import net from "node:net";

import { checkDbConnection } from "../../infra/db/knex";
import {
  createOrchestratorClientFromEnv,
  type OrchestratorPrinterStatus,
} from "../../infra/integrations/orchestrator/client";

// Status vocabulary consumed by the dashboard "Стан сервісів" panel:
//   up       — healthy
//   degraded — partially available (some sub-units down)
//   down     — unreachable / failing
//   unknown  — not checkable in this deployment (no probe configured)
export type ServiceStatus = "up" | "degraded" | "down" | "unknown";

export type ServicesHealth = {
  shop: ServiceStatus;
  fulfillment: ServiceStatus;
  /** The atelier print-orchestrator — the only owner of printer hardware. */
  orchestrator: ServiceStatus;
  printers: ServiceStatus;
  db: ServiceStatus;
  redis: ServiceStatus;
};

const SHOP_TIMEOUT_MS = 3000;
const REDIS_TIMEOUT_MS = 1500;
// Must comfortably cover the orchestrator client's own request timeout.
const PRINTERS_TIMEOUT_MS = 6000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

// Shop API lives on a separate server (192.168.0.135). We never assume it is
// down: without a configured probe URL its state is genuinely unknown, so we
// report "unknown" rather than a false red alarm.
async function checkShop(): Promise<ServiceStatus> {
  const url = process.env.SHOP_HEALTHCHECK_URL?.trim();
  if (!url) return "unknown";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHOP_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok ? "up" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

// Redis is probed with a raw TCP connect (no client library is bundled). If no
// host is configured the service is not part of this deployment -> "unknown".
async function checkRedis(): Promise<ServiceStatus> {
  const host = process.env.REDIS_HOST?.trim();
  if (!host) return "unknown";

  const port = Number(process.env.REDIS_PORT) || 6379;

  return new Promise<ServiceStatus>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (status: ServiceStatus) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(REDIS_TIMEOUT_MS);
    socket.once("connect", () => finish("up"));
    socket.once("timeout", () => finish("down"));
    socket.once("error", () => finish("down"));
    socket.connect(port, host);
  });
}

/**
 * Aggregates the orchestrator-reported printer list into one service status:
 *   no printers configured -> unknown
 *   all online             -> up
 *   some online            -> degraded
 *   none online            -> down
 */
export function summarizePrintersHealth(
  printers: OrchestratorPrinterStatus[]
): ServiceStatus {
  if (printers.length === 0) return "unknown";

  const onlineCount = printers.filter(
    (printer) => printer.online && !printer.error
  ).length;

  if (onlineCount === 0) return "down";
  if (onlineCount < printers.length) return "degraded";
  return "up";
}

/**
 * One HTTP request to the atelier orchestrator answers for both rows: its own
 * availability and the printer network state. No device (Moonraker/MQTT/WS/
 * camera) is ever probed from here. When the orchestrator cannot be reached
 * the printers are honestly "unknown" — we have no way to know their state.
 */
async function checkOrchestratorAndPrinters(): Promise<{
  orchestrator: ServiceStatus;
  printers: ServiceStatus;
}> {
  // Single attempt: a health probe must fit its PRINTERS_TIMEOUT_MS budget
  // and report "down" honestly — the client's default retry would stretch a
  // connect-timeout outage past the budget and degrade the answer to
  // "unknown" instead.
  const client = createOrchestratorClientFromEnv({ retries: 0 });
  if (!client) {
    return { orchestrator: "unknown", printers: "unknown" };
  }

  try {
    const printers = await client.listPrinterStatuses();
    return { orchestrator: "up", printers: summarizePrintersHealth(printers) };
  } catch {
    return { orchestrator: "down", printers: "unknown" };
  }
}

export async function getServicesHealth(): Promise<ServicesHealth> {
  const [db, farm, shop, redis] = await Promise.all([
    withTimeout(checkDbConnection(), 2000, false),
    withTimeout(checkOrchestratorAndPrinters(), PRINTERS_TIMEOUT_MS, {
      orchestrator: "unknown" as ServiceStatus,
      printers: "unknown" as ServiceStatus,
    }),
    checkShop(),
    checkRedis(),
  ]);

  return {
    // The fulfillment API is this very process answering the request.
    fulfillment: "up",
    db: db ? "up" : "down",
    orchestrator: farm.orchestrator,
    printers: farm.printers,
    shop,
    redis,
  };
}
