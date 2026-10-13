import assert from "node:assert/strict";
import test from "node:test";

import type { OutboxEvent } from "../../core/outbox";

test("notification routes require admin token before manual dispatch", async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  process.env.ADMIN_TOKEN = "secret";
  process.env.NODE_ENV = "test";
  process.env.TELEGRAM_ENABLED = "false";

  const { default: Fastify } = await import("fastify");
  const { default: notificationsRoutes } = await import("./routes");

  const app = Fastify();
  await app.register(notificationsRoutes, { prefix: "/api/notifications" });

  const unauthorized = await app.inject({
    method: "POST",
    url: "/api/notifications/dispatch",
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(unauthorized.json(), { error: "Unauthorized" });

  const authorized = await app.inject({
    method: "POST",
    url: "/api/notifications/dispatch",
    headers: { "x-admin-token": "secret" },
  });

  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.json().dispatch.enabled, false);

  await app.close();
  delete process.env.ADMIN_TOKEN;
  delete process.env.TELEGRAM_ENABLED;
});


test("notification dispatch route reports rejected credentials during cooldown", async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  process.env.ADMIN_TOKEN = "route-test-token";
  const { default: Fastify } = await import("fastify");
  const { default: notificationsRoutes } = await import("./routes");
  const app = Fastify();
  try {
    await app.register(notificationsRoutes, {
      prefix: "/api/notifications",
      dispatch: async () => ({ enabled: true, claimed: 0, sent: 0, failed: 0,
        blockedReason: "telegram_unauthorized" as const,
      }),
    });
    const response = await app.inject({ method: "POST", url: "/api/notifications/dispatch",
      headers: { "x-admin-token": "route-test-token" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, false);
    assert.equal(response.json().dispatch.blockedReason, "telegram_unauthorized");
  } finally {
    await app.close();
    delete process.env.ADMIN_TOKEN;
  }
});


test("topic test dispatches its own queued IDs and requires every test to be delivered", async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
  process.env.ADMIN_TOKEN = "test-topic-route-token";
  const { default: Fastify } = await import("fastify");
  const { default: notificationsRoutes } = await import("./routes");
  const app = Fastify();
  const queued = ["orders", "productReports", "prints", "criticalErrors"].map((topic) => ({
    id: `topic-test-${topic}`, event_type: "notification.test",
  }));
  let dispatchResult = { enabled: true, claimed: 4, sent: 4, failed: 0 };
  const requestedIds: unknown[] = [];
  let enqueues = 0;
  try {
    await app.register(notificationsRoutes, { prefix: "/api/notifications",
      enqueueTestNotifications: async () => {
        enqueues += 1;
        return queued as OutboxEvent[];
      },
      dispatch: async (options) => { requestedIds.push(options?.eventIds); return dispatchResult; },
    });
    const request = () => app.inject({ method: "POST", url: "/api/notifications/test",
      headers: { "x-admin-token": "test-topic-route-token" },
    });
    const success = await request();
    assert.equal(success.statusCode, 200);
    assert.equal(success.json().ok, true);
    assert.deepEqual(requestedIds[0], queued.map((event) => event.id));
    dispatchResult = { enabled: true, claimed: 0, sent: 0, failed: 0 };
    assert.equal((await request()).json().ok, false, "a concurrent worker or backlog cannot create false test success");
    dispatchResult = { enabled: false, claimed: 0, sent: 0, failed: 0 };
    assert.equal((await request()).json().ok, false);
    assert.equal(enqueues, 3);
  } finally {
    await app.close();
    delete process.env.ADMIN_TOKEN;
  }
});
