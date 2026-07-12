import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorClient,
  OrchestratorPrinterStatus,
} from "../../infra/integrations/orchestrator/client";
import { OrchestratorError } from "../../infra/integrations/orchestrator/client";
import type {
  CriticalErrorNotificationPayload,
  PrinterNotificationPayload,
} from "../notifications/types";

// Loaded lazily so DATABASE_URL (required transitively via the dispatcher) is
// set before the module graph is evaluated.
async function loadMonitor() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  return import("./monitor");
}

type PrinterStatus = OrchestratorPrinterStatus;

function status(overrides: Partial<PrinterStatus> = {}): PrinterStatus {
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
    // Fresh by default: the monitor refuses to classify stale statuses, so
    // fixtures must look like live orchestrator data.
    updatedAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

type FakeClientOptions = {
  snapshot?: { data: Buffer; mime: string } | null;
  onSnapshot?: (printerId: string, options: unknown) => void;
};

/** A scriptable stand-in for the orchestrator client: one entry per poll. */
function fakeClient(
  polls: Array<PrinterStatus[] | Error>,
  options: FakeClientOptions = {}
): OrchestratorClient {
  let call = 0;

  return {
    listPrinterStatuses: async () => {
      const next = polls[Math.min(call, polls.length - 1)];
      call += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    fetchSnapshot: async (printerId: string, snapshotOptions: unknown) => {
      options.onSnapshot?.(printerId, snapshotOptions);
      return options.snapshot ?? null;
    },
  } as unknown as OrchestratorClient;
}

function collectors() {
  const printerPayloads: PrinterNotificationPayload[] = [];
  const dedupeKeys: Array<string | null> = [];
  const criticalPayloads: CriticalErrorNotificationPayload[] = [];

  return {
    printerPayloads,
    dedupeKeys,
    criticalPayloads,
    enqueue: async (
      payload: PrinterNotificationPayload,
      dedupeKey?: string | null
    ) => {
      printerPayloads.push(payload);
      dedupeKeys.push(dedupeKey ?? null);
    },
    enqueueCritical: async (payload: CriticalErrorNotificationPayload) => {
      criticalPayloads.push(payload);
    },
  };
}

// ── classifyTransition (unchanged notification rules) ───────────────────────

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

test("classifyTransition reports a generic pause from printing", async () => {
  const { classifyTransition } = await loadMonitor();

  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "paused", stateMessage: "User paused" })
    ),
    "paused"
  );

  // Pause that did not come from an active print is not reported.
  assert.equal(
    classifyTransition(status({ status: "idle" }), status({ status: "paused" })),
    null
  );
});

test("classifyTransition distinguishes a filament runout pause", async () => {
  const { classifyTransition } = await loadMonitor();

  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "paused", stateMessage: "Filament runout" })
    ),
    "filament_runout"
  );

  // Reason carried on stateText (e.g. Creality) is recognised too.
  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "paused", stateText: "Закінчився філамент" })
    ),
    "filament_runout"
  );

  // A routine M600 colour change must NOT be misread as a runout.
  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "paused", stateMessage: "Filament change" })
    ),
    "paused"
  );
});

test("classifyTransition treats a runout reported as error as a runout", async () => {
  const { classifyTransition } = await loadMonitor();

  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "error", error: "Filament runout detected" })
    ),
    "filament_runout"
  );

  // A genuine fault still reports as a generic error.
  assert.equal(
    classifyTransition(
      status({ status: "printing" }),
      status({ status: "error", error: "MCU shutdown" })
    ),
    "error"
  );
});

