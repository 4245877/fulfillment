import type { FastifyInstance } from "fastify";
import type { Knex } from "knex";

import { env } from "../../shared/env";
import { isStaleStatus } from "./staleness";
import {
  createMemoryPrinterMonitorStateStore,
  printerMonitorStateStore,
  type PrinterMonitorStateStore,
} from "./monitorState";
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
  | "started"
  | "progress"
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

const COMPLETE_STATE_RE = /^(?:complete(?:d)?|finish(?:ed)?|done|success(?:ful(?:ly)?)?)[.!]?$/i;
const COMPLETE_MESSAGE_RE = /^(?:print(?:ing)?|job)\s+(?:(?:is|has|was)\s+)?(?:successfully\s+)?(?:complete(?:d)?|finish(?:ed)?|done)(?:\s+successfully)?[.!]?$/i;
const CANCEL_STATE_RE = /^(?:cancel(?:led|ed)?|abort(?:ed)?|stop(?:ped)?)(?:\s+by\s+(?:the\s+)?(?:user|operator))?[.!]?$/i;
const CANCEL_MESSAGE_RE = /^(?:print(?:ing)?|job)\s+(?:(?:is|has|was)\s+)?(?:cancel(?:led|ed)?|abort(?:ed)?|stop(?:ped)?)(?:\s+by\s+(?:the\s+)?(?:user|operator))?[.!]?$/i;
// Firmware-reported pause/error reasons that mean the spool ran out. Covers
// Moonraker (`print_stats.message`), Klipper macros, Creality and common
// localisations so a runout is surfaced distinctly from a manual pause.
// Deliberately requires a runout-specific token: a bare "filament" must NOT
// match, otherwise a routine M600 colour change ("Filament change") would be
// mislabelled as a runout.
const FILAMENT_RUNOUT_RE =
  /runout|run\s*out|out of filament|закінч.*філ|нема.*філ|законч.*фил|нет.*фил/i;

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
 * Creality "stop"). A numeric idle state without a terminal marker stays
 * ambiguous even when its previous job percentage lingers at 100.
 */
function looksCancelled(status: PrinterStatus): boolean {
  return [status.stateText, status.stateMessage].some((text) =>
    text != null && (CANCEL_STATE_RE.test(text.trim()) || CANCEL_MESSAGE_RE.test(text.trim()))
  );
}

function hasExplicitCompletion(status: PrinterStatus): boolean {
  // Error text and arbitrary prose such as "failed to complete" cannot prove
  // success. Accept firmware state markers or a complete success message.
  return [status.stateText, status.stateMessage].some((text) =>
    text != null && (COMPLETE_STATE_RE.test(text.trim()) || COMPLETE_MESSAGE_RE.test(text.trim()))
  );
}

function sameRun(prev: PrinterStatus, next: PrinterStatus): boolean {
  return Boolean(prev.activeRunId && next.activeRunId && prev.activeRunId === next.activeRunId);
}

function changedJob(prev: PrinterStatus, next: PrinterStatus): boolean {
  // Canonical run identity outranks display metadata: devices can enrich the
  // filename with a task title while the same print is already running.
  if (prev.activeRunId && next.activeRunId) return prev.activeRunId !== next.activeRunId;
  return Boolean(prev.currentFile && next.currentFile && prev.currentFile !== next.currentFile);
}

function resetPrintMetrics(prev: PrinterStatus, next: PrinterStatus): boolean {
  // Elapsed print time is monotonic; a percentage may recalculate downward
  // while the same job continues, so prefer the timer when both are known.
  if (prev.elapsedSeconds != null && next.elapsedSeconds != null) {
    return next.elapsedSeconds < prev.elapsedSeconds;
  }
  return prev.progressPct != null && next.progressPct != null && next.progressPct < prev.progressPct;
}

function progressMilestone(status: PrinterStatus): number {
  const progress = status.progressPct ?? 0;
  return progress >= 75 ? 75 : progress >= 50 ? 50 : progress >= 25 ? 25 : 0;
}

