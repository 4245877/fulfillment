import type { FastifyPluginAsync } from "fastify";

import {
  dispatchPendingNotifications,
  enqueueTelegramTopicTestNotifications,
} from "./dispatcher";
import { requireAdmin } from "../../core/auth";

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
