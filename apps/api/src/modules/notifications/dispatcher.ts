import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Knex } from "knex";

import {
  claimOutboxEvents,
  deferOutboxEvent,
  enqueueOutboxEvent,
  markOutboxEventFailed,
  markOutboxEventSent,
  type OutboxEvent,
} from "../../core/outbox";
import { env } from "../../shared/env";
import {
  getTelegramConfig,
  type TelegramConfig,
} from "../../infra/integrations/telegram/config";
import { TelegramApiError, TelegramClient } from "../../infra/integrations/telegram/client";
import type { OrderRecord } from "../orders/types";
import type { ProductReport } from "../productReports/types";
import { routeNotificationToTopic, getTelegramMessageThreadId } from "./routing";
import {
  getNotificationRetryAfterMs,
  isRetryableNotificationError,
} from "./retry";
import {
  clampTelegramText,
  renderNotificationMessage,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
} from "./templates";
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_TYPE_VALUES,
  isNotificationEventType,
  type CriticalErrorNotificationPayload,
  type FilamentLowStockNotificationPayload,
  type NotificationEventType,
  type NotificationPayload,
  type NotificationPhoto,
  type NotificationTopicKey,
  type OrderNotificationKind,
  type OrderNotificationPayload,
  type PrinterNotificationKind,
  type PrinterNotificationPayload,
  type ProductReportNotificationPayload,
  type TestNotificationPayload,
} from "./types";

type DbLike = Knex | Knex.Transaction;

type LoggerLike = {
  info?: (obj: unknown, message?: string) => void;
  warn?: (obj: unknown, message?: string) => void;
  error?: (obj: unknown, message?: string) => void;
};

type NotificationOutboxStore = {
  claim: typeof claimOutboxEvents;
  markSent: typeof markOutboxEventSent;
  markFailed: typeof markOutboxEventFailed;
  defer: typeof deferOutboxEvent;
};

const notificationOutbox: NotificationOutboxStore = {
  claim: claimOutboxEvents,
  markSent: markOutboxEventSent,
  markFailed: markOutboxEventFailed,
  defer: deferOutboxEvent,
};

const TELEGRAM_AUTH_COOLDOWN_MS = 60_000;
const TELEGRAM_RATE_LIMIT_FALLBACK_MS = 60_000;
type TelegramBlockedReason = "telegram_unauthorized" | "telegram_forbidden" | "telegram_rate_limited";
let telegramCooldown: {
  botToken: string;
  until: number;
  reason: TelegramBlockedReason;
} | null = null;

type DispatchOptions = {
  client?: TelegramClient;
  config?: TelegramConfig;
  limit?: number;
  eventIds?: readonly string[];
  logger?: LoggerLike;
  outbox?: NotificationOutboxStore;
  shouldStop?: () => boolean;
};

type DispatchResult = {
  enabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
  blockedReason?: TelegramBlockedReason;
};

function nowIso() {
  return new Date().toISOString();
}

function orderSnapshot(order: OrderRecord): OrderNotificationPayload["order"] {
  return {
    id: order.id,
    shopOrderId: order.shop_order_id,
    source: order.source,
    status: order.status,
    customerName: order.customer_name,
    email: order.email,
    phone: order.phone,
    totalUah: order.total_uah,
    currency: order.currency,
    itemsCount: Array.isArray(order.items) ? order.items.length : 0,
    receivedAt: order.received_at ?? null,
    updatedAt: order.updated_at ?? null,
  };
}

function orderEventType(kind: OrderNotificationKind): NotificationEventType {
  if (kind === "received") {
    return NOTIFICATION_EVENT_TYPES.ORDER_RECEIVED;
  }

  if (kind === "synced") {
    return NOTIFICATION_EVENT_TYPES.ORDER_SYNCED;
  }

  return NOTIFICATION_EVENT_TYPES.ORDER_STATUS_CHANGED;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack || null : null;
}

