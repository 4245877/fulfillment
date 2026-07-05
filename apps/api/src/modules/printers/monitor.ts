import type { FastifyInstance } from "fastify";

import { env } from "../../shared/env";
import { getTelegramConfig } from "../../infra/integrations/telegram/config";
import { enqueuePrinterNotification } from "../notifications/dispatcher";
import type {
  NotificationPhoto,
  PrinterNotificationPayload,
} from "../notifications/types";
import {
  getPrinterStatus,
  readPrintersConfig,
  type PrinterConfig,
  type PrinterStatus,
} from "./routes";
import { captureSnapshot, captureSnapshotViaOrchestrator } from "./snapshot";

export type PrinterTransitionKind =
  | "error"
  | "paused"
  | "filament_runout"
  | "completed"
  | "cancelled";

type LoggerLike = {
  info?: (obj: unknown, message?: string) => void;
  warn?: (obj: unknown, message?: string) => void;
  error?: (obj: unknown, message?: string) => void;
};

const COMPLETE_RE = /complete|finish|done/i;
const CANCEL_RE = /cancel|abort|stop/i;
// Firmware-reported pause/error reasons that mean the spool ran out. Covers
// Moonraker (`print_stats.message`), Klipper macros, Creality and common
// localisations so a runout is surfaced distinctly from a manual pause.
// Deliberately requires a runout-specific token: a bare "filament" must NOT
// match, otherwise a routine M600 colour change ("Filament change") would be
// mislabelled as a runout.
const FILAMENT_RUNOUT_RE =
  /runout|run\s*out|out of filament|закінч.*філ|нема.*філ/i;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Free-text the device offers as a reason for a pause/stop/error. */
function reasonText(status: PrinterStatus): string {
  return [status.stateText, status.stateMessage, status.error]
    .filter(Boolean)
    .join(" ");
}

function looksFilamentRunout(status: PrinterStatus): boolean {
  return FILAMENT_RUNOUT_RE.test(reasonText(status));
}

/**
 * True when an idle/stopped print was aborted rather than finished. Relies on
 * the device reporting a cancel/abort/stop state (Moonraker "cancelled",
 * Creality "stop"); a purely numeric idle state with no marker is
 * indistinguishable from completion and is left to `looksComplete`.
 */
function looksCancelled(status: PrinterStatus): boolean {
  return Boolean(status.stateText && CANCEL_RE.test(status.stateText));
}

function looksComplete(status: PrinterStatus): boolean {
  if (looksCancelled(status)) {
    return false;
  }

  if (status.stateText && COMPLETE_RE.test(status.stateText)) {
    return true;
  }

  return status.progressPct != null && status.progressPct >= 99;
}

/**
 * Decides whether the change from `prev` to `next` is worth a Telegram
 * notification. Returns `null` for the first observation, offline blips, and
 * any non-notable change so the monitor stays quiet between real events.
 */
export function classifyTransition(
  prev: PrinterStatus | undefined,
  next: PrinterStatus
): PrinterTransitionKind | null {
  // First time we see this printer: record a baseline, never alert. This also
  // avoids spurious alerts after an API restart for a pre-existing condition.
  if (!prev) {
    return null;
  }

  if (!next.online) {
    return null;
  }

  if (next.status === "error" && prev.status !== "error") {
    // Some firmwares surface a filament runout as an "error" rather than a
    // pause; classify it as a runout so the operator gets the actionable
    // message instead of a generic printer error.
    return looksFilamentRunout(next) ? "filament_runout" : "error";
  }

  if (next.status === "paused" && prev.status === "printing") {
    return looksFilamentRunout(next) ? "filament_runout" : "paused";
  }

  if (
    next.status === "idle" &&
    (prev.status === "printing" || prev.status === "paused")
  ) {
    if (looksCancelled(next)) {
      return "cancelled";
    }

    if (looksComplete(next)) {
      return "completed";
    }
  }

  return null;
}

export function buildPrinterNotificationPayload(
  status: PrinterStatus,
  kind: PrinterTransitionKind,
  occurredAt: string
): PrinterNotificationPayload {
  return {
    kind,
    printer: {
      id: status.id,
      name: status.name,
      model: status.model || null,
    },
    status: status.status,
    stateText: status.stateText ?? null,
    currentFile: status.currentFile ?? null,
    progressPct: status.progressPct ?? null,
    errorMessage:
      kind === "completed" || kind === "cancelled"
        ? null
        : status.error || status.stateMessage || null,
    occurredAt,
    photo: null,
  };
}

export type PollPrintersOptions = {
  snapshotEnabled?: boolean;
  snapshotTimeoutMs?: number;
  snapshotMaxBytes?: number;
  /** When set, capture snapshots through the atelier orchestrator (see capturePhoto). */
  snapshotOrchestratorUrl?: string | null;
  logger?: LoggerLike;
};

