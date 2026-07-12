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
  assert.match(body.error, /недоступний/i);
  assert.deepEqual(body.printers, []);
  await app.close();
});

test("GET /status answers 503 when no orchestrator is configured", async () => {
  const app = await buildApp(null);

  const response = await get(app, "/api/printers/status");

  assert.equal(response.statusCode, 503);
  assert.match(response.json().error, /не налаштований/i);
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
