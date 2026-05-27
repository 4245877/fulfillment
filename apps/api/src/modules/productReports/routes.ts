import type { FastifyInstance } from "fastify";

import {
  createProductReport,
  listProductReports,
  updateProductReport,
} from "./service";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function getErrorStatus(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  if (message.includes("not found")) {
    return 404;
  }

  return 400;
}

export default async function productReportsRoutes(app: FastifyInstance) {
  app.post("/products/:productId/reports", async (req, reply) => {
    try {
      const params = req.params as { productId?: string };

      const item = await createProductReport(
        String(params.productId || ""),
        req.body as any
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
        req.body as any
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