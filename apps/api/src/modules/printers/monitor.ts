import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { env } from "../../shared/env";
import { isStaleStatus } from "./staleness";
import { getTelegramConfig } from "../../infra/integrations/telegram/config";
import {
  createOrchestratorClientFromEnv,
  OrchestratorError,
  type OrchestratorClient,
  type OrchestratorPrinterStatus,
} from "../../infra/integrations/orchestrator/client";
import {
  enqueueCriticalErrorNotification,
  enqueuePrinterNotification,
} from "../notifications/dispatcher";
import type {
  CriticalErrorNotificationPayload,
  NotificationPhoto,
  PrinterNotificationPayload,
} from "../notifications/types";

/** The status shape the monitor classifies — as delivered by the orchestrator. */
export type PrinterStatus = OrchestratorPrinterStatus;

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
 *
 * Deliberate conservatism around connectivity gaps: while a printer is offline
 * its baseline becomes the offline status, and an idle→(anything) edge after a
 * reconnect matches no completion/cancel branch — a print that ended while the
 * link was down is reported late by a real fresh transition or not at all,
 * never invented from the gap.
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

export { isStaleStatus } from "./staleness";

/**
 * Deterministic outbox dedupe key for one detected transition. Encodes the
 * printer, the event kind, the job and the orchestrator's own status timestamp
 * — so re-processing the same orchestrator snapshot (overlapping cycles, a
 * crash between enqueue and baseline update) cannot enqueue twice, while a
 * genuine re-print of the same file later produces a different key. Statuses
 * without updatedAt fall back to a one-minute wall-clock bucket.
 */
export function buildPrinterEventDedupeKey(
  status: PrinterStatus,
  kind: PrinterTransitionKind,
  nowMs: number = Date.now()
): string {
  const jobHash = createHash("sha1")
    .update(status.currentFile ?? "")
    .digest("hex")
    .slice(0, 12);

  const stamp = status.updatedAt ?? `bucket:${Math.floor(nowMs / 60_000)}`;

  return `notification:printer:${status.id}:${kind}:${jobHash}:${stamp}`;
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
  /** Age after which an orchestrator status is too old to classify. */
  staleAfterMs?: number;
  logger?: LoggerLike;
  /** Injectable for tests; defaults to the env-configured orchestrator client. */
  client?: OrchestratorClient | null;
  /** Injectable for tests; defaults to the real Telegram outbox enqueue. */
  enqueue?: (
    payload: PrinterNotificationPayload,
    dedupeKey?: string | null
  ) => Promise<unknown>;
  /** Injectable for tests; defaults to the critical-errors outbox enqueue. */
  enqueueCritical?: (
    payload: CriticalErrorNotificationPayload
  ) => Promise<unknown>;
};

// Extra time the orchestrator may need over a plain image fetch: it can switch
// the chamber light on and wait for it to come up before grabbing the frame.
const ORCHESTRATOR_SNAPSHOT_EXTRA_MS = 3000;

// How many consecutive failed polls confirm the orchestrator is down. One
// blip (restart, GC pause) must not page the operator; a confirmed outage
// produces exactly one critical alert.
const ORCHESTRATOR_DOWN_AFTER_FAILURES = 3;

// How many consecutive successful polls confirm a recovery. Requiring more
// than one keeps a flapping link (ok, fail, ok, fail…) from alternating
// outage/recovery messages: a single lucky poll inside an outage neither
// announces recovery nor re-arms the outage alert.
const ORCHESTRATOR_RECOVERED_AFTER_SUCCESSES = 2;

/** Live counters for ops/diagnostics; reset only with the process. */
export type PrinterMonitorStats = {
  /** Whether an orchestrator URL is configured at all. */
  configured: boolean;
  cyclesTotal: number;
  cyclesFailed: number;
  /** Cycles skipped because the previous one was still running. */
  overlapsSkipped: number;
  lastCycleStartedAt: string | null;
  lastCycleDurationMs: number | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  /** True between the outage alert and the confirmed recovery. */
  outageActive: boolean;
  notificationsEnqueued: number;
  /** Enqueues collapsed by the outbox dedupe key (same transition seen twice). */
  notificationsDeduped: number;
  /** Per-printer freshness from the last successful cycle. */
  printers: Array<{
    id: string;
    status: PrinterStatus["status"];
    online: boolean;
    stale: boolean;
    updatedAt: string | null;
  }>;
};

