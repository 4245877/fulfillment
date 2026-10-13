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

test("classifyTransition requires an explicit success marker for completion", async () => {
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
    const baseline = status({ status: "printing" });
    const client = fakeClient([
      [baseline],
      [{ ...testCase.next, updatedAt: baseline.updatedAt }],
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
  assert.match(c.criticalPayloads[1].message, /восстановлен|доступ/i);
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

test("event dedupe uses committed version and ignores changing upstream timestamps", async () => {
  const { buildPrinterEventDedupeKey } = await loadMonitor();
  const snap = status({ id: "k2", currentFile: "vase.gcode" });
  const key = buildPrinterEventDedupeKey(snap, "completed", 3);
  assert.equal(key, "notification:printer:k2:completed:v3");
  assert.equal(buildPrinterEventDedupeKey({ ...snap, updatedAt: "2030-01-01T00:00:00Z" }, "completed", 3), key);
  assert.notEqual(buildPrinterEventDedupeKey(snap, "completed", 4), key);
  assert.notEqual(buildPrinterEventDedupeKey(snap, "cancelled", 3), key);
  assert.notEqual(buildPrinterEventDedupeKey({ ...snap, id: "p2" }, "completed", 3), key);
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

test("start detection distinguishes a new run from pause/error recovery", async () => {
  const { classifyTransition } = await loadMonitor();
  assert.equal(classifyTransition(status(), status({ status: "printing" })), "started");
  assert.equal(classifyTransition(status({ status: "paused" }), status({ status: "printing" })), null);
  assert.equal(classifyTransition(status({ status: "error" }), status({ status: "printing" })), null);
  assert.equal(classifyTransition(status({ status: "printing", currentFile: "a.gcode" }),
    status({ status: "printing", currentFile: "b.gcode" })), "started");
  assert.equal(classifyTransition(status({ status: "printing", activeRunId: "old" }),
    status({ status: "printing", activeRunId: "new" })), "started");
});

test("completion requires success evidence and cancellation takes precedence", async () => {
  const { classifyTransition } = await loadMonitor();
  const active = status({ status: "printing", progressPct: 99 });
  assert.equal(classifyTransition(active, status({ progressPct: 99 })), null);
  assert.equal(classifyTransition(active, status({ stateMessage: "Print completed", progressPct: null })), "completed");
  assert.equal(classifyTransition(active, status({ stateText: "complete", stateMessage: "cancelled", progressPct: 100 })), "cancelled");
  assert.equal(classifyTransition(status({ status: "error" }), status({ progressPct: 100 })), null);
  assert.equal(classifyTransition(status({ status: "error" }), status({ stateText: "complete" })), "completed");
});

test("printing milestones send current progress once without a premature 100% event", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const polls = [status(), ...[0, 29, 30, 20, 61, 61, 81, 100].map((progressPct) =>
    status({ status: "printing", currentFile: "part.gcode", progressPct, remainingMinutes: 12, elapsedSeconds: 90 })),
  status({ stateText: "complete", currentFile: null, progressPct: null, elapsedSeconds: 100 })];
  const client = fakeClient(polls.map((entry) => [entry]));
  const c = collectors();
  for (const _entry of polls) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => [payload.kind, payload.progressPct]),
    [["started", 0], ["progress", 29], ["progress", 61], ["progress", 81], ["completed", 100]]);
  assert.equal(c.printerPayloads[1].remainingMinutes, 12);
  assert.equal(c.printerPayloads[1].elapsedSeconds, 90);
  assert.equal(c.printerPayloads.at(-1)?.currentFile, "part.gcode");
  assert.equal(c.printerPayloads.at(-1)?.elapsedSeconds, 100);
  assert.equal(new Set(c.dedupeKeys).size, c.dedupeKeys.length);
});

test("a large progress jump sends only the highest crossed milestone", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([[status({ status: "printing", progressPct: 1 })],
    [status({ status: "printing", progressPct: 82 })], [status({ status: "printing", progressPct: 84 })]]);
  const c = collectors();
  for (let i = 0; i < 3; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => [payload.kind, payload.progressPct]), [["progress", 82]]);
});

test("a failed enqueue preserves the transition and event identity on a newer snapshot", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const base = Date.now();
  const client = fakeClient([[status({ status: "printing", updatedAt: new Date(base).toISOString() })],
    [status({ stateText: "complete", updatedAt: new Date(base + 1).toISOString() })],
    [status({ stateText: "complete", updatedAt: new Date(base + 2).toISOString() })],
    [status({ stateText: "complete", updatedAt: new Date(base + 3).toISOString() })]]);
  const c = collectors();
  const keys: Array<string | null | undefined> = [];
  let attempts = 0;
  const enqueue = async (payload: PrinterNotificationPayload, key?: string | null) => {
    keys.push(key);
    if (attempts++ === 0) throw new Error("temporary database failure");
    return c.enqueue(payload, key);
  };
  const options = { client, enqueue, enqueueCritical: c.enqueueCritical, snapshotEnabled: false };
  assert.equal(await pollPrintersOnce(options), 0);
  assert.equal(await pollPrintersOnce(options), 0);
  assert.equal(await pollPrintersOnce(options), 1);
  assert.equal(await pollPrintersOnce(options), 0);
  assert.equal(c.printerPayloads.length, 1);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("missing, offline and unknown observations preserve a print until reconnect completion", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  for (const gap of [[], [status({ status: "offline", online: false })], [status({ status: "unknown" })]]) {
    resetPrinterMonitorState();
    const client = fakeClient([[status({ status: "printing", currentFile: "job.gcode" })], gap,
      [status({ stateText: "complete", currentFile: null, progressPct: null })]]);
    const c = collectors();
    for (let i = 0; i < 3; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
    assert.equal(c.printerPayloads.length, 1);
    assert.equal(c.printerPayloads[0].kind, "completed");
    assert.equal(c.printerPayloads[0].currentFile, "job.gcode");
  }
});

test("a transient ambiguous idle cannot swallow a delayed terminal marker", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([[status({ status: "printing", currentFile: "job.gcode", progressPct: 95 })],
    [status({ progressPct: null })], [status({ stateText: "complete", progressPct: null })],
    [status({ stateText: "complete", progressPct: null })]]);
  const c = collectors();
  for (let i = 0; i < 4; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["completed"]);
  assert.equal(c.printerPayloads[0].currentFile, "job.gcode");
});

test("persisted state survives restarts without repeating start or progress and catches completion", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  const { createMemoryPrinterMonitorStateStore } = await import("./monitorState");
  const store = createMemoryPrinterMonitorStateStore();
  resetPrinterMonitorState();
  const client = fakeClient([[status()], [status({ status: "printing", activeRunId: "run1", progressPct: 0 })],
    [status({ status: "printing", activeRunId: "run1", progressPct: 51 })],
    [status({ status: "printing", activeRunId: "run1", progressPct: 52 })],
    [status({ stateText: "complete", progressPct: 100 })], [status({ stateText: "complete", progressPct: 100 })]]);
  const c = collectors();
  for (let i = 0; i < 3; i += 1) await pollPrintersOnce({ client, store, snapshotEnabled: false, ...c });
  resetPrinterMonitorState();
  assert.equal(await pollPrintersOnce({ client, store, snapshotEnabled: false, ...c }), 0);
  resetPrinterMonitorState();
  assert.equal(await pollPrintersOnce({ client, store, snapshotEnabled: false, ...c }), 1);
  resetPrinterMonitorState();
  assert.equal(await pollPrintersOnce({ client, store, snapshotEnabled: false, ...c }), 0);
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["started", "progress", "completed"]);
});

