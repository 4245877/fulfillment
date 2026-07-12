import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Knex } from "knex";

import {
  claimOutboxEvents,
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
import { TelegramClient } from "../../infra/integrations/telegram/client";
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

type DispatchOptions = {
  client?: TelegramClient;
  config?: TelegramConfig;
  limit?: number;
  logger?: LoggerLike;
};

type DispatchResult = {
  enabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
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
    await client.sendPhoto({
      chatId: config.chatId,
      messageThreadId,
      // Defensive net on top of the per-field clamps in the templates: a media
      // caption tops out at 1024 chars, beyond which Telegram returns a
      // non-retryable 400.
      caption: clampTelegramText(text, TELEGRAM_CAPTION_LIMIT),
      parseMode: "HTML",
      photo: Buffer.from(photo.base64, "base64"),
      mimeType: photo.mime,
      filename: photo.filename || undefined,
    });
    return;
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

  const client =
    options.client ??
    new TelegramClient({
      botToken: config.botToken,
      timeoutMs: config.requestTimeoutMs,
    });

  const events = await claimOutboxEvents({
    eventTypes: NOTIFICATION_EVENT_TYPE_VALUES,
    limit: options.limit ?? env.NOTIFICATIONS_BATCH_SIZE,
  });

  const result: DispatchResult = {
    enabled: true,
    claimed: events.length,
    sent: 0,
    failed: 0,
  };

  for (const event of events) {
    try {
      await sendNotificationEvent(event, client, config);
      await markOutboxEventSent(event.id);
      result.sent += 1;
    } catch (error) {
      await markOutboxEventFailed(event, error, {
        retryAfterMs: getNotificationRetryAfterMs(error),
        retryable: isRetryableNotificationError(error),
        maxAttempts: env.NOTIFICATIONS_MAX_ATTEMPTS,
      });
      result.failed += 1;

      options.logger?.error?.(
        { eventId: event.id, error: getErrorMessage(error) },
        "Failed to dispatch Telegram notification"
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

export function registerNotificationOutboxWorker(app: FastifyInstance) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const run = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      const result = await dispatchPendingNotifications({ logger: app.log });

      if (result.enabled && result.claimed > 0) {
        app.log.info(result, "Telegram notification dispatch completed");
      }
    } catch (error) {
      app.log.error({ error: getErrorMessage(error) }, "Notification worker failed");
    } finally {
      running = false;
    }
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
    const config = getTelegramConfig();

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
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}
