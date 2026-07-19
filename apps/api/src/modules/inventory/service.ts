import { randomUUID } from "node:crypto";

import { env } from "../../shared/env";
import { publishEvent } from "../../core/events";
import { enqueueFilamentLowStockNotification } from "../notifications/dispatcher";
import {
  listFilamentMovementViews,
  listPrinterStateRows,
  listStockRows,
  readMaterialsSnapshot,
  runInventoryMutation,
  type InventoryMutationScope,
} from "./repo";

import type {
  CanonicalColor,
  CanonicalMaterial,
  FilamentAvailabilityItem,
  FilamentAvailabilityResponse,
  FilamentMovement,
  FilamentMovementSource,
  FilamentMovementView,
  FilamentStock,
  FilamentStockView,
  InventoryStore,
  PrinterFilamentState,
  StockStatus,
} from "./types";

export type AddFilamentInput = {
  material: string;
  color: string;
  colorName?: string;
  quantityG: number;
  lowStockG?: number;
  criticalStockG?: number;
  source?: FilamentMovementSource;
  note?: string;
};

export type ConsumeFilamentInput = {
  material?: string;
  color?: string;
  /** Grams to consume. Provide this OR grams OR lengthMm. */
  quantityG?: number;
  /** Alias for quantityG — the field name the print-orchestrator sends. */
  grams?: number;
  /**
   * Extruded filament length in mm (e.g. Klipper print_stats.filament_used).
   * Converted to grams via the resolved material's density when quantityG is absent.
   */
  lengthMm?: number;
  /** Filament diameter in mm for the length→grams conversion (default 1.75). */
  diameterMm?: number;
  /**
   * AMS slot the consumption came from (Bambu). Resolves the reel loaded into
   * that slot via printer_filament_state (printerId, amsTray); without a
   * per-slot row the printer-level reel (amsTray null) is used.
   */
  amsTray?: number;
  source?: FilamentMovementSource;
  note?: string;
  printerId?: string;
  printJobId?: string;
  idempotencyKey?: string;
};

export type AdjustFilamentInput = {
  material: string;
  color: string;
  colorName?: string;
  actualG: number;
  source?: FilamentMovementSource;
  note?: string;
};

export type UpdateFilamentInput = {
  /** Identify the stock either by its id or by material+color. */
  id?: string;
  material?: string;
  color?: string;
  colorName?: string;
  lowStockG?: number;
  criticalStockG?: number;
  /** Toggle whether the position is active (archived positions leave the list). */
  enabled?: boolean;
};

export type LoadPrinterFilamentInput = {
  printerId: string;
  /** AMS slot to bind the reel to (multi-slot printers); omit for the printer-level reel. */
  amsTray?: number | null;
  material: string;
  color: string;
  colorName?: string;
};

/**
 * The loaded-reel hint the print-orchestrator sends, resolved to an existing
 * stock rather than creating one (unlike {@link LoadPrinterFilamentInput}). The
 * material may carry a brand suffix and the colour is a device hex; both are
 * translated to a stock position by {@link resolveStockForDeviceMatch}.
 */
export type SyncPrinterFilamentInput = {
  printerId: string;
  /** AMS slot (multi-slot printers); omit/null for the printer-level reel. */
  amsTray?: number | null;
  material: string;
  /** Device colour hint — a `#RRGGBB` hex or a named colour; optional. */
  color?: string;
  colorName?: string;
};

export type SyncPrinterFilamentResult =
  | {
      resolved: true;
      state: PrinterFilamentState;
      stock: FilamentStockView;
      /** True when the binding actually moved to a different stock (vs an idempotent re-sync). */
      changed: boolean;
      /** How the stock was chosen (see {@link resolveStockForDeviceMatch}). */
      matchedBy: "material-color" | "material-only";
      /** True when the reel's reported colour provably differs from the bound stock's. */
      colorMismatch: boolean;
      /** The stock the slot was bound to before this sync, when it changed; else null. */
      previousStock: {
        id: string;
        material: string;
        color: string;
        colorName: string | null;
      } | null;
    }
  | {
      resolved: false;
      printerId: string;
      amsTray: number | null;
      material: string;
      reason: string;
    };

const COLOR_NAMES: Record<string, string> = {
  black: "Чорний",
  white: "Білий",
  gray: "Сірий",
  grey: "Сірий",
  red: "Червоний",
  blue: "Синій",
  green: "Зелений",
  yellow: "Жовтий",
  orange: "Помаранчевий",
  transparent: "Прозорий",
  clear: "Прозорий",
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function normalizeMaterial(value: unknown): string {
  const material = String(value || "").trim().toUpperCase();

  if (!material) {
    throw new Error("Material is required");
  }

  return material;
}

function normalizeColor(value: unknown): string {
  const color = String(value || "").trim().toLowerCase();

  if (!color) {
    throw new Error("Color is required");
  }

  return color;
}

function normalizeColorName(color: string, colorName?: string): string {
  const clean = String(colorName || "").trim();

  if (clean) {
    return clean;
  }

  return COLOR_NAMES[color] || color.slice(0, 1).toUpperCase() + color.slice(1);
}

function normalizeQuantity(value: unknown, field = "quantityG"): number {
  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`${field} must be a positive number`);
  }

  const rounded = Math.round(quantity);

  // Stock is tracked in whole grams. A positive value that rounds to zero must
  // NOT silently become a 0 g movement (it would still consume the idempotency
  // key); the caller accumulates such micro-amounts and re-sends them once they
  // reach a whole gram (see apps/atelier FilamentConsumption).
  if (rounded === 0) {
    throw new Error(`${field} is below the minimum unit of 1 g`);
  }

  return rounded;
}

