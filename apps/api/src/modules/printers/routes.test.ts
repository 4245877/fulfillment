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
const bambuStatusWaiters = new Map<
  string,
  Set<(status: PrinterStatus | null) => void>
>();

const SECRET_MASK = "********";
const BAMBU_FIRST_STATUS_WAIT_MS = 4500;

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
  bambuStatusWaiters.delete(printerId);
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

export function mergeBambuStatus(
  previous: PrinterStatus | undefined,
  next: PrinterStatus
): PrinterStatus {
  if (!previous || !previous.online || !next.online) return next;

  return {
    ...previous,
    ...next,
    status: next.status === "unknown" ? previous.status : next.status,
    currentFile: next.currentFile ?? previous.currentFile,
    progressPct: next.progressPct ?? previous.progressPct,
    printed: next.printed ?? previous.printed,
    remainingMinutes: next.remainingMinutes ?? previous.remainingMinutes,
    nozzleTemp: next.nozzleTemp ?? previous.nozzleTemp,
    bedTemp: next.bedTemp ?? previous.bedTemp,
    error: next.error,
    updatedAt: next.updatedAt,
  };
}

function setBambuCache(printerId: string, status: PrinterStatus) {
  status = mergeBambuStatus(bambuCache.get(printerId), status);
  bambuCache.set(printerId, status);

  const waiters = bambuStatusWaiters.get(printerId);
  if (!waiters) return;

  bambuStatusWaiters.delete(printerId);

  for (const resolve of waiters) {
    resolve(status);
  }
}

function waitForBambuStatus(printerId: string, timeoutMs: number) {
  return new Promise<PrinterStatus | null>((resolve) => {
    const cached = bambuCache.get(printerId);
    if (cached) {
      resolve(cached);
      return;
    }

    const waiters = bambuStatusWaiters.get(printerId) || new Set();
    let timeout: NodeJS.Timeout | null = null;

    const done = (status: PrinterStatus | null) => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      waiters.delete(done);

      if (waiters.size === 0) {
        bambuStatusWaiters.delete(printerId);
      }

      resolve(status);
    };

    waiters.add(done);
    bambuStatusWaiters.set(printerId, waiters);

    timeout = setTimeout(() => done(null), timeoutMs);
  });
}

function toStatusState(value: unknown): PrinterStatus["status"] {
  const state = String(value || "").toLowerCase();

  if (
    ["printing", "running", "prepare", "preparing", "heating"].includes(state)
  ) {
    return "printing";
  }
  if (["paused", "pause", "pausing"].includes(state)) return "paused";
  if (
    [
      "complete",
      "standby",
      "idle",
      "finished",
      "finish",
      "cancel",
      "cancelled",
      "canceled",
    ].includes(state)
  ) {
    return "idle";
  }
  if (["error", "failed", "failure"].includes(state)) return "error";

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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = toFiniteNumber(value);
    if (numberValue !== null) return numberValue;
  }

  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null) continue;

    const text = String(value).trim();
    if (text) return text;
  }

  return "";
}

function getBambuPrintPayload(payload: unknown): Record<string, unknown> | null {
  if (!isObject(payload)) return null;

  if (isObject(payload.print)) return payload.print;

  if (
    "gcode_state" in payload ||
    "mc_percent" in payload ||
    "nozzle_temper" in payload
  ) {
    return payload;
  }

  if (isObject(payload.payload) && isObject(payload.payload.print)) {
    return payload.payload.print;
  }

  if (isObject(payload.data) && isObject(payload.data.print)) {
    return payload.data.print;
  }

  return null;
}

