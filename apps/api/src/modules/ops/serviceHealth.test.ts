import assert from "node:assert/strict";
import test from "node:test";

import type { OrchestratorPrinterStatus } from "../../infra/integrations/orchestrator/client";

// Loaded lazily so DATABASE_URL (required transitively via infra/db) is set
// before the module graph is evaluated.
async function loadServiceHealth() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  return import("./serviceHealth");
}

function printer(
  overrides: Partial<OrchestratorPrinterStatus>
): OrchestratorPrinterStatus {
  return {
    id: "p1",
    name: "Printer",
    model: null,
    online: true,
    status: "idle",
    currentFile: null,
    progressPct: null,
    remainingMinutes: null,
    nozzleTemp: null,
    bedTemp: null,
    material: null,
    stateText: null,
    stateMessage: null,
    updatedAt: null,
    error: null,
    ...overrides,
  };
}

test("summarizePrintersHealth: no printers -> unknown", async () => {
  const { summarizePrintersHealth } = await loadServiceHealth();
  assert.equal(summarizePrintersHealth([]), "unknown");
});

test("summarizePrintersHealth: all online -> up", async () => {
  const { summarizePrintersHealth } = await loadServiceHealth();
  assert.equal(
    summarizePrintersHealth([printer({ id: "a" }), printer({ id: "b" })]),
    "up"
  );
});

test("summarizePrintersHealth: some offline or erroring -> degraded", async () => {
  const { summarizePrintersHealth } = await loadServiceHealth();
  assert.equal(
    summarizePrintersHealth([
      printer({ id: "a" }),
      printer({ id: "b", online: false, status: "offline" }),
    ]),
    "degraded"
  );
  assert.equal(
    summarizePrintersHealth([
      printer({ id: "a" }),
      printer({ id: "b", status: "error", error: "MCU shutdown" }),
    ]),
    "degraded"
  );
});

test("summarizePrintersHealth: none online -> down", async () => {
  const { summarizePrintersHealth } = await loadServiceHealth();
  assert.equal(
    summarizePrintersHealth([
      printer({ id: "a", online: false, status: "offline" }),
      printer({ id: "b", online: false, status: "offline" }),
    ]),
    "down"
  );
});