function normalizeNonNegative(value: unknown, field: string): number {
  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }

  return Math.round(quantity);
}

function normalizePositiveFloat(value: unknown, field: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number`);
  }

  return parsed;
}

const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;
const DEFAULT_FILAMENT_DENSITY_G_CM3 = 1.24;

// Filament density by material (g/cm³), used to convert extruded length → mass.
const FILAMENT_DENSITY_G_CM3: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.06,
  ASA: 1.06,
  TPU: 1.21,
  PC: 1.2,
  PA: 1.14,
  NYLON: 1.14,
};

function densityForMaterial(material: string): number {
  return (
    FILAMENT_DENSITY_G_CM3[material.toUpperCase()] ?? DEFAULT_FILAMENT_DENSITY_G_CM3
  );
}

/**
 * Converts extruded filament length (mm) to mass (grams) for a solid cylindrical
 * strand: mass = π·r²·length·density. Diameter/length in mm, density in g/cm³.
 */
function lengthMmToGrams(
  lengthMm: number,
  material: string,
  diameterMm = DEFAULT_FILAMENT_DIAMETER_MM
): number {
  const radiusCm = diameterMm / 2 / 10;
  const lengthCm = lengthMm / 10;
  const volumeCm3 = Math.PI * radiusCm * radiusCm * lengthCm;

  return volumeCm3 * densityForMaterial(material);
}

// ── Device-hint resolution ─────────────────────────────────────────────────
//
// The print-orchestrator reports the filament a printer has *loaded* straight
// from the device, so a reel can be bound to a printer with no manual dashboard
// entry (see syncPrinterFilament). Those hints are raw device values — the
// material may carry a brand suffix ("PLA Basic") and the colour is a hex
// (`#RRGGBB`), while stock is keyed on a base material and a named colour. These
// helpers translate a hint to an existing stock position without ever inventing
// one.

/** Known polymer families, longest-first so "PETG" wins over a bare "PET". */
const MATERIAL_FAMILIES = [
  "PETG",
  "PET",
  "PLA",
  "TPU",
  "ABS",
  "ASA",
  "PVA",
  "HIPS",
  "PACF",
  "PAHT",
  "PA",
  "PC",
  "NYLON",
];

/**
 * Reduces a raw device material to its stock family: uppercased, with any brand
 * suffix stripped ("PLA Basic" → "PLA", "PETG-CF" → "PETG"). Falls back to the
 * cleaned string when nothing matches, so an unknown material still compares
 * consistently. Used for the device-facing paths only (loaded-reel sync and the
 * consume material-mismatch guard); the dashboard already sends clean families.
 */
export function normalizeDeviceMaterial(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) {
    throw new Error("Material is required");
  }

  const compact = raw.replace(/[^A-Z0-9]/g, "");
  for (const family of MATERIAL_FAMILIES) {
    if (compact.startsWith(family)) {
      return family;
    }
  }

  return raw;
}

/** Representative RGB for each named stock colour, for nearest-colour matching. */
const NAMED_COLOR_RGB: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  red: [255, 0, 0],
  blue: [0, 0, 255],
  green: [0, 128, 0],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  brown: [139, 69, 19],
};

/**
 * Parses a colour hint to RGB: a `#RRGGBB`/`RRGGBB` hex, or one of the named
 * stock colours ({@link NAMED_COLOR_RGB}). Returns null for anything else
 * (transparent/clear, an unknown name, or no colour at all) — the caller then
 * cannot disambiguate by colour and falls back accordingly.
 */
export function parseColorToRgb(value: unknown): [number, number, number] | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;

  const hex = /^#?([0-9a-f]{6})$/.exec(raw);
  if (hex) {
    const int = Number.parseInt(hex[1], 16);
    return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
  }

  return NAMED_COLOR_RGB[raw] ?? null;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Beyond this RGB distance two colours are treated as different, so a loaded
 * reel is never bound to a clearly-wrong-coloured stock (e.g. a red reel to the
 * only black stock). ~0..441 possible; a dark grey still resolves to black/grey.
 */
const MAX_COLOR_DISTANCE = 160;

/** How a device reel hint was matched to a stock position (see resolveStockForDeviceMatch). */
export type DeviceStockMatch = {
  stock: FilamentStock;
  /**
   * `material-color` — the colour hint participated in the choice (nearest
   * within {@link MAX_COLOR_DISTANCE} among several candidates).
   * `material-only` — the single stock of the material was taken regardless of
   * colour; the hint may contradict it (see {@link deviceColorMismatch}).
   */
  matchedBy: "material-color" | "material-only";
};

/**
 * Finds the existing enabled stock a loaded reel maps to, or null when there is
 * no honest match (never creating stock from a device hint):
 *
 *  1. No stock of that material → null (nothing to deduct from).
 *  2. Exactly one stock of the material → that reel, colour-agnostic
 *     (`material-only`): with a single spool of a material loaded, the grams
 *     belong to it regardless of the colour hint. When the hint PROVABLY
 *     contradicts the stock's colour, the sync layer reports it as a
 *     colour-mismatch warning instead of matching silently.
 *  3. Several colours of the material → the nearest by colour
 *     (`material-color`), but only within {@link MAX_COLOR_DISTANCE}; an
 *     unparseable/absent hint or a colour that matches none of them closely
 *     stays unresolved rather than guessing wrong.
 */
