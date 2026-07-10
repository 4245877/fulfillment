import type { Knex } from "knex";

import { db } from "../../infra/db/knex";
import type {
  FilamentMovement,
  FilamentMovementSource,
  FilamentMovementType,
  FilamentStock,
  InventoryStore,
  PrinterFilamentState,
} from "./types";

type DbLike = Knex | Knex.Transaction;

const INVENTORY_LOCK_ID = 735001;

type FilamentStockRow = {
  id: string;
  material: string;
  color: string;
  color_name: string;
  stock_g: number;
  low_stock_g: number;
  critical_stock_g: number;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type FilamentMovementRow = {
  id: string;
  stock_id: string;
  type: FilamentMovementType;
  quantity_g: number;
  before_g: number;
  after_g: number;
  source: FilamentMovementSource;
  note: string | null;
  printer_id: string | null;
  print_job_id: string | null;
  idempotency_key: string | null;
  created_at: Date | string;
};

type PrinterFilamentStateRow = {
  id: string;
  printer_id: string;
  ams_tray: number | null;
  stock_id: string;
  material: string;
  color: string;
  updated_at: Date | string;
};

function iso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function createEmptyStore(): InventoryStore {
  return {
    version: 1,
    filamentStock: [],
    filamentMovements: [],
    printerFilamentState: [],
  };
}

function stockFromRow(row: FilamentStockRow): FilamentStock {
  return {
    id: row.id,
    material: row.material,
    color: row.color,
    colorName: row.color_name,
    stockG: Number(row.stock_g),
    lowStockG: Number(row.low_stock_g),
    criticalStockG: Number(row.critical_stock_g),
    enabled: Boolean(row.enabled),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function movementFromRow(row: FilamentMovementRow): FilamentMovement {
  return {
    id: row.id,
    stockId: row.stock_id,
    type: row.type,
    quantityG: Number(row.quantity_g),
    beforeG: Number(row.before_g),
    afterG: Number(row.after_g),
    source: row.source,
    note: row.note,
    printerId: row.printer_id,
    printJobId: row.print_job_id,
    idempotencyKey: row.idempotency_key,
    createdAt: iso(row.created_at),
  };
}

function printerStateFromRow(row: PrinterFilamentStateRow): PrinterFilamentState {
  return {
    id: row.id,
    printerId: row.printer_id,
    amsTray: row.ams_tray == null ? null : Number(row.ams_tray),
    stockId: row.stock_id,
    material: row.material,
    color: row.color,
    updatedAt: iso(row.updated_at),
  };
}

function stockToRow(item: FilamentStock) {
  return {
    id: item.id,
    material: item.material,
    color: item.color,
    color_name: item.colorName,
    stock_g: item.stockG,
    low_stock_g: item.lowStockG,
    critical_stock_g: item.criticalStockG,
    enabled: item.enabled,
    created_at: new Date(item.createdAt),
    updated_at: new Date(item.updatedAt),
  };
}

function movementToRow(item: FilamentMovement) {
  return {
    id: item.id,
    stock_id: item.stockId,
    type: item.type,
    quantity_g: item.quantityG,
    before_g: item.beforeG,
    after_g: item.afterG,
    source: item.source,
    note: item.note,
    printer_id: item.printerId,
    print_job_id: item.printJobId,
    idempotency_key: item.idempotencyKey,
    created_at: new Date(item.createdAt),
  };
}

function printerStateToRow(item: PrinterFilamentState) {
  return {
    id: item.id,
    printer_id: item.printerId,
    ams_tray: item.amsTray,
    stock_id: item.stockId,
    material: item.material,
    color: item.color,
    updated_at: new Date(item.updatedAt),
  };
}

async function readInventoryStoreFrom(client: DbLike): Promise<InventoryStore> {
  const [stockRows, movementRows, printerStateRows] = await Promise.all([
    client<FilamentStockRow>("filament_stock").select("*").orderBy([
      { column: "material", order: "asc" },
      { column: "color", order: "asc" },
    ]),
    client<FilamentMovementRow>("filament_movements")
      .select("*")
      .orderBy("created_at", "desc"),
    client<PrinterFilamentStateRow>("printer_filament_state")
      .select("*")
      .orderBy("printer_id", "asc"),
  ]);

  return {
    version: 1,
    filamentStock: stockRows.map(stockFromRow),
    filamentMovements: movementRows.map(movementFromRow),
    printerFilamentState: printerStateRows.map(printerStateFromRow),
  };
}

async function replaceInventoryStore(client: DbLike, store: InventoryStore): Promise<void> {
  await client("printer_filament_state").delete();
  await client("filament_movements").delete();
  await client("filament_stock").delete();

  if (store.filamentStock.length > 0) {
    await client("filament_stock").insert(store.filamentStock.map(stockToRow));
  }

  if (store.filamentMovements.length > 0) {
    await client("filament_movements").insert(
      store.filamentMovements.map(movementToRow)
    );
  }

  if (store.printerFilamentState.length > 0) {
    await client("printer_filament_state").insert(
      store.printerFilamentState.map(printerStateToRow)
    );
  }
}

export async function readInventoryStore(): Promise<InventoryStore> {
  try {
    return await readInventoryStoreFrom(db);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("does not exist")) {
      return createEmptyStore();
    }

    throw error;
  }
}

export async function writeInventoryStore(store: InventoryStore): Promise<void> {
  await db.transaction(async (trx) => {
    await trx.raw("select pg_advisory_xact_lock(?)", [INVENTORY_LOCK_ID]);
    await replaceInventoryStore(trx, store);
  });
}

export async function updateInventoryStore<T>(
  mutator: (store: InventoryStore) => T | Promise<T>
): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw("select pg_advisory_xact_lock(?)", [INVENTORY_LOCK_ID]);

    const store = await readInventoryStoreFrom(trx);
    const result = await mutator(store);

    await replaceInventoryStore(trx, store);

    return result;
  });
}