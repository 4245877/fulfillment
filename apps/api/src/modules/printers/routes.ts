import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import mqtt from "mqtt";
import WebSocket from "ws";

type PrinterProtocol = "moonraker" | "bambu" | "creality";

type PrinterConfig = {
  id: string;
  name: string;
  model?: string;
  imageUrl?: string;

  protocol: PrinterProtocol;
  host: string;
  port?: number;

  deviceUi?: string;
  profile?: string;
  material?: string;
  nozzle?: string;

  enabled?: boolean;
  apiKey?: string;
  serial?: string;
  accessCode?: string;
};

type PrinterStatus = {
  id: string;
  name: string;
  model?: string;
  imageUrl?: string;

  protocol: PrinterProtocol;
  host?: string;
  port?: number;
  deviceUi?: string;
  profile?: string;
  material?: string;
  nozzle?: string;

  online: boolean;
  status: "idle" | "printing" | "paused" | "error" | "offline" | "unknown";
  currentFile: string | null;
  progressPct: number | null;
  printed: string | null;
  remainingMinutes: number | null;
  nozzleTemp: number | null;
  bedTemp: number | null;
  updatedAt: string;
  error?: string;
};

const bambuCache = new Map<string, PrinterStatus>();
const bambuClients = new Map<string, mqtt.MqttClient>();

const SECRET_MASK = "********";

const PRINTERS_CONFIG_PATH =
  process.env.PRINTERS_CONFIG_PATH ||
  path.resolve(process.cwd(), "data", "printers.json");

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizePrinterConfig(printer: PrinterConfig): PrinterConfig {
  return {
    ...printer,
    apiKey: printer.apiKey ? SECRET_MASK : "",
    accessCode: printer.accessCode ? SECRET_MASK : "",
  };
}

function restoreMaskedSecrets(
  value: unknown,
  existing?: PrinterConfig
): unknown {
  if (!isObject(value) || !existing) return value;

  return {
    ...value,
    apiKey: value.apiKey === SECRET_MASK ? existing.apiKey : value.apiKey,
    accessCode:
      value.accessCode === SECRET_MASK ? existing.accessCode : value.accessCode,
  };
}

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!expectedToken && process.env.NODE_ENV === "production") {
    return reply.code(500).send({
      error: "ADMIN_TOKEN is not configured",
    });
  }

  if (!expectedToken) return null;

  const token = getHeaderValue(request.headers["x-admin-token"]);

  if (token !== expectedToken) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }

  return null;
}

function resetBambuClient(printerId: string) {
  const client = bambuClients.get(printerId);

  if (client) {
    client.end(true);
  }

  bambuClients.delete(printerId);
  bambuCache.delete(printerId);
}

function resetBambuClients() {
  for (const printerId of bambuClients.keys()) {
    resetBambuClient(printerId);
  }
}

function normalizeProtocol(value: unknown): PrinterProtocol {
  const protocol = String(value || "moonraker").trim().toLowerCase();

  if (protocol === "bambu") return "bambu";
  if (protocol === "creality") return "creality";

  return "moonraker";
}

function normalizePrinterConfig(value: unknown): PrinterConfig | null {
  if (!isObject(value)) return null;

  const id = String(value.id || "").trim();
  const name = String(value.name || "").trim();
  const host = String(value.host || "").trim();

  if (!id || !name || !host) {
    return null;
  }

  const portValue = Number(value.port);

  return {
    id,
    name,
    model: String(value.model || "").trim(),
    imageUrl: String(value.imageUrl || "").trim(),

    protocol: normalizeProtocol(value.protocol),
    host,
    port: Number.isFinite(portValue) && portValue > 0 ? portValue : undefined,

    deviceUi: String(value.deviceUi || "").trim(),
    profile: String(value.profile || "").trim(),
    material: String(value.material || "").trim(),
    nozzle: String(value.nozzle || "").trim(),

    enabled: value.enabled !== false,

    apiKey: String(value.apiKey || "").trim(),
    serial: String(value.serial || "").trim(),
    accessCode: String(value.accessCode || "").trim(),
  };
}

function readPrintersConfigFromEnv(): PrinterConfig[] {
  try {
    const raw = process.env.PRINTERS_CONFIG_JSON || "[]";
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizePrinterConfig)
      .filter((printer): printer is PrinterConfig => Boolean(printer));
  } catch {
    return [];
  }
}

