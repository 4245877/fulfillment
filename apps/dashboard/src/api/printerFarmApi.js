export async function fetchPrinterStatuses() {
  const res = await fetch("/api/printers/status", {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `Printer status request failed: ${res.status}. ${text.slice(0, 160)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `API вернул не JSON: ${text.slice(0, 160)}`
    );
  }
}