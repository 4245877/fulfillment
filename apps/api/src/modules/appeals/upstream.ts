// Upstream appeals proxy — talks to the shop service at 192.168.0.139.
//
// The dashboard browser must NOT reach the LAN service directly (it is served
// from a different origin and the shop host is not publicly routable). Instead
// the fulfillment API acts as the proxy: the dashboard calls /api/appeals here,
// and — when APPEALS_SERVICE_URL is configured — we forward to the shop's own
// appeals endpoints. This mirrors how the backups module and the shop health
// probe reach other LAN hosts from the server side.
//
// ── Wiring the real service ─────────────────────────────────────────────────
// Set APPEALS_SERVICE_URL (e.g. http://192.168.0.139) in the API environment.
// The shop service is expected to expose, under that base:
//
//   GET    /api/appeals                 → { items: Appeal[] }  (or Appeal[])
//   GET    /api/appeals/:id             → { item: Appeal }     (or Appeal)
//   POST   /api/appeals/:id/read        → { item: Appeal }
//   POST   /api/appeals/:id/messages    → { message, item }    body: { text }
//   PATCH  /api/appeals/:id             → { item: Appeal }     body: { status }
//
// Until that lands, leave APPEALS_SERVICE_URL unset and the service layer serves
// the in-memory store (./store.ts) so the page works end-to-end today.

import { env } from "../../shared/env";

const TIMEOUT_MS = 8000;

export function isUpstreamEnabled(): boolean {
  return Boolean(env.APPEALS_SERVICE_URL);
}

function baseUrl(): string {
  return String(env.APPEALS_SERVICE_URL).replace(/\/+$/, "");
}

export class UpstreamError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "UpstreamError";
    this.statusCode = statusCode;
  }
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: init.method || "GET",
      signal: controller.signal,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    const text = await res.text();
    const json = text ? safeJson(text) : null;

    if (!res.ok) {
      const message =
        (json && typeof json.error === "string" && json.error) ||
        `Сервіс звернень повернув ${res.status}`;
      throw new UpstreamError(message, res.status);
    }

    return json as T;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    // Network failure / timeout — never leak the raw transport error.
    throw new UpstreamError("Сервіс звернень недоступний");
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const upstream = {
  list: () => call<any>("/api/appeals"),
  get: (id: string) => call<any>(`/api/appeals/${encodeURIComponent(id)}`),
  markRead: (id: string) =>
    call<any>(`/api/appeals/${encodeURIComponent(id)}/read`, { method: "POST" }),
  sendMessage: (id: string, text: string) =>
    call<any>(`/api/appeals/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: { text },
    }),
  setStatus: (id: string, status: string) =>
    call<any>(`/api/appeals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { status },
    }),
};
