import assert from "node:assert/strict";
import test from "node:test";

import type { OutboxEvent } from "../../core/outbox";
import { TelegramApiError, TelegramClient } from "../../infra/integrations/telegram/client";
import type { TelegramConfig } from "../../infra/integrations/telegram/config";

async function loadDispatcher() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  return import("./dispatcher");
}

const config: TelegramConfig = {
  enabled: true,
  botToken: "test-token",
  chatId: "test-chat",
  requestTimeoutMs: 5000,
  topics: { orders: 1, productReports: 2, prints: 3, criticalErrors: 4 },
};

function event(id: string, photo = false): OutboxEvent {
  return {
    id,
    event_type: "notification.printer.print_completed",
    payload: {
      kind: "completed",
      printer: { id: "p1", name: "Printer" },
      status: "idle",
      currentFile: "vase.gcode",
      progressPct: 100,
      occurredAt: "2026-10-03T12:00:00.000Z",
      photo: photo ? { base64: "AQID", mime: "image/jpeg" } : null,
    },
    dedupe_key: id,
    status: "pending",
    attempts: 0,
    next_attempt_at: "",
    locked_at: null,
    claim_token: `claim-${id}`,
    delivered_at: null,
    last_error: null,
    created_at: "",
    updated_at: "",
  };
}

function store(events: OutboxEvent[]) {
  const claims: Array<{ limit?: number; lockTimeoutMs?: number }> = [];
  const sent: string[] = [];
  const failed: Array<{ id: string; retryable?: boolean; retryAfterMs?: number }> = [];
  const deferred: Array<{ id: string; delayMs: number }> = [];
  return {
    claims,
    sent,
    failed,
    deferred,
    claim: async (input: { limit?: number; lockTimeoutMs?: number }) => {
      claims.push(input);
      const index = events.findIndex((current) => current.status === "pending" &&
        (!current.next_attempt_at || Date.parse(current.next_attempt_at) <= Date.now()));
      const next = index < 0 ? undefined : events.splice(index, 1)[0];
      if (next) next.status = "processing";
      return next ? [next] : [];
    },
    defer: async (current: OutboxEvent, error: unknown, delayMs = 60_000) => {
      current.status = "pending";
      current.next_attempt_at = new Date(Date.now() + delayMs).toISOString();
      current.last_error = (error as Error).message;
      events.unshift(current);
      deferred.push({ id: current.id, delayMs });
      return true;
    },
    markSent: async (current: OutboxEvent) => { sent.push(current.id); return true; },
    markFailed: async (
      current: OutboxEvent,
      _error: unknown,
      options: { retryable?: boolean; retryAfterMs?: number } = {}
    ) => { failed.push({ id: current.id, ...options }); return true; },
  };
}

function client(overrides: Partial<TelegramClient> = {}): TelegramClient {
  return {
    sendMessage: async () => ({ message_id: 1, date: 1, chat: {} }),
    sendPhoto: async () => ({ message_id: 1, date: 1, chat: {} }),
    ...overrides,
  } as TelegramClient;
}

test("dispatcher sends print completion to the configured topic and acknowledges once", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("complete")]);
  let sentPayload: unknown;
  const result = await dispatchPendingNotifications({ config, outbox, client: client({
    sendMessage: async (input) => { sentPayload = input; return { message_id: 1, date: 1, chat: {} }; },
  }) });
  assert.deepEqual(result, { enabled: true, claimed: 1, sent: 1, failed: 0 });
  assert.deepEqual(outbox.sent, ["complete"]);
  assert.equal((sentPayload as any).messageThreadId, 3);
  assert.match((sentPayload as any).text, /Печать завершена/);
  assert.match((sentPayload as any).text, /100%/);
  assert.equal(outbox.failed.length, 0);
});

test("dispatcher isolates an outbox failure and sends the next event", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("bad"), event("good")]);
  outbox.markFailed = async () => { throw new Error("constraint rejected update"); };
  let sends = 0;
  const result = await dispatchPendingNotifications({ config, outbox, client: client({
    sendMessage: async () => {
      sends += 1;
      if (sends === 1) throw new TelegramApiError("Bad Request", { statusCode: 400, retryable: false });
      return { message_id: 2, date: 1, chat: {} };
    },
  }) });
  assert.equal(sends, 2);
  assert.deepEqual(outbox.sent, ["good"]);
  assert.deepEqual(result, { enabled: true, claimed: 2, sent: 1, failed: 1 });
});

