// Appeals service — picks the data source for every operation and normalises
// what comes back to the shapes the dashboard "Звернення" page expects.
//
// Three explicit modes, resolved per call (never a silent fallback):
//
//   1. upstream     — APPEALS_SERVICE_URL is set → proxy to the shop service at
//                     192.168.0.139 and serve its real appeals.
//   2. mock         — APPEALS_SERVICE_URL is unset AND APPEALS_USE_MOCK is true →
//                     serve the in-memory demo store (./store.ts). Dev only.
//   3. unconfigured — neither is set → throw AppealsServiceUnavailableError so the
//                     page shows "Сервіс звернень недоступний" instead of fake
//                     chats. This is the default: we never pass seed data off as
//                     real customer appeals.
//
// Upstream payloads are unwrapped from optional { item } / { items } envelopes
// and run through normalizeAppeal so a slightly different upstream format can't
// crash the UI — normalisation lives here, not in the JSX.

import type { Appeal, AppealMessage, AppealStatus } from "./types";
import { isAppealStatus } from "./types";
import { localStore } from "./store";
import { isUpstreamEnabled, upstream } from "./upstream";
import { env } from "../../shared/env";

export class AppealsServiceUnavailableError extends Error {
  statusCode = 503;
  constructor(message = "Сервіс звернень недоступний") {
    super(message);
    this.name = "AppealsServiceUnavailableError";
  }
}

type Mode = "upstream" | "mock" | "unconfigured";

// APPEALS_SERVICE_URL wins when set — the real service is always the source of
// truth, so a stray APPEALS_USE_MOCK can never shadow it in production.
function resolveMode(): Mode {
  if (isUpstreamEnabled()) return "upstream";
  if (env.APPEALS_USE_MOCK) return "mock";
  return "unconfigured";
}

function unavailable(): never {
  throw new AppealsServiceUnavailableError();
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
    default:
      return unavailable();
  }
}

export async function getAppeal(id: string): Promise<Appeal> {
  switch (resolveMode()) {
    case "upstream":
      return normalizeAppeal(unwrapItem(await upstream.get(id)));
    case "mock":
      return localStore.get(id);
    default:
      return unavailable();
  }
}

export async function markAppealRead(id: string): Promise<Appeal> {
  switch (resolveMode()) {
    case "upstream":
      return normalizeAppeal(unwrapItem(await upstream.markRead(id)));
    case "mock":
      return localStore.markRead(id);
    default:
      return unavailable();
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
    default:
      return unavailable();
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
    default:
      return unavailable();
  }
}