export function resolveStockForDeviceMatch(
  store: InventoryStore,
  material: string,
  color: unknown
): DeviceStockMatch | null {
  const candidates = store.filamentStock.filter(
    (item) => item.enabled && item.material === material
  );

  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { stock: candidates[0], matchedBy: "material-only" };
  }

  const target = parseColorToRgb(color);
  if (!target) return null;

  let best: FilamentStock | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const rgb = parseColorToRgb(candidate.color);
    if (!rgb) continue;
    const distance = colorDistance(target, rgb);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best && bestDistance <= MAX_COLOR_DISTANCE
    ? { stock: best, matchedBy: "material-color" }
    : null;
}

/**
 * Whether a device colour hint PROVABLY contradicts the chosen stock's colour:
 * both sides parse to RGB and sit farther apart than {@link MAX_COLOR_DISTANCE}
 * (e.g. a red reel bound to the only black PLA). An absent/unparseable side is
 * never a mismatch — we only warn on evidence, not on missing data.
 */
export function deviceColorMismatch(stockColor: unknown, hintColor: unknown): boolean {
  const stockRgb = parseColorToRgb(stockColor);
  const hintRgb = parseColorToRgb(hintColor);
  if (!stockRgb || !hintRgb) return false;
  return colorDistance(stockRgb, hintRgb) > MAX_COLOR_DISTANCE;
}

function statusForGrams(
  stockG: number,
  lowStockG: number,
  criticalStockG: number
): StockStatus {
  if (stockG <= criticalStockG) {
    return "critical";
  }

  if (stockG <= lowStockG) {
    return "low";
  }

  return "ok";
}

function getStatus(stock: FilamentStock): StockStatus {
  return statusForGrams(stock.stockG, stock.lowStockG, stock.criticalStockG);
}

const STATUS_SEVERITY: Record<StockStatus, number> = {
  ok: 0,
  low: 1,
  critical: 2,
};

/**
 * A reel that just crossed a warning threshold downwards — the shape the
 * inventory service hands to the notification layer. Kept free of transport
 * concerns (source/time are stamped at enqueue) so {@link detectLowStockAlert}
 * stays pure and unit-testable.
 */
export type FilamentLowStockAlert = {
  stockId: string;
  material: string;
  color: string;
  colorName: string;
  label: string;
  status: "low" | "critical";
  stockG: number;
  stockKg: number;
  thresholdG: number;
  lowStockG: number;
  criticalStockG: number;
};

/**
 * Edge-detects a downward threshold crossing for a single stock movement:
 * returns an alert only when the status got strictly worse (ok→low, ok→critical,
 * low→critical), so refills and consumes that keep the reel in the same band are
 * silent. The alert reports the band it landed in and the threshold it broke.
 */
function detectLowStockAlert(
  stock: FilamentStock,
  beforeG: number,
  afterG: number
): FilamentLowStockAlert | null {
  const before = statusForGrams(beforeG, stock.lowStockG, stock.criticalStockG);
  const after = statusForGrams(afterG, stock.lowStockG, stock.criticalStockG);

  if (after === "ok" || STATUS_SEVERITY[after] <= STATUS_SEVERITY[before]) {
    return null;
  }

  return {
    stockId: stock.id,
    material: stock.material,
    color: stock.color,
    colorName: stock.colorName,
    label: `${stock.material} ${stock.colorName}`,
    status: after,
    stockG: afterG,
    stockKg: Math.round(afterG) / 1000,
    thresholdG: after === "critical" ? stock.criticalStockG : stock.lowStockG,
    lowStockG: stock.lowStockG,
    criticalStockG: stock.criticalStockG,
  };
}

function toStockView(stock: FilamentStock): FilamentStockView {
  return {
    ...stock,
    stockKg: Math.round(stock.stockG) / 1000,
    status: getStatus(stock),
  };
}

function findStock(
  store: InventoryStore,
  material: string,
  color: string
): FilamentStock | undefined {
  return store.filamentStock.find(
    (item) => item.material === material && item.color === color
  );
}

function ensureStock(
  store: InventoryStore,
  params: {
    material: string;
    color: string;
    colorName?: string;
    lowStockG?: number;
    criticalStockG?: number;
  }
): FilamentStock {
  const material = normalizeMaterial(params.material);
  const color = normalizeColor(params.color);

  const existing = findStock(store, material, color);

  if (existing) {
    if (params.colorName) {
      existing.colorName = normalizeColorName(color, params.colorName);
    }

    if (params.lowStockG != null) {
      existing.lowStockG = normalizeNonNegative(params.lowStockG, "lowStockG");
    }

    if (params.criticalStockG != null) {
      existing.criticalStockG = normalizeNonNegative(
        params.criticalStockG,
        "criticalStockG"
      );
    }

    existing.updatedAt = nowIso();

    return existing;
  }

  const createdAt = nowIso();

  const stock: FilamentStock = {
    id: id("filament_stock"),
    material,
    color,
    colorName: normalizeColorName(color, params.colorName),
    stockG: 0,
    lowStockG:
      params.lowStockG == null
        ? 1000
        : normalizeNonNegative(params.lowStockG, "lowStockG"),
    criticalStockG:
      params.criticalStockG == null
        ? 300
        : normalizeNonNegative(params.criticalStockG, "criticalStockG"),
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  };

  store.filamentStock.push(stock);

  return stock;
}

