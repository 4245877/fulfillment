import assert from "node:assert/strict";
import test from "node:test";

import { routeNotificationToTopic } from "./routing";
import { NOTIFICATION_EVENT_TYPES } from "./types";

test("routes notification event types to Telegram topics", () => {
  assert.equal(
    routeNotificationToTopic(NOTIFICATION_EVENT_TYPES.ORDER_RECEIVED, {} as any),
    "orders"
  );
  assert.equal(
    routeNotificationToTopic(
      NOTIFICATION_EVENT_TYPES.PRODUCT_REPORT_CREATED,
      {} as any
    ),
    "productReports"
  );
  assert.equal(
    routeNotificationToTopic(
      NOTIFICATION_EVENT_TYPES.SYSTEM_CRITICAL_ERROR,
      {} as any
    ),
    "criticalErrors"
  );
});

test("routes Telegram topic tests only to known topics", () => {
  assert.equal(
    routeNotificationToTopic(NOTIFICATION_EVENT_TYPES.TEST, {
      topic: "criticalErrors",
    } as any),
    "criticalErrors"
  );

  assert.throws(
    () =>
      routeNotificationToTopic(NOTIFICATION_EVENT_TYPES.TEST, {
        topic: "unknown",
      } as any),
    /Unsupported notification topic/
  );
});
