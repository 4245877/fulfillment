import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("fulfillment_orders", (table) => {
    table.string("id", 120).primary();

    table.string("shop_order_id", 120).nullable();
    table.string("source", 40).notNullable().defaultTo("shop");

    table.string("status", 40).notNullable().defaultTo("New");

    table.string("customer_name", 240).nullable();
    table.string("email", 240).nullable();
    table.string("phone", 80).nullable();

    table.decimal("total_uah", 12, 2).nullable();
    table.string("currency", 8).notNullable().defaultTo("UAH");

    table.string("payment_provider", 80).nullable();
    table.string("payment_status", 80).nullable();
    table.string("shipping_method", 80).nullable();
    table.string("tracking_number", 160).nullable();

    table.jsonb("items").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb("shipping_address").nullable();
    table.jsonb("billing_address").nullable();
    table.jsonb("source_payload").nullable();

    table.text("notes").nullable();

    table.timestamp("received_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["shop_order_id"]);
    table.index(["status"]);
    table.index(["source"]);
    table.index(["created_at"]);
    table.index(["updated_at"]);
  });

  await knex.schema.createTable("fulfillment_order_events", (table) => {
    table.string("id", 120).primary();

    table
      .string("order_id", 120)
      .notNullable()
      .references("id")
      .inTable("fulfillment_orders")
      .onDelete("CASCADE");

    table.string("type", 80).notNullable();

    table.string("from_status", 40).nullable();
    table.string("to_status", 40).nullable();

    table.string("actor", 160).nullable();
    table.text("note").nullable();
    table.jsonb("payload").nullable();

    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["order_id"]);
    table.index(["type"]);
    table.index(["created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("fulfillment_order_events");
  await knex.schema.dropTableIfExists("fulfillment_orders");
}