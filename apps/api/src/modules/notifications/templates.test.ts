import assert from "node:assert/strict";
import test from "node:test";

import { renderNotificationMessage } from "./templates";
import { NOTIFICATION_EVENT_TYPES } from "./types";

test("renders Telegram HTML with escaped user-controlled values", () => {
  const html = renderNotificationMessage(NOTIFICATION_EVENT_TYPES.ORDER_RECEIVED, {
    event: "received",
    order: {
      id: "ord_<script>",
      shopOrderId: "shop&1",
      source: "shop",
      status: "New",
      customerName: "Ada <Admin>",
      email: "ada@example.test",
      phone: "+380",
      totalUah: 42,
      currency: "UAH",
      itemsCount: 1,
      receivedAt: null,
      updatedAt: null,
    },
    previousStatus: null,
    nextStatus: "New",
    actor: "shop",
    note: "5 > 3 & 2 < 4",
  } as any);

  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("ord_&lt;script&gt;"), true);
  assert.equal(html.includes("shop&amp;1"), true);
  assert.equal(html.includes("5 &gt; 3 &amp; 2 &lt; 4"), true);
});
