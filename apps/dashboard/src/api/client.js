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
      // Prefer the clean { ok:false, error } contract the API returns on
      // non-2xx so callers can show a human message instead of a raw dump.
      let parsed = null;
      if (ct.includes("json") && text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
      const message =
        (parsed && typeof parsed.error === "string" && parsed.error) ||
        `${res.status} ${res.statusText} @ ${url}${snippet}`;

      const err = new Error(message);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }

    if (expect === "json") {
      if (!ct.includes("json")) {
        const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
        throw new Error(
          `Expected JSON but got "${ct || "unknown"}" @ ${url}${snippet}`
        );
      }
      if (!text) return null;
      return JSON.parse(text);
    }

    return text;
  } finally {
    if (t) clearTimeout(t);
  }
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    qs.set(key, String(value));
  });

  const text = qs.toString();
  return text ? `?${text}` : "";
}

export const api = {
  get: (path, opts) =>
    request(path, { ...(opts || {}), method: "GET", expect: "json" }),

  post: (path, body, opts) =>
    request(path, { ...(opts || {}), method: "POST", body, expect: "json" }),

  put: (path, body, opts) =>
    request(path, { ...(opts || {}), method: "PUT", body, expect: "json" }),

  patch: (path, body, opts) =>
    request(path, { ...(opts || {}), method: "PATCH", body, expect: "json" }),

  del: (path, opts) =>
    request(path, { ...(opts || {}), method: "DELETE", expect: "json" }),

  getText: (path, opts) =>
    request(path, { ...(opts || {}), method: "GET", expect: "text" }),

  listOrders: (params, opts) =>
    request(`/api/orders${buildQuery(params)}`, {
      ...(opts || {}),
      method: "GET",
      expect: "json",
    }),

  getOrder: (orderId, opts) =>
    request(`/api/orders/${encodeURIComponent(orderId)}`, {
      ...(opts || {}),
      method: "GET",
      expect: "json",
    }),

  updateOrderStatus: (orderId, payload, opts) =>
    request(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      ...(opts || {}),
      method: "PATCH",
      body: payload,
      expect: "json",
    }),

  reportProduct: (productId, payload, opts) =>
    request(`/api/products/${encodeURIComponent(productId)}/reports`, {
      ...(opts || {}),
      method: "POST",
      body: payload,
      expect: "json",
    }),

  listProductReports: (params, opts) =>
    request(`/api/product-reports${buildQuery(params)}`, {
      ...(opts || {}),
      method: "GET",
      expect: "json",
    }),

  updateProductReport: (reportId, payload, opts) =>
    request(`/api/product-reports/${encodeURIComponent(reportId)}`, {
      ...(opts || {}),
      method: "PATCH",
      body: payload,
      expect: "json",
    }),

  archiveProductReport: (reportId, opts) =>
    request(`/api/product-reports/${encodeURIComponent(reportId)}/archive`, {
      ...(opts || {}),
      method: "POST",
      expect: "json",
    }),

  restoreProductReport: (reportId, opts) =>
    request(`/api/product-reports/${encodeURIComponent(reportId)}/restore`, {
      ...(opts || {}),
      method: "POST",
      expect: "json",
    }),

  deleteProductReport: (reportId, opts) =>
    request(`/api/product-reports/${encodeURIComponent(reportId)}`, {
      ...(opts || {}),
      method: "DELETE",
      expect: "json",
    }),

  permanentlyDeleteProductReport: (reportId, opts) =>
    request(`/api/product-reports/${encodeURIComponent(reportId)}/permanent`, {
      ...(opts || {}),
      method: "DELETE",
      expect: "json",
    }),
};