async function readPrintersConfig(): Promise<PrinterConfig[]> {
  try {
    const raw = await fs.readFile(PRINTERS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizePrinterConfig)
      .filter((printer): printer is PrinterConfig => Boolean(printer));
  } catch {
    return readPrintersConfigFromEnv();
  }
}

async function writePrintersConfig(printers: PrinterConfig[]) {
  await fs.mkdir(path.dirname(PRINTERS_CONFIG_PATH), { recursive: true });
  await fs.writeFile(
    PRINTERS_CONFIG_PATH,
    JSON.stringify(printers, null, 2),
    "utf8"
  );
}

function addPrinterMeta(
  printer: PrinterConfig,
  status: Omit<
    PrinterStatus,
    | "id"
    | "name"
    | "model"
    | "imageUrl"
    | "protocol"
    | "host"
    | "port"
    | "deviceUi"
    | "profile"
    | "material"
    | "nozzle"
  >
): PrinterStatus {
  return {
    id: printer.id,
    name: printer.name,
    model: printer.model,
    imageUrl: printer.imageUrl,
    protocol: printer.protocol,
    host: printer.host,
    port: printer.port,
    deviceUi: printer.deviceUi,
    profile: printer.profile,
    material: printer.material,
    nozzle: printer.nozzle,
    ...status,
  };
}

function makeOfflineStatus(printer: PrinterConfig, error: string): PrinterStatus {
  return addPrinterMeta(printer, {
    online: false,
    status: "offline",
    currentFile: null,
    progressPct: null,
    printed: null,
    remainingMinutes: null,
    nozzleTemp: null,
    bedTemp: null,
    updatedAt: new Date().toISOString(),
    error,
  });
}

function toStatusState(value: unknown): PrinterStatus["status"] {
  const state = String(value || "").toLowerCase();

  if (["printing", "running"].includes(state)) return "printing";
  if (["paused", "pause"].includes(state)) return "paused";
  if (["complete", "standby", "idle", "finished", "finish"].includes(state)) {
    return "idle";
  }
  if (["error", "failed"].includes(state)) return "error";

  return "unknown";
}

function estimateRemainingMinutes(
  progressPct: number | null,
  elapsedSec: number | null
) {
  if (!progressPct || progressPct <= 0 || !elapsedSec) return null;

  const totalSec = elapsedSec / (progressPct / 100);
  const remainingSec = Math.max(0, totalSec - elapsedSec);

  return Math.round(remainingSec / 60);
}

async function getMoonrakerStatus(
  printer: PrinterConfig
): Promise<PrinterStatus> {
  const port = printer.port ?? 80;
  const baseUrl = `http://${printer.host}:${port}`;

  const url =
    `${baseUrl}/printer/objects/query` +
    `?print_stats` +
    `&virtual_sdcard` +
    `&display_status` +
    `&extruder` +
    `&heater_bed`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: printer.apiKey ? { "X-Api-Key": printer.apiKey } : undefined,
    });

    if (!res.ok) {
      throw new Error(`Moonraker HTTP ${res.status}`);
    }

    const json = await res.json();
    const status = json?.result?.status || {};

    const printStats = status.print_stats || {};
    const virtualSd = status.virtual_sdcard || {};
    const displayStatus = status.display_status || {};
    const extruder = status.extruder || {};
    const bed = status.heater_bed || {};

    const progressPct =
      typeof virtualSd.progress === "number"
        ? Math.round(virtualSd.progress * 100)
        : typeof displayStatus.progress === "number"
          ? Math.round(displayStatus.progress * 100)
          : null;

    const elapsedSec =
      typeof printStats.print_duration === "number"
        ? printStats.print_duration
        : null;

    return addPrinterMeta(printer, {
      online: true,
      status: toStatusState(printStats.state),
      currentFile: printStats.filename || null,
      progressPct,
      printed: null,
      remainingMinutes: estimateRemainingMinutes(progressPct, elapsedSec),
      nozzleTemp:
        typeof extruder.temperature === "number"
          ? Math.round(extruder.temperature)
          : null,
      bedTemp:
        typeof bed.temperature === "number" ? Math.round(bed.temperature) : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return makeOfflineStatus(
      printer,
      error instanceof Error ? error.message : "Unknown Moonraker error"
    );
  } finally {
    clearTimeout(timeout);
  }
}