test("an older delayed snapshot cannot regress a completed baseline", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const base = Date.now();
  const client = fakeClient([[status({ status: "printing", updatedAt: new Date(base).toISOString() })],
    [status({ stateText: "complete", updatedAt: new Date(base + 2).toISOString() })],
    [status({ status: "printing", updatedAt: new Date(base + 1).toISOString() })],
    [status({ stateText: "complete", updatedAt: new Date(base + 3).toISOString() })]]);
  const c = collectors();
  for (let i = 0; i < 4; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["completed"]);
});

test("reprinting the same file gets distinct durable event versions", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([status(), status({ status: "printing", currentFile: "same.gcode", progressPct: 0 }),
    status({ stateText: "complete" }), status({ status: "printing", currentFile: "same.gcode", progressPct: 0 }),
    status({ stateText: "complete" })].map((entry) => [entry]));
  const c = collectors();
  for (let i = 0; i < 5; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["started", "completed", "started", "completed"]);
  assert.equal(new Set(c.dedupeKeys).size, 4);
});

test("snapshot errors degrade to text without losing the event", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([[status({ status: "printing" })], [status({ stateText: "complete" })]]);
  client.fetchSnapshot = async () => { throw new Error("snapshot timed out"); };
  const c = collectors();
  await pollPrintersOnce({ client, ...c });
  assert.equal(await pollPrintersOnce({ client, ...c }), 1);
  assert.equal(c.printerPayloads[0].photo, null);
});