export async function enqueueOrderNotification(
  kind: OrderNotificationKind,
  order: OrderRecord,
  details: {
    previousStatus?: string | null;
    nextStatus?: string | null;
    actor?: string | null;
    note?: string | null;
    eventId?: string | null;
  } = {},
  trx?: DbLike
): Promise<OutboxEvent> {
  const payload: OrderNotificationPayload = {
    event: kind,
    order: orderSnapshot(order),
    previousStatus: details.previousStatus ?? null,
    nextStatus: details.nextStatus ?? null,
    actor: details.actor ?? null,
    note: details.note ?? null,
  };

  return enqueueOutboxEvent(
    {
      eventType: orderEventType(kind),
      payload,
      dedupeKey: details.eventId
        ? `notification:order-event:${details.eventId}`
        : null,
    },
    trx
  );
}

export async function enqueueProductReportNotification(
  report: ProductReport,
  trx?: DbLike
): Promise<OutboxEvent> {
  const payload: ProductReportNotificationPayload = {
    report: {
      reportId: report.report_id,
      productId: report.product_id,
      productName: report.product_name || null,
      productSku: report.product_sku || null,
      reason: report.reason,
      comment: report.comment || null,
      pageUrl: report.page_url || null,
      source: report.source || null,
      userAgent: report.user_agent || null,
      referer: report.referer || null,
      createdAt: report.created_at,
    },
  };

  return enqueueOutboxEvent(
    {
      eventType: NOTIFICATION_EVENT_TYPES.PRODUCT_REPORT_CREATED,
      payload,
      dedupeKey: `notification:product-report:${report.report_id}`,
    },
    trx
  );
}

function printerEventType(kind: PrinterNotificationKind): NotificationEventType {
  if (kind === "started") return NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_STARTED;
  if (kind === "progress") return NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_PROGRESS;
  if (kind === "error") {
    return NOTIFICATION_EVENT_TYPES.PRINTER_ERROR;
  }

  if (kind === "paused") {
    return NOTIFICATION_EVENT_TYPES.PRINTER_PAUSED;
  }

  if (kind === "filament_runout") {
    return NOTIFICATION_EVENT_TYPES.PRINTER_FILAMENT_RUNOUT;
  }

  if (kind === "cancelled") {
    return NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_CANCELLED;
  }

  return NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_COMPLETED;
}

/**
 * Enqueues a printer transition for Telegram. `dedupeKey` (when given) makes
 * the enqueue idempotent at the outbox level: the same detected transition —
 * printer + kind + job + orchestrator status timestamp — inserts exactly one
 * row even if the monitor observes it twice (overlapping cycles, a re-poll of
 * the same orchestrator snapshot, a crash between enqueue and baseline save).
 */
export async function enqueuePrinterNotification(
  payload: PrinterNotificationPayload,
  dedupeKey?: string | null,
  trx?: DbLike
): Promise<OutboxEvent> {
  return enqueueOutboxEvent(
    {
      eventType: printerEventType(payload.kind),
      payload,
      dedupeKey: dedupeKey ?? null,
    },
    trx
  );
}

/**
 * Raised by the inventory service when a consumption drops a reel across a
 * warning threshold. Meant to be enqueued inside the inventory transaction (pass
 * `trx`) so the alert commits atomically with the stock movement that triggered
 * it. Edge-triggered upstream, so no dedupe key is needed here.
 */
export async function enqueueFilamentLowStockNotification(
  payload: FilamentLowStockNotificationPayload,
  trx?: DbLike
): Promise<OutboxEvent> {
  return enqueueOutboxEvent(
    {
      eventType: NOTIFICATION_EVENT_TYPES.INVENTORY_FILAMENT_LOW,
      payload,
    },
    trx
  );
}

