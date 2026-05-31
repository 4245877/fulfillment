const REQUEST_TIMEOUT_MS = 8000;
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || "";

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(path, {
      credentials: "include",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(
        `Запит до API не виконано: ${res.status}. ${text.slice(0, 200)}`
      );
    }

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`API повернув не JSON: ${text.slice(0, 160)}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Запит до API перевищив час очікування");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchPrinterStatuses() {
  return requestJson("/api/printers/status");
}

export async function fetchPrinterConfigs() {
  return requestJson("/api/printers/config");
}

export async function savePrinterConfigs(printers) {
  return requestJson("/api/printers/config", {
    method: "POST",
    body: JSON.stringify({
      printers: Array.isArray(printers) ? printers : [],
    }),
  });
}

export async function testPrinterConnection(printer) {
  return requestJson("/api/printers/test", {
    method: "POST",
    body: JSON.stringify(printer ?? {}),
  });
}