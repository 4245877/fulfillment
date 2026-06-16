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
