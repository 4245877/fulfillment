import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Existing pending/processing rows remain recoverable. Every subsequent
  // claim receives a fresh token so an expired worker cannot change its owner.
  await knex.schema.alterTable("outbox_events", (table) => {
    table.uuid("claim_token").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("outbox_events", (table) => {
    table.dropColumn("claim_token");
  });
}
