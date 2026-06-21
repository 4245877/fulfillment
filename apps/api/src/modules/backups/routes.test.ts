import assert from "node:assert/strict";
import test from "node:test";

// The service builds its config object once at module load, so backup env must
// be set before the first dynamic import of "./routes".
process.env.NODE_ENV = "test";
process.env.BACKUP_SSH_HOST = "10.0.0.1";
process.env.BACKUP_DEST_HOST = "10.0.0.2";
process.env.BACKUP_RETENTION_DAYS = "28";

test("backup mutating routes require admin token", async () => {
  process.env.ADMIN_TOKEN = "secret";

  const { default: Fastify } = await import("fastify");
  const { default: backupsRoutes } = await import("./routes");

  const app = Fastify();
  await app.register(backupsRoutes, { prefix: "/api/ops/backup" });

  for (const url of [
    "/api/ops/backup/run",
    "/api/ops/backup/test-restore",
  ]) {
    const unauthorized = await app.inject({ method: "POST", url });
    assert.equal(unauthorized.statusCode, 401, `${url} should reject`);
    assert.deepEqual(unauthorized.json(), { error: "Unauthorized" });
  }

  await app.close();
  delete process.env.ADMIN_TOKEN;
});

test("backup config route exposes hosts and retention without SSH", async () => {
  const { default: Fastify } = await import("fastify");
  const { default: backupsRoutes } = await import("./routes");

  const app = Fastify();
  await app.register(backupsRoutes, { prefix: "/api/ops/backup" });

  const res = await app.inject({ method: "GET", url: "/api/ops/backup/config" });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.equal(body.sourceHost, "10.0.0.1");
  assert.equal(body.destHost, "10.0.0.2");
  assert.equal(body.retentionDays, 28);

  await app.close();
});
