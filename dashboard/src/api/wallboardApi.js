const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

function join(base, path) {
  if (path.startsWith("http")) return path;
  if (!base) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function getJson(path, fallback = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);

    const r = await fetch(join(API_BASE, path), {
      credentials: "include",
      signal: ctrl.signal,
    });

    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));

    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? await r.json() : fallback;
  } catch {
    return fallback;
  }
}

export const api = {
  printsOverview: () => getJson("/api/prints/overview", { printers: [], jobs: [], stats: {} }),
  opsOverview: () =>
    getJson("/api/ops/overview", {
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

// Если вдруг захочешь использовать вручную — без withCredentials (лучше same-origin через proxy/nginx)
export function openSSE(path, onEvent) {
  let es;
  try {
    es = new EventSource(join(API_BASE, path));
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {}
    };
    es.onerror = () => {
      try { es.close(); } catch {}
    };
  } catch {}
  return () => {
    try { es?.close(); } catch {}
  };
}
