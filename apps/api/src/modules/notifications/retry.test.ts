import assert from "node:assert/strict";
import test from "node:test";

import { TelegramApiError } from "../../infra/integrations/telegram/client";
import { getNotificationRetryAfterMs, isRetryableNotificationError } from "./retry";

test("notification retry helpers respect Telegram retry metadata", () => {
  const rateLimit = new TelegramApiError("rate limit", {
    retryAfterSeconds: 9,
    retryable: true,
  });

  assert.equal(getNotificationRetryAfterMs(rateLimit), 9000);
  assert.equal(isRetryableNotificationError(rateLimit), true);

  const badRequest = new TelegramApiError("bad request", { retryable: false });

  assert.equal(getNotificationRetryAfterMs(badRequest), undefined);
  assert.equal(isRetryableNotificationError(badRequest), false);
  assert.equal(isRetryableNotificationError(new Error("db timeout")), true);
});
