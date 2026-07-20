// Persistent, file-backed appeals store — the REAL source of truth for the
// "Обращения" inbox.
//
// Threads are created by the shop's "Задать вопрос мастеру" mini-chat,
// which POSTs each question to /api/appeals/ingest (see ./routes.ts). Operators
// then read and answer them from the dashboard. Text-only messages (stage 1).
//
// Storage is a single JSON file (data/appeals.json), written atomically
// (temp + rename) — the same pattern as the productReports repo. The API runs
// as one Fastify process, so every read-modify-write is serialised through an
// in-process queue to avoid lost updates when two requests race.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Appeal, AppealMessage, AppealStatus } from "./types";
import { isAppealStatus } from "./types";

const DATA_FILE =
  process.env.APPEALS_DATA_FILE ||
  path.join(process.cwd(), "data", "appeals.json");

interface AppealsStoreFile {
  version: 1;
  appeals: Appeal[];
}

// Payload accepted from the shop when a customer asks a question. The nested
// product/customer shape mirrors the shop's OutboundQuestion; the route also
// accepts the flat variant and maps it into this one before calling ingest().
export interface AppealIngestInput {
  threadId?: string | null;
  message: string;
  customer?: { name?: string | null; contact?: string | null } | null;
  product?: {
    id?: string | number | null;
    name?: string | null;
    sku?: string | null;
    url?: string | null;
  } | null;
  at?: string | null; // ISO timestamp of the customer message
}

export class AppealNotFoundError extends Error {
  statusCode = 404;
  constructor(message = "Обращение не найдено") {
    super(message);
    this.name = "AppealNotFoundError";
  }
}

const clone = <T,>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const byLatest = (a: Appeal, b: Appeal) =>
  new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();

const nextMessageId = () => `msg-${randomUUID()}`;

const isoOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const str = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

function normalizeMessage(raw: any): AppealMessage {
  return {
    id: str(raw?.id) || nextMessageId(),
    author: raw?.author === "operator" ? "operator" : "customer",
    text: str(raw?.text),
    at: isoOr(raw?.at, new Date().toISOString()),
  };
}

function normalizeAppeal(raw: any): Appeal {
  const customer = raw?.customer ?? {};
  const product = raw?.product ?? {};
  const messages = Array.isArray(raw?.messages) ? raw.messages.map(normalizeMessage) : [];
  const created = isoOr(raw?.createdAt, new Date().toISOString());

  return {
    id: str(raw?.id),
    status: isAppealStatus(raw?.status) ? raw.status : "new",
    unread: Number.isFinite(Number(raw?.unread)) ? Number(raw.unread) : 0,
    createdAt: created,
    lastMessageAt: isoOr(raw?.lastMessageAt, created),
    customer: { name: str(customer.name), contact: str(customer.contact) },
    product: {
      id: str(product.id),
      name: str(product.name),
      sku: str(product.sku),
      url: str(product.url),
    },
    messages,
  };
}

function createEmptyStore(): AppealsStoreFile {
  return { version: 1, appeals: [] };
}

async function readStore(): Promise<AppealsStoreFile> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const appeals = Array.isArray(parsed?.appeals) ? parsed.appeals : [];
    return { version: 1, appeals: appeals.map(normalizeAppeal) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return createEmptyStore();
    }
    throw error;
  }
}

async function writeStore(store: AppealsStoreFile): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmpFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmpFile, DATA_FILE);
}

// Serialise all access so concurrent requests can't clobber each other's
// read-modify-write. Reads go through the queue too, so they always observe a
// consistent snapshot between writes.
let queue: Promise<unknown> = Promise.resolve();

