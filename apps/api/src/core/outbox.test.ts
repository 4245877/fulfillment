import assert from "node:assert/strict";
import test from "node:test";

test("outbox backoff uses retry_after when Telegram provides it", async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  const { calculateOutboxBackoffMs } = await import("./outbox");

  assert.equal(calculateOutboxBackoffMs(1, 7000), 7000);
  assert.equal(calculateOutboxBackoffMs(1, -1), 0);
});

test("outbox backoff grows exponentially and caps at ten minutes", async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  const { calculateOutboxBackoffMs } = await import("./outbox");

  assert.equal(calculateOutboxBackoffMs(1), 2000);
  assert.equal(calculateOutboxBackoffMs(3), 8000);
  assert.equal(calculateOutboxBackoffMs(10), 600000);
  assert.equal(calculateOutboxBackoffMs(99), 600000);
});

test("outbox dead-letters retryable events once attempts hit the cap", async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  const { shouldRetryOutboxEvent, DEFAULT_MAX_OUTBOX_ATTEMPTS } = await import(
    "./outbox"
  );

  // Non-retryable errors are never re-queued.
  assert.equal(shouldRetryOutboxEvent(1, false), false);

  // Retryable errors retry until (but not at/after) the cap.
  assert.equal(shouldRetryOutboxEvent(1, true), true);
  assert.equal(
    shouldRetryOutboxEvent(DEFAULT_MAX_OUTBOX_ATTEMPTS - 1, true),
    true
  );
  assert.equal(shouldRetryOutboxEvent(DEFAULT_MAX_OUTBOX_ATTEMPTS, true), false);

  // The cap is configurable.
  assert.equal(shouldRetryOutboxEvent(3, true, 3), false);
});
