import path from "node:path";
import knex, { type Knex } from "knex";

import { env } from "../../shared/env";

export const db: Knex = knex({
  client: "pg",
  connection: env.DATABASE_URL,
  pool: {
    min: 0,
    max: 10,
  },
  migrations: {
    directory: path.resolve(process.cwd(), "src/infra/db/migrations"),
    extension: "ts",
  },
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.raw("select 1");
    return true;
  } catch {
    return false;
  }
}