test("classifyTransition reports a cancelled print", async () => {
  const { classifyTransition } = await loadMonitor();

  // The orchestrator maps Moonraker's raw "cancelled" to status idle while
  // stateText keeps the raw marker for CANCEL_RE.
  assert.equal(
    classifyTransition(
      status({ status: "printing", progressPct: 40 }),
      status({ status: "idle", stateText: "cancelled", progressPct: 40 })
    ),
    "cancelled"
  );

  // A cancel near the end must not be misreported as completion (Creality).
  assert.equal(
    classifyTransition(
      status({ status: "printing", progressPct: 99 }),
      status({ status: "idle", stateText: "stop", progressPct: 99 })
    ),
    "cancelled"
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

// ── pollPrintersOnce (orchestrator-backed monitoring loop) ──────────────────

test("pollPrintersOnce enqueues a completion with the orchestrator snapshot", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const imageBytes = Buffer.from("fake-jpeg-bytes");
  const snapshotCalls: Array<{ id: string; options: unknown }> = [];
  const client = fakeClient(
    [
      [status({ status: "printing", progressPct: 90 })],
      [status({ status: "idle", stateText: "complete", progressPct: 100 })],
    ],
    {
      snapshot: { data: imageBytes, mime: "image/jpeg" },
      onSnapshot: (id, options) => snapshotCalls.push({ id, options }),
    }
  );

  const c = collectors();
  assert.equal(await pollPrintersOnce({ client, ...c }), 0); // baseline
  assert.equal(await pollPrintersOnce({ client, ...c }), 1);

  assert.equal(c.printerPayloads.length, 1);
  const [payload] = c.printerPayloads;
  assert.equal(payload.kind, "completed");
  assert.equal(payload.printer.id, "p1");

  // The photo went through the orchestrator with ensureLight and the binary
  // data survived the base64 round-trip intact.
  assert.equal(snapshotCalls.length, 1);
  assert.equal(snapshotCalls[0].id, "p1");
  assert.equal((snapshotCalls[0].options as { ensureLight: boolean }).ensureLight, true);
  assert.ok(payload.photo);
  assert.ok(Buffer.from(payload.photo.base64, "base64").equals(imageBytes));
});

test("pollPrintersOnce stays silent while the state does not change", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const client = fakeClient([
    [status({ status: "printing" })],
    [status({ status: "printing" })],
    [status({ status: "printing" })],
  ]);

  const c = collectors();
  await pollPrintersOnce({ client, ...c });
  await pollPrintersOnce({ client, ...c });
  await pollPrintersOnce({ client, ...c });

  assert.equal(c.printerPayloads.length, 0);
  assert.equal(c.criticalPayloads.length, 0);
});

test("pollPrintersOnce reports transitions for cancel, pause, error and runout", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();

  const cases: Array<{ next: PrinterStatus; kind: string }> = [
    {
      next: status({ status: "idle", stateText: "cancelled" }),
      kind: "cancelled",
    },
    { next: status({ status: "paused" }), kind: "paused" },
    { next: status({ status: "error", error: "MCU shutdown" }), kind: "error" },
    {
      next: status({ status: "paused", stateMessage: "Filament runout" }),
      kind: "filament_runout",
    },
  ];

  for (const testCase of cases) {
    resetPrinterMonitorState();
    const client = fakeClient([
      [status({ status: "printing" })],
      [testCase.next],
    ]);
    const c = collectors();
    await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
    await pollPrintersOnce({ client, snapshotEnabled: false, ...c });

    assert.equal(c.printerPayloads.length, 1, testCase.kind);
    assert.equal(c.printerPayloads[0].kind, testCase.kind);
  }
});

test("a confirmed orchestrator outage alerts exactly once and recovers once", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const outage = new OrchestratorError("network", "connect ECONNREFUSED");
  const client = fakeClient([
    [status({ status: "printing" })], // baseline
    outage,
    outage,
    outage,
    outage, // still down: no second alert
    [status({ status: "idle", stateText: "complete", progressPct: 100 })],
    [status({ status: "idle", stateText: "complete", progressPct: 100 })],
  ]);

  const c = collectors();
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });

  // Two failures: a blip, not yet an outage.
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.equal(c.criticalPayloads.length, 0);

  // Third consecutive failure confirms the outage -> exactly one alert.
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.equal(c.criticalPayloads.length, 1);
  assert.match(c.criticalPayloads[0].message, /недоступ/i);

  // A fourth failure must NOT repeat the alert.
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.equal(c.criticalPayloads.length, 1);

  // First success: the pre-outage baseline still works — the completion that
  // happened meanwhile is reported — but ONE success is not yet a confirmed
  // recovery (anti-flapping), so no recovery message.
  const enqueued = await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.equal(enqueued, 1);
  assert.equal(c.printerPayloads[0]?.kind, "completed");
  assert.equal(c.criticalPayloads.length, 1);

  // Second consecutive success confirms recovery -> exactly one message.
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.equal(c.criticalPayloads.length, 2);
  assert.match(c.criticalPayloads[1].message, /відновлено|доступ/i);
});