function addMovement(
  store: InventoryStore,
  params: Omit<FilamentMovement, "id" | "createdAt">
): FilamentMovement {
  const movement: FilamentMovement = {
    id: id("filament_movement"),
    createdAt: nowIso(),
    ...params,
  };

  store.filamentMovements.unshift(movement);

  return movement;
}

/**
 * Best-effort material family for building the DB load scope only — returns ""
 * instead of throwing on empty/invalid input, so scope construction never fails
 * before the pure logic can raise the real, specific validation error.
 */
function scopeMaterial(value: unknown): string {
  try {
    return normalizeDeviceMaterial(value);
  } catch {
    return "";
  }
}

/** Annotates the movement note when an add/adjust brought a position back from the archive. */
function withReactivationNote(
  note: string | null | undefined,
  reactivated: boolean
): string | null {
  const base = note ?? null;
  if (!reactivated) {
    return base;
  }

  return base
    ? `${base} · позицію повернено з архіву`
    : "позицію повернено з архіву";
}

export async function listFilamentStock(): Promise<FilamentStockView[]> {
  const stock = await listStockRows({ enabledOnly: true });

  return stock
    .sort((a, b) => {
      const materialCompare = a.material.localeCompare(b.material);
      if (materialCompare !== 0) return materialCompare;

      return a.color.localeCompare(b.color);
    })
    .map(toStockView);
}

export async function listFilamentMovements(
  limit = 100
): Promise<FilamentMovementView[]> {
  const requested = Math.trunc(Number(limit));
  const clamped = Number.isFinite(requested)
    ? Math.max(1, Math.min(requested, 500))
    : 100;

  return listFilamentMovementViews(clamped);
}

export async function listPrinterFilamentState(): Promise<
  PrinterFilamentState[]
> {
  return listPrinterStateRows();
}

/**
 * The add mutation against an already-loaded store. Pure of I/O (see
 * {@link applyConsume}). Section 3: adding stock to an ARCHIVED position brings
 * it back (enabled = true) so the new balance is actually visible — otherwise
 * the write succeeds but the position stays hidden from listFilamentStock. The
 * reactivation is recorded explicitly in the movement note.
 */
export function applyAddFilament(store: InventoryStore, input: AddFilamentInput) {
  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);
  const quantityG = normalizeQuantity(input.quantityG);

  const stock = ensureStock(store, {
    material,
    color,
    colorName: input.colorName,
    lowStockG: input.lowStockG,
    criticalStockG: input.criticalStockG,
  });

  const reactivated = !stock.enabled;
  if (reactivated) {
    stock.enabled = true;
  }

  const beforeG = stock.stockG;
  const afterG = beforeG + quantityG;

  stock.stockG = afterG;
  stock.updatedAt = nowIso();

  const movement = addMovement(store, {
    stockId: stock.id,
    type: "add",
    quantityG,
    beforeG,
    afterG,
    source: input.source || "dashboard",
    note: withReactivationNote(input.note, reactivated),
    printerId: null,
    printJobId: null,
    idempotencyKey: null,
  });

  return {
    stock: toStockView(stock),
    movement,
    reactivated,
  };
}

export async function addFilament(input: AddFilamentInput) {
  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);

  return runInventoryMutation(
    { stockKeys: [{ material, color }] },
    (store) => applyAddFilament(store, input)
  );
}

/**
 * Resolves which stock a consumption должен списаться from, in priority order:
 *
 *  1. Explicit material+color that matches an existing stock — the dashboard's
 *     manual flow, unchanged.
 *  2. The reel loaded on the printer: the per-slot row (printerId, amsTray)
 *     when a tray is named, falling back to the printer-level row (amsTray
 *     null). Printer-originated calls land here — their material/color are
 *     device hints (Bambu colours are hex, stock colours are names), so the
 *     loaded-reel binding, not the hint, decides the stock. A material hint
 *     that contradicts the loaded reel is rejected rather than silently
 *     deducting the wrong spool.
 *  3. Otherwise the old errors: unknown explicit stock without a printer to
 *     fall back to, no loaded reel, or no way to resolve at all.
 */
function resolveConsumeStock(
  store: InventoryStore,
  input: ConsumeFilamentInput
): FilamentStock {
  // Device hints may carry a brand suffix; normalize to the stock family so the
  // mismatch guard compares like with like (loaded "PETG" vs a "PETG HF" hint).
  const material = input.material ? normalizeDeviceMaterial(input.material) : "";
  const color = input.color ? normalizeColor(input.color) : "";

  if (material && color) {
    const direct = findStock(store, material, color);
    if (direct) {
      return direct;
    }

    if (!input.printerId) {
      throw new Error(`Filament stock not found: ${material} ${color}`);
    }
  }

  if (!input.printerId) {
    throw new Error("Material and color are required");
  }

  const states = store.printerFilamentState.filter(
    (item) => item.printerId === input.printerId
  );
  const printerState =
    (input.amsTray != null
      ? states.find((item) => item.amsTray === input.amsTray)
      : undefined) ?? states.find((item) => item.amsTray == null);

  if (!printerState) {
    const slot = input.amsTray != null ? ` (AMS tray ${input.amsTray})` : "";
    throw new Error(`No filament loaded for printer ${input.printerId}${slot}`);
  }

  if (material && material !== printerState.material) {
    throw new Error(
      `Printer ${input.printerId} reports ${material}, but the loaded reel is ` +
        `${printerState.material} ${printerState.color} — reload the printer filament`
    );
  }

  const stock = store.filamentStock.find(
    (item) => item.id === printerState.stockId
  );

  if (!stock) {
    throw new Error(
      `Filament stock not found: ${printerState.material} ${printerState.color}`
    );
  }

  return stock;
}

