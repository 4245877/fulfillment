// Pure helpers for the "Последние движения" (recent movements) table. Kept free of
// React so they can be unit-tested (see inventoryMovements.test.js) — this is
// where the "printer name / — / unknown-safe" and "position / archived / safe"
// rendering rules live.

import { getColorName } from "./inventoryVocab.js";

/**
 * Builds a printerId → friendly-name map from whatever the printer-status API
 * returned. Tolerant of the API being unavailable or shaped differently: a
 * missing/degraded response yields an empty map (the UI then falls back to the
 * raw id) and never throws.
 *
 * @param {unknown} statusPayload  the GET /api/printers/status body, or null
 * @returns {Map<string, string>}
 */
export function buildPrinterNameMap(statusPayload) {
  const map = new Map();
  const printers = Array.isArray(statusPayload?.printers)
    ? statusPayload.printers
    : Array.isArray(statusPayload)
      ? statusPayload
      : [];

  for (const printer of printers) {
    const id = printer?.id;
    const name = printer?.name;
    if (typeof id === "string" && id && typeof name === "string" && name) {
      map.set(id, name);
    }
  }

  return map;
}

/**
 * How to render a movement's printer cell.
 *   - no printerId (manual op)         → "—", not flagged unknown
 *   - printerId with a known name      → the name, id in the tooltip
 *   - printerId we cannot resolve      → the raw id, flagged unknown (an old or
 *     deleted printer must not blank the cell or crash the row)
 */
export function resolvePrinterLabel(printerId, printerNameById) {
  if (!printerId) {
    return { text: "—", title: null, unknown: false, manual: true };
  }

  const name =
    printerNameById && typeof printerNameById.get === "function"
      ? printerNameById.get(printerId)
      : printerNameById?.[printerId];

  if (name) {
    return { text: name, title: printerId, unknown: false, manual: false };
  }

  return {
    text: printerId,
    title: "Неизвестный или удалённый принтер",
    unknown: true,
    manual: false,
  };
}

/**
 * How to render a movement's position (material + colour) cell from the
 * denormalised stock fields the API now returns on each movement.
 *   - resolvable position → "PLA Чёрный" (+ "(архив)" when archived)
 *   - missing/removed     → "—", flagged unknown (never crashes the render)
 * The stock id goes into the tooltip, so the table itself is not littered with
 * UUIDs.
 */
export function resolvePositionLabel(movement) {
  const material = movement?.stockMaterial || null;
  const colorName =
    movement?.stockColorName ||
    (movement?.stockColor ? getColorName(movement.stockColor) : null);

  const parts = [material, colorName].filter(Boolean);

  if (parts.length === 0) {
    return {
      text: "—",
      title: movement?.stockId || null,
      unknown: true,
      archived: false,
    };
  }

  const archived = movement?.stockEnabled === false;

  return {
    text: parts.join(" "),
    title: movement?.stockId || null,
    unknown: false,
    archived,
  };
}

/** Short, tooltip-friendly form of an opaque id — avoids dumping full UUIDs into the table. */
export function shortId(value) {
  const str = String(value || "");
  if (!str) return "";
  return str.length > 12 ? `…${str.slice(-8)}` : str;
}