type MonitorState = {
  lastStatusByPrinter: Map<string, PrinterStatus>;
  /** Printer ids currently skipped as stale, to log the edge once. */
  staleIds: Set<string>;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  outageNotified: boolean;
  pollInFlight: boolean;
  stats: PrinterMonitorStats;
};

function freshStats(): PrinterMonitorStats {
  return {
    configured: false,
    cyclesTotal: 0,
    cyclesFailed: 0,
    overlapsSkipped: 0,
    lastCycleStartedAt: null,
    lastCycleDurationMs: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    outageActive: false,
    notificationsEnqueued: 0,
    notificationsDeduped: 0,
    printers: [],
  };
}

const state: MonitorState = {
  lastStatusByPrinter: new Map(),
  staleIds: new Set(),
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  outageNotified: false,
  pollInFlight: false,
  stats: freshStats(),
};

export function resetPrinterMonitorState() {
  state.lastStatusByPrinter.clear();
  state.staleIds.clear();
  state.consecutiveFailures = 0;
  state.consecutiveSuccesses = 0;
  state.outageNotified = false;
  state.pollInFlight = false;
  state.stats = freshStats();
}

/** A snapshot of the monitor's live counters for /api/ops/overview. */
export function getPrinterMonitorStats(): PrinterMonitorStats {
  return {
    ...state.stats,
    configured: Boolean(env.PRINTER_ORCHESTRATOR_URL),
    consecutiveFailures: state.consecutiveFailures,
    outageActive: state.outageNotified,
    printers: state.stats.printers.map((printer) => ({ ...printer })),
  };
}

async function capturePhoto(
  client: OrchestratorClient,
  printerId: string,
  options: PollPrintersOptions
): Promise<NotificationPhoto | null> {
  // The orchestrator owns light control and the night schedule: ensureLight
  // switches the chamber light on before capturing so night photos are not
  // dark. There is deliberately no direct-to-camera fallback — the
  // orchestrator is the only device owner.
  const snapshot = await client.fetchSnapshot(printerId, {
    ensureLight: true,
    timeoutMs:
      options.snapshotTimeoutMs != null
        ? options.snapshotTimeoutMs + ORCHESTRATOR_SNAPSHOT_EXTRA_MS
        : undefined,
    maxBytes: options.snapshotMaxBytes,
  });

  if (!snapshot) {
    return null;
  }

  return {
    base64: snapshot.data.toString("base64"),
    mime: snapshot.mime,
    filename: `${printerId}.jpg`,
  };
}

/**
 * Raises exactly one critical alert per confirmed orchestrator outage and one
 * recovery message when it stays up again. Between those, repeated failures
 * are only logged — never re-sent to Telegram.
 *
 * The alert text is deliberately STABLE (no failure counter, no raw error):
 * the critical-errors outbox dedupes by message signature within a time
 * window, so even a monitor restart mid-outage cannot double-send the alert
 * inside that window. Details go to the structured log instead.
 */
async function trackOrchestratorAvailability(
  outcome: "ok" | "failed",
  errorMessage: string | null,
  options: PollPrintersOptions
): Promise<void> {
  const enqueueCritical =
    options.enqueueCritical ?? enqueueCriticalErrorNotification;

  if (outcome === "failed") {
    state.consecutiveFailures += 1;
    state.consecutiveSuccesses = 0;

    if (
      state.consecutiveFailures >= ORCHESTRATOR_DOWN_AFTER_FAILURES &&
      !state.outageNotified
    ) {
      state.outageNotified = true;
      options.logger?.error?.(
        {
          operation: "printer_monitor_outage",
          consecutiveFailures: state.consecutiveFailures,
          error: errorMessage,
        },
        "Print orchestrator outage confirmed"
      );
      await enqueueCritical({
        message:
          "Оркестратор друку недоступний — моніторинг принтерів не отримує статуси.",
        name: "PrinterOrchestratorUnavailable",
        occurredAt: new Date().toISOString(),
      });
    }
    return;
  }

  state.consecutiveFailures = 0;
  state.consecutiveSuccesses += 1;

  if (
    state.outageNotified &&
    state.consecutiveSuccesses >= ORCHESTRATOR_RECOVERED_AFTER_SUCCESSES
  ) {
    state.outageNotified = false;
    options.logger?.info?.(
      { operation: "printer_monitor_recovery" },
      "Print orchestrator recovered"
    );
    await enqueueCritical({
      message:
        "Оркестратор друку знову доступний — моніторинг принтерів відновлено.",
      name: "PrinterOrchestratorRecovered",
      occurredAt: new Date().toISOString(),
    });
  }
}

