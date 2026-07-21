import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

/*
 * DB-backed tests for the point-query mutation path (repo.runInventoryMutation +
 * service wrappers) against a REAL Postgres. Opt-in: they run only when
 * INVENTORY_DB_TEST_URL points at a THROWAWAY, migrated database and are skipped
 * otherwise, so the default `pnpm test` (no database) stays green.
 *
 *   # one-time: a disposable DB, migrated
 *   INVENTORY_DB_TEST_URL=postgres://user:pass@localhost:5433/fulfillment_repotest \
 *     node --import tsx --test src/modules/inventory/repo.integration.test.ts
 *
 * These cover what the DB-free service.test.ts cannot: that a write is a point
 * INSERT/UPDATE (not a delete-all rewrite), that idempotency and concurrency
 * hold across real transactions, and that the movements feed is enriched.
 */

const DB_URL = process.env.INVENTORY_DB_TEST_URL;
const skip = DB_URL ? false : "INVENTORY_DB_TEST_URL not set (needs a throwaway migrated DB)";

// knex reads DATABASE_URL at import; point it at the throwaway DB before the
// service/repo modules are loaded.
if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
}

type Service = typeof import("./service");
type Knex = typeof import("../../infra/db/knex");

let svc: Service;
let knex: Knex;

async function reset() {
  await knex.db.raw(
    "truncate table filament_movements, printer_filament_state, filament_stock restart identity cascade"
  );
  await knex.db.raw("truncate table outbox_events restart identity cascade");
}

describe("inventory point-query path (DB-backed)", { skip }, () => {
  before(async () => {
    svc = await import("./service");
    knex = await import("../../infra/db/knex");
    await reset();
  });

  after(async () => {
    if (knex) {
      await knex.db.destroy();
    }
  });

  test("add then consume are point writes, not a delete-all rewrite", async () => {
    await reset();
    await svc.addFilament({ material: "PLA", color: "black", quantityG: 1000 });
    await svc.addFilament({ material: "PETG", color: "white", quantityG: 500 });

    // Consuming PLA must leave the PETG row untouched (a full rewrite would have
    // deleted + reinserted every row).
    const petgBefore = await knex
      .db("filament_stock")
      .where({ material: "PETG", color: "white" })
      .first();

    await svc.consumeFilament({ material: "PLA", color: "black", quantityG: 200 });

    const petgAfter = await knex
      .db("filament_stock")
      .where({ material: "PETG", color: "white" })
      .first();
    const pla = await knex
      .db("filament_stock")
      .where({ material: "PLA", color: "black" })
      .first();

    assert.equal(Number(pla.stock_g), 800);
    assert.equal(petgAfter.updated_at.getTime(), petgBefore.updated_at.getTime(), "PETG row not rewritten");
    const movements = await knex.db("filament_movements").count<{ count: string }[]>("id as count");
    assert.equal(Number(movements[0].count), 3, "one movement per op, history preserved");
  });

  test("a repeated idempotencyKey does not deduct twice", async () => {
    await reset();
    await svc.addFilament({ material: "PLA", color: "black", quantityG: 1000 });
    await svc.loadPrinterFilament({ printerId: "k2", material: "PLA", color: "black" });

    const input = {
      printerId: "k2",
      grams: 120,
      source: "printer" as const,
      idempotencyKey: "run-42",
    };
    const first = await svc.consumeFilament(input);
    const second = await svc.consumeFilament(input);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);

    const pla = await knex.db("filament_stock").where({ material: "PLA", color: "black" }).first();
    assert.equal(Number(pla.stock_g), 880, "deducted exactly once");
    const moves = await knex.db("filament_movements").where({ type: "consume" });
    assert.equal(moves.length, 1, "exactly one consume movement");
  });

  test("concurrent consumes never drive the balance negative", async () => {
    await reset();
    await svc.addFilament({ material: "PLA", color: "black", quantityG: 100 });

    // Five concurrent 30 g consumes against 100 g: the advisory lock serialises
    // them, so exactly three succeed and two are rejected — final 10 g, never < 0.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        svc.consumeFilament({ material: "PLA", color: "black", quantityG: 30 })
      )
    );

    const rejected = results.filter((r) => r.status === "rejected").length;
    const pla = await knex.db("filament_stock").where({ material: "PLA", color: "black" }).first();

    assert.equal(Number(pla.stock_g), 10, "final balance is exact, not negative");
    assert.equal(rejected, 2, "the two overdrawing consumes were refused");
  });

  test("adding to an archived position reactivates it and it becomes visible", async () => {
    await reset();
    await svc.addFilament({ material: "PLA", color: "black", quantityG: 1000 });
    // Archive it.
    await svc.updateFilamentStock({ material: "PLA", color: "black", enabled: false });
    assert.equal((await svc.listFilamentStock()).length, 0, "archived position hidden");

    const result = await svc.addFilament({ material: "PLA", color: "black", quantityG: 500 });
    assert.equal(result.reactivated, true);
    assert.equal(result.stock.enabled, true);

    const visible = await svc.listFilamentStock();
    assert.equal(visible.length, 1, "reactivated position is visible again");
    assert.equal(visible[0].stockG, 1500);
  });

  test("materials summary + availability read a consistent snapshot", async () => {
    await reset();
    await svc.addFilament({ material: "PLA", color: "black", quantityG: 2000 });
    await svc.addFilament({ material: "PETG", color: "white", quantityG: 50 });
    await svc.loadPrinterFilament({ printerId: "k2", material: "PLA", color: "black" });

    // getInventoryMaterialsSummary runs a repeatable-read transaction across two
    // tables (stock + reel bindings) — smoke that it executes and agrees.
    const summary = await svc.getInventoryMaterialsSummary();
    assert.equal(summary.reelsInUse, 1);
    assert.equal(summary.filamentKg, 2.05);
    assert.equal(summary.stock.length, 2);

    const availability = await svc.getFilamentAvailability();
    assert.equal(availability.items.length, 2);
    const pla = availability.items.find((i) => i.material === "PLA");
    assert.equal(pla?.available, true);
  });

  test("movements feed is enriched with the (even archived) position", async () => {
    await reset();
    await svc.addFilament({ material: "PLA", color: "black", quantityG: 1000, note: "новая катушка" });
    await svc.updateFilamentStock({ material: "PLA", color: "black", enabled: false });

    const movements = await svc.listFilamentMovements(10);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].stockMaterial, "PLA");
    assert.equal(movements[0].stockColor, "black");
    assert.equal(movements[0].stockEnabled, false, "archived position still resolvable in history");
  });
});
