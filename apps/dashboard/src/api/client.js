const RAW_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE || // обратная совместимость
  "";

const API_BASE = String(RAW_BASE).replace(/\/+$/, "");

export function apiUrl(path) {
  const p = String(path || "");
  if (!p) return API_BASE || "/";
  if (/^https?:\/\//i.test(p)) return p;

  if (!API_BASE) {
    return p.startsWith("/") ? p : `/${p}`;
  }
  return p.startsWith("/") ? `${API_BASE}${p}` : `${API_BASE}/${p}`;
}

async function request(
  path,
  {
    method = "GET",
    headers,
    body,
    expect = "json",
    timeoutMs = 15000,
    signal,
    credentials = "same-origin",
  } = {}
) {
  const url = apiUrl(path);

  const ctrl = !signal ? new AbortController() : null;
  const usedSignal = signal || ctrl?.signal;

  const t =
    timeoutMs && ctrl
      ? setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs)
      : null;

  try {
    const res = await fetch(url, {
      method,
      credentials,
      signal: usedSignal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    if (!res.ok) {
      const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
      throw new Error(`${res.status} ${res.statusText} @ ${url}${snippet}`);
    }

    if (expect === "json") {
      if (!ct.includes("json")) {
        const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
        throw new Error(`Expected JSON but got "${ct || "unknown"}" @ ${url}${snippet}`);
      }
      if (!text) return null;
      return JSON.parse(text);
    }

    return text;
  } finally {
    if (t) clearTimeout(t);
  }
}

export const api = {
  get: (path, opts) => request(path, { ...(opts || {}), method: "GET", expect: "json" }),
  post: (path, body, opts) => request(path, { ...(opts || {}), method: "POST", body, expect: "json" }),
  put: (path, body, opts) => request(path, { ...(opts || {}), method: "PUT", body, expect: "json" }),
  del: (path, opts) => request(path, { ...(opts || {}), method: "DELETE", expect: "json" }),

  getText: (path, opts) => request(path, { ...(opts || {}), method: "GET", expect: "text" }),
};
