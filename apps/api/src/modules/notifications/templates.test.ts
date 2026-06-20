import assert from "node:assert/strict";
import test from "node:test";

import {
  renderNotificationMessage,
  TELEGRAM_MESSAGE_LIMIT,
} from "./templates";
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

test("renders printer error with name and escaped description", () => {
  const html = renderNotificationMessage(NOTIFICATION_EVENT_TYPES.PRINTER_ERROR, {
    kind: "error",
    printer: { id: "k2", name: "Creality K2", model: "K2" },
    status: "error",
    stateText: "error",
    currentFile: "vase.gcode",
    progressPct: 42,
    errorMessage: "Servo <fault> & stall",
    occurredAt: "2026-06-20T10:00:00.000Z",
    photo: null,
  } as any);

  assert.equal(html.includes("❌ Помилка принтера"), true);
  assert.equal(html.includes("Creality K2"), true);
  assert.equal(html.includes("vase.gcode"), true);
  assert.equal(html.includes("Servo &lt;fault&gt; &amp; stall"), true);
  assert.equal(html.includes("<fault>"), false);
});

test("renders filament runout with the reason description", () => {
  const html = renderNotificationMessage(
    NOTIFICATION_EVENT_TYPES.PRINTER_FILAMENT_RUNOUT,
    {
      kind: "filament_runout",
      printer: { id: "k2", name: "Creality K2", model: "K2" },
      status: "paused",
      stateText: "pause",
      currentFile: "vase.gcode",
      progressPct: 42,
      errorMessage: "Filament runout",
      occurredAt: "2026-06-20T10:00:00.000Z",
      photo: null,
    } as any
  );

  assert.equal(html.includes("🧵 Закінчився філамент"), true);
  assert.equal(html.includes("Filament runout"), true);
});

test("renders a cancelled print without an error line", () => {
  const html = renderNotificationMessage(
    NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_CANCELLED,
    {
      kind: "cancelled",
      printer: { id: "k2", name: "Creality K2", model: null },
      status: "idle",
      stateText: "cancelled",
      currentFile: "vase.gcode",
      progressPct: 99,
      errorMessage: null,
      occurredAt: "2026-06-20T10:00:00.000Z",
      photo: null,
    } as any
  );

  assert.equal(html.includes("🚫 Друк скасовано"), true);
  assert.equal(html.includes("99%"), true);
  assert.equal(html.includes("Опис"), false);
});

test("clamps an oversized critical error within the Telegram message limit", () => {
  const html = renderNotificationMessage(
    NOTIFICATION_EVENT_TYPES.SYSTEM_CRITICAL_ERROR,
    {
      message: "x".repeat(50_000),
      name: "Error",
      stack: "y".repeat(50_000),
      statusCode: 500,
      method: "POST",
      url: `/api/${"z".repeat(50_000)}`,
      requestId: "req_1",
      occurredAt: "2026-06-20T10:00:00.000Z",
    } as any
  );

  assert.equal(html.length <= TELEGRAM_MESSAGE_LIMIT, true);
  assert.equal(html.includes("Критична помилка API"), true);
});

test("renders print completion without an error line", () => {
  const html = renderNotificationMessage(
    NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_COMPLETED,
    {
      kind: "completed",
      printer: { id: "k2", name: "Creality K2", model: null },
      status: "idle",
      stateText: "complete",
      currentFile: "vase.gcode",
      progressPct: 100,
      errorMessage: null,
      occurredAt: "2026-06-20T10:00:00.000Z",
      photo: null,
    } as any
  );

  assert.equal(html.includes("✅ Друк завершено"), true);
  assert.equal(html.includes("100%"), true);
  assert.equal(html.includes("Опис"), false);
});
