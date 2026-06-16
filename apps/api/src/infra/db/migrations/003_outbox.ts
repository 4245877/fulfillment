import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("outbox_events", (table) => {
    table.string("id", 120).primary();

    table.string("event_type", 120).notNullable();
    table.jsonb("payload").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.string("dedupe_key", 240).nullable();

    table.string("status", 40).notNullable().defaultTo("pending");
    table.integer("attempts").notNullable().defaultTo(0);

    table.timestamp("next_attempt_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("locked_at", { useTz: true }).nullable();
    table.timestamp("delivered_at", { useTz: true }).nullable();
    table.text("last_error").nullable();

    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["dedupe_key"]);
    table.index(["event_type"]);
    table.index(["status", "next_attempt_at"]);
    table.index(["created_at"]);
  });

  await knex.raw(`
    alter table outbox_events
    add constraint outbox_events_status_check
    check (status in ('pending', 'processing', 'sent', 'failed'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("outbox_events");
}
