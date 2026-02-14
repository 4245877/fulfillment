import { api, apiUrl } from "./client.js";

async function safeJson(p, fallback) {
  try {
    return await api.get(p, { timeoutMs: 10000 });
  } catch {
    return fallback;
  }
}

export const apiWB = {
  printsOverview: () =>
    safeJson("/api/prints/overview", { printers: [], jobs: [], stats: {} }),

  opsOverview: () =>
    safeJson("/api/ops/overview", {
      stats: {
        orders: {},
        payments: {},
        logistics: {},
        materials: {},
        queues: {},
        services: {},
        indexer: {},
        webhooks: {},
        alerts: [],
      },
      printers: [],
      jobs: [],
    }),
};

export function openSSE(path, onEvent) {
  let es;
  try {
    es = new EventSource(apiUrl(path));
    es.onmessage = (e) => {
      try { onEvent?.(JSON.parse(e.data)); } catch {}
    };
    es.onerror = () => { try { es.close(); } catch {} };
  } catch {}
  return () => { try { es?.close(); } catch {} };
}
