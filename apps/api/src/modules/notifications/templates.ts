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
    return "Новый заказ";
  }

  if (payload.event === "synced") {
    return "Синхронизация заказа";
  }

  return "Изменение статуса заказа";
}

function renderOrder(payload: OrderNotificationPayload): string {
  const order = payload.order;
  const lines = [
    `<b>${orderTitle(payload)}</b>`,
    line("ID", order.id),
    line("ID магазину", order.shopOrderId),
    line("ID магазина", order.shopOrderId),
    line("Клиент", order.customerName),
    line("Телефон", order.phone),
    line("Email", order.email),
    line("Сумма", money(order.totalUah, order.currency)),
    line("Позиций", order.itemsCount),
  ];

  if (payload.previousStatus || payload.nextStatus) {
    lines.push(
      line("Переход", `${payload.previousStatus || "-"} -> ${payload.nextStatus || "-"}`)
    );
  }

  if (payload.actor) {
    lines.push(line("Автор", payload.actor));
  }

  if (payload.note) {
    lines.push(line("Заметка", payload.note));
  }

  return lines.join("\n");
}

function renderProductReport(payload: ProductReportNotificationPayload): string {
  const report = payload.report;

  return [
    "<b>Жалоба на товар</b>",
    line("Report ID", report.reportId),
    line("Товар", report.productName || report.productId),
    line("SKU", report.productSku),
    line("Причина", report.reason),
    line("Комментарий", report.comment),
    line("Страница", report.pageUrl),
    line("Источник", report.source),
  ].join("\n");
}

function printerTitle(payload: PrinterNotificationPayload): string {
  if (payload.kind === "error") {
    return "❌ Ошибка принтера";
  }

  if (payload.kind === "filament_runout") {
    return "🧵 Закончился филамент";
  }

  if (payload.kind === "paused") {
    return "⏸ Печать приостановлена";
  }

  if (payload.kind === "cancelled") {
    return "🚫 Печать отменена";
  }

  return "✅ Печать завершена";
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
    lines.push(line("Прогресс", `${payload.progressPct}%`));
  }

  // Description carries the human-readable reason for errors, pauses and
  // filament runouts. Completion/cancellation drop it via a null errorMessage.
  // Kept short so the rendered total stays under the 1024-char photo caption.
  if (payload.errorMessage) {
    lines.push(line("Описание", clamp(payload.errorMessage, 400)));
  }

  lines.push(line("Время", payload.occurredAt));

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
      ? "🛑 Критический запас филамента"
      : "⚠️ Филамент заканчивается";

  return [
    `<b>${title}</b>`,
    line("Материал", payload.label),
    line("Остаток", kg(payload.stockG)),
    line("Порог", kg(payload.thresholdG)),
    line("Время", payload.occurredAt),
  ].join("\n");
}

function renderCriticalError(payload: CriticalErrorNotificationPayload): string {
  const lines = [
    "<b>Критическая ошибка API</b>",
    line("Сообщение", clamp(payload.message, 1500)),
    line("Статус", payload.statusCode ?? 500),
    line("Метод", payload.method),
    line("URL", clamp(String(payload.url ?? ""), 500)),
    line("Request ID", payload.requestId),
    line("Время", payload.occurredAt),
  ];

  if (payload.stack) {
    lines.push(line("Stack", clamp(payload.stack, 1200)));
  }

  return lines.join("\n");
}

function renderTest(payload: TestNotificationPayload): string {
  return [
    "<b>Тест Telegram-темы</b>",
    line("Тема", TELEGRAM_TOPIC_LABELS[payload.topic]),
    line("Метка", payload.label),
    line("Время", payload.requestedAt),
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
