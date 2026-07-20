export const NOTIFICATION_EVENT_TYPES = {
  ORDER_RECEIVED: "notification.order.received",
  ORDER_SYNCED: "notification.order.synced",
  ORDER_STATUS_CHANGED: "notification.order.status_changed",
  PRODUCT_REPORT_CREATED: "notification.product_report.created",
  PRINTER_ERROR: "notification.printer.error",
  PRINTER_PAUSED: "notification.printer.paused",
  PRINTER_FILAMENT_RUNOUT: "notification.printer.filament_runout",
  PRINTER_PRINT_COMPLETED: "notification.printer.print_completed",
  PRINTER_PRINT_CANCELLED: "notification.printer.print_cancelled",
  INVENTORY_FILAMENT_LOW: "notification.inventory.filament_low",
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

export type PrinterNotificationKind =
  | "error"
  | "paused"
  | "filament_runout"
  | "completed"
  | "cancelled";

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

/**
 * A filament reel whose remaining stock just crossed a warning threshold
 * downwards (ok→low, ok→critical or low→critical). Edge-triggered by a
 * consumption in the inventory service, so exactly one is raised per crossing —
 * not one per consume while the reel stays in the same band.
 */
export type FilamentLowStockNotificationPayload = {
  stockId: string;
  material: string;
  color: string;
  colorName: string;
  /** Human label, e.g. "PETG Чёрный". */
  label: string;
  /** The band it dropped into — the one that fired this alert. */
  status: "low" | "critical";
  stockG: number;
  stockKg: number;
  /** The threshold that was crossed: criticalStockG for "critical", else lowStockG. */
  thresholdG: number;
  lowStockG: number;
  criticalStockG: number;
  /** What consumed the filament (dashboard, printer, …). */
  source: string;
  occurredAt: string;
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
  | FilamentLowStockNotificationPayload
  | CriticalErrorNotificationPayload
  | TestNotificationPayload;

export function isNotificationEventType(
  value: string
): value is NotificationEventType {
  return NOTIFICATION_EVENT_TYPE_VALUES.includes(value as NotificationEventType);
}