test("dispatcher retries acknowledgement without repeating a confirmed Telegram send", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("complete")]);
  let sends = 0;
  let acknowledgements = 0;
  outbox.markSent = async (current) => {
    acknowledgements += 1;
    if (acknowledgements < 3) throw new Error("temporary db error");
    outbox.sent.push(current.id);
    return true;
  };
  const result = await dispatchPendingNotifications({ config, outbox, client: client({
    sendMessage: async () => { sends += 1; return { message_id: 1, date: 1, chat: {} }; },
  }) });
  assert.equal(sends, 1);
  assert.equal(acknowledgements, 3);
  assert.equal(result.sent, 1);
  assert.equal(outbox.failed.length, 0);
});

test("dispatcher leaves uncertain acknowledgement leased and processes later events", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("unacknowledged"), event("good")]);
  const errors: string[] = [];
  outbox.markSent = async (current) => {
    if (current.id === "unacknowledged") throw new Error("db unavailable");
    outbox.sent.push(current.id);
    return true;
  };
  const result = await dispatchPendingNotifications({ config, outbox, client: client(),
    logger: { error: (_obj, message) => { errors.push(message || ""); } },
  });
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(outbox.failed.length, 0, "confirmed delivery is never requeued as a send failure");
  assert.deepEqual(outbox.sent, ["good"]);
  assert.match(errors[0], /delivery confirmed/);
});

test("dispatcher claims each event immediately with a lease longer than its request timeout", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("first"), event("second")]);
  const order: string[] = [];
  const claim = outbox.claim;
  outbox.claim = async (input) => { order.push("claim"); return claim(input); };
  await dispatchPendingNotifications({ config: { ...config, requestTimeoutMs: 180_000 }, outbox,
    limit: 2, client: client({ sendMessage: async () => {
      order.push("send"); return { message_id: 1, date: 1, chat: {} };
    } }),
  });
  assert.deepEqual(order, ["claim", "send", "claim", "send"]);
  assert.ok(outbox.claims.every((claimInput) => claimInput.limit === 1));
  assert.ok(outbox.claims.every((claimInput) => (claimInput.lockTimeoutMs || 0) >= 2 * 180_000 + 30_000));
});

test("dispatcher falls back to text for a definitively rejected camera photo", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("complete", true)]);
  let texts = 0;
  await dispatchPendingNotifications({ config, outbox, client: client({
    sendPhoto: async () => { throw new TelegramApiError("Bad Request: PHOTO_INVALID_DIMENSIONS", {
      statusCode: 400, retryable: false,
    }); },
    sendMessage: async () => { texts += 1; return { message_id: 1, date: 1, chat: {} }; },
  }) });
  assert.equal(texts, 1);
  assert.deepEqual(outbox.sent, ["complete"]);
});

test("dispatcher does not send a second text after an ambiguous photo timeout", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("complete", true)]);
  let texts = 0;
  await dispatchPendingNotifications({ config, outbox, client: client({
    sendPhoto: async () => { throw new TelegramApiError("Telegram request timed out", { retryable: true }); },
    sendMessage: async () => { texts += 1; return { message_id: 1, date: 1, chat: {} }; },
  }) });
  assert.equal(texts, 0);
  assert.equal(outbox.failed[0]?.retryable, true);
});

test("dispatcher preserves retry budgets and stops claiming during Telegram rate limits", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const current = event("rate-limited");
  current.attempts = 9;
  const outbox = store([current, event("later")]);
  const rateConfig = { ...config, botToken: "rate-limit-test-token" };
  let sends = 0;
  const rejected = client({ sendMessage: async () => {
    sends += 1;
    throw new TelegramApiError("Too Many Requests", {
      statusCode: 429, retryable: true, retryAfterSeconds: 17,
    });
  } });
  const first = await dispatchPendingNotifications({ config: rateConfig, outbox, client: rejected });
  assert.deepEqual(first, { enabled: true, claimed: 1, sent: 0, failed: 1,
    blockedReason: "telegram_rate_limited" });
  assert.deepEqual(outbox.deferred, [{ id: "rate-limited", delayMs: 17_000 }]);
  assert.equal(outbox.failed.length, 0);
  assert.equal(current.attempts, 9, "rate limits cannot dead-letter a valid notification");
  const next = await dispatchPendingNotifications({ config: rateConfig, outbox, client: rejected });
  assert.equal(next.claimed, 0);
  assert.equal(next.blockedReason, "telegram_rate_limited");
  assert.equal(sends, 1);
});