test("negative completion text and free-text error never prove a successful print", async () => {
  const { classifyTransition } = await loadMonitor();
  const prev = status({ status: "printing", progressPct: 80 });
  for (const next of [status({ stateMessage: "print not completed" }),
    status({ stateText: "not completed" }), status({ error: "failed to complete print" }),
    status({ stateMessage: "Unable to complete print" })]) {
    assert.equal(classifyTransition(prev, next), null);
    assert.equal(classifyTransition(prev, { ...next, progressPct: 100 }), null,
      "100% cannot override explicit failure evidence");
  }
});

test("a runout changing from pause to error is reported once and resume does not restart the run", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([status(), status({ status: "printing", progressPct: 1 }),
    status({ status: "paused", stateMessage: "Filament runout" }),
    status({ status: "error", error: "Filament runout" }),
    status({ status: "printing", progressPct: 26 }), status({ stateText: "complete" })].map((entry) => [entry]));
  const c = collectors();
  for (let i = 0; i < 6; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["started", "filament_runout", "progress", "completed"]);
});

test("cancellation requires a terminal marker rather than unrelated stop prose", async () => {
  const { classifyTransition } = await loadMonitor();
  const prev = status({ status: "printing" });
  assert.equal(classifyTransition(prev, status({ stateText: "complete", stateMessage: "Job stopped after successful completion", progressPct: 100 })), "completed");
  assert.equal(classifyTransition(prev, status({ stateMessage: "Print cancelled by user", progressPct: 100 })), "cancelled");
  assert.equal(classifyTransition(prev, status({ stateMessage: "Print not cancelled", progressPct: 80 })), null);
  assert.equal(classifyTransition(prev, status({ error: "Stop command failed", progressPct: 80 })), null);
});

test("failed outage and recovery enqueues remain armed for the next poll", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const outage = new OrchestratorError("network", "down");
  const client = fakeClient([outage, outage, outage, outage, [status()], [status()], [status()], [status()]]);
  const c = collectors();
  const attempts = new Map<string, number>();
  const enqueueCritical = async (payload: CriticalErrorNotificationPayload) => {
    const count = attempts.get(payload.name ?? "") ?? 0;
    attempts.set(payload.name ?? "", count + 1);
    if (count === 0) throw new Error("critical outbox unavailable");
    return c.enqueueCritical(payload);
  };
  const options = { client, snapshotEnabled: false, enqueue: c.enqueue, enqueueCritical };
  await pollPrintersOnce(options);
  await pollPrintersOnce(options);
  assert.equal(await pollPrintersOnce(options), 0);
  await pollPrintersOnce(options);
  await pollPrintersOnce(options);
  assert.equal(await pollPrintersOnce(options), 0);
  await pollPrintersOnce(options);
  await pollPrintersOnce(options);
  assert.deepEqual(c.criticalPayloads.map((payload) => payload.name), ["PrinterOrchestratorUnavailable", "PrinterOrchestratorRecovered"]);
  assert.equal(attempts.get("PrinterOrchestratorUnavailable"), 2);
  assert.equal(attempts.get("PrinterOrchestratorRecovered"), 2);
});


