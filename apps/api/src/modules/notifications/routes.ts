import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  dispatchPendingNotifications,
  enqueueTelegramTopicTestNotifications,
} from "./dispatcher";

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!expectedToken && process.env.NODE_ENV === "production") {
    reply.code(500);
    return { error: "ADMIN_TOKEN is not configured" };
  }

  if (!expectedToken) {
    return null;
  }

  const token = getHeaderValue(request.headers["x-admin-token"]);

  if (token !== expectedToken) {
    reply.code(401);
    return { error: "Unauthorized" };
  }

  return null;
}

const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/test", async (req, reply) => {
    const authError = requireAdmin(req, reply);

    if (authError) {
      return authError;
    }

    const queued = await enqueueTelegramTopicTestNotifications();
    const dispatch = await dispatchPendingNotifications({
      limit: queued.length,
      logger: app.log,
    });

    return {
      ok: dispatch.enabled && dispatch.failed === 0,
      queued: queued.map((event) => ({
        id: event.id,
        eventType: event.event_type,
      })),
      dispatch,
    };
  });

  app.post("/dispatch", async (req, reply) => {
    const authError = requireAdmin(req, reply);

    if (authError) {
      return authError;
    }

    const dispatch = await dispatchPendingNotifications({ logger: app.log });

    return {
      ok: dispatch.enabled && dispatch.failed === 0,
      dispatch,
    };
  });
};

export default notificationsRoutes;
