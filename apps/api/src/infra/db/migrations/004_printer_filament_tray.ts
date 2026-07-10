import type { Knex } from "knex";

// Per-tray reel binding for multi-slot printers (Bambu AMS). A row with
// ams_tray = NULL is the printer-level reel (single-spool printers, unchanged
// behaviour); a row with ams_tray = N binds slot N to its own stock. NULLS NOT
// DISTINCT keeps "one printer-level row per printer" enforced in the database,
// exactly like the old unique(printer_id).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("printer_filament_state", (table) => {
    table.integer("ams_tray").nullable();
    table.dropUnique(["printer_id"]);
  });

  await knex.raw(`
    alter table printer_filament_state
    add constraint printer_filament_state_printer_tray_unique
    unique nulls not distinct (printer_id, ams_tray)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    alter table printer_filament_state
    drop constraint printer_filament_state_printer_tray_unique
  `);

  // Restoring unique(printer_id) requires one row per printer again: keep the
  // printer-level row when present, otherwise the most recently updated tray row.
  await knex.raw(`
    delete from printer_filament_state p
    using printer_filament_state q
    where p.printer_id = q.printer_id
      and p.id <> q.id
      and (
        (p.ams_tray is not null and q.ams_tray is null)
        or (
          (p.ams_tray is null) = (q.ams_tray is null)
          and (p.updated_at, p.id) < (q.updated_at, q.id)
        )
      )
  `);

  await knex.schema.alterTable("printer_filament_state", (table) => {
    table.dropColumn("ams_tray");
    table.unique(["printer_id"]);
  });
}
