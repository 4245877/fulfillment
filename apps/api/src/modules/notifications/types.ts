export const NOTIFICATION_EVENT_TYPES = {
  ORDER_RECEIVED: "notification.order.received",
  ORDER_SYNCED: "notification.order.synced",
  ORDER_STATUS_CHANGED: "notification.order.status_changed",
  PRODUCT_REPORT_CREATED: "notification.product_report.created",
  PRINTER_ERROR: "notification.printer.error",
  PRINTER_PAUSED: "notification.printer.paused",
  PRINTER_PRINT_COMPLETED: "notification.printer.print_completed",
  SYSTEM_CRITICAL_ERROR: "notification.system.critical_error",
  TEST: "notification.test",
} as const;

export const NOTIFICATION_EVENT_TYPE_VALUES = Object.values(
  NOTIFICATION_EVENT_TYPES
);

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

export type NotificationTopicKey =
  | "orders"
  | "productReports"
  | "prints"
  | "criticalErrors";

export type OrderNotificationKind = "received" | "synced" | "status_changed";

export type OrderNotificationPayload = {
  event: OrderNotificationKind;
  order: {
    id: string;
    shopOrderId: string | null;
    source: string;
    status: string;
    customerName: string | null;
    email: string | null;
    phone: string | null;
    totalUah: number | null;
    currency: string;
    itemsCount: number;
    receivedAt: string | null;
    updatedAt: string | null;
  };
  previousStatus?: string | null;
  nextStatus?: string | null;
  actor?: string | null;
  note?: string | null;
};

export type ProductReportNotificationPayload = {
  report: {
    reportId: string;
    productId: string;
    productName: string | null;
    productSku: string | null;
    reason: string;
    comment: string | null;
    pageUrl: string | null;
    source: string | null;
    userAgent: string | null;
    referer: string | null;
    createdAt: string;
  };
};

export type NotificationPhoto = {
  base64: string;
  mime: string;
  filename?: string | null;
};

export type PrinterNotificationKind = "error" | "paused" | "completed";

export type PrinterNotificationPayload = {
  kind: PrinterNotificationKind;
  printer: {
    id: string;
    name: string;
    model?: string | null;
  };
  status: string;
  stateText?: string | null;
  currentFile?: string | null;
  progressPct?: number | null;
  errorMessage?: string | null;
  occurredAt: string;
  photo?: NotificationPhoto | null;
};

export type CriticalErrorNotificationPayload = {
  message: string;
  name?: string | null;
  stack?: string | null;
  statusCode?: number | null;
  method?: string | null;
  url?: string | null;
  requestId?: string | null;
  occurredAt: string;
};

export type TestNotificationPayload = {
  topic: NotificationTopicKey;
  label: string;
  requestedAt: string;
};

export type NotificationPayload =
  | OrderNotificationPayload
  | ProductReportNotificationPayload
  | PrinterNotificationPayload
  | CriticalErrorNotificationPayload
  | TestNotificationPayload;

export function isNotificationEventType(
  value: string
): value is NotificationEventType {
  return NOTIFICATION_EVENT_TYPE_VALUES.includes(value as NotificationEventType);
}
