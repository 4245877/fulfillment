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
import { captureSnapshot } from "./snapshot";

export type PrinterTransitionKind = "error" | "paused" | "completed";

type LoggerLike = {
  info?: (obj: unknown, message?: string) => void;
  warn?: (obj: unknown, message?: string) => void;
  error?: (obj: unknown, message?: string) => void;
};

const COMPLETE_RE = /complete|finish|done/i;
const CANCEL_RE = /cancel|abort|stop/i;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function looksComplete(status: PrinterStatus): boolean {
  if (status.stateText && CANCEL_RE.test(status.stateText)) {
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
    return "error";
  }

  if (next.status === "paused" && prev.status === "printing") {
    return "paused";
  }

  if (
    next.status === "idle" &&
    (prev.status === "printing" || prev.status === "paused") &&
    looksComplete(next)
  ) {
    return "completed";
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
      kind === "completed"
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
  logger?: LoggerLike;
};

const lastStatusByPrinter = new Map<string, PrinterStatus>();

export function resetPrinterMonitorState() {
  lastStatusByPrinter.clear();
}

async function capturePhoto(
  printer: PrinterConfig,
  options: PollPrintersOptions
): Promise<NotificationPhoto | null> {
  const snapshot = await captureSnapshot(printer, {
    timeoutMs: options.snapshotTimeoutMs,
    maxBytes: options.snapshotMaxBytes,
  });

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
