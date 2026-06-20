import type { FastifyPluginAsync } from "fastify";
import { readPricing, writePricing } from "./service";

type PutBody = {
  tree?: unknown;
  baseHash?: string;
};

const pricingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/ops/pricing", async (_req, reply) => {
    try {
      return await readPricing();
    } catch (error) {
      app.log.error({ err: error }, "failed to read pricing.yml");
      reply.code(502);
      return { ok: false, error: String((error as Error)?.message || error) };
    }
  });

  app.put("/api/ops/pricing", async (req, reply) => {
    const body = (req.body || {}) as PutBody;

    if (!body || typeof body !== "object" || !("tree" in body)) {
      reply.code(400);
      return { ok: false, error: "Missing 'tree' in request body" };
    }

    try {
      return await writePricing(body.tree, body.baseHash);
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      app.log.error({ err: error }, "failed to write pricing.yml");
      reply.code(statusCode === 409 ? 409 : 502);
      return { ok: false, error: String((error as Error)?.message || error) };
    }
  });
};

export default pricingRoutes;
