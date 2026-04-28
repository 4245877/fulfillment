export async function fetchPrinterStatuses() {
  const res = await fetch("/api/printers/status", {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Printer status request failed: ${res.status}`);
  }

  return res.json();
}