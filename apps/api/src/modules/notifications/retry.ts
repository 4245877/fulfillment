import { TelegramApiError } from "../../infra/integrations/telegram/client";

export function getNotificationRetryAfterMs(error: unknown): number | undefined {
  if (error instanceof TelegramApiError && error.retryAfterSeconds !== undefined) {
    return error.retryAfterSeconds * 1000;
  }

  return undefined;
}

export function isRetryableNotificationError(error: unknown): boolean {
  if (error instanceof TelegramApiError) {
    return error.retryable;
  }

  return true;
}