function withStore<T>(fn: (store: AppealsStoreFile) => T | Promise<T>, persist: boolean): Promise<T> {
  const run = queue.then(async () => {
    const store = await readStore();
    const result = await fn(store);
    if (persist) await writeStore(store);
    return result;
  });
  // Keep the chain alive even if this task rejects.
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const findThread = (store: AppealsStoreFile, id: string): Appeal | undefined =>
  store.appeals.find((thread) => thread.id === id);

export const persistentStore = {
  list(): Promise<Appeal[]> {
    return withStore((store) => clone(store.appeals).sort(byLatest), false);
  },

  get(id: string): Promise<Appeal> {
    return withStore((store) => {
      const thread = findThread(store, id);
      if (!thread) throw new AppealNotFoundError();
      return clone(thread);
    }, false);
  },

  markRead(id: string): Promise<Appeal> {
    return withStore((store) => {
      const thread = findThread(store, id);
      if (!thread) throw new AppealNotFoundError();
      thread.unread = 0;
      return clone(thread);
    }, true);
  },

  // Operator reply. A brand-new appeal moves into active work automatically.
  sendMessage(id: string, text: string): Promise<{ message: AppealMessage; item: Appeal }> {
    return withStore((store) => {
      const thread = findThread(store, id);
      if (!thread) throw new AppealNotFoundError();

      const message: AppealMessage = {
        id: nextMessageId(),
        author: "operator",
        text: String(text).trim(),
        at: new Date().toISOString(),
      };

      thread.messages.push(message);
      thread.lastMessageAt = message.at;
      if (thread.status === "new") thread.status = "in_progress";

      return { message: clone(message), item: clone(thread) };
    }, true);
  },

  setStatus(id: string, status: AppealStatus): Promise<Appeal> {
    return withStore((store) => {
      const thread = findThread(store, id);
      if (!thread) throw new AppealNotFoundError();
      thread.status = status;
      return clone(thread);
    }, true);
  },

  // Customer question from the shop. A provided threadId is used only to look up
  // an existing thread to append to; a new thread always gets a server-minted
  // UUID (see below). A reply from the customer re-opens a closed thread so the
  // operator sees it again.
  ingest(
    input: AppealIngestInput
  ): Promise<{ item: Appeal; message: AppealMessage; created: boolean }> {
    return withStore((store) => {
      const text = String(input.message ?? "").trim();
      const at = isoOr(input.at, new Date().toISOString());
      const message: AppealMessage = {
        id: nextMessageId(),
        author: "customer",
        text,
        at,
      };

      const existingId = input.threadId ? String(input.threadId) : "";
      let thread = existingId ? findThread(store, existingId) : undefined;
      let created = false;

      if (!thread) {
        // A brand-new thread always gets an unguessable server-minted UUID. The
        // read side (GET /api/appeals/ingest/:threadId) is public and returns a
        // thread's whole message history by id, so honouring a caller-chosen
        // (possibly sequential) id would let anyone enumerate other customers'
        // chats. The caller gets this id back and uses it for follow-up messages.
        thread = {
          id: randomUUID(),
          status: "new",
          unread: 0,
          createdAt: at,
          lastMessageAt: at,
          customer: {
            name: str(input.customer?.name),
            contact: str(input.customer?.contact),
          },
          product: {
            id: str(input.product?.id),
            name: str(input.product?.name),
            sku: str(input.product?.sku),
            url: str(input.product?.url),
          },
          messages: [],
        };
        store.appeals.push(thread);
        created = true;
      } else {
        // Fill in any customer/product context that was missing before.
        thread.customer.name ||= str(input.customer?.name);
        thread.customer.contact ||= str(input.customer?.contact);
        thread.product.name ||= str(input.product?.name);
        thread.product.sku ||= str(input.product?.sku);
        thread.product.url ||= str(input.product?.url);
        thread.product.id ||= str(input.product?.id);
        if (thread.status === "closed") thread.status = "in_progress";
      }

      thread.messages.push(message);
      thread.lastMessageAt = at;
      thread.unread += 1;

      return { item: clone(thread), message: clone(message), created };
    }, true);
  },
};