// Extra time the orchestrator may need over a direct capture: it can switch the
// chamber light on and wait for it to come up before grabbing the frame.
const ORCHESTRATOR_SNAPSHOT_EXTRA_MS = 3000;

const lastStatusByPrinter = new Map<string, PrinterStatus>();

export function resetPrinterMonitorState() {
  lastStatusByPrinter.clear();
}

async function capturePhoto(
  printer: PrinterConfig,
  options: PollPrintersOptions
): Promise<NotificationPhoto | null> {
  const orchestratorUrl = options.snapshotOrchestratorUrl?.trim();

  // Prefer the orchestrator's light-aware capture when configured: it turns the
  // chamber light on before grabbing the frame at night, which this API cannot
  // do on its own. Fall back to a direct device capture if it is unreachable,
  // does not know the printer, or returns no frame.
  let snapshot = orchestratorUrl
    ? await captureSnapshotViaOrchestrator(orchestratorUrl, printer, {
        timeoutMs:
          options.snapshotTimeoutMs != null
            ? options.snapshotTimeoutMs + ORCHESTRATOR_SNAPSHOT_EXTRA_MS
            : undefined,
        maxBytes: options.snapshotMaxBytes,
      })
    : null;

  if (!snapshot) {
    snapshot = await captureSnapshot(printer, {
      timeoutMs: options.snapshotTimeoutMs,
      maxBytes: options.snapshotMaxBytes,
    });
  }

  if (!snapshot) {
    return null;
  }

  return {
    base64: snapshot.base64,
    mime: snapshot.mime,
    filename: `${printer.id}.jpg`,
  };
}

/**
 * Polls every enabled printer once, detects notable transitions and enqueues a
 * Telegram notification (with a camera snapshot when available). Returns the
 * number of notifications enqueued.
 */
export async function pollPrintersOnce(
  options: PollPrintersOptions = {}
): Promise<number> {
  const printers = (await readPrintersConfig()).filter(
    (printer) => printer.enabled !== false
  );

  // Drop baselines for printers no longer enabled/configured so the map can't
  // grow without bound as printers come and go. A printer re-enabled later is
  // then treated as a fresh first observation (no spurious alert).
  const activeIds = new Set(printers.map((printer) => printer.id));
  for (const knownId of lastStatusByPrinter.keys()) {
    if (!activeIds.has(knownId)) {
      lastStatusByPrinter.delete(knownId);
    }
  }

  let enqueued = 0;

  for (const printer of printers) {
    let status: PrinterStatus;

    try {
      status = await getPrinterStatus(printer);
    } catch (error) {
      options.logger?.warn?.(
        { printerId: printer.id, error: getErrorMessage(error) },
        "Printer status poll failed"
      );
      continue;
    }

    const prev = lastStatusByPrinter.get(printer.id);
    lastStatusByPrinter.set(printer.id, status);

    const kind = classifyTransition(prev, status);
    if (!kind) {
      continue;
    }

    const payload = buildPrinterNotificationPayload(
      status,
      kind,
      new Date().toISOString()
    );

    if (options.snapshotEnabled ?? true) {
      try {
        payload.photo = await capturePhoto(printer, options);
      } catch (error) {
        options.logger?.warn?.(
          { printerId: printer.id, error: getErrorMessage(error) },
          "Printer snapshot capture failed"
        );
      }
    }

    try {
      await enqueuePrinterNotification(payload);
      enqueued += 1;
    } catch (error) {
      options.logger?.error?.(
        { printerId: printer.id, error: getErrorMessage(error) },
        "Failed to enqueue printer notification"
      );
    }
  }

  return enqueued;
}

export function registerPrinterMonitorWorker(app: FastifyInstance) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const run = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      const enqueued = await pollPrintersOnce({
        snapshotEnabled: env.PRINTER_SNAPSHOT_ENABLED,
        snapshotTimeoutMs: env.PRINTER_SNAPSHOT_TIMEOUT_MS,
        snapshotMaxBytes: env.PRINTER_SNAPSHOT_MAX_BYTES,
        snapshotOrchestratorUrl: env.PRINTER_SNAPSHOT_ORCHESTRATOR_URL,
        logger: app.log,
      });

      if (enqueued > 0) {
        app.log.info({ enqueued }, "Printer monitor enqueued notifications");
      }
    } catch (error) {
      app.log.error(
        { error: getErrorMessage(error) },
        "Printer monitor failed"
      );
    } finally {
      running = false;
    }
  };

  app.addHook("onReady", async () => {
    if (!env.PRINTER_MONITOR_ENABLED) {
      app.log.info("Printer monitor is disabled");
      return;
    }

    if (!getTelegramConfig().enabled) {
      app.log.info(
        "Printer monitor requires Telegram notifications to be enabled"
      );
      return;
    }

    timer = setInterval(() => {
      void run();
    }, env.PRINTER_MONITOR_POLL_INTERVAL_MS);

    void run();
  });

  app.addHook("onClose", async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}