test("ambiguous idle survives restart and permits a new same-file run with reset progress", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  const { createMemoryPrinterMonitorStateStore } = await import("./monitorState");
  const store = createMemoryPrinterMonitorStateStore();
  resetPrinterMonitorState();
  const client = fakeClient([status({ status: "printing", currentFile: "same.gcode", progressPct: 80 }),
    status(), status({ status: "printing", currentFile: "same.gcode", progressPct: 0 }),
    status({ status: "printing", currentFile: "same.gcode", progressPct: 30 }),
    status({ stateText: "complete" })].map((entry) => [entry]));
  const c = collectors();
  const options = { client, store, snapshotEnabled: false, ...c };
  await pollPrintersOnce(options);
  await pollPrintersOnce(options);
  resetPrinterMonitorState();
  for (let i = 0; i < 3; i += 1) await pollPrintersOnce(options);
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["started", "progress", "completed"]);
  assert.equal(new Set(c.dedupeKeys).size, 3);
});

test("ambiguous idle followed by continuing progress does not invent a new run", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([status({ status: "printing", currentFile: "same.gcode", progressPct: 30 }),
    status(), status({ status: "printing", currentFile: "same.gcode", progressPct: 31 }),
    status({ stateText: "complete" })].map((entry) => [entry]));
  const c = collectors();
  for (let i = 0; i < 4; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["completed"]);
});

test("newer ambiguous idle prevents delayed printing snapshots from consuming its restart evidence", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const base = Date.now();
  const client = fakeClient([
    status({ status: "printing", currentFile: "same.gcode", progressPct: 80, updatedAt: new Date(base).toISOString() }),
    status({ updatedAt: new Date(base + 2).toISOString() }),
    status({ status: "printing", currentFile: "same.gcode", progressPct: 0, updatedAt: new Date(base + 1).toISOString() }),
    status({ status: "printing", currentFile: "same.gcode", progressPct: 1, updatedAt: new Date(base + 3).toISOString() }),
  ].map((entry) => [entry]));
  const c = collectors();
  for (let i = 0; i < 4; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => [payload.kind, payload.progressPct]), [["started", 1]]);
});

test("canonical run identity prevents filename enrichment and idle metric jitter from repeating a start", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState, classifyTransition } = await loadMonitor();
  assert.equal(classifyTransition(status({ status: "printing", activeRunId: "run1", currentFile: "plate.gcode" }),
    status({ status: "printing", activeRunId: "run1", currentFile: "Plate title" })), null);
  resetPrinterMonitorState();
  const client = fakeClient([status(),
    status({ status: "printing", activeRunId: "run1", currentFile: "plate.gcode", progressPct: 10 }),
    status({ status: "printing", activeRunId: "run1", currentFile: "Plate title", progressPct: 30 }),
    status(), status({ status: "printing", activeRunId: "run1", currentFile: "Plate title", progressPct: 20 }),
  ].map((entry) => [entry]));
  const c = collectors();
  for (let i = 0; i < 5; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["started", "progress"]);
});

test("failed recovery alert enqueue cannot suppress a printer's short-lived terminal marker", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const outage = new OrchestratorError("network", "down");
  const client = fakeClient([outage, outage, outage,
    [status({ status: "printing", currentFile: "job.gcode", progressPct: 80 })],
    [status({ stateText: "complete", currentFile: null, progressPct: null })],
    [status()],
  ]);
  const c = collectors();
  const options = { client, snapshotEnabled: false, enqueue: c.enqueue,
    enqueueCritical: async (payload: CriticalErrorNotificationPayload) => {
      if (payload.name === "PrinterOrchestratorRecovered") throw new Error("critical outbox unavailable");
      return c.enqueueCritical(payload);
    },
  };
  for (let i = 0; i < 6; i += 1) await pollPrintersOnce(options);
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["completed"]);
  assert.equal(c.printerPayloads[0].currentFile, "job.gcode");
});

test("a standalone user cancellation marker wins over a lingering 100 percent value", async () => {
  const { classifyTransition } = await loadMonitor();
  const prev = status({ status: "printing" });
  for (const marker of ["stopped by user", "cancelled by the operator", "aborted by user"]) {
    assert.equal(classifyTransition(prev, status({ stateText: marker, progressPct: 100 })), "cancelled");
  }
});