/**
 * The consume mutation against an already-loaded store. Pure of I/O (the
 * store object is mutated in place) so it can be unit-tested without Postgres;
 * `consumeFilament` runs it inside the advisory-locked transaction, which makes
 * the idempotency check → insert sequence atomic under concurrency.
 */
export function applyConsume(store: InventoryStore, input: ConsumeFilamentInput) {
  const quantityInput = input.quantityG ?? input.grams;
  const hasGrams = quantityInput != null;
  const hasLength = input.lengthMm != null;

  if (!hasGrams && !hasLength) {
    throw new Error("Either quantityG or lengthMm is required");
  }

  const lengthMm =
    !hasGrams && hasLength
      ? normalizePositiveFloat(input.lengthMm, "lengthMm")
      : null;
  const diameterMm =
    input.diameterMm != null
      ? normalizePositiveFloat(input.diameterMm, "diameterMm")
      : DEFAULT_FILAMENT_DIAMETER_MM;

  if (input.idempotencyKey) {
    const existing = store.filamentMovements.find(
      (item) => item.idempotencyKey === input.idempotencyKey
    );

    if (existing) {
      return {
        duplicate: true,
        movement: existing,
        stock:
          store.filamentStock.find((item) => item.id === existing.stockId) ||
          null,
        lowStockAlert: null as FilamentLowStockAlert | null,
      };
    }
  }

  const stock = resolveConsumeStock(store, input);

  // Section 3: never drain an ARCHIVED position silently. A manual or
  // printer-originated consume against a disabled stock is refused explicitly
  // (it is invisible in the warehouse list, so the operator would not see the
  // deduction) — restore or refill it first.
  if (!stock.enabled) {
    throw new Error(
      `Filament position ${stock.material} ${stock.colorName} is archived — ` +
        `restore it before consuming`
    );
  }

  // Explicit grams win; otherwise derive them from the extruded length using
  // the resolved stock's material density.
  const quantityG =
    lengthMm != null
      ? normalizeQuantity(lengthMmToGrams(lengthMm, stock.material, diameterMm))
      : normalizeQuantity(quantityInput);

  const beforeG = stock.stockG;
  const afterG = beforeG - quantityG;

  if (afterG < 0) {
    throw new Error(
      `Not enough filament stock: ${stock.material} ${stock.color}. Available: ${beforeG}g, requested: ${quantityG}g`
    );
  }

  stock.stockG = afterG;
  stock.updatedAt = nowIso();

  const movement = addMovement(store, {
    stockId: stock.id,
    type: "consume",
    quantityG: -quantityG,
    beforeG,
    afterG,
    source: input.source || "dashboard",
    note: input.note || null,
    printerId: input.printerId || null,
    printJobId: input.printJobId || null,
    idempotencyKey: input.idempotencyKey || null,
  });

  return {
    duplicate: false,
    stock: toStockView(stock),
    movement,
    lowStockAlert: detectLowStockAlert(stock, beforeG, afterG),
  };
}

export async function consumeFilament(input: ConsumeFilamentInput) {
  // Narrow load scope: the material's stock rows (explicit material+color path)
  // and/or the printer's bindings and the stocks they reference (loaded-reel
  // path), plus the one movement carrying this idempotency key. Never the whole
  // store, never the whole movement history.
  const materials = input.material ? [scopeMaterial(input.material)] : [];
  const scope: InventoryMutationScope = {
    materials: materials.filter(Boolean),
    printers: input.printerId ? [String(input.printerId)] : [],
    includePrinterStateStock: true,
    idempotencyKey: input.idempotencyKey ?? null,
  };

  return runInventoryMutation(scope, async (store, trx) => {
    const result = applyConsume(store, input);

    // Enqueue on the same transaction as the movement so the alert commits
    // atomically with the stock drop that triggered it (outbox pattern).
    if (result.lowStockAlert) {
      await enqueueFilamentLowStockNotification(
        {
          ...result.lowStockAlert,
          source: input.source || "dashboard",
          occurredAt: nowIso(),
        },
        trx
      );
    }

    return result;
  });
}

/**
 * The adjust (set-to-actual) mutation against an already-loaded store. Pure of
 * I/O (see {@link applyConsume}). Like {@link applyAddFilament}, correcting an
 * ARCHIVED position brings it back so the corrected balance is visible.
 */
export function applyAdjustFilament(
  store: InventoryStore,
  input: AdjustFilamentInput
) {
  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);
  const actualG = normalizeNonNegative(input.actualG, "actualG");

  const stock = ensureStock(store, {
    material,
    color,
    colorName: input.colorName,
  });

  const reactivated = !stock.enabled;
  if (reactivated) {
    stock.enabled = true;
  }

  const beforeG = stock.stockG;
  const afterG = actualG;
  const deltaG = afterG - beforeG;

  stock.stockG = afterG;
  stock.updatedAt = nowIso();

  const movement = addMovement(store, {
    stockId: stock.id,
    type: "adjust",
    quantityG: deltaG,
    beforeG,
    afterG,
    source: input.source || "dashboard",
    note: withReactivationNote(input.note, reactivated),
    printerId: null,
    printJobId: null,
    idempotencyKey: null,
  });

  return {
    stock: toStockView(stock),
    movement,
    reactivated,
  };
}