function ensureBambuClient(printer: PrinterConfig) {
  if (!printer.serial || !printer.accessCode) {
    bambuCache.set(
      printer.id,
      makeOfflineStatus(printer, "Bambu serial/accessCode is not configured")
    );

    return;
  }

  if (bambuClients.has(printer.id)) return;

  const port = printer.port ?? 8883;
  const client = mqtt.connect(`mqtts://${printer.host}:${port}`, {
    username: "bblp",
    password: printer.accessCode,
    rejectUnauthorized: false,
    connectTimeout: 3500,
    reconnectPeriod: 5000,
  });

  const reportTopic = `device/${printer.serial}/report`;
  const requestTopic = `device/${printer.serial}/request`;

  client.on("connect", () => {
    client.subscribe(reportTopic);

    client.publish(
      requestTopic,
      JSON.stringify({
        pushing: {
          sequence_id: String(Date.now()),
          command: "pushall",
        },
      })
    );
  });

  client.on("message", (_topic, payload) => {
    try {
      const json = JSON.parse(payload.toString());
      const print = json?.print || {};

      const layer =
        print.layer_num && print.total_layer_num
          ? `${print.layer_num}/${print.total_layer_num} шар`
          : null;

      bambuCache.set(
        printer.id,
        addPrinterMeta(printer, {
          online: true,
          status: toStatusState(print.gcode_state),
          currentFile: print.subtask_name || print.gcode_file || null,
          progressPct:
            typeof print.mc_percent === "number"
              ? Math.round(print.mc_percent)
              : null,
          printed: layer,
          remainingMinutes:
            typeof print.mc_remaining_time === "number"
              ? Math.round(print.mc_remaining_time)
              : null,
          nozzleTemp:
            typeof print.nozzle_temper === "number"
              ? Math.round(print.nozzle_temper)
              : null,
          bedTemp:
            typeof print.bed_temper === "number"
              ? Math.round(print.bed_temper)
              : null,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      // ignore bad mqtt payload
    }
  });

  client.on("error", (error) => {
    bambuCache.set(printer.id, makeOfflineStatus(printer, error.message));
  });

  bambuClients.set(printer.id, client);
}

async function getBambuStatus(printer: PrinterConfig): Promise<PrinterStatus> {
  ensureBambuClient(printer);

  return (
    bambuCache.get(printer.id) ||
    addPrinterMeta(printer, {
      online: false,
      status: "unknown",
      currentFile: null,
      progressPct: null,
      printed: null,
      remainingMinutes: null,
      nozzleTemp: null,
      bedTemp: null,
      updatedAt: new Date().toISOString(),
      error: "Waiting for Bambu MQTT status",
    })
  );
}

function normalizeCrealityState(state: unknown): PrinterStatus["status"] {
  const value = String(state ?? "").toLowerCase();

  if (value === "1" || value.includes("print")) return "printing";
  if (value === "5" || value.includes("pause")) return "paused";
  if (value === "0" || value.includes("stop") || value.includes("idle")) {
    return "idle";
  }
  if (value.includes("error") || value.includes("fail")) return "error";

  return "unknown";
}

function getCrealityStatus(printer: PrinterConfig): Promise<PrinterStatus> {
  const port = printer.port ?? 9999;
  const url = `ws://${printer.host}:${port}`;

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let settled = false;

    const finish = (status: PrinterStatus) => {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);

      try {
        ws?.close();
      } catch {
        // ignore
      }

      resolve(status);
    };

    const timeout = setTimeout(() => {
      finish(makeOfflineStatus(printer, "Creality WebSocket timeout"));
    }, 2500);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      finish(
        makeOfflineStatus(
          printer,
          err instanceof Error ? err.message : String(err)
        )
      );
      return;
    }

    ws.on("open", () => {
      try {
        ws?.send(
          JSON.stringify({
            ModeCode: "heart_beat",
            msg: new Date().toISOString(),
          })
        );
      } catch {
        // ignore
      }
    });

    ws.on("message", (data) => {
      try {
        const raw = data.toString();

        if (!raw || raw === "ok") {
          return;
        }

        const parsed = JSON.parse(raw);

        const progress =
          parsed.printProgress !== undefined
            ? Number(parsed.printProgress)
            : null;

        finish(
          addPrinterMeta(printer, {
            online: true,
            status: normalizeCrealityState(parsed.state),
            currentFile: parsed.printFileName || null,
            progressPct: Number.isFinite(progress) ? progress : null,
            printed: parsed.printJobTime ? String(parsed.printJobTime) : null,
            remainingMinutes:
              parsed.printLeftTime !== undefined && parsed.printLeftTime !== null
                ? Math.round(Number(parsed.printLeftTime) / 60)
                : null,
            nozzleTemp:
              parsed.nozzleTemp !== undefined ? Number(parsed.nozzleTemp) : null,
            bedTemp:
              parsed.bedTemp0 !== undefined ? Number(parsed.bedTemp0) : null,
            updatedAt: new Date().toISOString(),
          })
        );
      } catch (err) {
        finish(
          makeOfflineStatus(
            printer,
            err instanceof Error ? err.message : String(err)
          )
        );
      }
    });

    ws.on("error", () => {
      finish(makeOfflineStatus(printer, "Creality WebSocket error"));
    });

    ws.on("close", () => {
      if (!settled) {
        finish(makeOfflineStatus(printer, "Creality WebSocket closed"));
      }
    });
  });
}

