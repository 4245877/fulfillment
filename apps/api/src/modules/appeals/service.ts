// Appeals service — picks the data source for every operation and normalises
// what comes back to the shapes the dashboard "Звернення" page expects.
//
// Three explicit modes, resolved per call:
//
//   1. upstream — APPEALS_SERVICE_URL is set → proxy to an external appeals
//                 service and serve its appeals. (Not used in the current
//                 topology; kept for flexibility.)
//   2. mock     — APPEALS_SERVICE_URL is unset AND APPEALS_USE_MOCK is true →
//                 serve the in-memory demo store (./store.ts). Dev only.
//   3. local    — default: this API is the appeals store. Threads live in a
//                 file-backed store (./persistentStore.ts): the shop's
//                 "Поставити запитання майстру" chat creates them via
//                 ingestAppeal(), and operators read/answer them here. Starts
//                 empty (no seed data), so an empty inbox is real, not fake.
//
// Upstream payloads are unwrapped from optional { item } / { items } envelopes
// and run through normalizeAppeal so a slightly different upstream format can't
// crash the UI — normalisation lives here, not in the JSX.

import type { Appeal, AppealMessage, AppealStatus } from "./types";
import { isAppealStatus } from "./types";
import { localStore } from "./store";
import { persistentStore, type AppealIngestInput } from "./persistentStore";
import { isUpstreamEnabled, upstream } from "./upstream";
import { env } from "../../shared/env";

export class AppealsServiceUnavailableError extends Error {
  statusCode = 503;
  constructor(message = "Сервіс звернень недоступний") {
    super(message);
    this.name = "AppealsServiceUnavailableError";
  }
}

type Mode = "upstream" | "mock" | "local";

// APPEALS_SERVICE_URL wins when set (proxy to an external service). Otherwise
// APPEALS_USE_MOCK serves demo data (dev only), and the default is the local
// file-backed store — this API owns the appeals.
function resolveMode(): Mode {
  if (isUpstreamEnabled()) return "upstream";
  if (env.APPEALS_USE_MOCK) return "mock";
  return "local";
}

const unwrapItem = (res: any): any => (res && res.item ? res.item : res);

const unwrapItems = (res: any): any[] =>
  Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];

function normalizeMessage(raw: any): AppealMessage {
  return {
    id: String(raw?.id ?? `msg-${Math.random().toString(36).slice(2, 10)}`),
    author: raw?.author === "operator" ? "operator" : "customer",
    text: String(raw?.text ?? ""),
    at: typeof raw?.at === "string" ? raw.at : new Date().toISOString(),
  };
}

function normalizeAppeal(raw: any): Appeal {
  const customer = raw?.customer ?? {};
  const product = raw?.product ?? {};
  const messages = Array.isArray(raw?.messages) ? raw.messages : [];
  const created = typeof raw?.createdAt === "string" ? raw.createdAt : undefined;
  const last = typeof raw?.lastMessageAt === "string" ? raw.lastMessageAt : undefined;
  const fallbackTime = last ?? created ?? new Date().toISOString();

  return {
    id: String(raw?.id ?? ""),
    status: isAppealStatus(raw?.status) ? raw.status : "new",
    unread: Number.isFinite(Number(raw?.unread)) ? Number(raw.unread) : 0,
    createdAt: created ?? fallbackTime,
    lastMessageAt: last ?? fallbackTime,
    customer: {
      name: String(customer.name ?? ""),
      contact: String(customer.contact ?? ""),
    },
    product: {
      id: String(product.id ?? ""),
      name: String(product.name ?? ""),
      sku: String(product.sku ?? ""),
      url: String(product.url ?? ""),
    },
    messages: messages.map(normalizeMessage),
  };
}

export async function listAppeals(): Promise<Appeal[]> {
  switch (resolveMode()) {
    case "upstream":
      return unwrapItems(await upstream.list()).map(normalizeAppeal);
    case "mock":
      return localStore.list();
    case "local":
    default:
      return persistentStore.list();
  }
}

export async function getAppeal(id: string): Promise<Appeal> {
  switch (resolveMode()) {
    case "upstream":
      return normalizeAppeal(unwrapItem(await upstream.get(id)));
    case "mock":
      return localStore.get(id);
    case "local":
    default:
      return persistentStore.get(id);
  }
}

export async function markAppealRead(id: string): Promise<Appeal> {
  switch (resolveMode()) {
    case "upstream":
      return normalizeAppeal(unwrapItem(await upstream.markRead(id)));
    case "mock":
      return localStore.markRead(id);
    case "local":
    default:
      return persistentStore.markRead(id);
  }
}

export async function sendAppealMessage(
  id: string,
  text: string
): Promise<{ message: AppealMessage | null; item: Appeal }> {
  switch (resolveMode()) {
    case "upstream": {
      const res = await upstream.sendMessage(id, text);
      const item = normalizeAppeal(unwrapItem(res));
      const message = res?.message
        ? normalizeMessage(res.message)
        : item.messages[item.messages.length - 1] ?? null;
      return { message, item };
    }
    case "mock":
      return localStore.sendMessage(id, text);
    case "local":
    default:
      return persistentStore.sendMessage(id, text);
  }
}

export async function setAppealStatus(
  id: string,
  status: AppealStatus
): Promise<Appeal> {
  switch (resolveMode()) {
    case "upstream":
      return normalizeAppeal(unwrapItem(await upstream.setStatus(id, status)));
    case "mock":
      return localStore.setStatus(id, status);
    case "local":
    default:
      return persistentStore.setStatus(id, status);
  }
}

// Customer question from the shop's "Поставити запитання майстру" chat. Creates
// or appends to a thread. In upstream mode it forwards to the external service;
// otherwise it writes to the local (or, in dev, mock) store.
export async function ingestAppeal(
  input: AppealIngestInput
): Promise<{ item: Appeal; message: AppealMessage; created: boolean }> {
  switch (resolveMode()) {
    case "upstream": {
      const res = await upstream.ingest(input);
      const item = normalizeAppeal(unwrapItem(res));
      const message = res?.message
        ? normalizeMessage(res.message)
        : item.messages[item.messages.length - 1] ?? normalizeMessage({ text: input.message });
      return { item, message, created: Boolean(res?.created) };
    }
    case "mock":
      return localStore.ingest(input);
    case "local":
    default:
      return persistentStore.ingest(input);
  }
}
