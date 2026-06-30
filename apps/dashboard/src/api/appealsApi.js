// Appeals (Звернення) — customer ⇄ operator chat data layer.
//
// This is a thin client over the fulfillment API's /api/appeals routes (served
// same-origin and proxied by nginx → api:8080, like every other dashboard
// call). The API itself either serves an in-memory store or proxies to the shop
// service at 192.168.0.139 — that choice lives server-side behind the
// APPEALS_SERVICE_URL env var, so neither the address nor the data source is
// hardcoded here. See apps/api/src/modules/appeals/* for the backend.
//
// The shop's "Поставити запитання майстру" mini-chat creates threads on the
// shop side; this layer only reads/answers them, so it stays compatible with
// that flow.
//
// Endpoints:
//   list()              → GET    /api/appeals               { items }
//   get(id)             → GET    /api/appeals/:id           { item }
//   markRead(id)        → POST   /api/appeals/:id/read      { item }
//   sendMessage(id,txt) → POST   /api/appeals/:id/messages  { message, item }
//   setStatus(id,status)→ PATCH  /api/appeals/:id           { item }
//
// ── Real-time ───────────────────────────────────────────────────────────────
// New customer messages are not pushed yet — the page refreshes manually. When
// the shop service exposes an events stream, subscribe via the existing
// src/hooks/useSSE.js (the API already serves SSE at /api/events/stream) and
// merge incoming threads/messages into the list.

import { api } from "./client.js";

export const appealsApi = {
  async list() {
    const res = await api.get("/api/appeals");
    return Array.isArray(res) ? res : res?.items ?? [];
  },

  async get(id) {
    const res = await api.get(`/api/appeals/${encodeURIComponent(id)}`);
    return res?.item ?? res ?? null;
  },

  async markRead(id) {
    const res = await api.post(`/api/appeals/${encodeURIComponent(id)}/read`);
    return res?.item ?? res ?? null;
  },

  async sendMessage(id, text) {
    const res = await api.post(
      `/api/appeals/${encodeURIComponent(id)}/messages`,
      { text }
    );
    // The page consumes { thread } — keep that shape, accept { item } from the API.
    return { message: res?.message ?? null, thread: res?.item ?? res ?? null };
  },

  async setStatus(id, status) {
    const res = await api.patch(`/api/appeals/${encodeURIComponent(id)}`, {
      status,
    });
    return res?.item ?? res ?? null;
  },
};
