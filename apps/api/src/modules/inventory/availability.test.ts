import assert from "node:assert/strict";
import { before, test } from "node:test";
import Fastify from "fastify";

import { requireFilamentAvailabilityToken } from "../../core/auth";
import type { FilamentStock, InventoryStore } from "./types";

/*
 * DB-free tests for the read-only shop availability feed. The data and
 * normalization logic is exercised through the pure buildFilamentAvailability /
 * canonicalizeMaterial / canonicalizeColor functions (no Postgres), the bearer
 * guard through requireFilamentAvailabilityToken directly, and the route wiring
 * through app.inject — whose 503/401 paths return before any store read, so no
 * database is touched.
 */

// Loaded lazily so DATABASE_URL (required transitively via the repo's knex
// import when shared/env is evaluated) has a value first — same idiom as
// service.test.ts. No query ever runs against it here.
async function loadService() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  return import("./service");
}

async function loadRoutes() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  return (await import("./routes")).default;
}

type Service = Awaited<ReturnType<typeof loadService>>;

let svc: Service;

before(async () => {
  svc = await loadService();
});

function stock(over: Partial<FilamentStock> = {}): FilamentStock {
  const now = "2026-07-11T12:00:00.000Z";
  return {
    id: "filament_stock_pla_black",
    material: "PLA",
    color: "black",
    colorName: "Чорний",
    stockG: 4800,
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
    filamentStock: [],
    filamentMovements: [],
    printerFilamentState: [],
    ...over,
  };
}

// ── buildFilamentAvailability: classification ──────────────────────────────

test("a mapped position above the threshold is available (status ok, no reason)", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({ filamentStock: [stock({ stockG: 4800 })] }),
    100
  );

  assert.equal(res.version, 1);
  assert.equal(res.threshold_g, 100);
  assert.equal(res.updated_at, "2026-07-11T12:00:00.000Z");
  assert.equal(res.items.length, 1);

  const item = res.items[0];
  assert.deepEqual(item, {
    stock_id: "filament_stock_pla_black",
    material: "PLA",
    color: "Black",
    material_raw: "PLA",
    color_raw: "black",
    mapped: true,
    available: true,
    available_weight_g: 4800,
    status: "ok",
  });
  assert.equal("reason" in item, false, "available items carry no reason");
});

test("stock exactly at the threshold is available (>= is inclusive)", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({ filamentStock: [stock({ stockG: 100 })] }),
    100
  );

  assert.equal(res.items[0].available, true);
  assert.equal(res.items[0].status, "ok");
  assert.equal(res.items[0].available_weight_g, 100);
});

test("stock above zero but below the threshold is below_threshold", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({ filamentStock: [stock({ stockG: 50 })] }),
    100
  );

  const item = res.items[0];
  assert.equal(item.available, false);
  assert.equal(item.status, "low");
  assert.equal(item.reason, "below_threshold");
  assert.equal(item.available_weight_g, 50);
  assert.equal(item.mapped, true);
});

test("zero stock is out_of_stock (status critical)", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({
      filamentStock: [
        stock({ id: "filament_stock_tpu_black", material: "TPU", stockG: 0 }),
      ],
    }),
    100
  );

  const item = res.items[0];
  assert.equal(item.material, "TPU");
  assert.equal(item.color, "Black");
  assert.equal(item.available, false);
  assert.equal(item.status, "critical");
  assert.equal(item.reason, "out_of_stock");
  assert.equal(item.available_weight_g, 0);
});

test("disabled positions are excluded from the feed", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({
      filamentStock: [
        stock({ id: "on", material: "PLA", color: "black", stockG: 4800 }),
        stock({ id: "off", material: "PETG", color: "white", stockG: 4800, enabled: false }),
      ],
    }),
    100
  );

  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].stock_id, "on");
});

test("an empty shelf returns no items and a null updated_at", () => {
  const res = svc.buildFilamentAvailability(storeWith(), 100);

  assert.deepEqual(res.items, []);
  assert.equal(res.updated_at, null);
  assert.equal(res.threshold_g, 100);
  assert.equal(res.version, 1);
});