export async function adjustFilament(input: AdjustFilamentInput) {
  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);

  return runInventoryMutation(
    { stockKeys: [{ material, color }] },
    (store) => applyAdjustFilament(store, input)
  );
}

/**
 * Edits an existing stock's descriptive data — colour name, low/critical
 * thresholds, active flag — without moving any grams. Pure of I/O (see
 * {@link applyConsume}); `updateFilamentStock` runs it inside the locked
 * transaction. The target is resolved by id or by material+color.
 */
export function applyUpdateFilament(
  store: InventoryStore,
  input: UpdateFilamentInput
) {
  const stock = input.id
    ? store.filamentStock.find((item) => item.id === input.id)
    : input.material && input.color
      ? findStock(
          store,
          normalizeMaterial(input.material),
          normalizeColor(input.color)
        )
      : undefined;

  if (!stock) {
    throw new Error("Filament stock not found");
  }

  if (input.colorName != null) {
    stock.colorName = normalizeColorName(stock.color, input.colorName);
  }

  if (input.lowStockG != null) {
    stock.lowStockG = normalizeNonNegative(input.lowStockG, "lowStockG");
  }

  if (input.criticalStockG != null) {
    stock.criticalStockG = normalizeNonNegative(
      input.criticalStockG,
      "criticalStockG"
    );
  }

  if (stock.criticalStockG > stock.lowStockG) {
    throw new Error(
      "criticalStockG must not be greater than lowStockG"
    );
  }

  if (input.enabled != null) {
    stock.enabled = Boolean(input.enabled);
  }

  stock.updatedAt = nowIso();

  return { stock: toStockView(stock) };
}

export async function updateFilamentStock(input: UpdateFilamentInput) {
  const scope: InventoryMutationScope = input.id
    ? { stockIds: [input.id] }
    : input.material && input.color
      ? {
          stockKeys: [
            {
              material: normalizeMaterial(input.material),
              color: normalizeColor(input.color),
            },
          ],
        }
      : {};

  return runInventoryMutation(scope, (store) => applyUpdateFilament(store, input));
}

function normalizeAmsTray(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }

  const tray = Number(value);

  if (!Number.isInteger(tray) || tray < 0) {
    throw new Error("amsTray must be a non-negative integer");
  }

  return tray;
}

/** Upserts the (printerId, amsTray) binding to point at a resolved stock. */
function upsertPrinterFilamentState(
  store: InventoryStore,
  printerId: string,
  amsTray: number | null,
  stock: FilamentStock
): PrinterFilamentState {
  const existing = store.printerFilamentState.find(
    (item) => item.printerId === printerId && item.amsTray === amsTray
  );

  if (existing) {
    existing.stockId = stock.id;
    existing.material = stock.material;
    existing.color = stock.color;
    existing.updatedAt = nowIso();

    return existing;
  }

  const state: PrinterFilamentState = {
    id: id("printer_filament"),
    printerId,
    amsTray,
    stockId: stock.id,
    material: stock.material,
    color: stock.color,
    updatedAt: nowIso(),
  };

  store.printerFilamentState.push(state);

  return state;
}

/** The load-reel mutation against a loaded store; see {@link applyConsume} on why it is extracted. */
export function applyLoadPrinterFilament(
  store: InventoryStore,
  input: LoadPrinterFilamentInput
): PrinterFilamentState {
  const printerId = String(input.printerId || "").trim();

  if (!printerId) {
    throw new Error("printerId is required");
  }

  const amsTray = normalizeAmsTray(input.amsTray);
  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);

  const stock = ensureStock(store, {
    material,
    color,
    colorName: input.colorName,
  });

  return upsertPrinterFilamentState(store, printerId, amsTray, stock);
}

export async function loadPrinterFilament(input: LoadPrinterFilamentInput) {
  const printerId = String(input.printerId || "").trim();
  const scope: InventoryMutationScope = {
    stockKeys:
      input.material && input.color
        ? [
            {
              material: normalizeMaterial(input.material),
              color: normalizeColor(input.color),
            },
          ]
        : [],
    printers: printerId ? [printerId] : [],
  };

  return runInventoryMutation(scope, (store) =>
    applyLoadPrinterFilament(store, input)
  );
}

/**
 * Binds the reel a printer reports as *loaded* to an existing stock, so the
 * orchestrator's auto-deduction has a target with no manual dashboard entry
 * (requirement: filament is resolved and bound automatically). Unlike
 * {@link applyLoadPrinterFilament} this never creates stock: the device hint is
 * resolved against what is actually on the shelf ({@link resolveStockForDeviceMatch}),
 * and when nothing matches it reports `resolved: false` instead of inventing a
 * reel — the binding (and any deduction) simply waits until the operator stocks
 * the material. Idempotent: re-syncing the same slot just refreshes the row.
 */