/**
 * Polls the orchestrator once for every printer's status, detects notable
 * transitions and enqueues a Telegram notification (with a camera snapshot
 * when available). Returns the number of notifications enqueued.
 *
 * Safety properties:
 *  - never runs concurrently with itself (an overlapping call returns 0);
 *  - a stale status (old orchestrator `updatedAt`) is never classified and
 *    never overwrites the last fresh baseline;
 *  - every enqueue carries a deterministic dedupe key, so the same transition
 *    cannot produce two outbox rows;
 *  - a failing printer only skips its own notification; an unreachable
 *    orchestrator skips the cycle and is reported once per confirmed outage.
 */
export async function pollPrintersOnce(
  options: PollPrintersOptions = {}
): Promise<number> {
  if (state.pollInFlight) {
    state.stats.overlapsSkipped += 1;
    options.logger?.warn?.(
      { operation: "printer_monitor_poll" },
      "Printer poll cycle skipped: previous cycle still running"
    );
    return 0;
  }

  state.pollInFlight = true;
  const startedAtMs = Date.now();
  state.stats.cyclesTotal += 1;
  state.stats.lastCycleStartedAt = new Date(startedAtMs).toISOString();

  try {
    return await pollPrintersCycle(options);
  } finally {
    state.stats.lastCycleDurationMs = Date.now() - startedAtMs;
    state.pollInFlight = false;
  }
}

