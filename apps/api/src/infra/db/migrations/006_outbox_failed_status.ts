import type { Knex } from "knex";

// 003 was already applied before dead-letter delivery was introduced. Updating
// its source does not change constraints on those existing databases.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    alter table outbox_events
      drop constraint if exists outbox_events_status_check,
      add constraint outbox_events_status_check
        check (status in ('pending', 'processing', 'sent', 'failed'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Keep dead letters parked when rolling back. Mapping them to pending would
  // unexpectedly resend notifications that have already exhausted retries.
  await knex.raw(`
    alter table outbox_events
      drop constraint if exists outbox_events_status_check,
      add constraint outbox_events_status_check
        check (status in ('pending', 'processing', 'sent', 'failed'))
  `);
}
