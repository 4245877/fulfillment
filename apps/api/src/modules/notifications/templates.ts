import { NOTIFICATION_EVENT_TYPES, type NotificationEventType } from "./types";
import { TELEGRAM_TOPIC_LABELS } from "./routing";
import type {
  CriticalErrorNotificationPayload,
  FilamentLowStockNotificationPayload,
  NotificationPayload,
  OrderNotificationPayload,
  PrinterNotificationPayload,
  ProductReportNotificationPayload,
  TestNotificationPayload,
} from "./types";

// Telegram hard limits: 4096 chars for a text message, 1024 for a media
// caption. We clamp the free-text fields that can blow up (error messages,
// stack traces, file names) so the rendered total stays safely under the
// caption limit even on the photo path — otherwise the API returns a
// non-retryable 400 and the (often most important) notification is lost.
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;

export function clampTelegramText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

const clamp = clampTelegramText;

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

  if (payload.kind === "filament_runout") {
    return "🧵 Закінчився філамент";
  }

  if (payload.kind === "paused") {
    return "⏸ Друк призупинено";
  }

  if (payload.kind === "cancelled") {
    return "🚫 Друк скасовано";
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
    lines.push(line("Файл", clamp(payload.currentFile, 200)));
  }

  if (
    (payload.kind === "completed" || payload.kind === "cancelled") &&
    payload.progressPct != null
  ) {
    lines.push(line("Прогрес", `${payload.progressPct}%`));
  }

  // Description carries the human-readable reason for errors, pauses and
  // filament runouts. Completion/cancellation drop it via a null errorMessage.
  // Kept short so the rendered total stays under the 1024-char photo caption.
  if (payload.errorMessage) {
    lines.push(line("Опис", clamp(payload.errorMessage, 400)));
  }

  lines.push(line("Час", payload.occurredAt));

  return lines.join("\n");
}

function kg(grams: number): string {
  return `${(Math.round(grams) / 1000).toFixed(2)} кг (${Math.round(grams)} г)`;
}

function renderFilamentLowStock(
  payload: FilamentLowStockNotificationPayload
): string {
  const title =
    payload.status === "critical"
      ? "🛑 Критичний запас філаменту"
      : "⚠️ Філамент закінчується";

  return [
    `<b>${title}</b>`,
    line("Матеріал", payload.label),
    line("Залишок", kg(payload.stockG)),
    line("Поріг", kg(payload.thresholdG)),
    line("Час", payload.occurredAt),
  ].join("\n");
}

function renderCriticalError(payload: CriticalErrorNotificationPayload): string {
  const lines = [
    "<b>Критична помилка API</b>",
    line("Повідомлення", clamp(payload.message, 1500)),
    line("Статус", payload.statusCode ?? 500),
    line("Метод", payload.method),
    line("URL", clamp(String(payload.url ?? ""), 500)),
    line("Request ID", payload.requestId),
    line("Час", payload.occurredAt),
  ];

  if (payload.stack) {
    lines.push(line("Stack", clamp(payload.stack, 1200)));
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
    case NOTIFICATION_EVENT_TYPES.PRINTER_FILAMENT_RUNOUT:
    case NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_COMPLETED:
    case NOTIFICATION_EVENT_TYPES.PRINTER_PRINT_CANCELLED:
      return renderPrinter(payload as PrinterNotificationPayload);

    case NOTIFICATION_EVENT_TYPES.INVENTORY_FILAMENT_LOW:
      return renderFilamentLowStock(
        payload as FilamentLowStockNotificationPayload
      );

    case NOTIFICATION_EVENT_TYPES.SYSTEM_CRITICAL_ERROR:
      return renderCriticalError(payload as CriticalErrorNotificationPayload);

    case NOTIFICATION_EVENT_TYPES.TEST:
      return renderTest(payload as TestNotificationPayload);

    default: {
      // Exhaustiveness guard: a new event type without a case would otherwise
      // return undefined and be sent as an empty Telegram message (400, lost).
      // Throwing routes it through the dispatcher's retry/dead-letter path.
      const _exhaustive: never = eventType;
      throw new Error(
        `Unhandled notification event type: ${String(_exhaustive)}`
      );
    }
  }
}
