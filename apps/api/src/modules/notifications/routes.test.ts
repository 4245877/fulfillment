import assert from "node:assert/strict";
import test from "node:test";

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
