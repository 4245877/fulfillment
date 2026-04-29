import type { FastifyInstance } from "fastify";
import mqtt from "mqtt";

type PrinterProtocol = "moonraker" | "bambu" | "creality";

type PrinterConfig = {
  id: string;
  name: string;
  protocol: PrinterProtocol;
  host: string;
  port?: number;
  enabled?: boolean;
  apiKey?: string;
  serial?: string;
  accessCode?: string;
};

type PrinterStatus = {
  id: string;
  name: string;
  protocol: PrinterProtocol;
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

function readPrintersConfig(): PrinterConfig[] {
  try {
    const raw = process.env.PRINTERS_CONFIG_JSON || "[]";
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeOfflineStatus(printer: PrinterConfig, error: string): PrinterStatus {
  return {
    id: printer.id,
    name: printer.name,
    protocol: printer.protocol,
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
  };
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

    return {
      id: printer.id,
      name: printer.name,
      protocol: printer.protocol,
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
    };
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
          ? `${print.layer_num}/${print.total_layer_num} слой`
          : null;

      bambuCache.set(printer.id, {
        id: printer.id,
        name: printer.name,
        protocol: printer.protocol,
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
      });
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
    bambuCache.get(printer.id) || {
      id: printer.id,
      name: printer.name,
      protocol: printer.protocol,
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
    }
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

    ws.addEventListener("open", () => {
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

    ws.addEventListener("message", (event) => {
      try {
        const raw = String(event.data);

        if (!raw || raw === "ok") {
          return;
        }

        const data = JSON.parse(raw);

        const progress =
          data.printProgress !== undefined ? Number(data.printProgress) : null;

        const status = normalizeCrealityState(data.state);

        finish({
          id: printer.id,
          name: printer.name,
          protocol: printer.protocol,
          online: true,
          status,
          currentFile: data.printFileName || null,
          progressPct: Number.isFinite(progress) ? progress : null,
          printed: data.printJobTime ? String(data.printJobTime) : null,
          remainingMinutes:
            data.printLeftTime !== undefined && data.printLeftTime !== null
              ? Math.round(Number(data.printLeftTime) / 60)
              : null,
          nozzleTemp:
            data.nozzleTemp !== undefined ? Number(data.nozzleTemp) : null,
          bedTemp: data.bedTemp0 !== undefined ? Number(data.bedTemp0) : null,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        finish(
          makeOfflineStatus(
            printer,
            err instanceof Error ? err.message : String(err)
          )
        );
      }
    });

    ws.addEventListener("error", () => {
      finish(makeOfflineStatus(printer, "Creality WebSocket error"));
    });

    ws.addEventListener("close", () => {
      clearTimeout(timeout);
    });
  });
}

export default async function printersRoutes(app: FastifyInstance) {
  app.get("/status", async () => {
    const printers = readPrintersConfig().filter(
      (printer) => printer.enabled !== false
    );

    const statuses = await Promise.all(
      printers.map(async (printer) => {
        try {
          if (printer.protocol === "moonraker") {
            return await getMoonrakerStatus(printer);
          }

          if (printer.protocol === "bambu") {
            return await getBambuStatus(printer);
          }

          if (printer.protocol === "creality") {
            return await getCrealityStatus(printer);
          }

          return makeOfflineStatus(printer, "Unsupported printer protocol");
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