/**
 * Collapses repeated critical errors with the same signature (message + URL +
 * status code) into a single notification per time window. Without this a hard
 * failure that makes every request return 500 (e.g. the DB is down) would post
 * hundreds of messages, hit Telegram's 429 limit and amplify the load.
 */
function criticalErrorDedupeKey(
  payload: CriticalErrorNotificationPayload
): string {
  const windowMs = Math.max(1, env.NOTIFICATIONS_CRITICAL_DEDUPE_WINDOW_MS);
  const bucket = Math.floor(Date.now() / windowMs);
  const signature = createHash("sha1")
    .update(
      [payload.statusCode ?? 500, payload.method ?? "", payload.url ?? "", payload.message]
        .join("\n")
    )
    .digest("hex");

  return `notification:critical-error:${signature}:${bucket}`;
}

export async function enqueueCriticalErrorNotification(
  payload: CriticalErrorNotificationPayload
): Promise<OutboxEvent> {
  return enqueueOutboxEvent({
    eventType: NOTIFICATION_EVENT_TYPES.SYSTEM_CRITICAL_ERROR,
    payload,
    dedupeKey: criticalErrorDedupeKey(payload),
  });
}

export async function enqueueTelegramTopicTestNotifications() {
  const requestedAt = nowIso();
  const topics: NotificationTopicKey[] = [
    "orders",
    "productReports",
    "prints",
    "criticalErrors",
  ];

  return Promise.all(
    topics.map((topic) => {
      const payload: TestNotificationPayload = {
        topic,
        label: `test-${topic}-${requestedAt}`,
        requestedAt,
      };

      return enqueueOutboxEvent({
        eventType: NOTIFICATION_EVENT_TYPES.TEST,
        payload,
      });
    })
  );
}

function getNotificationPhoto(
  payload: NotificationPayload
): NotificationPhoto | null {
  const photo = (payload as PrinterNotificationPayload).photo;

  if (!photo || typeof photo.base64 !== "string" || !photo.base64) {
    return null;
  }

  return photo;
}

async function sendNotificationEvent(
  event: OutboxEvent,
  client: TelegramClient,
  config: TelegramConfig
) {
  if (!isNotificationEventType(event.event_type)) {
    throw new Error(`Unsupported notification event type: ${event.event_type}`);
  }

  const eventType = event.event_type;
  const payload = event.payload as NotificationPayload;
  const topic = routeNotificationToTopic(eventType, payload);
  const messageThreadId = getTelegramMessageThreadId(config, topic);
  const text = renderNotificationMessage(eventType, payload);
  const photo = getNotificationPhoto(payload);

  if (photo) {
    try {
      await client.sendPhoto({
        chatId: config.chatId,
        messageThreadId,
        caption: clampTelegramText(text, TELEGRAM_CAPTION_LIMIT),
        parseMode: "HTML",
        photo: Buffer.from(photo.base64, "base64"),
        mimeType: photo.mime,
        filename: photo.filename || undefined,
      });
      return;
    } catch (error) {
      // A rejected camera image must not discard the print event. Only fall
      // back after a definitive media rejection: on a timeout the photo may
      // already have been delivered, so sending text would create a duplicate.
      if (
        !(error instanceof TelegramApiError) ||
        (error.statusCode !== 400 && error.telegramErrorCode !== 400) ||
        !/(?:PHOTO_INVALID_DIMENSIONS|IMAGE_PROCESS_FAILED|wrong (?:type|file)|invalid (?:photo|image)|photo (?:is|must)|file (?:is too big|must be non-empty)|failed to (?:process|decode) (?:photo|image))/i.test(error.message)
      ) {
        throw error;
      }
    }
  }

  await client.sendMessage({
    chatId: config.chatId,
    messageThreadId,
    text: clampTelegramText(text, TELEGRAM_MESSAGE_LIMIT),
    parseMode: "HTML",
    disableWebPagePreview: true,
  });
}

