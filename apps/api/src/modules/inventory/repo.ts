import type { Knex } from "knex";

import { db } from "../../infra/db/knex";
import type {
  FilamentMovement,
  FilamentMovementSource,
  FilamentMovementType,
  FilamentMovementView,
  FilamentStock,
  InventoryStore,
  PrinterFilamentState,
} from "./types";

// A single advisory lock serialises every inventory MUTATION (see
// runInventoryMutation). It is the one place concurrency is arbitrated, which is
// why the mutation path can read the few rows it needs, apply the change in
// memory, and write only the deltas back — no full-table rewrite, and two
// concurrent consumes can never race a stock into the negative.
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

type FilamentMovementViewRow = FilamentMovementRow & {
  stock_material: string | null;
  stock_color: string | null;
  stock_color_name: string | null;
  stock_enabled: boolean | null;
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

function movementViewFromRow(row: FilamentMovementViewRow): FilamentMovementView {
  return {
    ...movementFromRow(row),
    stockMaterial: row.stock_material,
    stockColor: row.stock_color,
    stockColorName: row.stock_color_name,
    stockEnabled: row.stock_enabled == null ? null : Boolean(row.stock_enabled),
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

function stockToRow(item: FilamentStock): FilamentStockRow {
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

/** Mutable columns of filament_stock (everything but the id and created_at). */
function stockUpdateRow(item: FilamentStock) {
  return {
    material: item.material,
    color: item.color,
    color_name: item.colorName,
    stock_g: item.stockG,
    low_stock_g: item.lowStockG,
    critical_stock_g: item.criticalStockG,
    enabled: item.enabled,
    updated_at: new Date(item.updatedAt),
  };
}

function movementToRow(item: FilamentMovement): FilamentMovementRow {
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

function printerStateToRow(item: PrinterFilamentState): PrinterFilamentStateRow {
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

function printerStateUpdateRow(item: PrinterFilamentState) {
  return {
    printer_id: item.printerId,
    ams_tray: item.amsTray,
    stock_id: item.stockId,
    material: item.material,
    color: item.color,
    updated_at: new Date(item.updatedAt),
  };
}

// ── Point reads ─────────────────────────────────────────────────────────────
//
// Each read touches only the rows it returns and never masks a missing table:
// an unapplied migration surfaces as an error, it does NOT quietly look like an
// empty warehouse (which would hide a broken deployment).

/** Active (or all) stock positions, ordered material then colour. */
export async function listStockRows(
  opts: { enabledOnly?: boolean } = {}
): Promise<FilamentStock[]> {
  let query = db<FilamentStockRow>("filament_stock").select("*");

  if (opts.enabledOnly) {
    query = query.where("enabled", true);
  }

  const rows = await query.orderBy([
    { column: "material", order: "asc" },
    { column: "color", order: "asc" },
  ]);

  return rows.map(stockFromRow);
}

/**
 * The most recent movements, newest first, each enriched with a snapshot of its
 * stock position (material/colour/enabled) via a LEFT JOIN — so the dashboard
 * can render the position even after it was archived or removed. Bounded by
 * `limit`, so the query cost never scales with the whole movement history.
 */
export async function listFilamentMovementViews(
  limit: number
): Promise<FilamentMovementView[]> {
  const rows = await db<FilamentMovementRow>({ m: "filament_movements" })
    .leftJoin({ s: "filament_stock" }, "s.id", "m.stock_id")
    .select(
      "m.*",
      db.ref("s.material").as("stock_material"),
      db.ref("s.color").as("stock_color"),
      db.ref("s.color_name").as("stock_color_name"),
      db.ref("s.enabled").as("stock_enabled")
    )
    .orderBy("m.created_at", "desc")
    .limit(limit);

  return (rows as unknown as FilamentMovementViewRow[]).map(movementViewFromRow);
}

/** All printer→reel bindings, ordered by printer. */
export async function listPrinterStateRows(): Promise<PrinterFilamentState[]> {
  const rows = await db<PrinterFilamentStateRow>("printer_filament_state")
    .select("*")
    .orderBy("printer_id", "asc");

  return rows.map(printerStateFromRow);
}

/**
 * The materials summary reads two related tables (stock + reel bindings); take
 * them from ONE snapshot so `reelsInUse` can never disagree with the stock it is
 * counted against (a REPEATABLE READ transaction gives both queries the same
 * view).
 */
export async function readMaterialsSnapshot(): Promise<{
  stock: FilamentStock[];
  reelsInUse: number;
}> {
  return db.transaction(
    async (trx) => {
      const [stockRows, reelRows] = await Promise.all([
        trx<FilamentStockRow>("filament_stock")
          .select("*")
          .where("enabled", true)
          .orderBy([
            { column: "material", order: "asc" },
            { column: "color", order: "asc" },
          ]),
        trx<PrinterFilamentStateRow>("printer_filament_state").count<{
          count: string;
        }>("id as count"),
      ]);

      return {
        stock: stockRows.map(stockFromRow),
        reelsInUse: Number(reelRows[0]?.count ?? 0),
      };
    },
    { isolationLevel: "repeatable read" }
  );
}

// ── Scoped mutation load ──────────────────────────────────────────────────────

/**
 * Declares the narrow slice of the warehouse a single mutation needs. The
 * runner loads only these rows (never the whole store, never the whole movement
 * history), applies the in-memory business logic against them, and writes back
 * only what changed.
 */
export type InventoryMutationScope = {
  /** Load the stock rows matching these exact (material, colour) keys. */
  stockKeys?: Array<{ material: string; color: string }>;
  /** Load every stock row of these materials (any colour, any enabled state). */
  materials?: string[];
  /** Load the stock rows with these ids. */
  stockIds?: string[];
  /** Load every printer_filament_state row for these printers. */
  printers?: string[];
  /** Also load the stock rows referenced by the loaded printer bindings. */
  includePrinterStateStock?: boolean;
  /** Load the one movement carrying this idempotency key, for duplicate checks. */
  idempotencyKey?: string | null;
};

async function loadScope(
  trx: Knex.Transaction,
  scope: InventoryMutationScope
): Promise<InventoryStore> {
  const stockById = new Map<string, FilamentStockRow>();

  const addStockRows = (rows: FilamentStockRow[]) => {
    for (const row of rows) {
      stockById.set(row.id, row);
    }
  };

  if (scope.stockKeys?.length) {
    // One indexed lookup per (material,color) — the pair is unique.
    for (const key of scope.stockKeys) {
      addStockRows(
        await trx<FilamentStockRow>("filament_stock").where({
          material: key.material,
          color: key.color,
        })
      );
    }
  }

  if (scope.materials?.length) {
    addStockRows(
      await trx<FilamentStockRow>("filament_stock").whereIn(
        "material",
        scope.materials
      )
    );
  }

  if (scope.stockIds?.length) {
    addStockRows(
      await trx<FilamentStockRow>("filament_stock").whereIn("id", scope.stockIds)
    );
  }

  let stateRows: PrinterFilamentStateRow[] = [];
  if (scope.printers?.length) {
    stateRows = await trx<PrinterFilamentStateRow>("printer_filament_state").whereIn(
      "printer_id",
      scope.printers
    );
  }

  if (scope.includePrinterStateStock && stateRows.length) {
    const missing = stateRows
      .map((row) => row.stock_id)
      .filter((id) => !stockById.has(id));

    if (missing.length) {
      addStockRows(
        await trx<FilamentStockRow>("filament_stock").whereIn("id", missing)
      );
    }
  }

  let movementRows: FilamentMovementRow[] = [];
  if (scope.idempotencyKey) {
    movementRows = await trx<FilamentMovementRow>("filament_movements").where({
      idempotency_key: scope.idempotencyKey,
    });
  }

  return {
    version: 1,
    filamentStock: [...stockById.values()].map(stockFromRow),
    filamentMovements: movementRows.map(movementFromRow),
    printerFilamentState: stateRows.map(printerStateFromRow),
  };
}

function stockDiffers(a: FilamentStock, b: FilamentStock): boolean {
  return (
    a.material !== b.material ||
    a.color !== b.color ||
    a.colorName !== b.colorName ||
    a.stockG !== b.stockG ||
    a.lowStockG !== b.lowStockG ||
    a.criticalStockG !== b.criticalStockG ||
    a.enabled !== b.enabled ||
    a.updatedAt !== b.updatedAt
  );
}

function printerStateDiffers(
  a: PrinterFilamentState,
  b: PrinterFilamentState
): boolean {
  return (
    a.printerId !== b.printerId ||
    a.amsTray !== b.amsTray ||
    a.stockId !== b.stockId ||
    a.material !== b.material ||
    a.color !== b.color ||
    a.updatedAt !== b.updatedAt
  );
}

/**
 * Writes back ONLY what the mutation changed, as point statements:
 *   - a stock/printer-state row new to the scope → INSERT
 *   - one that existed and changed → UPDATE by id
 *   - a movement not present before → INSERT (movements are append-only)
 * Nothing is ever deleted, and untouched rows in the scope are not rewritten.
 */
async function persistInventoryDiff(
  trx: Knex.Transaction,
  before: InventoryStore,
  after: InventoryStore
): Promise<void> {
  const beforeStock = new Map(before.filamentStock.map((s) => [s.id, s]));
  for (const stock of after.filamentStock) {
    const prev = beforeStock.get(stock.id);
    if (!prev) {
      await trx("filament_stock").insert(stockToRow(stock));
    } else if (stockDiffers(prev, stock)) {
      await trx("filament_stock")
        .where({ id: stock.id })
        .update(stockUpdateRow(stock));
    }
  }

  const beforeMovements = new Set(before.filamentMovements.map((m) => m.id));
  const newMovements = after.filamentMovements.filter(
    (m) => !beforeMovements.has(m.id)
  );
  if (newMovements.length) {
    await trx("filament_movements").insert(newMovements.map(movementToRow));
  }

  const beforeStates = new Map(
    before.printerFilamentState.map((p) => [p.id, p])
  );
  for (const state of after.printerFilamentState) {
    const prev = beforeStates.get(state.id);
    if (!prev) {
      await trx("printer_filament_state").insert(printerStateToRow(state));
    } else if (printerStateDiffers(prev, state)) {
      await trx("printer_filament_state")
        .where({ id: state.id })
        .update(printerStateUpdateRow(state));
    }
  }
}

/**
 * Runs an inventory mutation transactionally under the advisory lock:
 *   1. take the lock (serialises all inventory writes);
 *   2. load only the scoped rows into an in-memory store;
 *   3. run the pure business logic against a clone of it;
 *   4. persist just the deltas.
 * The lock + the re-read of fresh stock inside the transaction is what prevents
 * concurrent consumes from ever driving a balance negative (the DB
 * `stock_g >= 0` CHECK is the final backstop). `mutate` receives the same `trx`
 * so it can enqueue outbox work atomically with the movement it records.
 */
export async function runInventoryMutation<T>(
  scope: InventoryMutationScope,
  mutate: (store: InventoryStore, trx: Knex.Transaction) => T | Promise<T>
): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw("select pg_advisory_xact_lock(?)", [INVENTORY_LOCK_ID]);

    const before = await loadScope(trx, scope);
    const working = structuredClone(before);

    const result = await mutate(working, trx);

    await persistInventoryDiff(trx, before, working);

    return result;
  });
}
