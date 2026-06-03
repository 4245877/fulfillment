import type { FastifyPluginAsync } from "fastify";

import { ORDER_STATUSES } from "./types";
import {
  changeOrderStatus,
  getOrder,
  getOrdersStatusSummary,
  listOrders,
  receiveOrder,
} from "./service";

const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const query = req.query as {
      status?: string;
      q?: string;
      limit?: string;
    };

    const orders = await listOrders({
      status: query.status,
      q: query.q,
      limit: query.limit ? Number(query.limit) : undefined,
    });

    return {
      orders,
      statuses: ORDER_STATUSES,
    };
  });

  app.get("/stats", async () => {
    return {
      orders: await getOrdersStatusSummary(),
    };
  });

  app.get("/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return await getOrder(id);
    } catch (e: any) {
      reply.code(e?.statusCode || 500);
      return {
        error: e?.message || "Failed to load order",
      };
    }
  });

  // Приём заказа из магазина.
  app.post("/", async (req, reply) => {
    try {
      const order = await receiveOrder(req.body as any);

      reply.code(201);
      return {
        ok: true,
        order,
      };
    } catch (e: any) {
      reply.code(e?.statusCode || 500);
      return {
        ok: false,
        error: e?.message || "Failed to receive order",
      };
    }
  });

  // Удобный endpoint именно для смены статуса.
  app.patch("/:id/status", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const order = await changeOrderStatus(id, req.body as any);

      return {
        ok: true,
        order,
      };
    } catch (e: any) {
      reply.code(e?.statusCode || 500);
      return {
        ok: false,
        error: e?.message || "Failed to update order status",
      };
    }
  });

  // Совместимый PATCH, если frontend отправит просто { status }.
  app.patch("/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as any;

      if (!body?.status) {
        reply.code(400);
        return {
          ok: false,
          error: "Only status update is supported now",
        };
      }

      const order = await changeOrderStatus(id, body);

      return {
        ok: true,
        order,
      };
    } catch (e: any) {
      reply.code(e?.statusCode || 500);
      return {
        ok: false,
        error: e?.message || "Failed to update order",
      };
    }
  });
};

export default ordersRoutes;