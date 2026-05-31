import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ProductReportError,
  createProductReport,
  listProductReports,
  updateProductReport,
} from "./service";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function getErrorStatus(error: unknown) {
  if (error instanceof ProductReportError) {
    return error.statusCode;
  }

  const statusCode = Number((error as any)?.statusCode);

  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }

  const message = getErrorMessage(error).toLowerCase();

  if (message.includes("not found")) {
    return 404;
  }

  if (message.includes("too many") || message.includes("spam")) {
    return 429;
  }

  return 400;
}

function getClientIp(req: FastifyRequest) {
  const headers = req.headers;

  const cfIp = String(headers["cf-connecting-ip"] || "").trim();
  const realIp = String(headers["x-real-ip"] || "").trim();

  const forwarded = String(headers["x-forwarded-for"] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0];

  return cfIp || realIp || forwarded || req.ip || "unknown";
}

export default async function productReportsRoutes(app: FastifyInstance) {
  app.post("/products/:productId/reports", async (req, reply) => {
    try {
      const params = req.params as { productId?: string };

      const item = await createProductReport(
        String(params.productId || ""),
        req.body as any,
        {
          ip: getClientIp(req),
          user_agent: String(req.headers["user-agent"] || ""),
          referer: String(req.headers.referer || req.headers.referrer || ""),
        },
      );

      reply.code(201);

      return {
        item,
      };
    } catch (error) {
      reply.code(getErrorStatus(error));
      return { error: getErrorMessage(error) };
    }
  });

  app.get("/product-reports", async (req, reply) => {
    try {
      const query = req.query as {
        status?: string;
        q?: string;
        limit?: string | number;
      };

      return await listProductReports({
        status: query.status as any,
        q: query.q,
        limit: Number(query.limit || 100),
      });
    } catch (error) {
      reply.code(getErrorStatus(error));
      return { error: getErrorMessage(error) };
    }
  });

  app.patch("/product-reports/:reportId", async (req, reply) => {
    try {
      const params = req.params as { reportId?: string };

      const item = await updateProductReport(
        String(params.reportId || ""),
        req.body as any,
      );

      return {
        item,
      };
    } catch (error) {
      reply.code(getErrorStatus(error));
      return { error: getErrorMessage(error) };
    }
  });
}