test("dispatcher defers API-envelope rate limits without retry_after for a safe cooldown", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("rate-without-delay"), event("later")]);
  const result = await dispatchPendingNotifications({ config: { ...config, botToken: "rate-no-delay" },
    outbox, client: client({ sendMessage: async () => {
      throw new TelegramApiError("Too Many Requests", { telegramErrorCode: 429, retryable: true });
    } }),
  });
  assert.equal(result.claimed, 1);
  assert.equal(result.blockedReason, "telegram_rate_limited");
  assert.deepEqual(outbox.deferred, [{ id: "rate-without-delay", delayMs: 60_000 }]);
});


test("dispatcher preserves queued notifications on invalid credentials and resumes with a new token", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const queued = event("complete");
  queued.attempts = 9;
  const outbox = store([queued, event("next")]);
  let requests = 0;
  const rejectedClient = client({ sendMessage: async () => {
    requests += 1;
    throw new TelegramApiError("Unauthorized", { statusCode: 401, telegramErrorCode: 401, retryable: false });
  } });
  const rejectedConfig = { ...config, botToken: "revoked-token" };
  const first = await dispatchPendingNotifications({ config: rejectedConfig, outbox, client: rejectedClient });
  assert.equal(first.claimed, 1, "the rejected credential stops the batch before claiming another row");
  assert.equal(first.blockedReason, "telegram_unauthorized");
  assert.equal(outbox.failed.length, 0);
  assert.equal(queued.attempts, 9, "credential rejection must not consume the remaining print retry");
  assert.equal(queued.status, "pending");
  assert.ok(Date.parse(queued.next_attempt_at) > Date.now() + 55_000);
  const duringCooldown = await dispatchPendingNotifications({ config: rejectedConfig, outbox, client: rejectedClient });
  assert.equal(duringCooldown.claimed, 0);
  assert.equal(duringCooldown.blockedReason, "telegram_unauthorized");
  assert.equal(requests, 1);
  const resumed = await dispatchPendingNotifications({ config: { ...config, botToken: "replacement-token" }, outbox, client: client() });
  assert.equal(resumed.sent, 1, "the deferred row still honours its persisted retry delay");
  assert.deepEqual(outbox.sent, ["next"]);
  queued.next_attempt_at = "";
  const afterDelay = await dispatchPendingNotifications({
    config: { ...config, botToken: "replacement-token" }, outbox, client: client(),
  });
  assert.equal(afterDelay.sent, 1);
  assert.deepEqual(outbox.sent, ["next", "complete"]);
});


test("dispatcher falls back after a definitive media error in an HTTP-success API envelope", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("envelope-media", true)]);
  let texts = 0;
  const result = await dispatchPendingNotifications({ config, outbox, client: client({
    sendPhoto: async () => { throw new TelegramApiError("Bad Request: PHOTO_INVALID_DIMENSIONS", {
      telegramErrorCode: 400, retryable: false,
    }); },
    sendMessage: async () => { texts += 1; return { message_id: 1, date: 1, chat: {} }; },
  }) });
  assert.equal(texts, 1);
  assert.equal(result.sent, 1);
  assert.equal(outbox.failed.length, 0);
});

test("dispatcher does not overwrite or retry after losing its delivery lease", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const current = event("expired-claim");
  const outbox = store([current]);
  let acknowledgements = 0;
  let sends = 0;
  outbox.markSent = async (claimed) => {
    assert.equal(claimed.claim_token, current.claim_token);
    acknowledgements += 1;
    return false;
  };
  const result = await dispatchPendingNotifications({ config, outbox, client: client({
    sendMessage: async () => { sends += 1; return { message_id: 1, date: 1, chat: {} }; },
  }) });
  assert.equal(sends, 1);
  assert.equal(acknowledgements, 1, "a superseded lease is never acknowledged again");
  assert.equal(outbox.failed.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
});

