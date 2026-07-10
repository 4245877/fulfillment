import { randomUUID } from "node:crypto";

import { enqueueFilamentLowStockNotification } from "../notifications/dispatcher";
import {
  readInventoryStore,
  updateInventoryStore,
} from "./repo";

import type {
  FilamentMovement,
  FilamentMovementSource,
  FilamentStock,
  FilamentStockView,
  InventoryStore,
  PrinterFilamentState,
  StockStatus,
} from "./types";

type AddFilamentInput = {
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

type AdjustFilamentInput = {
  material: string;
  color: string;
  colorName?: string;
  actualG: number;
  source?: FilamentMovementSource;
  note?: string;
};

type UpdateFilamentInput = {
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

type LoadPrinterFilamentInput = {
  printerId: string;
  /** AMS slot to bind the reel to (multi-slot printers); omit for the printer-level reel. */
  amsTray?: number | null;
  material: string;
  color: string;
  colorName?: string;
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

  return Math.round(quantity);
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

export async function listFilamentStock(): Promise<FilamentStockView[]> {
  const store = await readInventoryStore();

  return store.filamentStock
    .filter((item) => item.enabled)
    .sort((a, b) => {
      const materialCompare = a.material.localeCompare(b.material);
      if (materialCompare !== 0) return materialCompare;

      return a.color.localeCompare(b.color);
    })
    .map(toStockView);
}

export async function listFilamentMovements(limit = 100) {
  const store = await readInventoryStore();

  return store.filamentMovements.slice(0, Math.max(1, Math.min(limit, 500)));
}

export async function listPrinterFilamentState(): Promise<
  PrinterFilamentState[]
> {
  const store = await readInventoryStore();

  return [...store.printerFilamentState].sort((a, b) =>
    a.printerId.localeCompare(b.printerId)
  );
}

export async function addFilament(input: AddFilamentInput) {
  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);
  const quantityG = normalizeQuantity(input.quantityG);

  return updateInventoryStore((store) => {
    const stock = ensureStock(store, {
      material,
      color,
      colorName: input.colorName,
      lowStockG: input.lowStockG,
      criticalStockG: input.criticalStockG,
    });

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
      note: input.note || null,
      printerId: null,
      printJobId: null,
      idempotencyKey: null,
    });

    return {
      stock: toStockView(stock),
      movement,
    };
  });
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
  const material = input.material ? normalizeMaterial(input.material) : "";
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
  return updateInventoryStore(async (store, trx) => {
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

export async function adjustFilament(input: AdjustFilamentInput) {
  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);
  const actualG = normalizeNonNegative(input.actualG, "actualG");

  return updateInventoryStore((store) => {
    const stock = ensureStock(store, {
      material,
      color,
      colorName: input.colorName,
    });

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
      note: input.note || null,
      printerId: null,
      printJobId: null,
      idempotencyKey: null,
    });

    return {
      stock: toStockView(stock),
      movement,
    };
  });
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
  return updateInventoryStore((store) => applyUpdateFilament(store, input));
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

export async function loadPrinterFilament(input: LoadPrinterFilamentInput) {
  return updateInventoryStore((store) => applyLoadPrinterFilament(store, input));
}

export async function getInventoryMaterialsSummary() {
  const store = await readInventoryStore();

  const activeStock = store.filamentStock.filter((item) => item.enabled);
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
    reelsInUse: store.printerFilamentState.length,
    lowThresholdKg: 1,
    stock,
    low,
  };
}