test("updated_at is the max updated_at across the returned positions", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({
      filamentStock: [
        stock({ id: "a", material: "PLA", color: "black", updatedAt: "2026-07-01T00:00:00.000Z" }),
        stock({ id: "b", material: "PETG", color: "white", updatedAt: "2026-07-10T09:30:00.000Z" }),
        // A disabled row with a newer stamp must NOT influence updated_at.
        stock({ id: "c", material: "ABS", color: "red", enabled: false, updatedAt: "2026-07-11T23:59:00.000Z" }),
      ],
    }),
    100
  );

  assert.equal(res.updated_at, "2026-07-10T09:30:00.000Z");
});

// ── buildFilamentAvailability: unmapped rows stay visible ──────────────────

test("an unknown material is kept but reported mapped:false / unmapped", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({
      filamentStock: [stock({ id: "x", material: "Wood", color: "black", stockG: 5000 })],
    }),
    100
  );

  const item = res.items[0];
  assert.equal(item.mapped, false);
  assert.equal(item.material, null, "canonical material is null when unmappable");
  assert.equal(item.color, "Black", "the color still maps — null pinpoints the failing side");
  assert.equal(item.material_raw, "Wood");
  assert.equal(item.available, false);
  assert.equal(item.reason, "unmapped");
});

test("an unknown color is kept but reported mapped:false / unmapped", () => {
  const res = svc.buildFilamentAvailability(
    storeWith({
      filamentStock: [stock({ id: "x", material: "PLA", color: "chartreuse", stockG: 5000 })],
    }),
    100
  );

  const item = res.items[0];
  assert.equal(item.mapped, false);
  assert.equal(item.material, "PLA");
  assert.equal(item.color, null);
  assert.equal(item.color_raw, "chartreuse");
  assert.equal(item.available, false);
  assert.equal(item.reason, "unmapped");
});

// ── canonicalizeMaterial ───────────────────────────────────────────────────

test("PLA family aliases all canonicalize to PLA", () => {
  for (const raw of ["PLA", "pla", "PLA+", "PLA PLUS", "HYPER PLA", "HYPER_PLA", "PLA BASIC", "  pla-basic  "]) {
    assert.equal(svc.canonicalizeMaterial(raw), "PLA", `${raw} → PLA`);
  }
});

test("the other canonical families map, including brand suffixes", () => {
  assert.equal(svc.canonicalizeMaterial("PETG"), "PETG");
  assert.equal(svc.canonicalizeMaterial("petg-cf"), "PETG");
  assert.equal(svc.canonicalizeMaterial("TPU"), "TPU");
  assert.equal(svc.canonicalizeMaterial("ABS"), "ABS");
  assert.equal(svc.canonicalizeMaterial("ASA"), "ASA");
});

test("unknown materials — and resin — stay unmapped (null), never invented", () => {
  for (const raw of ["Wood", "PC", "PVA", "Nylon", "Resin Standard", "", "   "]) {
    assert.equal(svc.canonicalizeMaterial(raw), null, `${raw} → null`);
  }
});

// ── canonicalizeColor ──────────────────────────────────────────────────────

test("gray and grey both canonicalize to Grey", () => {
  assert.equal(svc.canonicalizeColor("gray"), "Grey");
  assert.equal(svc.canonicalizeColor("grey"), "Grey");
  assert.equal(svc.canonicalizeColor("GREY"), "Grey");
});

test("silver stays Silver — no RGB collapsing into Grey", () => {
  assert.equal(svc.canonicalizeColor("silver"), "Silver");
  // Grey, Silver and Transparent must remain distinct canonical values.
  assert.notEqual(svc.canonicalizeColor("silver"), svc.canonicalizeColor("grey"));
  assert.notEqual(svc.canonicalizeColor("transparent"), svc.canonicalizeColor("grey"));
  assert.notEqual(svc.canonicalizeColor("transparent"), svc.canonicalizeColor("silver"));
});

test("the documented color aliases map to their canonical English names", () => {
  const cases: Record<string, string> = {
    black: "Black",
    white: "White",
    yellow: "Yellow",
    transparent: "Transparent",
    clear: "Transparent",
    bronze: "Bronze",
    orange: "Orange",
    green: "Green",
    red: "Red",
    blue: "Blue",
    purple: "Purple",
    gold: "Gold",
    multicolor: "Multicolor",
    "multi color": "Multicolor",
  };

  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(svc.canonicalizeColor(raw), expected, `${raw} → ${expected}`);
  }
});

