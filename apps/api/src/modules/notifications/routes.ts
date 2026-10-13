import type { FastifyPluginAsync } from "fastify";

import {
  dispatchPendingNotifications,
  enqueueTelegramTopicTestNotifications,
} from "./dispatcher";
import { requireAdmin } from "../../core/auth";

type NotificationsRouteOptions = {
  dispatch?: typeof dispatchPendingNotifications;
  enqueueTestNotifications?: typeof enqueueTelegramTopicTestNotifications;
};

const notificationsRoutes: FastifyPluginAsync<NotificationsRouteOptions> = async (app, options) => {
  const dispatchNotifications = options.dispatch ?? dispatchPendingNotifications;
  const enqueueTestNotifications = options.enqueueTestNotifications ?? enqueueTelegramTopicTestNotifications;
  app.post("/test", async (req, reply) => {
    const authError = requireAdmin(req, reply);

    if (authError) {
      return authError;
    }

    const queued = await enqueueTestNotifications();
    const dispatch = await dispatchNotifications({
      limit: queued.length,
      eventIds: queued.map((event) => event.id),
      logger: app.log,
    });

    return {
      ok: dispatch.enabled && dispatch.failed === 0 && !dispatch.blockedReason &&
        dispatch.sent === queued.length,
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

    const dispatch = await dispatchNotifications({ logger: app.log });

    return {
      ok: dispatch.enabled && dispatch.failed === 0 && !dispatch.blockedReason,
      dispatch,
    };
  });
};

export default notificationsRoutes;