export function applySyncPrinterFilament(
  store: InventoryStore,
  input: SyncPrinterFilamentInput
): SyncPrinterFilamentResult {
  const printerId = String(input.printerId || "").trim();

  if (!printerId) {
    throw new Error("printerId is required");
  }

  const amsTray = normalizeAmsTray(input.amsTray);
  const material = normalizeDeviceMaterial(input.material);

  const match = resolveStockForDeviceMatch(store, material, input.color);

  if (!match) {
    return {
      resolved: false,
      printerId,
      amsTray,
      material,
      reason: `No stock matches ${material}${input.color ? ` ${input.color}` : ""}`,
    };
  }

  const { stock, matchedBy } = match;

  // Snapshot the previous binding BEFORE the upsert (which mutates the state
  // row in place) so an actual reel change can be reported exactly once — an
  // idempotent re-sync of the same slot to the same stock is `changed: false`
  // and produces no operational event.
  const existing = store.printerFilamentState.find(
    (item) => item.printerId === printerId && item.amsTray === amsTray
  );
  const previousBinding = existing
    ? { stockId: existing.stockId, material: existing.material, color: existing.color }
    : null;
  const changed = !previousBinding || previousBinding.stockId !== stock.id;
  const previous =
    previousBinding && previousBinding.stockId !== stock.id
      ? store.filamentStock.find((item) => item.id === previousBinding.stockId)
      : undefined;

  const state = upsertPrinterFilamentState(store, printerId, amsTray, stock);

  return {
    resolved: true,
    state,
    stock: toStockView(stock),
    changed,
    matchedBy,
    colorMismatch:
      matchedBy === "material-only" && deviceColorMismatch(stock.color, input.color),
    previousStock:
      changed && previousBinding
        ? {
            id: previousBinding.stockId,
            material: previous?.material ?? previousBinding.material,
            color: previous?.color ?? previousBinding.color,
            colorName: previous?.colorName ?? null,
          }
        : null,
  };
}

/**
 * Dedup anchor for the colour-mismatch operational event: per (printer, slot),
 * the signature of the last warned combination (device material+colour hint ×
 * chosen stock). Re-syncs of the same combination (poll retries, atelier
 * restarts) warn once; a reel change, a different stock or a resolved mismatch
 * resets it. In-memory by design — after an API restart the warning may repeat
 * once, which is acceptable for an operator notice.
 */
const colorMismatchWarned = new Map<string, string>();

export async function syncPrinterFilament(input: SyncPrinterFilamentInput) {
  const printerId = String(input.printerId || "").trim();
  const material = scopeMaterial(input.material);
  const scope: InventoryMutationScope = {
    materials: material ? [material] : [],
    printers: printerId ? [printerId] : [],
    // Load the stocks referenced by the printer's existing bindings too, so a
    // reel CHANGE can name the previous position in the operational event.
    includePrinterStateStock: true,
  };

  const result = await runInventoryMutation(scope, (store) =>
    applySyncPrinterFilament(store, input)
  );

  // Operational events (after the transaction committed — never for a rolled-back
  // change). The SSE bus is the dashboard's live operational feed.
  if (result.resolved) {
    const slotKey = `${result.state.printerId}:${result.state.amsTray ?? "main"}`;

    if (result.changed) {
      publishEvent({
        domain: "inventory",
        type: "printer_filament_changed",
        payload: {
          printerId: result.state.printerId,
          amsTray: result.state.amsTray,
          stockId: result.stock.id,
          material: result.stock.material,
          color: result.stock.color,
          colorName: result.stock.colorName,
          previous: result.previousStock,
        },
      });
    }

    if (result.colorMismatch) {
      const warnSig = `${material}|${String(input.color ?? "")}|${result.stock.id}`;
      if (colorMismatchWarned.get(slotKey) !== warnSig) {
        colorMismatchWarned.set(slotKey, warnSig);
        publishEvent({
          domain: "inventory",
          type: "printer_filament_color_mismatch",
          payload: {
            printerId: result.state.printerId,
            amsTray: result.state.amsTray,
            material,
            deviceColor: input.color ?? null,
            stockId: result.stock.id,
            stockColor: result.stock.color,
            stockColorName: result.stock.colorName,
            matchedBy: "material-only",
          },
        });
      }
    } else {
      colorMismatchWarned.delete(slotKey);
    }
  }

  return result;
}

export async function getInventoryMaterialsSummary() {
  const { stock: activeStock, reelsInUse } = await readMaterialsSnapshot();

  const totalG = activeStock.reduce((sum, item) => sum + item.stockG, 0);

  const stock = activeStock
    .sort((a, b) => {
      const materialCompare = a.material.localeCompare(b.material);
      if (materialCompare !== 0) return materialCompare;

      return a.color.localeCompare(b.color);
    })
    .map((item) => ({
      id: item.id,
      material: item.material,
      color: item.color,
      colorName: item.colorName,
      label: `${item.material} ${item.colorName}`,
      stockG: item.stockG,
      remainKg: Math.round(item.stockG) / 1000,
      lowStockG: item.lowStockG,
      criticalStockG: item.criticalStockG,
      status: getStatus(item),
    }));

  const low = stock
    .filter((item) => item.status === "low" || item.status === "critical")
    .sort((a, b) => a.stockG - b.stockG)
    .map((item) => ({
      material: item.label,
      remainKg: item.remainKg,
      status: item.status,
    }));

  return {
    filamentKg: Math.round(totalG) / 1000,
    resinL: 0,
    reelsInUse,
    lowThresholdKg: 1,
    stock,
    low,
  };
}

