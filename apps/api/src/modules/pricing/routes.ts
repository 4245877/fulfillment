import type { FastifyPluginAsync } from "fastify";
import { readPricing, writePricing } from "./service";
import { requireAdmin } from "../../core/auth";

type PutBody = {
  tree?: unknown;
  baseHash?: string;
};

// Map a thrown error onto an HTTP status + a safe, user-facing message.
//  - errors tagged with a 4xx `statusCode` are the operator's to fix (empty
//    config, anchors, bad payload, version conflict) → surface the message;
//  - a 500 tag is an internal invariant failure → generic message, detail logged;
//  - anything untagged is an SSH/transport failure → 502, never echo the raw
//    error (it may contain remote stderr / command fragments) — issue #2.
export function classifyError(
  error: unknown,
  fallbackText: string
): { status: number; text: string } {
  const statusCode = (error as { statusCode?: number })?.statusCode;
  const message = String((error as Error)?.message || error);

  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return { status: statusCode, text: message };
  }
  if (statusCode === 500) {
    return { status: 500, text: "Внутрішня помилка під час підготовки pricing.yml." };
  }
  return { status: 502, text: fallbackText };
}

const pricingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/ops/pricing", async (_req, reply) => {
    try {
      return await readPricing();
    } catch (error) {
      app.log.error({ err: error }, "failed to read pricing.yml");
      const { status, text } = classifyError(
        error,
        "Не вдалося прочитати pricing.yml із сервера."
      );
      reply.code(status);
      return { ok: false, error: text };
    }
  });

  app.put("/api/ops/pricing", async (req, reply) => {
    // Writing pricing.yml runs an SSH write to the production ingester host, so
    // it must be admin-gated like the other remote-mutating endpoints.
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    const body = (req.body || {}) as PutBody;

    if (!body || typeof body !== "object" || !("tree" in body)) {
      reply.code(400);
      return { ok: false, error: "Missing 'tree' in request body" };
    }

    try {
      return await writePricing(body.tree, body.baseHash);
    } catch (error) {
      app.log.error({ err: error }, "failed to write pricing.yml");
      const { status, text } = classifyError(
        error,
        "Не вдалося зберегти pricing.yml на сервері (помилка віддаленого збереження)."
      );
      reply.code(status);
      return { ok: false, error: text };
    }
  });
};

export default pricingRoutes;
