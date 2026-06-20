import assert from "node:assert/strict";
import test from "node:test";

import type { PrinterStatus } from "./routes";

// Loaded lazily so DATABASE_URL (required transitively via the dispatcher) is
// set before the module graph is evaluated.
async function loadMonitor() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  return import("./monitor");
}

function status(overrides: Partial<PrinterStatus>): PrinterStatus {
  return {
    id: "p1",
    name: "Printer",
    protocol: "moonraker",
    online: true,
    status: "idle",
    currentFile: null,
    progressPct: null,
    printed: null,
    remainingMinutes: null,
    nozzleTemp: null,
    bedTemp: null,
    updatedAt: "2026-06-20T10:00:00.000Z",
    ...overrides,
  };
}

test("classifyTransition ignores the first observation", async () => {
  const { classifyTransition } = await loadMonitor();
  assert.equal(classifyTransition(undefined, status({ status: "printing" })), null);
});

test("classifyTransition ignores offline printers", async () => {
  const { classifyTransition } = await loadMonitor();
  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "offline", online: false })
    ),
    null
  );
});

test("classifyTransition reports a new error once", async () => {
  const { classifyTransition } = await loadMonitor();

  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "error", error: "MCU shutdown" })
    ),
    "error"
  );

  // Already in error -> no repeat alert.
  assert.equal(
    classifyTransition(
      status({ status: "error" }),
      status({ status: "error", error: "MCU shutdown" })
    ),
    null
  );
});

test("classifyTransition reports a pause from printing (filament runout)", async () => {
  const { classifyTransition } = await loadMonitor();

  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "paused", stateMessage: "Filament runout" })
    ),
    "paused"
  );

  // Pause that did not come from an active print is not reported.
  assert.equal(
    classifyTransition(
      status({ status: "idle" }),
      status({ status: "paused" })
    ),
    null
  );
});

test("classifyTransition reports completion by raw state or progress", async () => {
  const { classifyTransition } = await loadMonitor();

  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "idle", stateText: "complete" })
    ),
    "completed"
  );

  assert.equal(
    classifyTransition(
      status({ status: "printing", progressPct: 99 }),
      status({ status: "idle", progressPct: 100 })
    ),
    "completed"
  );
});

test("classifyTransition does not treat a cancelled print as completion", async () => {
  const { classifyTransition } = await loadMonitor();

  assert.equal(
    classifyTransition(
      status({ status: "printing", progressPct: 40 }),
      status({ status: "idle", stateText: "cancelled", progressPct: 40 })
    ),
    null
  );
});

test("buildPrinterNotificationPayload carries error detail, drops it for completion", async () => {
  const { buildPrinterNotificationPayload } = await loadMonitor();

  const errorPayload = buildPrinterNotificationPayload(
    status({
      id: "k2",
      name: "Creality K2",
      model: "K2",
      status: "error",
      error: "Servo fault",
      currentFile: "vase.gcode",
    }),
    "error",
    "2026-06-20T10:00:00.000Z"
  );

  assert.equal(errorPayload.kind, "error");
  assert.equal(errorPayload.printer.name, "Creality K2");
  assert.equal(errorPayload.errorMessage, "Servo fault");
  assert.equal(errorPayload.photo, null);

  const completedPayload = buildPrinterNotificationPayload(
    status({ status: "idle", stateText: "complete", progressPct: 100 }),
    "completed",
    "2026-06-20T10:00:00.000Z"
  );

  assert.equal(completedPayload.kind, "completed");
  assert.equal(completedPayload.errorMessage, null);
  assert.equal(completedPayload.progressPct, 100);
});
