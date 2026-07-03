import { EventEmitter } from "node:events";

// Lightweight in-process event bus that backs the SSE stream (/api/events/stream).
// Domain modules publish notable changes here; every connected dashboard client
// is a subscriber and receives them live. Single-process only — good enough for
// this deployment (one Fastify instance). If the API is ever scaled out, replace
// the emitter with a shared broker (Redis pub/sub, Postgres LISTEN/NOTIFY).

export type DomainEvent = {
  domain: string; // "orders" | "appeals" | "inventory" | "ops"
  type: string; // "received" | "status_changed" | "message" | ...
  ts: string;
  payload: unknown;
};

const emitter = new EventEmitter();
// Many concurrent SSE clients each add a listener; lift the default cap so a
// busy wallboard doesn't trip Node's MaxListenersExceededWarning.
emitter.setMaxListeners(0);

const CHANNEL = "event";

export function publishEvent(event: {
  domain: string;
  type: string;
  payload?: unknown;
  ts?: string;
}): void {
  const full: DomainEvent = {
    domain: event.domain,
    type: event.type,
    ts: event.ts ?? new Date().toISOString(),
    payload: event.payload ?? {},
  };

  emitter.emit(CHANNEL, full);
}

export function subscribeEvents(listener: (event: DomainEvent) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => {
    emitter.off(CHANNEL, listener);
  };
}