/** Classify fresh device transitions; a first observation establishes a baseline. */
export function classifyTransition(
  prev: PrinterStatus | undefined,
  next: PrinterStatus
): PrinterTransitionKind | null {
  if (!prev || !next.online || next.status === "unknown" || next.status === "offline") return null;

  if (next.status === "printing" && (prev.status === "idle" || changedJob(prev, next))) {
    return "started";
  }

  if (next.status === "error" && prev.status !== "error") {
    if (looksFilamentRunout(next)) return looksFilamentRunout(prev) ? null : "filament_runout";
    return "error";
  }

  if (
    (next.status === "paused" || next.status === "error") &&
    looksFilamentRunout(next) && !looksFilamentRunout(prev)
  ) return "filament_runout";

  if (next.status === "paused" && prev.status === "printing") return "paused";

  if (
    next.status === "idle" &&
    (prev.status === "printing" || prev.status === "paused" || prev.status === "error")
  ) {
    if (looksCancelled(next)) return "cancelled";
    // Match the orchestrator's outcome policy: a lingering percentage is
    // context, while only an explicit success marker can prove completion.
    if (hasExplicitCompletion(next)) return "completed";
  }

  return null;
}

export { isStaleStatus } from "./staleness";

/** A committed monotonic version identifies the event independently of device timestamps. */
export function buildPrinterEventDedupeKey(
  status: PrinterStatus,
  kind: PrinterTransitionKind,
  eventVersion: number
): string {
  return `notification:printer:${status.id}:${kind}:v${eventVersion}`;
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
    progressPct: kind === "completed" ? 100
      : status.progressPct != null && status.progressPct < 100 ? status.progressPct : null,
    remainingMinutes: kind === "completed" || kind === "cancelled"
      ? null : status.remainingMinutes ?? null,
    elapsedSeconds: status.elapsedSeconds ?? null,
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
    dedupeKey?: string | null,
    transaction?: Knex.Transaction
  ) => Promise<unknown>;
  /** Injectable durable store; custom enqueue handlers default to an in-memory store. */
  store?: PrinterMonitorStateStore;
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
  memoryStore: PrinterMonitorStateStore;
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
  memoryStore: createMemoryPrinterMonitorStateStore(),
  staleIds: new Set(),
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  outageNotified: false,
  pollInFlight: false,
  stats: freshStats(),
};

