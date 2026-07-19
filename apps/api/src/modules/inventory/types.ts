// Canonical movement vocabularies — the SINGLE source of truth. These literal
// sets must stay in sync with:
//   • the DB CHECK constraints (filament_movements_type_check /
//     filament_movements_source_check, migration 001_inventory.ts), and
//   • the dashboard labels (apps/dashboard/src/pages/inventoryVocab.js).
// The API validation layer (validation.ts) rejects anything outside them before
// a query runs, so the DB constraint is only a backstop.
export const FILAMENT_MOVEMENT_TYPES = ["add", "consume", "adjust"] as const;

export type FilamentMovementType = (typeof FILAMENT_MOVEMENT_TYPES)[number];

export const FILAMENT_MOVEMENT_SOURCES = [
  "dashboard",
  "telegram",
  "printer",
  "system",
] as const;

export type FilamentMovementSource =
  (typeof FILAMENT_MOVEMENT_SOURCES)[number];

export type FilamentStock = {
  id: string;
  material: string;
  color: string;
  colorName: string;
  stockG: number;
  lowStockG: number;
  criticalStockG: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FilamentMovement = {
  id: string;
  stockId: string;
  type: FilamentMovementType;
  quantityG: number;
  beforeG: number;
  afterG: number;
  source: FilamentMovementSource;
  note: string | null;
  printerId: string | null;
  printJobId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
};

/**
 * A movement enriched with a snapshot of its stock position (material / colour),
 * so the dashboard's "Останні рухи" table can show WHICH position moved without
 * a second lookup — and without breaking when that position was later archived
 * (enabled = false) or removed (all stock fields null). Denormalised at read
 * time via a LEFT JOIN in {@link listFilamentMovementViews}; the API keeps the
 * raw movement fields unchanged and only adds the `stock*` fields.
 */
export type FilamentMovementView = FilamentMovement & {
  stockMaterial: string | null;
  stockColor: string | null;
  stockColorName: string | null;
  stockEnabled: boolean | null;
};

export type PrinterFilamentState = {
  id: string;
  printerId: string;
  /**
   * AMS slot this reel is loaded into, for multi-slot printers (Bambu AMS).
   * `null` is the printer-level reel — the only kind single-spool printers have.
   * At most one row per (printerId, amsTray), including the null slot.
   */
  amsTray: number | null;
  stockId: string;
  material: string;
  color: string;
  updatedAt: string;
};

export type InventoryStore = {
  version: 1;
  filamentStock: FilamentStock[];
  filamentMovements: FilamentMovement[];
  printerFilamentState: PrinterFilamentState[];
};

export type StockStatus = "ok" | "low" | "critical";

export type FilamentStockView = FilamentStock & {
  stockKg: number;
  status: StockStatus;
};

// ── Filament availability (read-only shop feed) ────────────────────────────
//
// The aggregated material×color availability the online shop reads over
// GET /api/inventory/filament/availability. Shaped for an external consumer
// (snake_case, canonical material/color values, a single availability
// threshold) — deliberately distinct from FilamentStockView, which speaks the
// dashboard's warehouse vocabulary (low/critical warning bands).

export type CanonicalMaterial = "PLA" | "PETG" | "TPU" | "ABS" | "ASA";

export type CanonicalColor =
  | "Black"
  | "White"
  | "Grey"
  | "Yellow"
  | "Transparent"
  | "Bronze"
  | "Orange"
  | "Green"
  | "Silver"
  | "Red"
  | "Blue"
  | "Purple"
  | "Gold"
  | "Multicolor";

export type FilamentAvailabilityStatus = "ok" | "low" | "critical";

/**
 * Why a position is not available. Absent for available positions.
 *  - `out_of_stock`    — zero grams on the shelf.
 *  - `below_threshold` — some grams, but below the availability threshold.
 *  - `unmapped`        — material or color could not be canonicalized (kept in
 *                        the feed for diagnostics, never available).
 */
export type FilamentAvailabilityReason =
  | "out_of_stock"
  | "below_threshold"
  | "unmapped";

export type FilamentAvailabilityItem = {
  stock_id: string;
  /** Canonical material, or null when the raw value could not be mapped. */
  material: CanonicalMaterial | null;
  /** Canonical color, or null when the raw value could not be mapped. */
  color: CanonicalColor | null;
  /** The untouched stored values, always present for diagnostics. */
  material_raw: string;
  color_raw: string;
  mapped: boolean;
  available: boolean;
  available_weight_g: number;
  status: FilamentAvailabilityStatus;
  reason?: FilamentAvailabilityReason;
};

export type FilamentAvailabilityResponse = {
  version: 1;
  /** Max updated_at across the returned positions; null when the shelf is empty. */
  updated_at: string | null;
  threshold_g: number;
  items: FilamentAvailabilityItem[];
};