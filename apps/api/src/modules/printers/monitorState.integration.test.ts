import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { OrchestratorClient, OrchestratorPrinterStatus } from "../../infra/integrations/orchestrator/client";
import type { PrinterMonitorRecord } from "./monitorState";

// Opt-in database tests use only a temporary schema and never dispatch Telegram.
test("PostgreSQL monitor atomically commits notifications, survives restarts and serializes competing workers", {
  skip: !process.env.OUTBOX_TEST_DATABASE_URL,
}, async (t) => {
  process.env.DATABASE_URL ??= process.env.OUTBOX_TEST_DATABASE_URL;
  const { default: knex } = await import("knex");
  const { up: createOutbox } = await import("../../infra/db/migrations/003_outbox");
  const { up: createClaimToken } = await import("../../infra/db/migrations/008_outbox_claim_token");
  const { up: createMonitorState } = await import("../../infra/db/migrations/007_printer_monitor_state");
  const { enqueuePrinterNotification } = await import("../notifications/dispatcher");
  const { pollPrintersOnce, resetPrinterMonitorState, buildPrinterEventDedupeKey } = await import("./monitor");
  const { createPostgresPrinterMonitorStateStore } = await import("./monitorState");
  const schema = `monitor_test_${randomUUID().replace(/-/g, "")}`;
  const connection = knex({ client: "pg", connection: process.env.OUTBOX_TEST_DATABASE_URL,
    searchPath: [schema], pool: { min: 0, max: 4 },
  });
  t.after(async () => {
    await connection.raw("drop schema ?? cascade", [schema]);
    await connection.destroy();
  });
  await connection.raw("create schema ??", [schema]);
  await createOutbox(connection);
  await createClaimToken(connection);
  await createMonitorState(connection);
  const storeA = createPostgresPrinterMonitorStateStore(connection);
  const storeB = createPostgresPrinterMonitorStateStore(connection);
  let snapshot: OrchestratorPrinterStatus = {
    id: "p1", name: "Printer", model: null, online: true, status: "idle", currentFile: null,
    progressPct: null, remainingMinutes: null, nozzleTemp: null, bedTemp: null, material: null,
    stateText: null, stateMessage: null, updatedAt: new Date().toISOString(), error: null,
  };
  const client = { listPrinterStatuses: async () => [snapshot], fetchSnapshot: async () => null } as unknown as OrchestratorClient;
  const options = { client, store: storeA, snapshotEnabled: false, enqueue: enqueuePrinterNotification,
    enqueueCritical: async () => {},
  };
  const countEvents = async () => Number((await connection("outbox_events").count("*").first())?.count);
  const readState = async () => (await connection("printer_monitor_state").where({ printer_id: "p1" }).first()).state as PrinterMonitorRecord;
  resetPrinterMonitorState();
  assert.equal(await pollPrintersOnce(options), 0);
  snapshot = { ...snapshot, status: "printing", currentFile: "test.gcode", progressPct: 0 };
  assert.equal(await pollPrintersOnce({ ...options, enqueue: async (payload, key, trx) => {
    assert.ok(trx, "production enqueue receives the state transaction");
    await enqueuePrinterNotification(payload, key, trx);
    throw new Error("simulated failure after outbox insert");
  } }), 0);
  assert.equal(await countEvents(), 0, "outbox insertion rolls back with failed enqueue");
  assert.equal((await readState()).lastStatus.status, "idle");
  assert.equal((await readState()).eventVersion, 0);
  assert.equal(await pollPrintersOnce(options), 1, "start retries against the unchanged baseline");
  snapshot = { ...snapshot, progressPct: 26 };
  assert.equal(await pollPrintersOnce(options), 1);
  resetPrinterMonitorState();
  snapshot = { ...snapshot, progressPct: 30 };
  assert.equal(await pollPrintersOnce({ ...options, store: storeB }), 0, "new store/process does not repeat start or milestone");

  await connection.raw(`alter table printer_monitor_state add constraint monitor_test_reject_version
    check ((state->>'eventVersion')::integer <> 3)`);
  snapshot = { ...snapshot, status: "idle", stateText: "complete", currentFile: null, progressPct: null };
  assert.equal(await pollPrintersOnce(options), 0);
  assert.equal(await countEvents(), 2, "failed baseline write rolls back its outbox event");
  assert.equal((await readState()).lastStatus.status, "printing");
  assert.equal((await readState()).eventVersion, 2);
  await connection.raw("alter table printer_monitor_state drop constraint monitor_test_reject_version");
  resetPrinterMonitorState();
  snapshot = { ...snapshot, updatedAt: new Date(Date.now() + 1).toISOString() };
  assert.equal(await pollPrintersOnce({ ...options, store: storeB }), 1, "completion is detected after restart");
  snapshot = { ...snapshot, updatedAt: new Date(Date.now() + 2).toISOString() };
  assert.equal(await pollPrintersOnce({ ...options, store: storeA }), 0);
  const events = await connection("outbox_events").orderBy("created_at");
  assert.deepEqual(events.map((event) => event.payload.kind), ["started", "progress", "completed"]);
  assert.deepEqual(events.map((event) => event.dedupe_key),
    ["notification:printer:p1:started:v1", "notification:printer:p1:progress:v2", "notification:printer:p1:completed:v3"]);
  assert.equal(events[2].payload.currentFile, "test.gcode");
  assert.equal(events[2].payload.progressPct, 100);

  let enterFirst: () => void = () => {};
  const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
  let releaseFirst: () => void = () => {};
  const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const active = { ...snapshot, id: "race", status: "printing" as const, progressPct: 26 };
  const record: PrinterMonitorRecord = { lastStatus: active, eventVersion: 1, progressMilestone: 25 };
  const first = storeA.withPrinter("race", async (previous, save, trx) => {
    assert.equal(previous, undefined);
    enterFirst();
    await release;
    await enqueuePrinterNotification({ kind: "progress", printer: { id: "race", name: "Race", model: null },
      status: "printing", stateText: null, currentFile: null, progressPct: 26, errorMessage: null,
      occurredAt: new Date().toISOString(), photo: null,
    }, buildPrinterEventDedupeKey(active, "progress", 1), trx);
    await save(record);
  });
  await firstEntered;
  const second = storeB.withPrinter("race", async (previous) => {
    assert.deepEqual(previous, record, "competing initial worker sees the committed first baseline");
  });
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(await countEvents(), 4, "competing workers produce one event for the run");

  const idleBase = Date.now();
  const idleState = async () => (await connection("printer_monitor_state")
    .where({ printer_id: "idle-restart" }).first()).state as PrinterMonitorRecord;
  snapshot = { ...snapshot, id: "idle-restart", status: "printing", stateText: null,
    currentFile: "same.gcode", progressPct: 80, updatedAt: new Date(idleBase).toISOString() };
  assert.equal(await pollPrintersOnce(options), 0);
  snapshot = { ...snapshot, status: "idle", currentFile: null, progressPct: null,
    updatedAt: new Date(idleBase + 1).toISOString() };
  assert.equal(await pollPrintersOnce(options), 0);
  assert.equal((await idleState()).lastStatus.status, "printing");
  assert.equal((await idleState()).lastObservation?.status, "idle");
  resetPrinterMonitorState();
  snapshot = { ...snapshot, status: "printing", currentFile: "same.gcode", progressPct: 0,
    updatedAt: new Date(idleBase + 2).toISOString() };
  assert.equal(await pollPrintersOnce({ ...options, store: storeB, enqueue: async (payload, key, trx) => {
    await enqueuePrinterNotification(payload, key, trx);
    throw new Error("failed new-run enqueue");
  } }), 0);
  assert.equal((await idleState()).lastObservation?.status, "idle", "rollback preserves restart evidence");
  assert.equal(await countEvents(), 4);
  assert.equal(await pollPrintersOnce({ ...options, store: storeB }), 1);
  assert.equal((await idleState()).lastObservation, undefined, "new run consumes the idle evidence");
  snapshot = { ...snapshot, progressPct: 26, updatedAt: new Date(idleBase + 3).toISOString() };
  assert.equal(await pollPrintersOnce(options), 1, "new run resets prior milestones");
  snapshot = { ...snapshot, status: "idle", progressPct: null, currentFile: null,
    updatedAt: new Date(idleBase + 4).toISOString() };
  assert.equal(await pollPrintersOnce(options), 0);
  resetPrinterMonitorState();
  snapshot = { ...snapshot, stateText: "complete", updatedAt: new Date(idleBase + 5).toISOString() };
  assert.equal(await pollPrintersOnce({ ...options, store: storeB }), 1,
    "delayed completion survives ambiguous idle and process restart");
  assert.equal(await countEvents(), 7);
});
