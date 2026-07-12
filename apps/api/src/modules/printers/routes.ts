import type { FastifyInstance } from "fastify";

import { requireAdmin } from "../../core/auth";
import {
  createOrchestratorClientFromEnv,
  OrchestratorError,
  type OrchestratorClient,
} from "../../infra/integrations/orchestrator/client";
import { isStaleStatus, resolveStaleAfterMs } from "./staleness";

export type PrintersRoutesOptions = {
  /** Injectable for tests; defaults to the env-configured orchestrator client. */
  client?: OrchestratorClient | null;
};

/**
 * Read-only printer API for the fulfillment dashboard. This service owns no
 * printer hardware: `GET /status` is an adapter over the atelier
 * print-orchestrator's `GET /api/printers`, and there are deliberately no
 * config or control routes here — printers are configured and driven in
 * atelier only.
 */
export default async function printersRoutes(
  app: FastifyInstance,
  opts: PrintersRoutesOptions = {}
) {
  const client =
    opts.client !== undefined ? opts.client : createOrchestratorClientFromEnv();

  app.get("/status", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    if (!client) {
      return reply.code(503).send({
        error:
          "Оркестратор друку не налаштований (PRINTER_ORCHESTRATOR_URL)",
        printers: [],
      });
    }

    try {
      const statuses = await client.listPrinterStatuses();
      // `stale: true` = the orchestrator answered, but this printer's status
      // timestamp is old (its poll loop stopped producing fresh data). Distinct
      // from `online: false` (the device did not answer the orchestrator) and
      // from a 502 below (the orchestrator itself is unreachable).
      const staleAfterMs = resolveStaleAfterMs();
      const printers = statuses.map((status) => ({
        ...status,
        stale: isStaleStatus(status, staleAfterMs),
      }));
      return { printers };
    } catch (error) {
      const message =
        error instanceof OrchestratorError
          ? error.message
          : "Невідома помилка оркестратора друку";

      request.log.warn(
        {
          error: message,
          kind: error instanceof OrchestratorError ? error.kind : "unknown",
        },
        "Printer status proxy failed"
      );

      return reply.code(502).send({
        error: `Оркестратор друку недоступний: ${message}`,
        printers: [],
      });
    }
  });
}
