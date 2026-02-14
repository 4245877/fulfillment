const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function toUrl(path) {
  if (!path) return API_BASE || "/";
  // абсолютный URL — не трогаем
  if (/^https?:\/\//i.test(path)) return path;
  // относительный к API_BASE (если задан), иначе как было
  if (!API_BASE) return path;
  if (path.startsWith("/")) return `${API_BASE}${path}`;
  return `${API_BASE}/${path}`;
}

async function request(path, { method = "GET", headers, body, expect = "json" } = {}) {
  const url = toUrl(path);

  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text(); // читаем один раз

  // Любой не-OK — ошибка с телом (если есть)
  if (!res.ok) {
    const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
    throw new Error(`${res.status} ${res.statusText} @ ${url}${snippet}`);
  }

  // ВАЖНО: если ожидали JSON, а пришёл HTML/текст — это тоже ошибка
  if (expect === "json") {
    if (!ct.includes("json")) {
      const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
      throw new Error(
        `Expected JSON but got "${ct || "unknown"}" @ ${url}${snippet}\n\n` +
          `Підказка: якщо API ще не запущений — це нормально. UI не має падати.`
      );
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON @ ${url}\n\n${text.slice(0, 300)}`);
    }
  }

  // Для редких случаев текста
  return text;
}

export const api = {
  get: (path, opts) => request(path, { ...(opts || {}), method: "GET", expect: "json" }),
  post: (path, body, opts) => request(path, { ...(opts || {}), method: "POST", body, expect: "json" }),
  put: (path, body, opts) => request(path, { ...(opts || {}), method: "PUT", body, expect: "json" }),
  del: (path, opts) => request(path, { ...(opts || {}), method: "DELETE", expect: "json" }),

  // если когда-нибудь понадобится текст:
  getText: (path, opts) => request(path, { ...(opts || {}), method: "GET", expect: "text" }),
};