async function getPrinterStatus(printer: PrinterConfig): Promise<PrinterStatus> {
  if (printer.protocol === "moonraker") {
    return getMoonrakerStatus(printer);
  }

  if (printer.protocol === "bambu") {
    return getBambuStatus(printer);
  }

  if (printer.protocol === "creality") {
    return getCrealityStatus(printer);
  }

  return makeOfflineStatus(printer, "Unsupported printer protocol");
}

function sendBadRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    error: message,
  });
}

export default async function printersRoutes(app: FastifyInstance) {
  app.get("/config", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    const printers = await readPrintersConfig();

    return {
      printers: printers.map(sanitizePrinterConfig),
    };
  });

  app.post(
    "/config",
    async (
      request: FastifyRequest<{ Body: { printers?: unknown } }>,
      reply
    ) => {
      const denied = requireAdmin(request, reply);
      if (denied) return denied;

      const rawPrinters = request.body?.printers;

      if (!Array.isArray(rawPrinters)) {
        return sendBadRequest(reply, "printers must be an array");
      }

      const currentPrinters = await readPrintersConfig();
      const currentById = new Map(
        currentPrinters.map((printer) => [printer.id, printer])
      );

      const printers = rawPrinters
        .map((value) => {
          const id = isObject(value) ? String(value.id || "").trim() : "";
          return restoreMaskedSecrets(value, currentById.get(id));
        })
        .map(normalizePrinterConfig)
        .filter((printer): printer is PrinterConfig => Boolean(printer));

      if (printers.length !== rawPrinters.length) {
        return sendBadRequest(
          reply,
          "Кожен принтер має містити id, name та host"
        );
      }

      const ids = new Set<string>();

      for (const printer of printers) {
        if (ids.has(printer.id)) {
          return sendBadRequest(reply, `Duplicate printer id: ${printer.id}`);
        }

        ids.add(printer.id);
      }

      await writePrintersConfig(printers);

      resetBambuClients();

      return {
        printers: printers.map(sanitizePrinterConfig),
      };
    }
  );

  app.post(
    "/test",
    async (request: FastifyRequest<{ Body: unknown }>, reply) => {
      const denied = requireAdmin(request, reply);
      if (denied) return denied;

      const body = request.body;
      const bodyId = isObject(body) ? String(body.id || "").trim() : "";

      const currentPrinters = await readPrintersConfig();
      const existing = currentPrinters.find((printer) => printer.id === bodyId);

      const restored = restoreMaskedSecrets(body, existing);
      const printer = normalizePrinterConfig(restored);

      if (!printer) {
        return sendBadRequest(
          reply,
          "Printer config requires id, name and host"
        );
      }

      const status = await getPrinterStatus(printer);

      return {
        ok: status.online && !status.error,
        status,
      };
    }
  );

  app.get("/status", async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    const printers = (await readPrintersConfig()).filter(
      (printer) => printer.enabled !== false
    );

    const statuses = await Promise.all(
      printers.map(async (printer) => {
        try {
          return await getPrinterStatus(printer);
        } catch (err) {
          return makeOfflineStatus(
            printer,
            err instanceof Error ? err.message : String(err)
          );
        }
      })
    );

    return { printers: statuses };
  });
}