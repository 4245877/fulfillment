import Fastify from "fastify";
import cors from "@fastify/cors";

import printersRoutes from "./modules/printers/routes";
import printsRoutes from "./modules/prints/routes";
import inventoryRoutes from "./modules/inventory/routes";
import backupsRoutes from "./modules/backups/routes";
import productReportsRoutes from "./modules/productReports/routes";
import ordersRoutes from "./modules/orders/routes";
import notificationsRoutes from "./modules/notifications/routes";
import pricingRoutes from "./modules/pricing/routes";
import appealsRoutes from "./modules/appeals/routes";
import { registerNotificationOutboxWorker } from "./modules/notifications/dispatcher";
import {
  getPrinterMonitorStats,
  registerPrinterMonitorWorker,
} from "./modules/printers/monitor";
import { getInventoryMaterialsSummary } from "./modules/inventory/service";
import { getOrdersOverview } from "./modules/orders/service";
import { checkDbConnection } from "./infra/db/knex";
import { getServicesHealth } from "./modules/ops/serviceHealth";
import { env } from "./shared/env";
import { subscribeEvents } from "./core/events";

const app = Fastify({ logger: true });

registerNotificationOutboxWorker(app);
registerPrinterMonitorWorker(app);

// CORS. An explicit allowlist (CORS_ALLOWED_ORIGINS) gets credentialed access;
// otherwise any origin is allowed but WITHOUT credentials — we never combine
// origin-reflection with credentials (that lets any website make credentialed
// cross-site requests). The dashboard is same-origin via nginx, so it needs no
// entry here. Важно: без await, чтобы не упираться в top-level await при CJS.
const corsAllowlist = (env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.register(
  cors,
  corsAllowlist.length > 0
    ? { origin: corsAllowlist, credentials: true }
    : { origin: true, credentials: false }
);

app.get("/health", async () => ({ ok: true }));

app.get("/ready", async (_req, reply) => {
  const dbOk = await checkDbConnection();

  if (!dbOk) {
    reply.code(503);
    return {
      ok: false,
      services: {
        db: "down",
      },
    };
  }

  return {
    ok: true,
    services: {
      db: "up",
    },
  };
});

app.get("/api/ops/overview", async () => {
  const [materials, services, ordersOverview] = await Promise.all([
    getInventoryMaterialsSummary(),
    getServicesHealth(),
    getOrdersOverview(),
  ]);

  // Live diagnostics of the printer-monitor worker: poll cadence, outage
  // state, per-printer data freshness, dedupe counters. This is the "degraded
  // integration" signal — the shop itself stays up without the orchestrator.
  const printerMonitor = getPrinterMonitorStats();

  return {
    stats: {
      orders: ordersOverview.statusCounts,
      payments: ordersOverview.payments,
      logistics: ordersOverview.logistics,
      materials,
      queues: {
        prints: { ready: 0, running: 0, lagMs: 0 },
        imports: { backlog: 0, lagMs: 0 },
        media: { backlog: 0, lagMs: 0 },
        webhooks: { backlog: 0, lagMs: 0 },
        notify: { backlog: 0, lagMs: 0 },
      },
      printerMonitor,
      services,
      indexer: {
        backlog: 0,
        lastIndexedAt: "—",
        ratePerMin: 0,
        shards: 1,
      },
      ingester: {
        batches: [],
        mediaBacklog: 0,
        mediaRatePerMin: 0,
        errors1h: 0,
        pricingVersion: "—",
      },
      webhooks: { providers: {} },
      alerts: [],
    },
    printers: [],
    jobs: [],
  };
});

app.get("/api/events/stream", async (req, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  reply.hijack();
  reply.raw.write(`: connected ${new Date().toISOString()}\n\n`);

  const send = (event: unknown) => {
    // Writes can throw if the socket is already gone between the close event and
    // the next tick; swallow so a disconnect never crashes the emitter loop.
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* client went away */
    }
  };

  // Forward real domain events (orders, appeals, …) published on the in-process
  // bus to this client.
  const unsubscribe = subscribeEvents(send);

  // Heartbeat keeps proxies/load balancers from idling the connection out.
  const timer = setInterval(() => {
    send({ domain: "ops", type: "heartbeat", ts: new Date().toISOString(), payload: {} });
  }, 5000);

  req.raw.on("close", () => {
    clearInterval(timer);
    unsubscribe();
  });
});

app.register(printersRoutes, { prefix: "/api/printers" });
app.register(printsRoutes, { prefix: "/api/prints" });
app.register(inventoryRoutes, { prefix: "/api/inventory" });
app.register(backupsRoutes, { prefix: "/api/ops/backup" });
app.register(productReportsRoutes, { prefix: "/api" });
app.register(ordersRoutes, { prefix: "/api/orders" });
app.register(notificationsRoutes, { prefix: "/api/notifications" });
app.register(appealsRoutes, { prefix: "/api/appeals" });
app.register(pricingRoutes);

export default app;