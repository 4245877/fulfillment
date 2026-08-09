import type { Knex } from "knex";

/**
 * A snapshot of the printer's name on every reel binding.
 *
 * `printer_id` is a cross-service reference: the printers themselves live in
 * atelier, and an operator may delete one there. When that happens the binding
 * row must stay — it records that a reel was put on a machine, which is history,
 * not configuration — but it would otherwise degrade to a bare id with nothing
 * to render. Denormalising the name at write time keeps the row readable after
 * the printer it names no longer exists.
 *
 * Nullable with no backfill: existing rows keep resolving their name through the
 * live printer directory (they refer to printers that still exist), and each
 * gets its snapshot the next time it is written. Adding a nullable column is
 * lock-light on Postgres and re-runnable — no data is rewritten or destroyed.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn("printer_filament_state", "printer_name");
  if (exists) return;

  await knex.schema.alterTable("printer_filament_state", (table) => {
    table.string("printer_name", 200).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn("printer_filament_state", "printer_name");
  if (!exists) return;

  await knex.schema.alterTable("printer_filament_state", (table) => {
    table.dropColumn("printer_name");
  });
}
