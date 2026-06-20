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
import { renderNotificationMessage } from "./templates";
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_TYPE_VALUES,
  isNotificationEventType,
  type CriticalErrorNotificationPayload,
  type NotificationEventType,
  type NotificationPayload,
  type NotificationTopicKey,
  type OrderNotificationKind,
  type OrderNotificationPayload,
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

export async function enqueueCriticalErrorNotification(
  payload: CriticalErrorNotificationPayload
): Promise<OutboxEvent> {
  return enqueueOutboxEvent({
    eventType: NOTIFICATION_EVENT_TYPES.SYSTEM_CRITICAL_ERROR,
    payload,
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

  await client.sendMessage({
    chatId: config.chatId,
    messageThreadId: getTelegramMessageThreadId(config, topic),
    text: renderNotificationMessage(eventType, payload),
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

    reply.code(statusCode);
    return {
      error: getErrorMessage(error),
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