test("dispatcher stops before claiming the next row after shutdown begins", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const outbox = store([event("in-flight"), event("next")]);
  let closing = false;
  const result = await dispatchPendingNotifications({ config, outbox, shouldStop: () => closing,
    client: client({ sendMessage: async () => {
      closing = true;
      return { message_id: 1, date: 1, chat: {} };
    } }),
  });
  assert.deepEqual(result, { enabled: true, claimed: 1, sent: 1, failed: 0 });
  assert.equal(outbox.claims.length, 1);
  assert.deepEqual(outbox.sent, ["in-flight"]);
});

test("notification worker waits for an in-flight delivery when closing", async () => {
  const { registerNotificationOutboxWorker } = await loadDispatcher();
  const { default: Fastify } = await import("fastify");
  const app = Fastify();
  let finish: () => void = () => {};
  const release = new Promise<void>((resolve) => { finish = resolve; });
  let dispatches = 0;
  let shouldStop: (() => boolean) | undefined;
  registerNotificationOutboxWorker(app, { config, dispatch: async (options) => {
    dispatches += 1;
    shouldStop = options?.shouldStop;
    await release;
    return { enabled: true, claimed: 1, sent: 1, failed: 0 };
  } });
  await app.ready();
  let closed = false;
  const close = app.close().then(() => { closed = true; });
  try {
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(closed, false);
    assert.equal(shouldStop?.(), true);
    assert.equal(dispatches, 1);
  } finally {
    finish();
    await close;
  }
  assert.equal(closed, true);
  assert.equal(dispatches, 1);
});


test("an active dispatch observes a rate limit discovered by concurrent dispatch", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const concurrentConfig = { ...config, botToken: "concurrent-rate-token" };
  const ongoingOutbox = store([event("in-flight"), event("next")]);
  let entered: () => void = () => {};
  let finish: () => void = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const release = new Promise<void>((resolve) => { finish = resolve; });
  const ongoing = dispatchPendingNotifications({ config: concurrentConfig, outbox: ongoingOutbox,
    client: client({ sendMessage: async () => {
      entered();
      await release;
      return { message_id: 1, date: 1, chat: {} };
    } }),
  });
  await started;
  try {
    const rejected = await dispatchPendingNotifications({ config: concurrentConfig,
      outbox: store([event("rejected")]), client: client({ sendMessage: async () => {
        throw new TelegramApiError("Too Many Requests", { statusCode: 429, retryAfterSeconds: 17 });
      } }),
    });
    assert.equal(rejected.blockedReason, "telegram_rate_limited");
  } finally {
    finish();
  }
  const result = await ongoing;
  assert.equal(result.claimed, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.blockedReason, "telegram_rate_limited");
  assert.deepEqual(ongoingOutbox.sent, ["in-flight"]);
});


test("dispatcher preserves queued notifications when the configured chat forbids delivery", async () => {
  const { dispatchPendingNotifications } = await loadDispatcher();
  const current = event("forbidden-at-retry-cap");
  current.attempts = 9;
  const outbox = store([current, event("next-after-forbidden")]);
  const forbiddenConfig = { ...config, botToken: "forbidden-chat-test-token" };
  let requests = 0;
  const forbiddenClient = client({ sendMessage: async () => {
    requests += 1;
    throw new TelegramApiError("Forbidden: bot was kicked from the supergroup chat", {
      telegramErrorCode: 403, retryable: false,
    });
  } });
  const first = await dispatchPendingNotifications({ config: forbiddenConfig, outbox, client: forbiddenClient });
  assert.deepEqual(first, { enabled: true, claimed: 1, sent: 0, failed: 1,
    blockedReason: "telegram_forbidden" });
  assert.equal(current.status, "pending");
  assert.equal(current.attempts, 9);
  assert.equal(outbox.failed.length, 0);
  assert.deepEqual(outbox.deferred, [{ id: current.id, delayMs: 60_000 }]);
  const cooldown = await dispatchPendingNotifications({ config: forbiddenConfig, outbox, client: forbiddenClient });
  assert.equal(cooldown.claimed, 0);
  assert.equal(cooldown.blockedReason, "telegram_forbidden");
  assert.equal(requests, 1);
});
