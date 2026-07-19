import type { FastifyInstance } from "fastify";

import {
  requireAdmin,
  requireAdminOrService,
  requireFilamentAvailabilityToken,
} from "../../core/auth";
import {
  addFilament,
  adjustFilament,
  consumeFilament,
  getFilamentAvailability,
  getInventoryMaterialsSummary,
  listFilamentMovements,
  listFilamentStock,
  listPrinterFilamentState,
  loadPrinterFilament,
  syncPrinterFilament,
  updateFilamentStock,
} from "./service";
import {
  InventoryValidationError,
  isDatabaseError,
  parseAddFilamentBody,
  parseAdjustFilamentBody,
  parseConsumeFilamentBody,
  parseLoadPrinterFilamentBody,
  parseSyncPrinterFilamentBody,
  parseUpdateFilamentBody,
} from "./validation";

export default async function inventoryRoutes(app: FastifyInstance) {
  // Encapsulated error handler for THIS plugin only: validation rejections
  // become 400 { error, code }; a driver/Postgres error becomes a generic 500
  // (the raw DB message is logged server-side, never returned); any other
  // service error keeps its human-readable message at 400. Nothing here ever
  // returns an unhandled Postgres error to the caller.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof InventoryValidationError) {
      reply.code(error.statusCode);
      return { error: error.message, code: error.code };
    }

    if (isDatabaseError(error)) {
      request.log.error({ err: error }, "inventory: unexpected database error");
      reply.code(500);
      return { error: "Internal server error", code: "internal_error" };
    }

    const status =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 400;
    reply.code(status >= 400 && status <= 599 ? status : 400);
    const message = error instanceof Error ? error.message : "Bad request";
    return { error: message || "Bad request", code: "bad_request" };
  });

  // ── Reads (no token; the dashboard fetches these same-origin) ──────────────

  app.get("/filament/stock", async () => {
    return {
      items: await listFilamentStock(),
    };
  });

  // Read-only availability feed for the online shop: aggregated material×color
  // availability from filament_stock. Guarded by its OWN bearer token
  // (FILAMENT_AVAILABILITY_TOKEN), never the dashboard's; strictly read-only and
  // it opens none of the mutating routes below. 503 when the token is unset,
  // 401 on a missing/wrong token.
  app.get("/filament/availability", async (req, reply) => {
    const denied = requireFilamentAvailabilityToken(req, reply);
    if (denied) return denied;

    return getFilamentAvailability();
  });

  app.get("/filament/movements", async (req) => {
    const query = req.query as { limit?: string | number };
    const limit = Number(query.limit || 100);

    return {
      items: await listFilamentMovements(limit),
    };
  });

  app.get("/summary", async () => {
    return getInventoryMaterialsSummary();
  });

  app.get("/printer-filament", async () => {
    return {
      items: await listPrinterFilamentState(),
    };
  });

  // ── Admin-only warehouse mutations (operator dashboard) ────────────────────
  // These require an admin token; the atelier service token does NOT open them.

  app.post("/filament/add", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    return addFilament(parseAddFilamentBody(req.body));
  });

  app.post("/filament/adjust", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    return adjustFilament(parseAdjustFilamentBody(req.body));
  });

  app.post("/filament/update", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    return updateFilamentStock(parseUpdateFilamentBody(req.body));
  });

  // Manual "which reel is on this printer" entry from the dashboard — admin only
  // (creates stock if needed). The automatic device-driven binding is /sync.
  app.post("/printer-filament/load", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    return loadPrinterFilament(parseLoadPrinterFilamentBody(req.body));
  });

  // ── Inter-service routes (dashboard OR atelier) ───────────────────────────
  // Accept EITHER an admin token (manual dashboard action) OR the atelier
  // service token (x-service-token) — these are the only two routes the service
  // token unlocks.

  // Manual consume from the dashboard AND automatic per-print deduction from the
  // atelier orchestrator.
  app.post("/filament/consume", async (req, reply) => {
    const denied = requireAdminOrService(req, reply);
    if (denied) return denied;

    return consumeFilament(parseConsumeFilamentBody(req.body));
  });

  // Auto-binds the reel a printer reports loaded to a stock position (called by
  // the atelier orchestrator, no manual entry). A hint that matches no stock is
  // a 200 `{ resolved: false }`, not an error, so the caller does not
  // retry-storm; only malformed input (missing printerId/material) is a 400.
  app.post("/printer-filament/sync", async (req, reply) => {
    const denied = requireAdminOrService(req, reply);
    if (denied) return denied;

    return syncPrinterFilament(parseSyncPrinterFilamentBody(req.body));
  });
}