export async function dispatchPendingNotifications(
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const config = options.config ?? getTelegramConfig();

  if (!config.enabled) {
    return { enabled: false, claimed: 0, sent: 0, failed: 0 };
  }

  if (
    telegramCooldown?.botToken === config.botToken &&
    Date.now() < telegramCooldown.until
  ) {
    return { enabled: true, claimed: 0, sent: 0, failed: 0, blockedReason: telegramCooldown.reason };
  }

  const client =
    options.client ??
    new TelegramClient({
      botToken: config.botToken,
      timeoutMs: config.requestTimeoutMs,
    });

  const outbox = options.outbox ?? notificationOutbox;
  const limit = Math.max(1, Math.min(options.limit ?? env.NOTIFICATIONS_BATCH_SIZE, 100));
  const result: DispatchResult = {
    enabled: true,
    claimed: 0,
    sent: 0,
    failed: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    if (options.shouldStop?.()) break;
    if (telegramCooldown?.botToken === config.botToken && Date.now() < telegramCooldown.until) {
      result.blockedReason = telegramCooldown.reason;
      break;
    }
    // Claim immediately before sending. Locking an entire slow batch up front
    // lets its later rows expire and be sent concurrently by another worker.
    const [event] = await outbox.claim({
      eventTypes: NOTIFICATION_EVENT_TYPE_VALUES,
      eventIds: options.eventIds,
      limit: 1,
      // A definitive media rejection may require a second text request.
      lockTimeoutMs: Math.max(120_000, 2 * config.requestTimeoutMs + 30_000),
    });
    if (!event) break;
    result.claimed += 1;
    if (options.shouldStop?.()) {
      await outbox.defer(event, new Error("Notification worker is shutting down"), 0);
      break;
    }
    // A concurrent manual dispatch can discover a bot cooldown while this
    // claim is in flight. Release it rather than making another rejected send.
    if (telegramCooldown?.botToken === config.botToken && Date.now() < telegramCooldown.until) {
      result.blockedReason = telegramCooldown.reason;
      await outbox.defer(event, new Error("Telegram delivery cooldown is active"),
        telegramCooldown.until - Date.now());
      break;
    }

    try {
      await sendNotificationEvent(event, client, config);
    } catch (error) {
      result.failed += 1;
      options.logger?.error?.(
        { eventId: event.id, error: getErrorMessage(error) },
        "Failed to dispatch Telegram notification"
      );
      const unauthorized = error instanceof TelegramApiError &&
        (error.statusCode === 401 || error.telegramErrorCode === 401);
      const forbidden = error instanceof TelegramApiError &&
        (error.statusCode === 403 || error.telegramErrorCode === 403);
      const rateLimited = error instanceof TelegramApiError &&
        (error.statusCode === 429 || error.telegramErrorCode === 429);
      if (unauthorized || forbidden || rateLimited) {
        // Integration rejection affects subsequent deliveries. Preserve retry budgets and
        // honour Telegram's cooldown before claiming another queued event.
        const delayMs = unauthorized || forbidden ? TELEGRAM_AUTH_COOLDOWN_MS :
          getNotificationRetryAfterMs(error) ?? TELEGRAM_RATE_LIMIT_FALLBACK_MS;
        result.blockedReason = unauthorized ? "telegram_unauthorized" :
          forbidden ? "telegram_forbidden" : "telegram_rate_limited";
        telegramCooldown = {
          botToken: config.botToken,
          until: Date.now() + delayMs,
          reason: result.blockedReason,
        };
        try {
          await outbox.defer(event, error, delayMs);
        } catch (persistError) {
          options.logger?.error?.(
            { eventId: event.id, error: getErrorMessage(persistError) },
            "Failed to defer Telegram notification after integration rejection"
          );
        }
        break;
      }
      try {
        await outbox.markFailed(event, error, {
          retryAfterMs: getNotificationRetryAfterMs(error),
          retryable: isRetryableNotificationError(error),
          maxAttempts: env.NOTIFICATIONS_MAX_ATTEMPTS,
        });
      } catch (persistError) {
        // Keep the row leased for crash recovery, but don't let one failed
        // database update strand every other event in the batch.
        options.logger?.error?.(
          { eventId: event.id, error: getErrorMessage(persistError) },
          "Failed to persist Telegram notification failure"
        );
      }
      continue;
    }

    // Telegram has confirmed delivery. Retry the database acknowledgement,
    // never the send, if persisting that result fails.
    let acknowledged = false;
    let acknowledgementError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        acknowledged = await outbox.markSent(event);
        if (!acknowledged) {
          acknowledgementError = new Error("Outbox delivery lease is no longer owned by this worker");
        }
        break;
      } catch (error) {
        acknowledgementError = error;
      }
    }
    if (acknowledged) {
      result.sent += 1;
    } else {
      result.failed += 1;
      options.logger?.error?.(
        { eventId: event.id, error: getErrorMessage(acknowledgementError) },
        "Telegram delivery confirmed but outbox acknowledgement failed; delivery may repeat after lease recovery"
      );
    }
  }

  return result;
}

