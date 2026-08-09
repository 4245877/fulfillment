import {
  FILAMENT_MOVEMENT_SOURCES,
  type FilamentMovementSource,
} from "./types";
import type {
  AddFilamentInput,
  AdjustFilamentInput,
  ConsumeFilamentInput,
  LoadPrinterFilamentInput,
  SyncPrinterFilamentInput,
  UpdateFilamentInput,
} from "./service";

/**
 * A rejected request that never reached the database. Carries an HTTP status and
 * a stable machine `code` so the route layer can return a structured error
 * ({ error, code }) with the right status — and so a bad `source`, a NaN
 * quantity, a too-long note, etc. are refused up front instead of surfacing as a
 * raw Postgres constraint violation later.
 */
export class InventoryValidationError extends Error {
  readonly statusCode = 400;
  readonly code: string;

  constructor(message: string, code = "invalid_request") {
    super(message);
    this.name = "InventoryValidationError";
    this.code = code;
  }
}

// Field bounds — aligned with the DB column widths (migration 001/004) so valid
// input can always be stored and oversized input is refused before the query.
const MATERIAL_MAX = 80;
const COLOR_MAX = 80;
const COLOR_NAME_MAX = 160;
const NOTE_MAX = 2000;
const PRINTER_ID_MAX = 120;
const PRINT_JOB_ID_MAX = 120;
const IDEMPOTENCY_MAX = 160;
const STOCK_ID_MAX = 80;
// filament_stock.stock_g is a Postgres int4; keep a single op well under its max.
const GRAMS_MAX = 100_000_000;
const LENGTH_MM_MAX = 1_000_000_000;
const DIAMETER_MM_MAX = 100;
const AMS_TRAY_MAX = 255;

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InventoryValidationError(
      "Request body must be a JSON object",
      "invalid_body"
    );
  }
  return body as Record<string, unknown>;
}

function requireString(
  rec: Record<string, unknown>,
  field: string,
  max: number
): string {
  const raw = rec[field];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new InventoryValidationError(`${field} is required`, `missing_${field}`);
  }
  const value = raw.trim();
  if (value.length > max) {
    throw new InventoryValidationError(
      `${field} must be at most ${max} characters`,
      `too_long_${field}`
    );
  }
  return value;
}

function optionalString(
  rec: Record<string, unknown>,
  field: string,
  max: number
): string | undefined {
  const raw = rec[field];
  if (raw == null || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new InventoryValidationError(
      `${field} must be a string`,
      `invalid_${field}`
    );
  }
  const value = raw.trim();
  if (value === "") {
    return undefined;
  }
  if (value.length > max) {
    throw new InventoryValidationError(
      `${field} must be at most ${max} characters`,
      `too_long_${field}`
    );
  }
  return value;
}

