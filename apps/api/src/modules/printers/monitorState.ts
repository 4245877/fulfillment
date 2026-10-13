import type { Knex } from "knex";

import { db } from "../../infra/db/knex";
import type { OrchestratorPrinterStatus } from "../../infra/integrations/orchestrator/client";

/** Committed together with the outbox event; versions never depend on poll timestamps. */
export type PrinterMonitorRecord = {
  lastStatus: OrchestratorPrinterStatus;
  /** A newer ambiguous idle report, retained without discarding the active job. */
  lastObservation?: OrchestratorPrinterStatus;
  eventVersion: number;
  progressMilestone: number;
};

export type PrinterMonitorStateStore = {
  withPrinter<T>(
    printerId: string,
    visit: (
      previous: PrinterMonitorRecord | undefined,
      save: (next: PrinterMonitorRecord) => Promise<void>,
      transaction?: Knex.Transaction
    ) => Promise<T>
  ): Promise<T>;
};

/** Used with injected enqueue handlers and available for restart/rollback tests. */
export function createMemoryPrinterMonitorStateStore(): PrinterMonitorStateStore {
  const records = new Map<string, PrinterMonitorRecord>();
  return {
    async withPrinter(printerId, visit) {
      let pending: PrinterMonitorRecord | undefined;
      const result = await visit(
        records.has(printerId) ? structuredClone(records.get(printerId)) : undefined,
        async (next) => { pending = structuredClone(next); }
      );
      if (pending) records.set(printerId, pending);
      return result;
    },
  };
}

export function createPostgresPrinterMonitorStateStore(connection: Knex = db): PrinterMonitorStateStore {
  return {
    async withPrinter(printerId, visit) {
      return connection.transaction(async (trx) => {
        // An advisory lock also serializes the first observation, when no row
        // exists yet. A row lock alone cannot protect that insertion race.
        await trx.raw("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
          `printer-monitor:${printerId}`,
        ]);
        const row = await trx("printer_monitor_state")
          .where({ printer_id: printerId })
          .forUpdate()
          .first<{ state: PrinterMonitorRecord }>();
        return visit(row?.state, async (next) => {
          await trx("printer_monitor_state")
            .insert({ printer_id: printerId, state: next, updated_at: trx.fn.now() })
            .onConflict("printer_id")
            .merge({ state: next, updated_at: trx.fn.now() });
        }, trx);
      });
    },
  };
}

export const printerMonitorStateStore = createPostgresPrinterMonitorStateStore();