export function buildBambuStatusFromPayload(
  printer: PrinterConfig,
  payload: unknown
): PrinterStatus | null {
  const print = getBambuPrintPayload(payload);
  if (!print) return null;

  const layerNum = firstFiniteNumber(print.layer_num, print.layerNum);
  const totalLayerNum = firstFiniteNumber(
    print.total_layer_num,
    print.totalLayerNum
  );

  const layer =
    layerNum !== null && totalLayerNum !== null
      ? `${Math.round(layerNum)}/${Math.round(totalLayerNum)} шар`
      : null;

  const progressPct = firstFiniteNumber(
    print.mc_percent,
    print.progress,
    print.print_progress,
    print.printProgress,
    print.progress_percent,
    print.progressPercent
  );

  const remainingMinutes = firstFiniteNumber(
    print.mc_remaining_time,
    print.remaining_time,
    print.remainingTime
  );

  const nozzleTemp = firstFiniteNumber(
    print.nozzle_temper,
    print.nozzle_temperature,
    print.nozzleTemp,
    print.hotend_temper,
    print.hotendTemp
  );

  const bedTemp = firstFiniteNumber(
    print.bed_temper,
    print.bed_temperature,
    print.bedTemp,
    print.heatbed_temper,
    print.heatbedTemp
  );

  const rawState = firstText(
    print.gcode_state,
    print.print_status,
    print.status,
    print.state
  );
  const currentFile = firstText(
    print.subtask_name,
    print.gcode_file,
    print.filename,
    print.file,
    print.task_name
  );

  if (
    !rawState &&
    !currentFile &&
    progressPct === null &&
    remainingMinutes === null &&
    nozzleTemp === null &&
    bedTemp === null &&
    layer === null
  ) {
    return null;
  }

  return addPrinterMeta(printer, {
    online: true,
    status: toStatusState(rawState),
    currentFile: currentFile || null,
    progressPct: progressPct !== null ? Math.round(progressPct) : null,
    printed: layer,
    remainingMinutes:
      remainingMinutes !== null ? Math.round(remainingMinutes) : null,
    nozzleTemp: nozzleTemp !== null ? Math.round(nozzleTemp) : null,
    bedTemp: bedTemp !== null ? Math.round(bedTemp) : null,
    updatedAt: new Date().toISOString(),
  });
}

export function getBambuMqttErrorMessage(error: Error | string) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("server unavailable")) {
    return `${message}. Bambu MQTT broker is reachable but refuses local monitoring. Enable LAN mode/local access on the printer and verify the printer is on the same LAN.`;
  }

  if (lower.includes("not authorized")) {
    return `${message}. Check the Bambu LAN access code; also verify that serial and accessCode are not swapped.`;
  }

  if (lower.includes("unacceptable protocol version")) {
    return `${message}. Bambu local MQTT requires MQTT 3.1.1.`;
  }

  return message || "Unknown Bambu MQTT error";
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
    setBambuCache(
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
      const status = buildBambuStatusFromPayload(printer, json);
      if (!status) return;

      setBambuCache(printer.id, status);
    } catch {
      // ignore bad mqtt payload
    }
  });

  client.on("error", (error) => {
    setBambuCache(
      printer.id,
      makeOfflineStatus(printer, getBambuMqttErrorMessage(error))
    );
  });

  bambuClients.set(printer.id, client);
}

async function getBambuStatus(
  printer: PrinterConfig,
  waitForFirstStatusMs = 0
): Promise<PrinterStatus> {
  ensureBambuClient(printer);

  const cached = bambuCache.get(printer.id);
  if (cached) return cached;

  if (waitForFirstStatusMs > 0) {
    const status = await waitForBambuStatus(printer.id, waitForFirstStatusMs);
    if (status) return status;
  }

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

async function getPrinterStatus(
  printer: PrinterConfig,
  options: { waitForBambuStatusMs?: number } = {}
): Promise<PrinterStatus> {
  if (printer.protocol === "moonraker") {
    return getMoonrakerStatus(printer);
  }

  if (printer.protocol === "bambu") {
    return getBambuStatus(printer, options.waitForBambuStatusMs ?? 0);
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

      const status = await getPrinterStatus(printer, {
        waitForBambuStatusMs: BAMBU_FIRST_STATUS_WAIT_MS,
      });

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