test("printer monitor worker aborts device reads and drains the active poll before shutdown", async () => {
  const { registerPrinterMonitorWorker } = await loadMonitor();
  const { env } = await import("../../shared/env");
  const { default: Fastify } = await import("fastify");
  const originalEnv = { ...env };
  Object.assign(env, { PRINTER_MONITOR_ENABLED: true, PRINTER_ORCHESTRATOR_URL: "http://test.invalid",
    TELEGRAM_ENABLED: true, TELEGRAM_BOT_TOKEN: "test", TELEGRAM_CHAT_ID: "test",
    TELEGRAM_TOPIC_ORDERS_ID: 1, TELEGRAM_TOPIC_PRODUCT_REPORTS_ID: 2,
    TELEGRAM_TOPIC_PRINTS_ID: 3, TELEGRAM_TOPIC_CRITICAL_ERRORS_ID: 4,
  });
  let finish: () => void = () => {};
  const release = new Promise<void>((resolve) => { finish = resolve; });
  let polls = 0;
  let clientClosed = false;
  const app = Fastify();
  registerPrinterMonitorWorker(app, {
    client: { close: () => { clientClosed = true; } } as unknown as OrchestratorClient,
    poll: async () => { polls += 1; await release; return 1; },
  });
  await app.ready();
  let closed = false;
  const close = app.close().then(() => { closed = true; });
  try {
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(polls, 1);
    assert.equal(clientClosed, true, "orchestrator reads abort as shutdown begins");
    assert.equal(closed, false, "the database may close only after the active poll commits");
  } finally {
    finish();
    await close;
    Object.assign(env, originalEnv);
  }
  assert.equal(closed, true);
  assert.equal(polls, 1);
});


test("monotonic elapsed time overrides progress recalculation across an ambiguous idle", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([status({ status: "printing", currentFile: "job.gcode", progressPct: 80, elapsedSeconds: 900 }),
    status(), status({ status: "printing", currentFile: "job.gcode", progressPct: 70, elapsedSeconds: 910 }),
  ].map((entry) => [entry]));
  const c = collectors();
  for (let i = 0; i < 3; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads, []);
});

test("elapsed time reset identifies a same-file restart even when progress is unavailable", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  resetPrinterMonitorState();
  const client = fakeClient([status({ status: "printing", currentFile: "job.gcode", elapsedSeconds: 900 }),
    status(), status({ status: "printing", currentFile: "job.gcode", elapsedSeconds: 5 }),
  ].map((entry) => [entry]));
  const c = collectors();
  for (let i = 0; i < 3; i += 1) await pollPrintersOnce({ client, snapshotEnabled: false, ...c });
  assert.deepEqual(c.printerPayloads.map((payload) => payload.kind), ["started"]);
});


test("100 percent idle stays ambiguous until an explicit completion marker arrives", async () => {
  const { pollPrintersOnce, resetPrinterMonitorState } = await loadMonitor();
  const { createMemoryPrinterMonitorStateStore } = await import("./monitorState");
  const store = createMemoryPrinterMonitorStateStore();
  resetPrinterMonitorState();
  const client = fakeClient([status({ status: "printing", currentFile: "job.gcode", progressPct: 99 }),
    status({ stateText: "standby", progressPct: 100 }), status({ progressPct: null }),
    status({ stateText: "complete", progressPct: null }), status({ stateText: "complete" }),
  ].map((entry) => [entry]));
  const c = collectors();
  const options = { client, store, snapshotEnabled: false, ...c };
  assert.equal(await pollPrintersOnce(options), 0);
  assert.equal(await pollPrintersOnce(options), 0, "a leftover percentage cannot announce success");
  assert.equal(await pollPrintersOnce(options), 0);
  resetPrinterMonitorState();
  assert.equal(await pollPrintersOnce(options), 1, "a delayed explicit success remains reportable after restart");
  assert.equal(await pollPrintersOnce(options), 0);
  assert.deepEqual(c.printerPayloads.map((payload) => [payload.kind, payload.progressPct, payload.currentFile]),
    [["completed", 100, "job.gcode"]]);
});
