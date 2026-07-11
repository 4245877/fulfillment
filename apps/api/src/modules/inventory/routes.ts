import type { FastifyInstance } from "fastify";

import { requireFilamentAvailabilityToken } from "../../core/auth";
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export default async function inventoryRoutes(app: FastifyInstance) {
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

  app.post("/filament/add", async (req, reply) => {
    try {
      return await addFilament(req.body as any);
    } catch (error) {
      reply.code(400);
      return { error: getErrorMessage(error) };
    }
  });

  app.post("/filament/consume", async (req, reply) => {
    try {
      return await consumeFilament(req.body as any);
    } catch (error) {
      reply.code(400);
      return { error: getErrorMessage(error) };
    }
  });

  app.post("/filament/adjust", async (req, reply) => {
    try {
      return await adjustFilament(req.body as any);
    } catch (error) {
      reply.code(400);
      return { error: getErrorMessage(error) };
    }
  });

  app.post("/filament/update", async (req, reply) => {
    try {
      return await updateFilamentStock(req.body as any);
    } catch (error) {
      reply.code(400);
      return { error: getErrorMessage(error) };
    }
  });

  app.get("/printer-filament", async () => {
    return {
      items: await listPrinterFilamentState(),
    };
  });

  app.post("/printer-filament/load", async (req, reply) => {
    try {
      return await loadPrinterFilament(req.body as any);
    } catch (error) {
      reply.code(400);
      return { error: getErrorMessage(error) };
    }
  });

  // Auto-binds the reel a printer reports loaded to a stock position (called by
  // the print-orchestrator, no manual entry). A hint that matches no stock is a
  // 200 `{ resolved: false }`, not an error, so the caller does not retry-storm;
  // only malformed input (missing printerId/material) is a 400.
  app.post("/printer-filament/sync", async (req, reply) => {
    try {
      return await syncPrinterFilament(req.body as any);
    } catch (error) {
      reply.code(400);
      return { error: getErrorMessage(error) };
    }
  });
}