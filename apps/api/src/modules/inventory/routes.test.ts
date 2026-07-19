import assert from "node:assert/strict";
import { before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";

/*
 * DB-free tests for inventory route AUTHORISATION and INPUT VALIDATION. Every
 * assertion here exercises a path that returns BEFORE the service/database is
 * touched — an auth denial or a validation rejection — so no Postgres is needed
 * (DATABASE_URL is a dummy the knex import is satisfied with but never queries).
 *
 * Covers mandatory scenarios 4, 5, 6 and 10.
 */

// Fixed tokens for the whole file (each test file runs in its own process, so
// this does not leak into other suites). Auth reads process.env live.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ADMIN_TOKEN = "admin-secret";
process.env.ATELIER_FULFILLMENT_TOKEN = "service-secret";
delete process.env.ATELIER_FULFILLMENT_AUTH_OPTIONAL;

const ADMIN = { "x-admin-token": "admin-secret" };
const SERVICE = { "x-service-token": "service-secret" };

async function loadRoutes() {
  return (await import("./routes")).default;
}

let app: FastifyInstance;

before(async () => {
  const routes = await loadRoutes();
  app = Fastify();
  await app.register(routes, { prefix: "/api/inventory" });
  await app.ready();
});

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json", ...headers },
    payload: JSON.stringify(body ?? {}),
  });
}

// ── 4. A mutating request without any token is rejected ──────────────────────

test("add without a token is rejected (401)", async () => {
  const res = await post("/api/inventory/filament/add", {
    material: "PLA",
    color: "black",
    quantityG: 100,
  });
  assert.equal(res.statusCode, 401);
});

test("consume without a token is rejected (401)", async () => {
  const res = await post("/api/inventory/filament/consume", {
    material: "PLA",
    color: "black",
    quantityG: 100,
  });
  assert.equal(res.statusCode, 401);
});

// ── 5. A wrong token is rejected ─────────────────────────────────────────────

test("a wrong admin token is rejected (401)", async () => {
  const res = await post(
    "/api/inventory/filament/add",
    { material: "PLA", color: "black", quantityG: 100 },
    { "x-admin-token": "not-the-token" }
  );
  assert.equal(res.statusCode, 401);
});

test("a wrong service token is rejected on consume (401)", async () => {
  const res = await post(
    "/api/inventory/filament/consume",
    { material: "PLA", color: "black", quantityG: 100 },
    { "x-service-token": "not-the-token" }
  );
  assert.equal(res.statusCode, 401);
});

// ── 6. The service token does NOT open admin-only routes ─────────────────────

test("the atelier service token does not open the admin add route (401)", async () => {
  const res = await post(
    "/api/inventory/filament/add",
    { material: "PLA", color: "black", quantityG: 100 },
    SERVICE
  );
  assert.equal(res.statusCode, 401, "service token must be refused on an admin route");
});

test("the service token does not open adjust/update/load either (401)", async () => {
  for (const url of [
    "/api/inventory/filament/adjust",
    "/api/inventory/filament/update",
    "/api/inventory/printer-filament/load",
  ]) {
    const res = await post(url, { material: "PLA", color: "black", actualG: 1 }, SERVICE);
    assert.equal(res.statusCode, 401, `${url} must refuse the service token`);
  }
});

test("the service token IS accepted for auth on consume (passes to validation)", async () => {
  // A deliberately invalid body: if auth had failed this would be 401; a 400
  // proves the service token cleared auth and the request reached validation.
  const res = await post("/api/inventory/filament/consume", {}, SERVICE);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "missing_quantity");
});

test("the service token IS accepted for auth on sync (passes to validation)", async () => {
  const res = await post("/api/inventory/printer-filament/sync", {}, SERVICE);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "missing_printerId");
});

test("an admin token is accepted for auth on an admin route (passes to validation)", async () => {
  const res = await post("/api/inventory/filament/add", {}, ADMIN);
  assert.equal(res.statusCode, 400, "past auth, rejected by validation");
});

// ── 10. An invalid `source` is rejected before the database ──────────────────

test("consume with an unknown source is rejected before the DB (400 invalid_source)", async () => {
  // `api` is exactly the stale value the UI used to send; it is not a real
  // source and must be refused up front.
  const res = await post(
    "/api/inventory/filament/consume",
    { material: "PLA", color: "black", quantityG: 100, source: "api" },
    ADMIN
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "invalid_source");
});

test("add with a NaN/Infinity/negative quantity is rejected (400)", async () => {
  for (const quantityG of ["not-a-number", "Infinity", -5, 0]) {
    const res = await post(
      "/api/inventory/filament/add",
      { material: "PLA", color: "black", quantityG },
      ADMIN
    );
    assert.equal(res.statusCode, 400, `quantityG=${quantityG} must be rejected`);
  }
});

// ── Compatibility mode (staged rollout) ──────────────────────────────────────

test("compat mode lets a token-less inter-service call pass auth, with a warning", async () => {
  process.env.ATELIER_FULFILLMENT_AUTH_OPTIONAL = "true";
  try {
    // No token at all; compat mode must let it clear auth (→ 400 validation),
    // NOT 401.
    const res = await post("/api/inventory/filament/consume", {}, {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "missing_quantity");
  } finally {
    delete process.env.ATELIER_FULFILLMENT_AUTH_OPTIONAL;
  }
});

test("with compat mode OFF a token-less inter-service call is refused (401)", async () => {
  const res = await post("/api/inventory/filament/consume", {}, {});
  assert.equal(res.statusCode, 401);
});
