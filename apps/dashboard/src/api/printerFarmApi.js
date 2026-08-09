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
      // The status route reports orchestrator unavailability as JSON
      // ({ error }); surface that message instead of the raw body slice.
      let message = "";
      try {
        message = JSON.parse(text)?.error || "";
      } catch {
        /* not JSON */
      }

      throw new Error(
        message || `Запрос к API не выполнен: ${res.status}. ${text.slice(0, 200)}`
      );
    }

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`API вернул не JSON: ${text.slice(0, 160)}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Запрос к API превысил время ожидания");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

// Read-only: printers are configured and controlled in the atelier
// print-dashboard; fulfillment only mirrors their live statuses.
export async function fetchPrinterStatuses() {
  return requestJson("/api/printers/status");
}

/**
 * The CONFIGURED fleet as atelier defines it, including printers that are
 * currently disabled (`enabled: false`). Use this — not the status feed — to
 * populate lists and forms: statuses exist only for ENABLED printers and only
 * once the farm has polled them, so a picker built from statuses cannot offer a
 * printer that is merely offline, and cannot name a disabled one in history.
 */
export async function fetchPrinterInventory() {
  return requestJson("/api/printers/inventory");
}
