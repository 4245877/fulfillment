import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  OrchestratorError,
  type OrchestratorClient,
} from "../../infra/integrations/orchestrator/client";
import printsRoutes from "./routes";

type FakeParts = {
  printers?: () => Promise<unknown[]>;
  queue?: () => Promise<unknown[]>;
  today?: () => Promise<unknown>;
};

function fakeClient(parts: FakeParts = {}): OrchestratorClient {
  return {
    listPrinterStatuses:
      parts.printers ?? (async () => [{ id: "k2", status: "printing" }]),
    listQueueJobs: parts.queue ?? (async () => []),
    fetchToday:
      parts.today ?? (async () => ({ done: 0, active: 0, failed: 0 })),
  } as unknown as OrchestratorClient;
}

async function buildApp(client: OrchestratorClient | null) {
  const app = Fastify();
  await app.register(printsRoutes, { prefix: "/api/prints", client });
  return app;
}

test("GET /overview assembles live printers, queue and today's counters", async () => {
  const app = await buildApp(
    fakeClient({
      printers: async () => [
        { id: "k2", status: "printing" },
        { id: "a1", status: "printing" },
        { id: "ender", status: "idle" },
      ],
      queue: async () => [
        { id: "q1", title: "Vase", printer: "k2", material: "PETG", eta: "14:00", status: "ready" },
        { id: "q2", title: "Boat", printer: null, material: null, eta: null, status: "review" },
      ],
      today: async () => ({ done: 5, active: 2, failed: 1 }),
    })
  );

  const response = await app.inject({ method: "GET", url: "/api/prints/overview" });
  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.available, true);
  assert.equal(body.reason, null);
  assert.equal(body.printers.length, 3);
  assert.equal(body.jobs.length, 2);
  assert.deepEqual(body.stats, { printing: 2, queued: 2, done: 5 });
  await app.close();
});

test("GET /overview reports an explicit unavailable status when the orchestrator is down", async () => {
  const app = await buildApp(
    fakeClient({
      printers: async () => {
        throw new OrchestratorError("network", "connect ECONNREFUSED");
      },
    })
  );

  const response = await app.inject({ method: "GET", url: "/api/prints/overview" });
  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.available, false);
  assert.equal(body.reason, "orchestrator_unavailable");
  assert.deepEqual(body.printers, []);
  assert.deepEqual(body.jobs, []);
  assert.deepEqual(body.stats, { printing: null, queued: null, done: null });
  await app.close();
});

test("GET /overview degrades to unavailable when any sub-read fails", async () => {
  const app = await buildApp(
    fakeClient({
      today: async () => {
        throw new OrchestratorError("timeout", "today timed out");
      },
    })
  );

  const response = await app.inject({ method: "GET", url: "/api/prints/overview" });
  const body = response.json();
  assert.equal(body.available, false);
  assert.equal(body.reason, "orchestrator_unavailable");
  await app.close();
});

test("GET /overview reports not_configured without an orchestrator URL", async () => {
  const app = await buildApp(null);

  const response = await app.inject({ method: "GET", url: "/api/prints/overview" });
  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.available, false);
  assert.equal(body.reason, "not_configured");
  await app.close();
});
