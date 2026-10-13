import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Explicit opt-in; all tables live in a temporary schema. Never use the real
// outbox to test recovery or send Telegram messages.
test("PostgreSQL legacy outbox migration, delivery recovery and deduplication", {
  skip: !process.env.OUTBOX_TEST_DATABASE_URL,
}, async (t) => {
  process.env.DATABASE_URL ??= process.env.OUTBOX_TEST_DATABASE_URL;
  const { default: knex } = await import("knex");
  const { up: createOutbox } = await import("../infra/db/migrations/003_outbox");
  const { up: repairConstraint, down: rollbackRepair } = await import("../infra/db/migrations/006_outbox_failed_status");
  const { up: addClaimToken } = await import("../infra/db/migrations/008_outbox_claim_token");
  const {
    enqueueOutboxEvent, claimOutboxEvents, markOutboxEventFailed, markOutboxEventSent, deferOutboxEvent,
  } = await import("./outbox");
  const schema = `notification_test_${randomUUID().replace(/-/g, "")}`;
  const connection = knex({ client: "pg", connection: process.env.OUTBOX_TEST_DATABASE_URL,
    searchPath: [schema], pool: { min: 0, max: 4 },
  });
  t.after(async () => {
    await connection.raw("drop schema ?? cascade", [schema]);
    await connection.destroy();
  });
  await connection.raw("create schema ??", [schema]);
  await createOutbox(connection);
  await addClaimToken(connection);
  await connection.raw(`alter table outbox_events drop constraint outbox_events_status_check,
    add constraint outbox_events_status_check check (status in ('pending', 'processing', 'sent'))`);
  const eventType = "notification.printer.print_completed";
  const failed = await enqueueOutboxEvent({ eventType, payload: { kind: "completed" }, dedupeKey: "legacy" }, connection);
  const [claimed] = await claimOutboxEvents({ eventTypes: [eventType], limit: 1 }, connection);
  assert.equal(claimed.id, failed.id);
  await assert.rejects(() => markOutboxEventFailed(claimed, new Error("invalid chat"), {
    retryable: false,
  }, connection), /outbox_events_status_check/);
  await repairConstraint(connection);
  await markOutboxEventFailed(claimed, new Error("invalid chat"), { retryable: false }, connection);
  assert.equal((await connection("outbox_events").where({ id: failed.id }).first()).status, "failed");
  await rollbackRepair(connection);
  assert.equal((await connection("outbox_events").where({ id: failed.id }).first()).status, "failed");
  const duplicate = await enqueueOutboxEvent({ eventType, payload: {}, dedupeKey: "legacy" }, connection);
  assert.equal(duplicate.id, failed.id);

  const pending = await enqueueOutboxEvent({ eventType, payload: {}, dedupeKey: "retry" }, connection);
  const [retry] = await claimOutboxEvents({ eventTypes: [eventType], limit: 1 }, connection);
  await markOutboxEventFailed(retry, new Error("rate limit"), { retryable: true, retryAfterMs: 60_000 }, connection);
  assert.equal((await connection("outbox_events").where({ id: pending.id }).first()).status, "pending");
  assert.equal((await claimOutboxEvents({ eventTypes: [eventType] }, connection)).length, 0, "retry delay respected");
  await connection("outbox_events").where({ id: pending.id }).update({ next_attempt_at: new Date(0) });
  const [retryAgain] = await claimOutboxEvents({ eventTypes: [eventType], limit: 1 }, connection);
  await markOutboxEventFailed(retryAgain, new Error("network"), { retryable: true, maxAttempts: 2 }, connection);
  assert.equal((await connection("outbox_events").where({ id: pending.id }).first()).status, "failed");

  const recovery = await enqueueOutboxEvent({ eventType, payload: {}, dedupeKey: "crash" }, connection);
  const [beforeCrash] = await claimOutboxEvents({ eventTypes: [eventType], limit: 1 }, connection);
  assert.equal(beforeCrash.id, recovery.id);
  await deferOutboxEvent(beforeCrash, new Error("Unauthorized"), 60_000, connection);
  const deferred = await connection("outbox_events").where({ id: recovery.id }).first();
  assert.equal(deferred.status, "pending");
  assert.equal(deferred.attempts, 0, "expired credentials preserve the retry budget");
  assert.equal((await claimOutboxEvents({ eventTypes: [eventType] }, connection)).length, 0, "auth deferral is respected");
  await connection("outbox_events").where({ id: recovery.id }).update({ next_attempt_at: new Date(0) });
  const [beforeRecovery] = await claimOutboxEvents({ eventTypes: [eventType], limit: 1 }, connection);
  assert.equal(beforeRecovery.id, recovery.id);
  assert.equal((await claimOutboxEvents({ eventTypes: [eventType] }, connection)).length, 0, "active lease prevents double claim");
  await connection("outbox_events").where({ id: recovery.id }).update({ locked_at: new Date(0) });
  const [afterRestart] = await claimOutboxEvents({ eventTypes: [eventType], limit: 1 }, connection);
  assert.equal(afterRestart.id, recovery.id);
  assert.notEqual(afterRestart.claim_token, beforeRecovery.claim_token);
  assert.equal(await markOutboxEventSent(beforeRecovery, connection), false,
    "the expired worker cannot acknowledge a superseding lease");
  assert.equal(await markOutboxEventFailed(beforeRecovery, new Error("stale failure"), {}, connection), false);
  assert.equal(await deferOutboxEvent(beforeRecovery, new Error("stale auth failure"), 0, connection), false);
  assert.equal((await connection("outbox_events").where({ id: recovery.id }).first()).attempts, 0);
  assert.equal(await markOutboxEventSent(afterRestart, connection), true);
  assert.equal(await markOutboxEventFailed(beforeRecovery, new Error("late failure"), {}, connection), false,
    "a late failure cannot turn a delivered notification back into pending");
  assert.equal((await connection("outbox_events").where({ id: recovery.id }).first()).status, "sent");
  assert.equal((await claimOutboxEvents({ eventTypes: [eventType] }, connection)).length, 0, "sent and dead-letter rows excluded");
  const earlier = await enqueueOutboxEvent({ eventType, payload: {}, dedupeKey: "backlog" }, connection);
  const requested = await enqueueOutboxEvent({ eventType, payload: {}, dedupeKey: "test-selected" }, connection);
  assert.deepEqual(await claimOutboxEvents({ eventTypes: [eventType], eventIds: [] }, connection), [],
    "an explicitly empty ID filter must never dispatch the unrelated backlog");
  const [selected] = await claimOutboxEvents({ eventTypes: [eventType], eventIds: [requested.id] }, connection);
  assert.equal(selected.id, requested.id, "a topic test selects only its own events");
  assert.equal((await connection("outbox_events").where({ id: earlier.id }).first()).status, "pending");
  const [unfiltered] = await claimOutboxEvents({ eventTypes: [eventType] }, connection);
  assert.equal(unfiltered.id, earlier.id, "omitting the filter still dispatches the normal backlog");
  assert.equal(await connection("outbox_events").count("*").first().then((row) => Number(row?.count)), 5);
});
