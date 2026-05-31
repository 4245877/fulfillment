import { randomUUID } from "node:crypto";

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

type ConsumeFilamentInput = {
  material?: string;
  color?: string;
  quantityG: number;
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

type LoadPrinterFilamentInput = {
  printerId: string;
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

function getStatus(stock: FilamentStock): StockStatus {
  if (stock.stockG <= stock.criticalStockG) {
    return "critical";
  }

  if (stock.stockG <= stock.lowStockG) {
    return "low";
  }

  return "ok";
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

export async function consumeFilament(input: ConsumeFilamentInput) {
  const quantityG = normalizeQuantity(input.quantityG);

  return updateInventoryStore((store) => {
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
        };
      }
    }

    let material = input.material ? normalizeMaterial(input.material) : "";
    let color = input.color ? normalizeColor(input.color) : "";

    if ((!material || !color) && input.printerId) {
      const printerState = store.printerFilamentState.find(
        (item) => item.printerId === input.printerId
      );

      if (!printerState) {
        throw new Error(`No filament loaded for printer ${input.printerId}`);
      }

      material = printerState.material;
      color = printerState.color;
    }

    if (!material || !color) {
      throw new Error("Material and color are required");
    }

    const stock = findStock(store, material, color);

    if (!stock) {
      throw new Error(`Filament stock not found: ${material} ${color}`);
    }

    const beforeG = stock.stockG;
    const afterG = beforeG - quantityG;

    if (afterG < 0) {
      throw new Error(
        `Not enough filament stock: ${material} ${color}. Available: ${beforeG}g, requested: ${quantityG}g`
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
    };
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

export async function loadPrinterFilament(input: LoadPrinterFilamentInput) {
  const printerId = String(input.printerId || "").trim();

  if (!printerId) {
    throw new Error("printerId is required");
  }

  const material = normalizeMaterial(input.material);
  const color = normalizeColor(input.color);

  return updateInventoryStore((store) => {
    const stock = ensureStock(store, {
      material,
      color,
      colorName: input.colorName,
    });

    const existing = store.printerFilamentState.find(
      (item) => item.printerId === printerId
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
      stockId: stock.id,
      material: stock.material,
      color: stock.color,
      updatedAt: nowIso(),
    };

    store.printerFilamentState.push(state);

    return state;
  });
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