import { env } from "../../../shared/env";

export type TelegramTopicKey = "orders" | "productReports" | "criticalErrors";

export type TelegramConfig = {
  enabled: boolean;
  botToken: string;
  chatId: string;
  requestTimeoutMs: number;
  topics: Record<TelegramTopicKey, number>;
};

function requireTelegramValue<T>(
  value: T | null | undefined,
  name: string
): T {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Missing required Telegram environment variable: ${name}`);
  }

  return value;
}

function requirePositiveInteger(value: number | null | undefined, name: string) {
  const required = requireTelegramValue(value, name);

  if (!Number.isInteger(required) || required <= 0) {
    throw new Error(
      `Invalid Telegram environment variable: ${name} must be a positive integer`
    );
  }

  return required;
}

function requirePositiveTimeout(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid Telegram environment variable: ${name} must be greater than 0`
    );
  }

  return value;
}

export function getTelegramConfig(): TelegramConfig {
  if (!env.TELEGRAM_ENABLED) {
    return {
      enabled: false,
      botToken: "",
      chatId: "",
      requestTimeoutMs: requirePositiveTimeout(
        env.TELEGRAM_REQUEST_TIMEOUT_MS,
        "TELEGRAM_REQUEST_TIMEOUT_MS"
      ),
      topics: {
        orders: 0,
        productReports: 0,
        criticalErrors: 0,
      },
    };
  }

  return {
    enabled: true,
    botToken: requireTelegramValue(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN"),
    chatId: requireTelegramValue(env.TELEGRAM_CHAT_ID, "TELEGRAM_CHAT_ID"),
    requestTimeoutMs: requirePositiveTimeout(
      env.TELEGRAM_REQUEST_TIMEOUT_MS,
      "TELEGRAM_REQUEST_TIMEOUT_MS"
    ),
    topics: {
      orders: requirePositiveInteger(
        env.TELEGRAM_TOPIC_ORDERS_ID,
        "TELEGRAM_TOPIC_ORDERS_ID"
      ),
      productReports: requirePositiveInteger(
        env.TELEGRAM_TOPIC_PRODUCT_REPORTS_ID,
        "TELEGRAM_TOPIC_PRODUCT_REPORTS_ID"
      ),
      criticalErrors: requirePositiveInteger(
        env.TELEGRAM_TOPIC_CRITICAL_ERRORS_ID,
        "TELEGRAM_TOPIC_CRITICAL_ERRORS_ID"
      ),
    },
  };
}
