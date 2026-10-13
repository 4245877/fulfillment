import app from "./app";
import { db } from "./infra/db/knex";
import { env } from "./shared/env";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

async function main() {
  // Apply pending migrations before accepting traffic. Without this a fresh
  // deployment boots against a schema-less database and every orders/outbox/
  // inventory query fails at runtime. Disable with MIGRATE_ON_START=false to run
  // migrations as a separate job instead.
  if (env.MIGRATE_ON_START) {
    const [batchNo, migrations] = await db.migrate.latest();

    if (migrations.length > 0) {
      app.log.info(
        { batch: batchNo, migrations },
        "Applied database migrations on startup"
      );
    }
  }

  await app.listen({ port, host });
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Stopping fulfillment API");
  try {
    // Workers finish their current event before PostgreSQL is disconnected.
    // Otherwise a normal restart can lose an accepted-send acknowledgement.
    await app.close();
    await db.destroy();
  } catch (error) {
    app.log.error({ err: error }, "Fulfillment API shutdown failed");
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

main().catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