test("one printer's failure does not break the others", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const a = (s: Partial<PrinterStatus>) => status({ id: "a", name: "A", ...s });
  const b = (s: Partial<PrinterStatus>) => status({ id: "b", name: "B", ...s });

  const client = fakeClient([
    [a({ status: "printing" }), b({ status: "printing" })],
    [
      a({ status: "idle", stateText: "complete", progressPct: 100 }),
      b({ status: "idle", stateText: "complete", progressPct: 100 }),
    ],
  ]);

  const c = collectors();
  const failingEnqueue = async (payload: PrinterNotificationPayload) => {
    if (payload.printer.id === "a") {
      throw new Error("outbox unavailable for A");
    }
    return c.enqueue(payload);
  };

  await pollPrintersOnce({
    client,
    snapshotEnabled: false,
    enqueue: failingEnqueue,
    enqueueCritical: c.enqueueCritical,
  });
  const enqueued = await pollPrintersOnce({
    client,
    snapshotEnabled: false,
    enqueue: failingEnqueue,
    enqueueCritical: c.enqueueCritical,
  });

  assert.equal(enqueued, 1);
  assert.equal(c.printerPayloads.length, 1);
  assert.equal(c.printerPayloads[0].printer.id, "b");
});

// ── Stale data, restarts, dedupe, flapping, overlap ─────────────────────────

test("a stale status is never classified and never overwrites the fresh baseline", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState, getPrinterMonitorStats } =
    await loadMonitor();
  resetPrinterMonitorState();

  const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const client = fakeClient([
    [status({ status: "printing" })],
    // The orchestrator's poll loop froze: old timestamp, state flipped to
    // idle+complete. Must NOT produce a "completed" event.
    [status({ status: "idle", stateText: "complete", progressPct: 100, updatedAt: staleAt })],
    // Fresh data returns: the real completion is reported against the last
    // FRESH baseline (printing), late but true.
    [status({ status: "idle", stateText: "complete", progressPct: 100 })],
  ]);

  const c = collectors();
  await pollPrintersOnce({ client, snapshotEnabled: false, staleAfterMs: 120_000, ...c });
  await pollPrintersOnce({ client, snapshotEnabled: false, staleAfterMs: 120_000, ...c });
  assert.equal(c.printerPayloads.length, 0, "stale data must not create events");
  assert.equal(getPrinterMonitorStats().printers[0]?.stale, true);

  await pollPrintersOnce({ client, snapshotEnabled: false, staleAfterMs: 120_000, ...c });
  assert.equal(c.printerPayloads.length, 1);
  assert.equal(c.printerPayloads[0].kind, "completed");
  assert.equal(getPrinterMonitorStats().printers[0]?.stale, false);
});

test("isStaleStatus: missing or unparsable updatedAt is not stale", async () => {
  const { isStaleStatus } = await loadMonitor();
  assert.equal(isStaleStatus({ updatedAt: null }, 1000), false);
  assert.equal(isStaleStatus({ updatedAt: "not-a-date" }, 1000), false);
  assert.equal(
    isStaleStatus({ updatedAt: new Date(Date.now() - 5000).toISOString() }, 1000),
    true,
    "5s-old status against a 1s budget is stale"
  );
  assert.equal(
    isStaleStatus({ updatedAt: new Date().toISOString() }, 60_000),
    false
  );
});

test("a monitor restart re-baselines and does not resend the already-sent event", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const done = status({ status: "idle", stateText: "complete", progressPct: 100 });
  const client = fakeClient([
    [status({ status: "printing" })],
    [done],
    [done],
    [done],
  ]);

  const c = collectors();
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.equal(c.printerPayloads.length, 1, "the real completion is sent once");

  // Process restart: in-memory baselines are gone.
  resetPrinterMonitorState();

  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.equal(
    c.printerPayloads.length,
    1,
    "after a restart the same completed state is a baseline, not a new event"
  );
});

test("the dedupe key is deterministic for one transition and differs across jobs/times", async () => {
  const { buildPrinterEventDedupeKey } = await loadMonitor();

  const snap = status({
    id: "k2",
    status: "idle",
    stateText: "complete",
    currentFile: "vase.gcode",
    updatedAt: "2026-07-12T10:00:00.000Z",
  });

  const key1 = buildPrinterEventDedupeKey(snap, "completed");
  const key2 = buildPrinterEventDedupeKey({ ...snap }, "completed");
  assert.equal(key1, key2, "same orchestrator snapshot -> same key");
  assert.match(key1, /^notification:printer:k2:completed:/);

  // A later re-print of the same file is a different event.
  const rerun = { ...snap, updatedAt: "2026-07-12T18:00:00.000Z" };
  assert.notEqual(buildPrinterEventDedupeKey(rerun, "completed"), key1);

  // Another kind or another job never collides.
  assert.notEqual(buildPrinterEventDedupeKey(snap, "cancelled"), key1);
  assert.notEqual(
    buildPrinterEventDedupeKey({ ...snap, currentFile: "boat.gcode" }, "completed"),
    key1
  );

  // No updatedAt (older orchestrator): falls back to a time bucket, still
  // deterministic within the same minute.
  const legacy = { ...snap, updatedAt: null };
  assert.equal(
    buildPrinterEventDedupeKey(legacy, "completed", 1_000_000),
    buildPrinterEventDedupeKey(legacy, "completed", 1_000_001)
  );
});

