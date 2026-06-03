import Fastify from "fastify";
import cors from "@fastify/cors";

import printersRoutes from "./modules/printers/routes";
import inventoryRoutes from "./modules/inventory/routes";
import backupsRoutes from "./modules/backups/routes";
import productReportsRoutes from "./modules/productReports/routes";
import ordersRoutes from "./modules/orders/routes";
import { getInventoryMaterialsSummary } from "./modules/inventory/service";
import { getOrdersStatusSummary } from "./modules/orders/service";
import { checkDbConnection } from "./infra/db/knex";

const app = Fastify({ logger: true });

// Важно: без await, чтобы не упираться в top-level await при CJS
app.register(cors, {
  origin: true,
  credentials: true,
});

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
  const materials = await getInventoryMaterialsSummary();

  return {
    stats: {
      orders: await getOrdersStatusSummary(),
      payments: {
        awaitingPrepay: 0,
        awaitingRest: 0,
        disputes: 0,
        avgCheckUAH: 0,
      },
      logistics: {
        new: 0,
        inTransit: 0,
        delivered: 0,
        problem: 0,
        byCarrier: {},
      },
      materials,
      queues: {
        prints: { ready: 0, running: 0, lagMs: 0 },
        imports: { backlog: 0, lagMs: 0 },
        media: { backlog: 0, lagMs: 0 },
        webhooks: { backlog: 0, lagMs: 0 },
        notify: { backlog: 0, lagMs: 0 },
      },
      services: {
        shop: "down",
        fulfillment: "up",
        printers: "down",
        db: (await checkDbConnection()) ? "up" : "down",
        redis: "down",
        indexer: "down",
      },
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

app.get("/api/prints/overview", async () => {
  return {
    printers: [],
    jobs: [],
    stats: { printing: 0, queued: 0, done: 0 },
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

  const timer = setInterval(() => {
    const event = {
      domain: "ops",
      type: "heartbeat",
      ts: new Date().toISOString(),
      payload: {},
    };

    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }, 5000);

  req.raw.on("close", () => clearInterval(timer));
});

app.register(printersRoutes, { prefix: "/api/printers" });
app.register(inventoryRoutes, { prefix: "/api/inventory" });
app.register(backupsRoutes, { prefix: "/api/ops/backup" });
app.register(productReportsRoutes, { prefix: "/api" });
app.register(ordersRoutes, { prefix: "/api/orders" });

export default app;