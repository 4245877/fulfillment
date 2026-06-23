// Pure, DOM-free helpers for the printer manager form. Kept out of the React
// component so the save/edit logic can be unit-tested without a build step:
//   node --test src/components/printers/printerForm.test.js

export const DEFAULT_PRINTER = {
  id: "",
  name: "",
  model: "",
  imageUrl: "/printer-images/default-printer.png",
  protocol: "moonraker",
  host: "",
  port: 80,
  deviceUi: "",
  snapshotUrl: "",
  profile: "fdm-0.4",
  material: "PLA",
  nozzle: "0.4",
  enabled: true,
  apiKey: "",
  serial: "",
  accessCode: "",
};

export function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґё]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

export function makeIdFromName(name) {
  return normalizeSlug(name) || `printer-${Date.now()}`;
}

export function makeEmptyPrinter() {
  return {
    ...DEFAULT_PRINTER,
    id: `printer-${Date.now()}`,
    name: "Новий принтер",
  };
}

export function formToPrinter(form, fallbackName) {
  return {
    ...form,
    id: String(form.id || "").trim() || makeIdFromName(fallbackName ?? form.name),
    name: String(form.name || "").trim(),
    host: String(form.host || "").trim(),
    port: Number(form.port) || undefined,
    enabled: form.enabled !== false,
  };
}

// Builds the printers array to persist for a save. This is the single source of
// truth for *which* printer an edit lands on.
//
// The dashboard's original bug was that the edit form had no per-printer
// selector, so `selectedId` was stuck on printers[0] and every change — a
// nozzle, a host, a camera URL — silently overwrote the first printer instead
// of the one being edited. Hence "changing the K2's nozzle set it on all the
// others".
//
// Rules:
//   - Creating, or no valid selection: append a new printer and leave every
//     existing one untouched. Never fall back to rewriting printers[0].
//   - Editing an existing printer: replace exactly the row whose id ===
//     selectedId, and pin the written id to selectedId. A printer's id is its
//     primary key (the server restores masked secrets by it and the UI shows it
//     read-only), so an edit must never re-key the record, spawn a duplicate,
//     or — if the list ever held a clashing id — touch a second row.
export function buildNextPrinters({ printers, form, selectedId, isCreating }) {
  const list = Array.isArray(printers) ? printers : [];

  const editingExisting =
    !isCreating && Boolean(selectedId) && list.some((p) => p.id === selectedId);

  if (!editingExisting) {
    const nextPrinter = formToPrinter(form);
    return { nextPrinter, nextPrinters: [...list, nextPrinter] };
  }

  const nextPrinter = formToPrinter({ ...form, id: selectedId });

  let replaced = false;
  const nextPrinters = list.map((printer) => {
    if (!replaced && printer.id === selectedId) {
      replaced = true;
      return nextPrinter;
    }

    return printer;
  });

  return { nextPrinter, nextPrinters };
}
