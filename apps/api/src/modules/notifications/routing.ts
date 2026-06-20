import type { TelegramConfig } from "../../infra/integrations/telegram/config";
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
  type NotificationPayload,
  type NotificationTopicKey,
  type TestNotificationPayload,
} from "./types";

export const TELEGRAM_TOPIC_LABELS: Record<NotificationTopicKey, string> = {
  orders: "Замовлення",
  productReports: "Скарги на товари",
  prints: "Повідомлення друку",
  criticalErrors: "Критичні помилки",
};

export function isNotificationTopicKey(value: unknown): value is NotificationTopicKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TELEGRAM_TOPIC_LABELS, value)
  );
}

export function routeNotificationToTopic(
  eventType: NotificationEventType,
  payload: NotificationPayload
): NotificationTopicKey {
  if (eventType === NOTIFICATION_EVENT_TYPES.TEST) {
    const topic = (payload as TestNotificationPayload).topic;

    if (!isNotificationTopicKey(topic)) {
      throw new Error(`Unsupported notification topic: ${String(topic)}`);
    }

    return topic;
  }

  if (
    eventType === NOTIFICATION_EVENT_TYPES.ORDER_RECEIVED ||
    eventType === NOTIFICATION_EVENT_TYPES.ORDER_SYNCED ||
    eventType === NOTIFICATION_EVENT_TYPES.ORDER_STATUS_CHANGED
  ) {
    return "orders";
  }

  if (eventType === NOTIFICATION_EVENT_TYPES.PRODUCT_REPORT_CREATED) {
    return "productReports";
  }

  return "criticalErrors";
}

export function getTelegramMessageThreadId(
  config: TelegramConfig,
  topic: NotificationTopicKey
): number {
  return config.topics[topic];
}
