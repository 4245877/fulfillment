import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { FilamentStock, InventoryStore } from "./types";

/*
 * DB-free tests for the consume/load mutations: applyConsume and
 * applyLoadPrinterFilament run against an in-memory InventoryStore, exactly the
 * object updateInventoryStore hands them inside the transaction. Covered: the
 * print-orchestrator contract (grams alias, lengthMm, amsTray reel resolution,
 * idempotent redelivery), the unchanged dashboard flows, and the guard rails
 * (insufficient stock, material mismatch, nothing loaded).
 */

// Loaded lazily so DATABASE_URL (required transitively via the repo's knex
// import) has a value before shared/env is evaluated — same idiom as
// modules/printers/monitor.test.ts. No query ever runs against it.
async function loadService() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  return import("./service");
}

type Service = Awaited<ReturnType<typeof loadService>>;
type ConsumeFilamentInput = Parameters<Service["applyConsume"]>[1];

let svc: Service;

before(async () => {
  svc = await loadService();
});

function stock(over: Partial<FilamentStock> = {}): FilamentStock {
  const now = new Date().toISOString();
  return {
    id: "stock_petg_black",
    material: "PETG",
    color: "black",
    colorName: "Чорний",
    stockG: 2000,
    lowStockG: 1000,
    criticalStockG: 300,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function storeWith(over: Partial<InventoryStore> = {}): InventoryStore {
  return {
    version: 1,
    filamentStock: [stock()],
    filamentMovements: [],
    printerFilamentState: [],
    ...over,
  };
}

function loadReel(
  store: InventoryStore,
  printerId: string,
  material: string,
  color: string,
  amsTray: number | null = null
) {
  return svc.applyLoadPrinterFilament(store, { printerId, material, color, amsTray });
}

test("dashboard flow: explicit material+color deducts that stock (unchanged)", () => {
  const store = storeWith();
  const result = svc.applyConsume(store, {
    material: "PETG",
    color: "black",
    quantityG: 300,
  });

  assert.equal(result.duplicate, false);
  assert.equal(store.filamentStock[0].stockG, 1700);
  assert.equal(result.movement!.quantityG, -300);
  assert.equal(result.movement!.source, "dashboard");
});

test("orchestrator flow: grams is accepted as an alias for quantityG", () => {
  const store = storeWith();
  loadReel(store, "bambu-a1-combo", "PETG", "black");

  const result = svc.applyConsume(store, {
    printerId: "bambu-a1-combo",
    grams: 120,
    source: "printer",
    idempotencyKey: "a1:run-1:t0",
  });

  assert.equal(result.duplicate, false);
  assert.equal(store.filamentStock[0].stockG, 1880);
  assert.equal(result.movement!.idempotencyKey, "a1:run-1:t0");
});

test("lengthMm converts to grams via the resolved material's density", () => {
  const store = storeWith();
  loadReel(store, "creality-k2", "PETG", "black");

  svc.applyConsume(store, {
    printerId: "creality-k2",
    lengthMm: 100000, // 100 m of 1.75 mm PETG (ρ 1.27) ≈ 305 g
    source: "printer",
  });

  assert.equal(store.filamentStock[0].stockG, 2000 - 305);
});

test("a redelivered idempotencyKey is a duplicate no-op, not a second deduction", () => {
  const store = storeWith();
  loadReel(store, "creality-k2", "PETG", "black");
  const input: ConsumeFilamentInput = {
    printerId: "creality-k2",
    grams: 100,
    idempotencyKey: "k2:run-7",
    source: "printer",
  };

  const first = svc.applyConsume(store, input);
  const second = svc.applyConsume(store, input);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.movement!.id, first.movement!.id);
  assert.equal(store.filamentStock[0].stockG, 1900, "deducted exactly once");
});

test("Bambu hints (material + hex color) resolve via the loaded reel, not the hint", () => {
  const store = storeWith();
  loadReel(store, "bambu-a1-combo", "PETG", "black");

  // No "PETG #00ff00" stock exists — the hex hint must not 404 the call.
  const result = svc.applyConsume(store, {
    printerId: "bambu-a1-combo",
    grams: 50,
    material: "PETG",
    color: "#00FF00",
    source: "printer",
  });

  assert.equal(result.stock!.color, "black");
  assert.equal(store.filamentStock[0].stockG, 1950);
});

test("amsTray resolves the per-slot reel; other slots and printers are untouched", () => {
  const petgBlack = stock();
  const plaWhite = stock({
    id: "stock_pla_white",
    material: "PLA",
    color: "white",
    colorName: "Білий",
    stockG: 750,
  });
  const store = storeWith({ filamentStock: [petgBlack, plaWhite] });
  loadReel(store, "bambu-a1-combo", "PETG", "black", 0);
  loadReel(store, "bambu-a1-combo", "PLA", "white", 1);

  svc.applyConsume(store, {
    printerId: "bambu-a1-combo",
    grams: 50,
    amsTray: 1,
    material: "PLA",
    source: "printer",
  });

  assert.equal(plaWhite.stockG, 700, "slot 1 reel deducted");
  assert.equal(petgBlack.stockG, 2000, "slot 0 reel untouched");
});

test("a slot with no per-tray row falls back to the printer-level reel", () => {
  const store = storeWith();
  loadReel(store, "bambu-a1-combo", "PETG", "black"); // printer-level, no tray

  svc.applyConsume(store, {
    printerId: "bambu-a1-combo",
    grams: 25,
    amsTray: 2,
    source: "printer",
  });

  assert.equal(store.filamentStock[0].stockG, 1975);
});

test("a material hint contradicting the loaded reel is rejected", () => {
  const store = storeWith();
  loadReel(store, "bambu-a1-combo", "PETG", "black");

  assert.throws(
    () =>
      svc.applyConsume(store, {
        printerId: "bambu-a1-combo",
        grams: 50,
        material: "PLA",
        source: "printer",
      }),
    /reports PLA, but the loaded reel is PETG black/
  );
  assert.equal(store.filamentStock[0].stockG, 2000, "nothing deducted");
});

test("consuming more than the stock holds is rejected and deducts nothing", () => {
  const store = storeWith();
  loadReel(store, "creality-k2", "PETG", "black");

  assert.throws(
    () => svc.applyConsume(store, { printerId: "creality-k2", grams: 5000 }),
    /Not enough filament stock/
  );
  assert.equal(store.filamentStock[0].stockG, 2000);
});

test("no loaded reel and no explicit stock is an explicit error", () => {
  const store = storeWith();

  assert.throws(
    () => svc.applyConsume(store, { printerId: "creality-k2", grams: 10 }),
    /No filament loaded for printer creality-k2/
  );
  assert.throws(
    () => svc.applyConsume(store, { grams: 10 }),
    /Material and color are required/
  );
  assert.throws(
    () =>
      svc.applyConsume(store, { material: "PLA", color: "red", quantityG: 10 }),
    /Filament stock not found: PLA red/
  );
});

test("a consume crossing the low threshold raises a low-stock alert", () => {
  const store = storeWith(); // 2000 g, low 1000, critical 300
  const result = svc.applyConsume(store, {
    material: "PETG",
    color: "black",
    quantityG: 1200, // -> 800 g, into the low band
  });

  assert.ok(result.lowStockAlert, "alert raised on the downward crossing");
  assert.equal(result.lowStockAlert!.status, "low");
  assert.equal(result.lowStockAlert!.label, "PETG Чорний");
  assert.equal(result.lowStockAlert!.stockG, 800);
  assert.equal(result.lowStockAlert!.thresholdG, 1000);
});

test("a consume that stays in the ok band raises no alert", () => {
  const store = storeWith();
  const result = svc.applyConsume(store, {
    material: "PETG",
    color: "black",
    quantityG: 300, // -> 1700 g, still ok
  });

  assert.equal(result.lowStockAlert, null);
});

test("consuming while already low does not re-alert", () => {
  const store = storeWith({ filamentStock: [stock({ stockG: 800 })] });
  const result = svc.applyConsume(store, {
    material: "PETG",
    color: "black",
    quantityG: 100, // 800 -> 700, stays low
  });

  assert.equal(result.lowStockAlert, null);
});

test("a consume straight into the critical band alerts as critical", () => {
  const store = storeWith();
  const result = svc.applyConsume(store, {
    material: "PETG",
    color: "black",
    quantityG: 1800, // -> 200 g, into critical
  });

  assert.equal(result.lowStockAlert!.status, "critical");
  assert.equal(result.lowStockAlert!.thresholdG, 300);
});

test("a low reel dropping into critical escalates with a fresh alert", () => {
  const store = storeWith({ filamentStock: [stock({ stockG: 800 })] });
  const result = svc.applyConsume(store, {
    material: "PETG",
    color: "black",
    quantityG: 600, // 800 (low) -> 200 (critical)
  });

  assert.equal(result.lowStockAlert!.status, "critical");
});

test("a redelivered consume does not re-raise the low-stock alert", () => {
  const store = storeWith();
  const input: ConsumeFilamentInput = {
    material: "PETG",
    color: "black",
    quantityG: 1200,
    idempotencyKey: "consume-1",
  };

  const first = svc.applyConsume(store, input);
  const second = svc.applyConsume(store, input);

  assert.ok(first.lowStockAlert, "the real consume alerts");
  assert.equal(second.duplicate, true);
  assert.equal(second.lowStockAlert, null, "the duplicate is silent");
  assert.equal(store.filamentStock[0].stockG, 800, "deducted exactly once");
});

test("updateFilament edits thresholds, colour name and active flag by id", () => {
  const store = storeWith();
  const result = svc.applyUpdateFilament(store, {
    id: "stock_petg_black",
    colorName: "Вугільний",
    lowStockG: 800,
    criticalStockG: 200,
    enabled: false,
  });

  const edited = store.filamentStock[0];
  assert.equal(edited.colorName, "Вугільний");
  assert.equal(edited.lowStockG, 800);
  assert.equal(edited.criticalStockG, 200);
  assert.equal(edited.enabled, false);
  assert.equal(edited.stockG, 2000, "grams are untouched by an edit");
  assert.equal(result.stock.status, "ok");
});

test("updateFilament resolves the target by material+color and recomputes status", () => {
  const store = storeWith();
  // Raise the critical threshold above the current stock → status flips.
  const result = svc.applyUpdateFilament(store, {
    material: "PETG",
    color: "black",
    criticalStockG: 2500,
    lowStockG: 3000,
  });

  assert.equal(result.stock.status, "critical");
});

test("updateFilament rejects a critical threshold above the low threshold", () => {
  const store = storeWith();
  assert.throws(
    () =>
      svc.applyUpdateFilament(store, {
        id: "stock_petg_black",
        criticalStockG: 1500,
      }),
    /criticalStockG must not be greater than lowStockG/
  );
});

test("updateFilament errors when the target does not exist", () => {
  const store = storeWith();
  assert.throws(
    () => svc.applyUpdateFilament(store, { id: "nope" }),
    /Filament stock not found/
  );
});

test("loadPrinterFilament upserts per (printerId, amsTray)", () => {
  const store = storeWith({
    filamentStock: [
      stock(),
      stock({ id: "stock_pla_white", material: "PLA", color: "white", stockG: 500 }),
    ],
  });

  const level = loadReel(store, "bambu-a1-combo", "PETG", "black");
  const tray0 = loadReel(store, "bambu-a1-combo", "PETG", "black", 0);
  const tray0Again = loadReel(store, "bambu-a1-combo", "PLA", "white", 0);

  assert.equal(store.printerFilamentState.length, 2, "printer-level + one tray row");
  assert.notEqual(level.id, tray0.id);
  assert.equal(tray0Again.id, tray0.id, "same slot re-load updates in place");
  assert.equal(tray0Again.material, "PLA");
  assert.throws(
    () => loadReel(store, "bambu-a1-combo", "PLA", "white", -1),
    /amsTray must be a non-negative integer/
  );
});
