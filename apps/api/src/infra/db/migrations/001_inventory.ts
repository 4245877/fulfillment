import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("filament_stock", (table) => {
    table.string("id", 80).primary();

    table.string("material", 80).notNullable();
    table.string("color", 80).notNullable();
    table.string("color_name", 160).notNullable();

    table.integer("stock_g").notNullable().defaultTo(0);
    table.integer("low_stock_g").notNullable().defaultTo(1000);
    table.integer("critical_stock_g").notNullable().defaultTo(300);

    table.boolean("enabled").notNullable().defaultTo(true);

    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["material", "color"]);
    table.index(["enabled"]);
    table.index(["material"]);
  });

  await knex.schema.createTable("filament_movements", (table) => {
    table.string("id", 80).primary();

    table
      .string("stock_id", 80)
      .notNullable()
      .references("id")
      .inTable("filament_stock")
      .onDelete("CASCADE");

    table.string("type", 40).notNullable();
    table.integer("quantity_g").notNullable();
    table.integer("before_g").notNullable();
    table.integer("after_g").notNullable();

    table.string("source", 40).notNullable();
    table.text("note").nullable();

    table.string("printer_id", 120).nullable();
    table.string("print_job_id", 120).nullable();
    table.string("idempotency_key", 160).nullable();

    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["stock_id"]);
    table.index(["created_at"]);
    table.index(["printer_id"]);
    table.unique(["idempotency_key"]);
  });

  await knex.schema.createTable("printer_filament_state", (table) => {
    table.string("id", 80).primary();

    table.string("printer_id", 120).notNullable();

    table
      .string("stock_id", 80)
      .notNullable()
      .references("id")
      .inTable("filament_stock")
      .onDelete("CASCADE");

    table.string("material", 80).notNullable();
    table.string("color", 80).notNullable();

    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["printer_id"]);
    table.index(["stock_id"]);
  });

  await knex.raw(`
    alter table filament_movements
    add constraint filament_movements_type_check
    check (type in ('add', 'consume', 'adjust'))
  `);

  await knex.raw(`
    alter table filament_movements
    add constraint filament_movements_source_check
    check (source in ('dashboard', 'telegram', 'printer', 'system'))
  `);

  await knex.raw(`
    alter table filament_stock
    add constraint filament_stock_stock_g_check
    check (stock_g >= 0)
  `);

  await knex.raw(`
    alter table filament_stock
    add constraint filament_stock_low_stock_g_check
    check (low_stock_g >= 0)
  `);

  await knex.raw(`
    alter table filament_stock
    add constraint filament_stock_critical_stock_g_check
    check (critical_stock_g >= 0)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("printer_filament_state");
  await knex.schema.dropTableIfExists("filament_movements");
  await knex.schema.dropTableIfExists("filament_stock");
}