test("unknown colors stay unmapped (null)", () => {
  for (const raw of ["chartreuse", "", "   ", "#00ff00"]) {
    assert.equal(svc.canonicalizeColor(raw), null, `${raw} → null`);
  }
});

// ── requireFilamentAvailabilityToken (bearer guard) ────────────────────────

function fakeReply() {
  const captured = { status: 0 };
  const reply: any = {
    code(status: number) {
      captured.status = status;
      return reply;
    },
  };
  return { reply, captured };
}

function fakeRequest(authorization?: string) {
  return { headers: authorization == null ? {} : { authorization } } as any;
}

test("guard: an unconfigured token fails closed with 503", () => {
  delete process.env.FILAMENT_AVAILABILITY_TOKEN;
  const { reply, captured } = fakeReply();

  const denied = requireFilamentAvailabilityToken(fakeRequest("Bearer whatever"), reply);

  assert.equal(captured.status, 503);
  assert.match(denied!.error, /not configured/i);
  assert.doesNotMatch(denied!.error, /whatever/, "the presented token never leaks into the body");
});

test("guard: a missing Authorization header is 401", () => {
  process.env.FILAMENT_AVAILABILITY_TOKEN = "s3cret-token";
  const { reply, captured } = fakeReply();

  const denied = requireFilamentAvailabilityToken(fakeRequest(), reply);

  assert.equal(captured.status, 401);
  assert.deepEqual(denied, { error: "Unauthorized" });
  delete process.env.FILAMENT_AVAILABILITY_TOKEN;
});

test("guard: a wrong or malformed token is 401", () => {
  process.env.FILAMENT_AVAILABILITY_TOKEN = "s3cret-token";

  for (const header of ["Bearer nope", "Basic s3cret-token", "s3cret-token", "Bearer", "Bearer "]) {
    const { reply, captured } = fakeReply();
    const denied = requireFilamentAvailabilityToken(fakeRequest(header), reply);
    assert.equal(captured.status, 401, `${header} → 401`);
    assert.deepEqual(denied, { error: "Unauthorized" });
  }

  delete process.env.FILAMENT_AVAILABILITY_TOKEN;
});

test("guard: the correct bearer token is authorised (returns null)", () => {
  process.env.FILAMENT_AVAILABILITY_TOKEN = "s3cret-token";

  // Exact, lowercase scheme, and surrounding whitespace all accepted.
  for (const header of ["Bearer s3cret-token", "bearer s3cret-token", "  Bearer   s3cret-token  "]) {
    const { reply, captured } = fakeReply();
    const denied = requireFilamentAvailabilityToken(fakeRequest(header), reply);
    assert.equal(denied, null, `${header} authorised`);
    assert.equal(captured.status, 0, "no error status set on success");
  }

  delete process.env.FILAMENT_AVAILABILITY_TOKEN;
});

// ── Route wiring (app.inject; guard returns before any store read) ─────────

async function availabilityApp() {
  const inventoryRoutes = await loadRoutes();
  const app = Fastify();
  await app.register(inventoryRoutes, { prefix: "/api/inventory" });
  return app;
}

const AVAILABILITY_URL = "/api/inventory/filament/availability";

test("route: unconfigured token → 503", async () => {
  delete process.env.FILAMENT_AVAILABILITY_TOKEN;
  const app = await availabilityApp();

  const res = await app.inject({ method: "GET", url: AVAILABILITY_URL });

  assert.equal(res.statusCode, 503);
  await app.close();
});

test("route: configured token but no header → 401", async () => {
  process.env.FILAMENT_AVAILABILITY_TOKEN = "s3cret-token";
  const app = await availabilityApp();

  const res = await app.inject({ method: "GET", url: AVAILABILITY_URL });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: "Unauthorized" });

  await app.close();
  delete process.env.FILAMENT_AVAILABILITY_TOKEN;
});

test("route: configured token but wrong bearer → 401", async () => {
  process.env.FILAMENT_AVAILABILITY_TOKEN = "s3cret-token";
  const app = await availabilityApp();

  const res = await app.inject({
    method: "GET",
    url: AVAILABILITY_URL,
    headers: { authorization: "Bearer nope" },
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: "Unauthorized" });

  await app.close();
  delete process.env.FILAMENT_AVAILABILITY_TOKEN;
});
