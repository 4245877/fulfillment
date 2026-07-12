import type { FastifyInstance } from "fastify";

import {
  createOrchestratorClientFromEnv,
  OrchestratorError,
  type OrchestratorClient,
} from "../../infra/integrations/orchestrator/client";

export type PrintsRoutesOptions = {
  /** Injectable for tests; defaults to the env-configured orchestrator client. */
  client?: OrchestratorClient | null;
};

export type PrintsOverviewReason =
  | "not_configured"
  | "orchestrator_unavailable";

/**
 * The Board's print tiles payload. `available: false` is an explicit degraded
 * marker — consumers must render "no data" (not zeroes) when they see it, so
 * an orchestrator outage never masquerades as an idle farm.
 */
export type PrintsOverview = {
  available: boolean;
  reason: PrintsOverviewReason | null;
  updatedAt: string;
  printers: unknown[];
  jobs: unknown[];
  stats: {
    printing: number | null;
    queued: number | null;
    done: number | null;
  };
};

function unavailable(reason: PrintsOverviewReason): PrintsOverview {
  return {
    available: false,
    reason,
    updatedAt: new Date().toISOString(),
    printers: [],
    jobs: [],
    stats: { printing: null, queued: null, done: null },
  };
}

/**
 * Read-only print overview for the Board page, assembled live from the atelier
 * print-orchestrator: printer statuses (`GET /api/printers`), the operator
 * queue (`GET /api/queue`) and today's counters (`GET /api/today`). Replaces
 * the old deprecated stub that always reported an empty farm.
 */
export default async function printsRoutes(
  app: FastifyInstance,
  opts: PrintsRoutesOptions = {}
) {
  const client =
    opts.client !== undefined ? opts.client : createOrchestratorClientFromEnv();

  app.get("/overview", async (request): Promise<PrintsOverview> => {
    if (!client) {
      return unavailable("not_configured");
    }

    try {
      const [printers, jobs, today] = await Promise.all([
        client.listPrinterStatuses(),
        client.listQueueJobs(),
        client.fetchToday(),
      ]);

      return {
        available: true,
        reason: null,
        updatedAt: new Date().toISOString(),
        printers,
        jobs,
        stats: {
          printing: printers.filter((printer) => printer.status === "printing")
            .length,
          // The orchestrator's queue holds only not-yet-dispatched jobs (they
          // are removed once started), so its size IS the queued count.
          queued: jobs.length,
          done: today.done,
        },
      };
    } catch (error) {
      request.log.warn(
        {
          operation: "prints_overview",
          error: error instanceof Error ? error.message : String(error),
          errorKind:
            error instanceof OrchestratorError ? error.kind : "unknown",
        },
        "Prints overview degraded: orchestrator unavailable"
      );
      return unavailable("orchestrator_unavailable");
    }
  });
}
