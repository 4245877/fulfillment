export type FilamentMovementType = "add" | "consume" | "adjust";

export type FilamentMovementSource =
  | "dashboard"
  | "telegram"
  | "printer"
  | "system";

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