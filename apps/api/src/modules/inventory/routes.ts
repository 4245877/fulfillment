import type { FastifyInstance } from "fastify";

import {
  addFilament,
  adjustFilament,
  consumeFilament,
  getInventoryMaterialsSummary,
  listFilamentMovements,
  listFilamentStock,
  listPrinterFilamentState,
  loadPrinterFilament,
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
}