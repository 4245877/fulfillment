import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  OrchestratorError,
  type OrchestratorClient,
} from "../../infra/integrations/orchestrator/client";
import printersRoutes from "./routes";

const ADMIN_TOKEN = "test-admin-token";

function fakeClient(
  handler: () => Promise<unknown[]>
): OrchestratorClient {
  return { listPrinterStatuses: handler } as unknown as OrchestratorClient;
}

async function buildApp(client: OrchestratorClient | null) {
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  const app = Fastify();
  await app.register(printersRoutes, { prefix: "/api/printers", client });
  return app;
}

function get(app: Awaited<ReturnType<typeof buildApp>>, url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-admin-token": ADMIN_TOKEN },
  });
}

test("GET /status proxies orchestrator statuses and adds a freshness flag", async () => {
  const printers = [
    { id: "k2", name: "Creality K2", status: "printing", online: true },
  ];
  const app = await buildApp(fakeClient(async () => printers));

  const response = await get(app, "/api/printers/status");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    printers: [{ ...printers[0], stale: false }],
  });
  await app.close();
});

test("GET /status flags printers whose orchestrator timestamp is stale", async () => {
  const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const freshAt = new Date().toISOString();
  const app = await buildApp(
    fakeClient(async () => [
      { id: "frozen", status: "printing", online: true, updatedAt: staleAt },
      { id: "live", status: "printing", online: true, updatedAt: freshAt },
      // No updatedAt (older orchestrator build): unknown age, not stale.
      { id: "legacy", status: "idle", online: true },
    ])
  );

  const response = await get(app, "/api/printers/status");

  assert.equal(response.statusCode, 200);
  const byId = new Map(
    (response.json().printers as Array<{ id: string; stale: boolean }>).map(
      (printer) => [printer.id, printer.stale]
    )
  );
  assert.equal(byId.get("frozen"), true);
  assert.equal(byId.get("live"), false);
  assert.equal(byId.get("legacy"), false);
  await app.close();
});

test("GET /status is admin-gated", async () => {
  const app = await buildApp(fakeClient(async () => []));

  const response = await app.inject({ method: "GET", url: "/api/printers/status" });

  assert.equal(response.statusCode, 401);
  await app.close();
});

test("GET /status answers 502 with a readable error when the orchestrator is down", async () => {
  const app = await buildApp(
    fakeClient(async () => {
      throw new OrchestratorError("network", "connect ECONNREFUSED");
    })
  );

  const response = await get(app, "/api/printers/status");

  assert.equal(response.statusCode, 502);
  const body = response.json();
  assert.match(body.error, /недоступен/i);
  assert.deepEqual(body.printers, []);
  await app.close();
});

test("GET /status answers 503 when no orchestrator is configured", async () => {
  const app = await buildApp(null);

  const response = await get(app, "/api/printers/status");

  assert.equal(response.statusCode, 503);
  assert.match(response.json().error, /не настроен/i);
  await app.close();
});

test("the local printer config routes are gone", async () => {
  const app = await buildApp(fakeClient(async () => []));

  for (const [method, url] of [
    ["GET", "/api/printers/config"],
    ["POST", "/api/printers/config"],
    ["POST", "/api/printers/test"],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    assert.equal(response.statusCode, 404, `${method} ${url}`);
  }

  await app.close();
});

// ── GET /inventory (the configured fleet) ────────────────────────────────────
//
// The configuration route and the status route answer different questions, and
// the difference is the point: a disabled printer belongs in the inventory and
// nowhere in the statuses; an enabled-but-offline one belongs in both.

import { PrinterDirectory } from "./directory";
import type {
  OrchestratorPrinterConfig,
  OrchestratorPrinterInventory,
} from "../../infra/integrations/orchestrator/client";

function configEntry(
  overrides: Partial<OrchestratorPrinterConfig> = {}
): OrchestratorPrinterConfig {
  return {
    id: "k2",
    name: "Creality K2",
    model: "K2 Plus",
    type: "FDM",
    printerClass: "k2",
    protocol: "moonraker",
    enabled: true,
    position: 10,
    material: "PETG",
    swatch: "#4c4f55",
    nozzleDiameterMm: 0.4,
    nozzleType: "hardened_steel",
    buildVolume: { x: 350, y: 350, z: 350 },
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

async function appWithDirectory(
  answer: () => Promise<OrchestratorPrinterInventory>
) {
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  const client = { listPrinterInventory: answer } as unknown as OrchestratorClient;
  const app = Fastify();
  await app.register(printersRoutes, {
    prefix: "/api/printers",
    client: null,
    directory: new PrinterDirectory({ client }),
  });
  return app;
}

test("GET /inventory serves the configured fleet, disabled printers included", async () => {
  const app = await appWithDirectory(async () => ({
    revision: "rev-1",
    updatedAt: "2026-07-12T12:00:00.000Z",
    printers: [configEntry(), configEntry({ id: "a1", name: "Bambu A1", enabled: false })],
  }));

  const response = await get(app, "/api/printers/inventory");
  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.available, true);
  assert.equal(body.revision, "rev-1");
  assert.equal(body.stale, false);
  assert.deepEqual(
    body.printers.map((printer: { id: string; enabled: boolean }) => [
      printer.id,
      printer.enabled,
    ]),
    [
      ["k2", true],
      ["a1", false],
    ]
  );
  await app.close();
});

test("GET /inventory requires the admin token", async () => {
  const app = await appWithDirectory(async () => ({
    revision: "rev-1",
    updatedAt: null,
    printers: [configEntry()],
  }));

  const response = await app.inject({
    method: "GET",
    url: "/api/printers/inventory",
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("GET /inventory reports a degraded fleet instead of an empty one", async () => {
  const app = await appWithDirectory(async () => {
    throw new Error("connect ECONNREFUSED");
  });

  const response = await get(app, "/api/printers/inventory");

  // 502 + available:false — never 200 with `printers: []`, which a consumer
  // would read as "the farm has no printers".
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().available, false);
  assert.equal(response.json().reason, "orchestrator_unavailable");
  await app.close();
});

test("GET /inventory serves the last known fleet, marked stale, during an outage", async () => {
  let fail = false;
  let nowMs = 1_000_000;
  const client = {
    listPrinterInventory: async () => {
      if (fail) throw new Error("connect ECONNREFUSED");
      return { revision: "rev-1", updatedAt: null, printers: [configEntry()] };
    },
  } as unknown as OrchestratorClient;

  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  const app = Fastify();
  await app.register(printersRoutes, {
    prefix: "/api/printers",
    client: null,
    directory: new PrinterDirectory({ client, now: () => nowMs, ttlMs: 30_000 }),
  });

  assert.equal((await get(app, "/api/printers/inventory")).statusCode, 200);

  // The orchestrator goes away and the cache ages past its freshness window.
  fail = true;
  nowMs += 60_000;

  const degraded = await get(app, "/api/printers/inventory");
  const body = degraded.json();

  // A display route keeps showing what it last knew — but says it is old, so
  // the operator is never told a fleet is current when nobody has confirmed it.
  assert.equal(degraded.statusCode, 200);
  assert.equal(body.available, true);
  assert.equal(body.stale, true);
  assert.equal(body.ageMs, 60_000);
  assert.equal(body.printers.length, 1);
  await app.close();
});

test("GET /inventory says so when no orchestrator is configured", async () => {
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  const app = Fastify();
  await app.register(printersRoutes, {
    prefix: "/api/printers",
    client: null,
    directory: new PrinterDirectory({ client: null }),
  });

  const response = await get(app, "/api/printers/inventory");
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().reason, "not_configured");
  await app.close();
});