function criticalPayloadFromError(
  error: unknown,
  req: FastifyRequest,
  statusCode: number
): CriticalErrorNotificationPayload {
  return {
    message: getErrorMessage(error),
    name: error instanceof Error ? error.name : null,
    stack: getErrorStack(error),
    statusCode,
    method: req.method,
    url: req.url,
    requestId: req.id,
    occurredAt: nowIso(),
  };
}

export function registerNotificationOutboxWorker(
  app: FastifyInstance,
  options: { dispatch?: typeof dispatchPendingNotifications; config?: TelegramConfig } = {}
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let activeRun: Promise<void> | null = null;
  let closing = false;

  const run = () => {
    if (closing || activeRun) return;
    activeRun = (async () => {
      try {
        const result = await (options.dispatch ?? dispatchPendingNotifications)({
          logger: app.log,
          config: options.config,
          shouldStop: () => closing,
        });
        if (result.enabled && result.claimed > 0) {
          app.log.info(result, "Telegram notification dispatch completed");
        }
      } catch (error) {
        app.log.error({ error: getErrorMessage(error) }, "Notification worker failed");
      }
    })().finally(() => { activeRun = null; });
  };

  app.setErrorHandler(async (error, req, reply) => {
    const statusCode = Number((error as any)?.statusCode || 500);

    if (statusCode >= 500) {
      // Always log: a custom handler replaces Fastify's default, so without
      // this the 5xx stack would silently vanish from the logs.
      app.log.error(
        { err: error, reqId: req.id, method: req.method, url: req.url, statusCode },
        "Unhandled request error"
      );

      // Only enqueue when the worker can actually drain the outbox. With
      // Telegram disabled the dispatch worker never starts, so enqueuing here
      // would pile up critical-error rows that are never sent nor surfaced.
      if (getTelegramConfig().enabled) {
        try {
          await enqueueCriticalErrorNotification(
            criticalPayloadFromError(error, req, statusCode)
          );
        } catch (enqueueError) {
          app.log.error(
            { error: getErrorMessage(enqueueError) },
            "Failed to enqueue critical error notification"
          );
        }
      }
    }

    reply.code(statusCode);
    return {
      // Never leak internal 5xx details to the client; client errors keep their
      // descriptive message.
      error:
        statusCode >= 500 ? "Internal Server Error" : getErrorMessage(error),
    };
  });

  app.addHook("onReady", async () => {
    const config = options.config ?? getTelegramConfig();

    if (!config.enabled) {
      app.log.info("Telegram notifications are disabled");
      return;
    }

    timer = setInterval(() => {
      void run();
    }, env.NOTIFICATIONS_POLL_INTERVAL_MS);

    void run();
  });

  app.addHook("onClose", async () => {
    closing = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await activeRun;
  });
}
