import Fastify from "fastify";
import cors from "@fastify/cors";
import printersRoutes from "./modules/printers/routes";

const app = Fastify({ logger: true });

// Важно: без await, чтобы не упираться в top-level await при CJS
app.register(cors, {
  origin: true,
  credentials: true,
});

app.get("/health", async () => ({ ok: true }));

app.get("/api/ops/overview", async () => {
  return {
    stats: {
      orders: {
        PrePrintCheck: 0,
        Queued: 0,
        Printing: 0,
        PostProcess: 0,
        Packaging: 0,
        Shipment: 0,
        Pickup: 0,
        Delivered: 0,
        Issued: 0,
      },
      payments: { awaitingPrepay: 0, awaitingRest: 0, disputes: 0, avgCheckUAH: 0 },
      logistics: { new: 0, inTransit: 0, delivered: 0, problem: 0, byCarrier: {} },
      materials: { filamentKg: 0, resinL: 0, reelsInUse: 0, lowThresholdKg: 1.0, low: [] },
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
        db: "down",
        redis: "down",
        indexer: "down",
      },
      indexer: { backlog: 0, lastIndexedAt: "—", ratePerMin: 0, shards: 1 },
      ingester: { batches: [], mediaBacklog: 0, mediaRatePerMin: 0, errors1h: 0, pricingVersion: "—" },
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

export default app;