import path from "node:path";
import type { Knex } from "knex";

const connection =
  process.env.DATABASE_URL ||
  "postgres://fulfillment:fulfillment_password@localhost:5433/fulfillment";

const config: Record<string, Knex.Config> = {
  development: {
    client: "pg",
    connection,
    migrations: {
      directory: path.resolve(__dirname, "src/infra/db/migrations"),
      extension: "ts",
    },
  },

  production: {
    client: "pg",
    connection,
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      directory: path.resolve(__dirname, "src/infra/db/migrations"),
      extension: "js",
    },
  },
};

export default config;