async function pollPrintersCycle(options: PollPrintersOptions): Promise<number> {
  const client =
    options.client !== undefined
      ? options.client
      : createOrchestratorClientFromEnv();

  if (!client) {
    options.logger?.warn?.(
      {},
      "Printer monitor has no orchestrator configured (PRINTER_ORCHESTRATOR_URL)"
    );
    return 0;
  }

  const enqueue = options.enqueue ?? enqueuePrinterNotification;
  const staleAfterMs = options.staleAfterMs ?? env.PRINTER_STATUS_STALE_MS;

  let statuses: PrinterStatus[];
  try {
    statuses = await client.listPrinterStatuses();
  } catch (error) {
    const message = getErrorMessage(error);
    state.stats.cyclesFailed += 1;
    options.logger?.warn?.(
      {
        operation: "printer_monitor_poll",
        error: message,
        errorKind: error instanceof OrchestratorError ? error.kind : "unknown",
        consecutiveFailures: state.consecutiveFailures + 1,
      },
      "Printer status poll via orchestrator failed"
    );
    await trackOrchestratorAvailability("failed", message, options);
    return 0;
  }

  state.stats.lastSuccessAt = new Date().toISOString();
  await trackOrchestratorAvailability("ok", null, options);

  // Drop baselines for printers no longer reported so the map can't grow
  // without bound as printers come and go. A printer re-added later is then
  // treated as a fresh first observation (no spurious alert).
  const activeIds = new Set(statuses.map((printer) => printer.id));
  for (const knownId of state.lastStatusByPrinter.keys()) {
    if (!activeIds.has(knownId)) {
      state.lastStatusByPrinter.delete(knownId);
      state.staleIds.delete(knownId);
    }
  }

  const nowMs = Date.now();
  state.stats.printers = statuses.map((status) => ({
    id: status.id,
    status: status.status,
    online: status.online,
    stale: isStaleStatus(status, staleAfterMs, nowMs),
    updatedAt: status.updatedAt,
  }));

  let enqueued = 0;

  for (const status of statuses) {
    // One printer's failure (snapshot, enqueue) must never stop the loop for
    // the remaining printers.
    try {
      // A stale status means the orchestrator's own poll loop has stopped
      // producing fresh data for this printer. Classifying it could turn the
      // freeze/unfreeze into a fake transition, so we keep the last FRESH
      // baseline and stay silent until fresh data returns; the real
      // transition (if any) is then computed against that fresh baseline.
      if (isStaleStatus(status, staleAfterMs, nowMs)) {
        if (!state.staleIds.has(status.id)) {
          state.staleIds.add(status.id);
          options.logger?.warn?.(
            {
              operation: "printer_monitor_stale",
              printerId: status.id,
              updatedAt: status.updatedAt,
              staleAfterMs,
            },
            "Printer status is stale; transitions suspended for this printer"
          );
        }
        continue;
      }
      state.staleIds.delete(status.id);

      const prev = state.lastStatusByPrinter.get(status.id);
      state.lastStatusByPrinter.set(status.id, status);

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
          payload.photo = await capturePhoto(client, status.id, options);
        } catch (error) {
          options.logger?.warn?.(
            { printerId: status.id, error: getErrorMessage(error) },
            "Printer snapshot capture failed"
          );
        }
      }

      const dedupeKey = buildPrinterEventDedupeKey(status, kind, nowMs);
      const event = (await enqueue(payload, dedupeKey)) as
        | { payload?: unknown }
        | undefined;

      // The outbox collapses duplicate dedupe keys into the existing row; the
      // returned row then carries the FIRST payload, not ours. Detect that to
      // count dedupes (diagnostics only — either way exactly one Telegram
      // message will leave the outbox).
      const returnedOccurredAt =
        event &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        "occurredAt" in event.payload
          ? String((event.payload as { occurredAt?: unknown }).occurredAt)
          : null;

      if (returnedOccurredAt !== null && returnedOccurredAt !== payload.occurredAt) {
        state.stats.notificationsDeduped += 1;
      } else {
        state.stats.notificationsEnqueued += 1;
      }

      options.logger?.info?.(
        {
          operation: "printer_monitor_event",
          printerId: status.id,
          eventKind: kind,
          deduped: returnedOccurredAt !== null && returnedOccurredAt !== payload.occurredAt,
        },
        "Printer transition enqueued"
      );
      enqueued += 1;
    } catch (error) {
      options.logger?.error?.(
        { printerId: status.id, error: getErrorMessage(error) },
        "Failed to enqueue printer notification"
      );
    }
  }

  return enqueued;
}

export function registerPrinterMonitorWorker(app: FastifyInstance) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let stopped = false;
  // One long-lived client for the worker so shutdown can abort its in-flight
  // requests instead of waiting out their timeouts.
  let client: OrchestratorClient | null = null;

  const run = async () => {
    if (running || stopped) {
      return;
    }

    running = true;

    try {
      const startedAt = Date.now();
      const enqueued = await pollPrintersOnce({
        snapshotEnabled: env.PRINTER_SNAPSHOT_ENABLED,
        snapshotTimeoutMs: env.PRINTER_SNAPSHOT_TIMEOUT_MS,
        snapshotMaxBytes: env.PRINTER_SNAPSHOT_MAX_BYTES,
        logger: app.log,
        client,
      });
      const durationMs = Date.now() - startedAt;

      if (durationMs > env.PRINTER_MONITOR_POLL_INTERVAL_MS) {
        app.log.warn(
          {
            operation: "printer_monitor_poll",
            durationMs,
            intervalMs: env.PRINTER_MONITOR_POLL_INTERVAL_MS,
          },
          "Printer poll cycle took longer than the poll interval"
        );
      }

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

    if (!env.PRINTER_ORCHESTRATOR_URL) {
      app.log.warn(
        "Printer monitor requires PRINTER_ORCHESTRATOR_URL (atelier print-orchestrator)"
      );
      return;
    }

    client = createOrchestratorClientFromEnv();

    timer = setInterval(() => {
      void run();
    }, env.PRINTER_MONITOR_POLL_INTERVAL_MS);

    void run();
  });

  app.addHook("onClose", async () => {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // Abort any in-flight orchestrator request so shutdown never hangs on a
    // dead upstream.
    client?.close();
    client = null;
  });
}