/** Parses a number-or-numeric-string, rejecting NaN and ±Infinity. */
function finiteNumber(
  rec: Record<string, unknown>,
  field: string
): number {
  const raw = rec[field];
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new InventoryValidationError(`${field} is required`, `missing_${field}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new InventoryValidationError(
      `${field} must be a finite number`,
      `invalid_${field}`
    );
  }
  return value;
}

function requirePositive(
  rec: Record<string, unknown>,
  field: string,
  max: number
): number {
  const value = finiteNumber(rec, field);
  if (value <= 0) {
    throw new InventoryValidationError(
      `${field} must be greater than 0`,
      `non_positive_${field}`
    );
  }
  if (value > max) {
    throw new InventoryValidationError(
      `${field} must be at most ${max}`,
      `too_large_${field}`
    );
  }
  return value;
}

function requireNonNegative(
  rec: Record<string, unknown>,
  field: string,
  max: number
): number {
  const value = finiteNumber(rec, field);
  if (value < 0) {
    throw new InventoryValidationError(
      `${field} must not be negative`,
      `negative_${field}`
    );
  }
  if (value > max) {
    throw new InventoryValidationError(
      `${field} must be at most ${max}`,
      `too_large_${field}`
    );
  }
  return value;
}

function has(rec: Record<string, unknown>, field: string): boolean {
  return rec[field] != null && rec[field] !== "";
}

function optionalNonNegative(
  rec: Record<string, unknown>,
  field: string,
  max: number
): number | undefined {
  return has(rec, field) ? requireNonNegative(rec, field, max) : undefined;
}

function optionalPositive(
  rec: Record<string, unknown>,
  field: string,
  max: number
): number | undefined {
  return has(rec, field) ? requirePositive(rec, field, max) : undefined;
}

/** AMS slot: null when absent (printer-level reel); a 0..255 integer otherwise. */
function optionalAmsTray(rec: Record<string, unknown>): number | null {
  if (!has(rec, "amsTray")) {
    return null;
  }
  const value = Number(rec.amsTray);
  if (!Number.isInteger(value) || value < 0 || value > AMS_TRAY_MAX) {
    throw new InventoryValidationError(
      `amsTray must be an integer between 0 and ${AMS_TRAY_MAX}`,
      "invalid_amsTray"
    );
  }
  return value;
}

function optionalSource(
  rec: Record<string, unknown>
): FilamentMovementSource | undefined {
  if (!has(rec, "source")) {
    return undefined;
  }
  const raw = rec.source;
  if (
    typeof raw !== "string" ||
    !(FILAMENT_MOVEMENT_SOURCES as readonly string[]).includes(raw)
  ) {
    throw new InventoryValidationError(
      `source must be one of: ${FILAMENT_MOVEMENT_SOURCES.join(", ")}`,
      "invalid_source"
    );
  }
  return raw as FilamentMovementSource;
}

function optionalBoolean(
  rec: Record<string, unknown>,
  field: string
): boolean | undefined {
  const raw = rec[field];
  if (raw == null) {
    return undefined;
  }
  if (typeof raw !== "boolean") {
    throw new InventoryValidationError(
      `${field} must be a boolean`,
      `invalid_${field}`
    );
  }
  return raw;
}

// ── Per-route parsers ────────────────────────────────────────────────────────
// Each returns the exact input the service expects, or throws
// InventoryValidationError. Material/color/quantity are re-normalised by the
// service; validating here is the defence-in-depth layer that keeps malformed
// input away from the database.

export function parseAddFilamentBody(body: unknown): AddFilamentInput {
  const rec = asRecord(body);
  return {
    material: requireString(rec, "material", MATERIAL_MAX),
    color: requireString(rec, "color", COLOR_MAX),
    colorName: optionalString(rec, "colorName", COLOR_NAME_MAX),
    quantityG: requirePositive(rec, "quantityG", GRAMS_MAX),
    lowStockG: optionalNonNegative(rec, "lowStockG", GRAMS_MAX),
    criticalStockG: optionalNonNegative(rec, "criticalStockG", GRAMS_MAX),
    source: optionalSource(rec),
    note: optionalString(rec, "note", NOTE_MAX),
  };
}

export function parseConsumeFilamentBody(body: unknown): ConsumeFilamentInput {
  const rec = asRecord(body);

  const out: ConsumeFilamentInput = {};

  const material = optionalString(rec, "material", MATERIAL_MAX);
  if (material) out.material = material;
  const color = optionalString(rec, "color", COLOR_MAX);
  if (color) out.color = color;

  const quantityG = optionalPositive(rec, "quantityG", GRAMS_MAX);
  if (quantityG != null) out.quantityG = quantityG;
  const grams = optionalPositive(rec, "grams", GRAMS_MAX);
  if (grams != null) out.grams = grams;
  const lengthMm = optionalPositive(rec, "lengthMm", LENGTH_MM_MAX);
  if (lengthMm != null) out.lengthMm = lengthMm;

  if (out.quantityG == null && out.grams == null && out.lengthMm == null) {
    throw new InventoryValidationError(
      "Provide a positive quantityG, grams, or lengthMm to consume",
      "missing_quantity"
    );
  }

  const diameterMm = optionalPositive(rec, "diameterMm", DIAMETER_MM_MAX);
  if (diameterMm != null) out.diameterMm = diameterMm;

  const amsTray = optionalAmsTray(rec);
  if (amsTray != null) out.amsTray = amsTray;

  out.source = optionalSource(rec);

  const note = optionalString(rec, "note", NOTE_MAX);
  if (note) out.note = note;
  const printerId = optionalString(rec, "printerId", PRINTER_ID_MAX);
  if (printerId) out.printerId = printerId;
  const printJobId = optionalString(rec, "printJobId", PRINT_JOB_ID_MAX);
  if (printJobId) out.printJobId = printJobId;
  const idempotencyKey = optionalString(rec, "idempotencyKey", IDEMPOTENCY_MAX);
  if (idempotencyKey) out.idempotencyKey = idempotencyKey;

  return out;
}

export function parseAdjustFilamentBody(body: unknown): AdjustFilamentInput {
  const rec = asRecord(body);
  return {
    material: requireString(rec, "material", MATERIAL_MAX),
    color: requireString(rec, "color", COLOR_MAX),
    colorName: optionalString(rec, "colorName", COLOR_NAME_MAX),
    actualG: requireNonNegative(rec, "actualG", GRAMS_MAX),
    source: optionalSource(rec),
    note: optionalString(rec, "note", NOTE_MAX),
  };
}

export function parseUpdateFilamentBody(body: unknown): UpdateFilamentInput {
  const rec = asRecord(body);

  const id = optionalString(rec, "id", STOCK_ID_MAX);
  const material = optionalString(rec, "material", MATERIAL_MAX);
  const color = optionalString(rec, "color", COLOR_MAX);

  if (!id && !(material && color)) {
    throw new InventoryValidationError(
      "Provide id, or material and color, to identify the position",
      "missing_identifier"
    );
  }

  const lowStockG = optionalNonNegative(rec, "lowStockG", GRAMS_MAX);
  const criticalStockG = optionalNonNegative(rec, "criticalStockG", GRAMS_MAX);

  return {
    id,
    material,
    color,
    colorName: optionalString(rec, "colorName", COLOR_NAME_MAX),
    lowStockG,
    criticalStockG,
    enabled: optionalBoolean(rec, "enabled"),
  };
}

/**
 * Note what is deliberately NOT parsed here (nor in the sync body):
 * `printerName`. The name snapshot stored on a binding is resolved from the
 * printer directory by the route — a caller must never be able to label a
 * binding with a name of its own choosing.
 */
export function parseLoadPrinterFilamentBody(
  body: unknown
): LoadPrinterFilamentInput {
  const rec = asRecord(body);
  return {
    printerId: requireString(rec, "printerId", PRINTER_ID_MAX),
    amsTray: optionalAmsTray(rec),
    material: requireString(rec, "material", MATERIAL_MAX),
    color: requireString(rec, "color", COLOR_MAX),
    colorName: optionalString(rec, "colorName", COLOR_NAME_MAX),
  };
}

export function parseSyncPrinterFilamentBody(
  body: unknown
): SyncPrinterFilamentInput {
  const rec = asRecord(body);
  return {
    printerId: requireString(rec, "printerId", PRINTER_ID_MAX),
    amsTray: optionalAmsTray(rec),
    material: requireString(rec, "material", MATERIAL_MAX),
    color: optionalString(rec, "color", COLOR_MAX),
    colorName: optionalString(rec, "colorName", COLOR_NAME_MAX),
  };
}

/**
 * Recognises a driver/Postgres/infrastructure error so the route layer can turn
 * it into a generic 500 instead of leaking the raw DB message or connection
 * host. pg query errors carry a SQLSTATE `code` + pg-specific fields; driver and
 * connection errors carry an errno-style string `code` (ECONNREFUSED,
 * ETIMEDOUT, 42P01, …). Application errors thrown by the service are plain
 * Errors with NO `code`, so they fall through to a readable 4xx with their
 * message. (Validation errors are matched before this in the handler.)
 */
export function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const e = error as Record<string, unknown>;
  if (typeof e.code === "string" && e.code.length > 0) {
    return true;
  }
  return typeof e.severity === "string" || typeof e.routine === "string";
}
