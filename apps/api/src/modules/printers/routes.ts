import type { FastifyInstance } from "fastify";

import { requireAdmin } from "../../core/auth";
import {
  createOrchestratorClientFromEnv,
  OrchestratorError,
  type OrchestratorClient,
} from "../../infra/integrations/orchestrator/client";
import { getPrinterDirectory, type PrinterDirectory } from "./directory";
import { isStaleStatus, resolveStaleAfterMs } from "./staleness";

export type PrintersRoutesOptions = {
  /** Injectable for tests; defaults to the env-configured orchestrator client. */
  client?: OrchestratorClient | null;
  /** Injectable for tests; defaults to the process-wide printer directory. */
  directory?: PrinterDirectory;
};

/**
 * Read-only printer API for the fulfillment dashboard. This service owns no
 * printer hardware and no printer configuration:
 *
 *  - `GET /inventory` — the fleet's CONFIGURATION (atelier's
 *    `/api/printers/inventory`, cached): what printers exist, including the
 *    disabled ones. This is the list a form should be built from;
 *  - `GET /status` — the fleet's LIVE STATE (atelier's `/api/printers`): what
 *    each enabled printer is doing right now.
 *
 * They are deliberately separate: a printer that is configured-and-disabled and
 * one that is enabled-but-offline are different situations, and a single merged
 * list cannot express both. There are no config or control routes here —
 * printers are configured and driven in atelier only.
 */
export default async function printersRoutes(
  app: FastifyInstance,
  opts: PrintersRoutesOptions = {}
) {
  const client =
    opts.client !== undefined ? opts.client : createOrchestratorClientFromEnv();
  const directory = opts.directory ?? getPrinterDirectory();
  directory.setLogger(app.log);

  /**
   * The configured fleet. `available: false` is an explicit degraded marker:
   * consumers must not read an empty list as "the farm has no printers".
   * A cached-but-stale answer is served with `stale: true` rather than an
   * error — this route only displays; the assignment paths use the directory's
   * own freshness gate instead.
   */
  app.get("/inventory", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    const snapshot = await directory.peek();

    if (!snapshot) {
      const stats = directory.stats();
      return reply.code(stats.configured ? 502 : 503).send({
        available: false,
        reason: stats.configured ? "orchestrator_unavailable" : "not_configured",
        error: stats.configured
          ? `Список принтеров недоступен: ${stats.lastError ?? "оркестратор печати не ответил"}`
          : "Оркестратор печати не настроен (PRINTER_ORCHESTRATOR_URL)",
        printers: [],
      });
    }

    return {
      available: true,
      reason: null,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      // Age of this service's copy, so the UI can say "данные могли устареть"
      // instead of silently showing a fleet nobody has confirmed in a while.
      stale: !snapshot.fresh,
      ageMs: snapshot.ageMs,
      printers: snapshot.printers,
    };
  });

  app.get("/status", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    if (!client) {
      return reply.code(503).send({
        error:
          "Оркестратор печати не настроен (PRINTER_ORCHESTRATOR_URL)",
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
          : "Неизвестная ошибка оркестратора печати";

      request.log.warn(
        {
          error: message,
          kind: error instanceof OrchestratorError ? error.kind : "unknown",
        },
        "Printer status proxy failed"
      );

      return reply.code(502).send({
        error: `Оркестратор печати недоступен: ${message}`,
        printers: [],
      });
    }
  });
}