export function resetPrinterMonitorState() {
  state.memoryStore = createMemoryPrinterMonitorStateStore();
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
  const enqueueSafely = async (payload: CriticalErrorNotificationPayload): Promise<boolean> => {
    try {
      await enqueueCritical(payload);
      return true;
    } catch (error) {
      // Keep this alert armed for retry, but still classify every printer in
      // a successful poll: a terminal marker may disappear by the next one.
      options.logger?.error?.(
        { operation: "printer_monitor_availability_enqueue", alert: payload.name, error: getErrorMessage(error) },
        "Failed to enqueue orchestrator availability notification"
      );
      return false;
    }
  };

  if (outcome === "failed") {
    state.consecutiveFailures += 1;
    state.consecutiveSuccesses = 0;

    if (
      state.consecutiveFailures >= ORCHESTRATOR_DOWN_AFTER_FAILURES &&
      !state.outageNotified
    ) {
      options.logger?.error?.(
        {
          operation: "printer_monitor_outage",
          consecutiveFailures: state.consecutiveFailures,
          error: errorMessage,
        },
        "Print orchestrator outage confirmed"
      );
      state.outageNotified = await enqueueSafely({
        message:
          "Оркестратор печати недоступен — мониторинг принтеров не получает статусы.",
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
    options.logger?.info?.(
      { operation: "printer_monitor_recovery" },
      "Print orchestrator recovered"
    );
    if (await enqueueSafely({
      message:
        "Оркестратор печати снова доступен — мониторинг принтеров восстановлен.",
      name: "PrinterOrchestratorRecovered",
      occurredAt: new Date().toISOString(),
    })) state.outageNotified = false;
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

  // Keep baselines for temporarily missing printers. Removal from a poll is
  // a connectivity gap, not evidence that the active job disappeared.
  const store = options.store ?? (options.enqueue ? state.memoryStore : printerMonitorStateStore);

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

      // Offline and unknown reports cannot replace a known active job.
      if (!status.online || status.status === "unknown" || status.status === "offline") continue;

      const result = await store.withPrinter(status.id, async (record, save, transaction) => {
        const prev = record?.lastStatus;
        const previousTimestamp = Date.parse((record?.lastObservation ?? prev)?.updatedAt ?? "");
        const currentTimestamp = Date.parse(status.updatedAt ?? "");
        // A second worker may have obtained this snapshot before a newer one
        // was committed. Never let its delayed poll regress the baseline.
        if (Number.isFinite(previousTimestamp) && Number.isFinite(currentTimestamp) &&
          currentTimestamp < previousTimestamp) return null;

        let kind = classifyTransition(prev, status);
        if (!kind && prev && status.status === "printing" &&
          record?.lastObservation?.status === "idle" && !sameRun(prev, status) &&
          resetPrintMetrics(prev, status)) kind = "started";
        let milestone = record?.progressMilestone ?? 0;
        if (!prev || kind === "started") {
          // Existing runs seen for the first time stay quiet. A start includes
          // its actual progress, so passed milestones need no second message.
          milestone = progressMilestone(status);
        } else if (!kind && status.status === "printing" && (status.progressPct ?? 0) < 100 && progressMilestone(status) > milestone) {
          kind = "progress";
          milestone = progressMilestone(status);
        }

        // Keep the active job for a delayed terminal marker, and durably keep
        // the idle observation for timestamp ordering and same-file restarts.
        if (!kind && status.status === "idle" && prev && prev.status !== "idle") {
          await save({ lastStatus: prev, lastObservation: status,
            eventVersion: record?.eventVersion ?? 0, progressMilestone: milestone });
          return null;
        }

        const effectiveStatus: PrinterStatus = {
          ...status,
          currentFile: status.currentFile ?? (kind === "started" ? null : prev?.currentFile ?? null),
          activeRunId: status.activeRunId ?? (kind === "started" ? null : prev?.activeRunId ?? null),
        };
        const nextVersion = (record?.eventVersion ?? 0) + (kind ? 1 : 0);
        let payload: PrinterNotificationPayload | null = null;
        let event: { payload?: unknown } | undefined;
        if (kind) {
          const occurredAt = Number.isFinite(currentTimestamp)
            ? new Date(currentTimestamp).toISOString() : new Date().toISOString();
          payload = buildPrinterNotificationPayload(effectiveStatus, kind, occurredAt);
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
          event = (await enqueue(
            payload, buildPrinterEventDedupeKey(effectiveStatus, kind, nextVersion), transaction
          )) as { payload?: unknown } | undefined;
        }

        // In production this write and the outbox insert share one SQL
        // transaction. Failed enqueues leave the last good baseline intact.
        await save({ lastStatus: effectiveStatus, eventVersion: nextVersion, progressMilestone: milestone });
        return kind && payload ? { kind, payload, event } : null;
      });

      if (!result) continue;
      const { kind, payload, event } = result;
      const returnedOccurredAt =
        event && typeof event.payload === "object" && event.payload !== null && "occurredAt" in event.payload
          ? String((event.payload as { occurredAt?: unknown }).occurredAt)
          : null;
      const deduped = returnedOccurredAt !== null && returnedOccurredAt !== payload.occurredAt;
      if (deduped) state.stats.notificationsDeduped += 1;
      else state.stats.notificationsEnqueued += 1;
      options.logger?.info?.(
        { operation: "printer_monitor_event", printerId: status.id, eventKind: kind, deduped },
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

export function registerPrinterMonitorWorker(app: FastifyInstance, options: {
  client?: OrchestratorClient | null;
  poll?: typeof pollPrintersOnce;
} = {}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  // One long-lived client for the worker so shutdown can abort its in-flight
  // requests instead of waiting out their timeouts.
  let client: OrchestratorClient | null = null;

  const run = (): Promise<void> => {
    if (inFlight || stopped) return Promise.resolve();
    inFlight = (async () => {
      try {
        const startedAt = Date.now();
        const enqueued = await (options.poll ?? pollPrintersOnce)({
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

        if (enqueued > 0) app.log.info({ enqueued }, "Printer monitor enqueued notifications");
      } catch (error) {
        app.log.error({ error: getErrorMessage(error) }, "Printer monitor failed");
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
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

    client = options.client !== undefined ? options.client : createOrchestratorClientFromEnv();

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
    await inFlight;
    client = null;
  });
}
