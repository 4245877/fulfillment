import { NOTIFICATION_EVENT_TYPES, type NotificationEventType } from "./types";
import { TELEGRAM_TOPIC_LABELS } from "./routing";
import type {
  CriticalErrorNotificationPayload,
  NotificationPayload,
  OrderNotificationPayload,
  PrinterNotificationPayload,
  ProductReportNotificationPayload,
  TestNotificationPayload,
} from "./types";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function valueOrDash(value: unknown): string {
  const text = String(value ?? "").trim();
  return text ? escapeHtml(text) : "-";
}

function line(label: string, value: unknown): string {
  return `<b>${escapeHtml(label)}:</b> ${valueOrDash(value)}`;
}

function money(total: number | null, currency: string): string {
  if (total == null) {
    return "-";
  }

  return `${total.toFixed(2)} ${escapeHtml(currency || "UAH")}`;
}

function orderTitle(payload: OrderNotificationPayload) {
  if (payload.event === "received") {
    return "Нове замовлення";
  }

  if (payload.event === "synced") {
    return "Синхронізація замовлення";
  }

  return "Зміна статусу замовлення";
}

function renderOrder(payload: OrderNotificationPayload): string {
  const order = payload.order;
  const lines = [
    `<b>${orderTitle(payload)}</b>`,
    line("ID", order.id),
    line("ID магазину", order.shopOrderId),
    line("Статус", order.status),
    line("Клієнт", order.customerName),
    line("Телефон", order.phone),
    line("Email", order.email),
    line("Сума", money(order.totalUah, order.currency)),
    line("Позицій", order.itemsCount),
  ];

  if (payload.previousStatus || payload.nextStatus) {
    lines.push(
      line("Перехід", `${payload.previousStatus || "-"} -> ${payload.nextStatus || "-"}`)
    );
  }

  if (payload.actor) {
    lines.push(line("Автор", payload.actor));
  }

  if (payload.note) {
    lines.push(line("Нотатка", payload.note));
  }

  return lines.join("\n");
}

function renderProductReport(payload: ProductReportNotificationPayload): string {
  const report = payload.report;

  return [
    "<b>Скарга на товар</b>",
    line("Report ID", report.reportId),
    line("Товар", report.productName || report.productId),
    line("SKU", report.productSku),
    line("Причина", report.reason),
    line("Коментар", report.comment),
    line("Сторінка", report.pageUrl),
    line("Джерело", report.source),
  ].join("\n");
}

function printerTitle(payload: PrinterNotificationPayload): string {
  if (payload.kind === "error") {
    return "❌ Помилка принтера";
  }

  if (payload.kind === "paused") {
    return "⏸ Друк призупинено";
  }

  return "✅ Друк завершено";
}

function renderPrinter(payload: PrinterNotificationPayload): string {
  const lines = [
    `<b>${printerTitle(payload)}</b>`,
    line("Принтер", payload.printer.name),
  ];

  if (payload.printer.model) {
    lines.push(line("Модель", payload.printer.model));
  }

  if (payload.currentFile) {
    lines.push(line("Файл", payload.currentFile));
  }

  if (payload.kind === "completed" && payload.progressPct != null) {
    lines.push(line("Прогрес", `${payload.progressPct}%`));
  }

  if (payload.kind !== "completed" && payload.errorMessage) {
    lines.push(line("Опис", payload.errorMessage.slice(0, 600)));
  }

  lines.push(line("Час", payload.occurredAt));

  return lines.join("\n");
}

function renderCriticalError(payload: CriticalErrorNotificationPayload): string {
  const lines = [
    "<b>Критична помилка API</b>",
    line("Повідомлення", payload.message),
    line("Статус", payload.statusCode ?? 500),
    line("Метод", payload.method),
    line("URL", payload.url),
    line("Request ID", payload.requestId),
    line("Час", payload.occurredAt),
  ];

  if (payload.stack) {
    lines.push(line("Stack", payload.stack.slice(0, 1200)));
  }

  return lines.join("\n");
}

function renderTest(payload: TestNotificationPayload): string {
  return [
    "<b>Тест Telegram-теми</b>",
    line("Тема", TELEGRAM_TOPIC_LABELS[payload.topic]),
    line("Мітка", payload.label),
    line("Час", payload.requestedAt),
  ].join("\n");
}

export function renderNotificationMessage(
  eventType: NotificationEventType,
  payload: NotificationPayload
): string {
  switch (eventType) {
    case NOTIFICATION_EVENT_TYPES.ORDER_RECEIVED:
    case NOTIFICATION_EVENT_TYPES.ORDER_SYNCED:
    case NOTIFICATION_EVENT_TYPES.ORDER_STATUS_CHANGED:
      return renderOrder(payload as OrderNotificationPayload);

    case NOTIFICATION_EVENT_TYPES.PRODUCT_REPORT_CREATED:
      return renderProductReport(payload as ProductReportNotificationPayload);

    case NOTIFICATION_EVENT_TYPES.PRINTER_ERROR:
    case NOTIFICATION_EVENT_TYPES.PRINTER_PAUSED:
    case NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_COMPLETED:
      return renderPrinter(payload as PrinterNotificationPayload);

    case NOTIFICATION_EVENT_TYPES.SYSTEM_CRITICAL_ERROR:
      return renderCriticalError(payload as CriticalErrorNotificationPayload);

    case NOTIFICATION_EVENT_TYPES.TEST:
      return renderTest(payload as TestNotificationPayload);
  }
}