// ── Filament availability (read-only shop feed) ────────────────────────────
//
// Canonicalization for the online shop's availability endpoint. It maps the
// free-form values the dashboard/printers stored (`material`, `color`) onto a
// small fixed vocabulary the shop can switch on. It is intentionally a plain
// alias table, NOT the RGB nearest-colour matching used for device-reel binding
// (resolveStockForDeviceMatch): the shop must never see Grey, Silver and Transparent
// collapsed together, so colour is matched by name only.

const CANONICAL_MATERIALS: readonly CanonicalMaterial[] = [
  "PLA",
  "PETG",
  "TPU",
  "ABS",
  "ASA",
];

/** Compacts a raw value for lookup: case-, space-, hyphen-, underscore- and +-insensitive. */
function compactKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Maps a stored material onto one of the five canonical families, or null when
 * it cannot be mapped (kept in the feed as `unmapped`, never invented). Handles
 * the common PLA variants (PLA+, PLA PLUS, PLA BASIC via the family prefix;
 * HYPER PLA via the stripped marketing prefix) and brand-suffixed families
 * (PETG-CF → PETG). Resin and other non-FDM materials stay unmapped by design.
 */
export function canonicalizeMaterial(value: unknown): CanonicalMaterial | null {
  let key = compactKey(value);
  if (!key) return null;

  // Strip a leading marketing prefix so "HYPER PLA"/"HYPER_PLA" reduce to "PLA".
  key = key.replace(/^HYPER/, "");
  if (!key) return null;

  for (const family of CANONICAL_MATERIALS) {
    if (key === family || key.startsWith(family)) {
      return family;
    }
  }

  return null;
}

/** Named-colour aliases keyed by {@link compactKey}. Names only — no RGB approximation. */
const COLOR_ALIASES: Record<string, CanonicalColor> = {
  black: "Black",
  white: "White",
  gray: "Grey",
  grey: "Grey",
  yellow: "Yellow",
  transparent: "Transparent",
  clear: "Transparent",
  bronze: "Bronze",
  orange: "Orange",
  green: "Green",
  silver: "Silver",
  red: "Red",
  blue: "Blue",
  purple: "Purple",
  gold: "Gold",
  multicolor: "Multicolor",
  multicolour: "Multicolor",
};

/**
 * Maps a stored colour onto the canonical English name, or null when it cannot
 * be mapped. Silver, Grey and Transparent stay distinct on purpose — the shop
 * distinguishes them, so no fuzzy/RGB collapsing happens here.
 */
export function canonicalizeColor(value: unknown): CanonicalColor | null {
  const key = compactKey(value);
  if (!key) return null;

  return COLOR_ALIASES[key.toLowerCase()] ?? null;
}

/**
 * Builds the availability feed from an already-loaded store. Pure of I/O (see
 * {@link applyConsume}) so it is unit-testable without Postgres. Only active
 * (enabled) positions are considered; each is canonicalized and classified
 * against `thresholdG` (`available = weight >= thresholdG`). Unmappable rows are
 * kept but reported `mapped: false` / `available: false` for diagnostics. Never
 * builds the full material×color matrix — an absent pair means "unavailable".
 */
export function buildFilamentAvailability(
  store: InventoryStore,
  thresholdG: number
): FilamentAvailabilityResponse {
  let updatedAt: string | null = null;
  let updatedAtMs = -Infinity;

  const items: FilamentAvailabilityItem[] = store.filamentStock
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const material = canonicalizeMaterial(entry.material);
      const color = canonicalizeColor(entry.color);
      const mapped = material !== null && color !== null;
      const weight = Math.max(0, Math.round(entry.stockG));

      let available = false;
      let status: FilamentAvailabilityItem["status"] = "critical";
      let reason: FilamentAvailabilityItem["reason"];

      if (!mapped) {
        reason = "unmapped";
      } else if (weight <= 0) {
        reason = "out_of_stock";
      } else if (weight < thresholdG) {
        status = "low";
        reason = "below_threshold";
      } else {
        available = true;
        status = "ok";
      }

      // Track the freshest position among those actually returned.
      const ms = Date.parse(entry.updatedAt);
      if (Number.isFinite(ms) && ms > updatedAtMs) {
        updatedAtMs = ms;
        updatedAt = entry.updatedAt;
      }

      const item: FilamentAvailabilityItem = {
        stock_id: entry.id,
        material,
        color,
        material_raw: entry.material,
        color_raw: entry.color,
        mapped,
        available,
        available_weight_g: weight,
        status,
      };

      if (reason) {
        item.reason = reason;
      }

      return item;
    })
    .sort((a, b) => {
      const materialCompare = (a.material ?? "").localeCompare(b.material ?? "");
      if (materialCompare !== 0) return materialCompare;

      const colorCompare = (a.color ?? "").localeCompare(b.color ?? "");
      if (colorCompare !== 0) return colorCompare;

      return a.stock_id.localeCompare(b.stock_id);
    });

  return {
    version: 1,
    updated_at: updatedAt,
    threshold_g: thresholdG,
    items,
  };
}

/**
 * Read-only availability feed for the online shop. Reads the shelf once and
 * classifies it against FILAMENT_AVAILABILITY_MIN_G (default 100 g). Strictly
 * read-only — no movement, no mutation.
 */
export async function getFilamentAvailability(): Promise<FilamentAvailabilityResponse> {
  const filamentStock = await listStockRows({ enabledOnly: true });

  return buildFilamentAvailability(
    {
      version: 1,
      filamentStock,
      filamentMovements: [],
      printerFilamentState: [],
    },
    env.FILAMENT_AVAILABILITY_MIN_G
  );
}