test("pollPrintersOnce passes the dedupe key to the outbox enqueue", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const client = fakeClient([
    [status({ status: "printing", currentFile: "vase.gcode" })],
    [status({ status: "idle", stateText: "complete", progressPct: 100, currentFile: "vase.gcode" })],
  ]);

  const c = collectors();
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });

  assert.equal(c.dedupeKeys.length, 1);
  assert.match(String(c.dedupeKeys[0]), /^notification:printer:p1:completed:/);
});

test("a flapping orchestrator (never N consecutive failures) stays silent", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const outage = new OrchestratorError("timeout", "poll timed out");
  const idle = [status({ status: "idle" })];
  const client = fakeClient([
    idle,
    outage,
    outage,
    idle,
    outage,
    outage,
    idle,
    outage,
  ]);

  const c = collectors();
  for (let i = 0; i < 8; i += 1) {
    await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  }

  assert.equal(c.criticalPayloads.length, 0, "no outage alert, no recovery spam");
});

test("one lucky poll inside an outage does not announce recovery", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const outage = new OrchestratorError("network", "down");
  const idle = [status({ status: "idle" })];
  const client = fakeClient([
    outage,
    outage,
    outage, // alert
    idle, // one success — not a recovery yet
    outage, // down again — and no second alert either
    outage,
    outage,
  ]);

  const c = collectors();
  for (let i = 0; i < 7; i += 1) {
    await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  }

  assert.equal(c.criticalPayloads.length, 1, "exactly one alert for the whole episode");
  assert.match(c.criticalPayloads[0].message, /недоступ/i);
});

test("overlapping poll cycles are skipped, not run concurrently", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState, getPrinterMonitorStats } =
    await loadMonitor();
  resetPrinterMonitorState();

  let release: (value: PrinterStatus[]) => void = () => {};
  const gate = new Promise<PrinterStatus[]>((resolve) => {
    release = resolve;
  });

  const hangingClient = {
    listPrinterStatuses: () => gate,
    fetchSnapshot: async () => null,
  } as unknown as OrchestratorClient;

  const c = collectors();
  const first = pollPrintersOnce({ client: hangingClient, snapshotEnabled: false, ...c });

  // While the first cycle hangs on the orchestrator, a second tick fires.
  const second = await pollPrintersOnce({ client: hangingClient, snapshotEnabled: false, ...c });
  assert.equal(second, 0, "the overlapping cycle must be skipped");
  assert.equal(getPrinterMonitorStats().overlapsSkipped, 1);

  release([status({ status: "idle" })]);
  await first;

  assert.equal(c.printerPayloads.length, 0);
});

test("getPrinterMonitorStats reports cycle timing and per-printer freshness", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState, getPrinterMonitorStats } =
    await loadMonitor();
  resetPrinterMonitorState();

  const client = fakeClient([[status({ status: "printing" })]]);
  const c = collectors();
  await pollPrintersOnce({ client, snapshotEnabled: false, ...c });

  const stats = getPrinterMonitorStats();
  assert.equal(stats.cyclesTotal, 1);
  assert.equal(stats.cyclesFailed, 0);
  assert.ok(stats.lastCycleStartedAt);
  assert.ok(stats.lastCycleDurationMs !== null && stats.lastCycleDurationMs >= 0);
  assert.ok(stats.lastSuccessAt);
  assert.equal(stats.consecutiveFailures, 0);
  assert.equal(stats.outageActive, false);
  assert.equal(stats.printers.length, 1);
  assert.equal(stats.printers[0].id, "p1");
  assert.equal(stats.printers[0].stale, false);
});

test("pollPrintersOnce degrades to text-only when no snapshot is available", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();

  const client = fakeClient(
    [
      [status({ status: "printing" })],
      [status({ status: "idle", stateText: "complete", progressPct: 100 })],
    ],
    { snapshot: null }
  );

  const c = collectors();
  await pollPrintersOnce({ client, ...c });
  await pollPrintersOnce({ client, ...c });

  assert.equal(c.printerPayloads.length, 1);
  assert.equal(c.printerPayloads[0].photo, null);
});
