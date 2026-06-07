import crypto from "node:crypto";

import { db } from "../../infra/db/knex";
import {
  ORDER_STATUSES,
  type ChangeOrderStatusInput,
  type OrderRecord,
  type OrderStatus,
  type ReceiveOrderInput,
} from "./types";
import {
  findOrderRepo,
  getOrderStatusCountsRepo,
  insertOrderEventRepo,
  insertOrderRepo,
  listOrderEventsRepo,
  listOrdersRepo,
  updateOrderRepo,
} from "./repo";

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  New: ["Accepted", "PrePrintCheck", "Cancelled", "Problem"],
  Accepted: ["PrePrintCheck", "Queued", "Packaging", "Cancelled", "Problem"],
  PrePrintCheck: ["Queued", "Packaging", "Cancelled", "Problem"],
  Queued: ["Printing", "Cancelled", "Problem"],
  Printing: ["PostProcess", "Problem"],
  PostProcess: ["Packaging", "Problem"],
  Packaging: ["Shipment", "Pickup", "Problem"],
  Shipment: ["Delivered", "Problem"],
  Pickup: ["Issued", "Problem"],
  Delivered: ["Problem"],
  Issued: ["Problem"],
  Cancelled: ["Problem"],
  Problem: ["Accepted", "PrePrintCheck", "Queued", "Packaging", "Shipment", "Pickup", "Cancelled"],
};

export const DEFAULT_ORDER_STATUS_COUNTS = ORDER_STATUSES.reduce<Record<OrderStatus, number>>(
  (acc, status) => {
    acc[status] = 0;
    return acc;
  },
  {} as Record<OrderStatus, number>
);

function makeId(prefix = "ord") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function asText(value: unknown): string | null {
  if (value === undefined || value === null) return null;

  const text = String(value).trim();
  return text || null;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus);
}

function normalizeStatus(value: unknown): OrderStatus {
  return isOrderStatus(value) ? value : "New";
}

function normalizeItems(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(Boolean)
    .map((item: any) => {
      const qty = Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
      const price = asNumber(item.price ?? item.unit_price ?? item.base_price);
      const total = asNumber(item.total ?? item.line_total);

      const files = Array.isArray(item.files)
        ? item.files
            .filter(Boolean)
            .map((file: any) => ({
              type: asText(file.type) ?? "stl",
              url: asText(file.url),
              filename: asText(file.filename),
              source: asText(file.source),
            }))
            .filter((file: any) => file.url)
        : [];

      return {
        ...item,
        product_id: item.product_id ?? item.productId ?? item.id ?? null,
        variant_id: item.variant_id ?? item.variantId ?? null,
        sku: item.sku ?? null,
        name: item.name ?? item.title ?? "Товар",
        qty,
        price,
        total: total ?? (price == null ? null : price * qty),
        files,
      };
    });
}

function normalizeIncomingOrder(payload: ReceiveOrderInput) {
  const shopOrderId = asText(
    payload.shop_order_id ??
      payload.order_id ??
      payload.external_id ??
      payload.id
  );

  const id = asText(payload.id ?? payload.order_id ?? shopOrderId) ?? makeId();

  const shippingAddress = payload.shipping_address as any;
  const billingAddress = payload.billing_address as any;
  const delivery = (payload as any).delivery as any;

  const customerName = asText(
    payload.customer_name ??
      payload.customer?.name ??
      payload.customer?.full_name ??
      shippingAddress?.name ??
      delivery?.recipient_name ??
      [
        payload.customer?.last_name ?? shippingAddress?.last_name,
        payload.customer?.first_name ?? shippingAddress?.first_name,
        payload.customer?.middle_name ?? shippingAddress?.middle_name,
      ]
        .filter(Boolean)
        .join(" ")
  );

  const email = asText(
    payload.email ??
      payload.customer?.email ??
      shippingAddress?.email ??
      billingAddress?.email
  );

  const phone = asText(
    payload.phone ??
      payload.customer?.phone ??
      shippingAddress?.phone ??
      billingAddress?.phone ??
      delivery?.recipient_phone
  );

  const total = asNumber(payload.total_uah ?? payload.total);

  return {
    id,
    shop_order_id: shopOrderId,
    source: asText(payload.source) ?? "shop",
    status: normalizeStatus(payload.status),

    customer_name: customerName,
    email,
    phone,

    total_uah: total,
    currency: asText(payload.currency) ?? "UAH",

    payment_provider: asText(payload.payment_provider),
    payment_status: asText(payload.payment_status),
    shipping_method: asText(payload.shipping_method),
    tracking_number: asText(payload.tracking_number),

    items: normalizeItems(payload.items),
    shipping_address: payload.shipping_address ?? (payload as any).delivery ?? null,
    billing_address: payload.billing_address ?? null,
    source_payload: payload,

    notes: asText(payload.notes),
  };
}

function canChangeStatus(from: OrderStatus, to: OrderStatus) {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function listOrders(filters = {}) {
  return listOrdersRepo(filters);
}

export async function getOrder(id: string) {
  const order = await findOrderRepo(id);

  if (!order) {
    const error = new Error("Order not found");
    (error as any).statusCode = 404;
    throw error;
  }

  const events = await listOrderEventsRepo(order.id);

  return {
    order,
    events,
  };
}

export async function receiveOrder(payload: ReceiveOrderInput): Promise<OrderRecord> {
  const normalized = normalizeIncomingOrder(payload);

  const existing = normalized.shop_order_id
    ? await findOrderRepo(normalized.shop_order_id)
    : await findOrderRepo(normalized.id);

  return db.transaction(async (trx) => {
    if (existing) {
      const updated = await updateOrderRepo(
        existing.id,
        {
          shop_order_id: existing.shop_order_id ?? normalized.shop_order_id,
          source: normalized.source,

          // Статус не перетираем при повторной синхронизации из магазина.
          // Статусом управляет fulfillment dashboard.
          customer_name: normalized.customer_name,
          email: normalized.email,
          phone: normalized.phone,

          total_uah: normalized.total_uah,
          currency: normalized.currency,

          payment_provider: normalized.payment_provider,
          payment_status: normalized.payment_status,
          shipping_method: normalized.shipping_method,
          tracking_number: normalized.tracking_number,

          items: JSON.stringify(normalized.items),
          shipping_address: normalized.shipping_address
            ? JSON.stringify(normalized.shipping_address)
            : null,
          billing_address: normalized.billing_address
            ? JSON.stringify(normalized.billing_address)
            : null,
          source_payload: JSON.stringify(normalized.source_payload),

          notes: normalized.notes,
        },
        trx
      );

      await insertOrderEventRepo(
        {
          id: makeId("oev"),
          order_id: updated.id,
          type: "order_synced",
          from_status: existing.status,
          to_status: updated.status,
          actor: "shop",
          note: "Order snapshot synced from shop",
          payload: JSON.stringify(payload),
        },
        trx
      );

      return updated;
    }

    const created = await insertOrderRepo(
      {
        ...normalized,
        items: JSON.stringify(normalized.items),
        shipping_address: normalized.shipping_address
          ? JSON.stringify(normalized.shipping_address)
          : null,
        billing_address: normalized.billing_address
          ? JSON.stringify(normalized.billing_address)
          : null,
        source_payload: JSON.stringify(normalized.source_payload),
      },
      trx
    );

    await insertOrderEventRepo(
      {
        id: makeId("oev"),
        order_id: created.id,
        type: "order_received",
        from_status: null,
        to_status: created.status,
        actor: "shop",
        note: "Order received from shop",
        payload: JSON.stringify(payload),
      },
      trx
    );

    return created;
  });
}

export async function changeOrderStatus(
  id: string,
  input: ChangeOrderStatusInput
): Promise<OrderRecord> {
  const nextStatus = input.status;

  if (!isOrderStatus(nextStatus)) {
    const error = new Error(`Invalid order status: ${nextStatus}`);
    (error as any).statusCode = 400;
    throw error;
  }

  const order = await findOrderRepo(id);

  if (!order) {
    const error = new Error("Order not found");
    (error as any).statusCode = 404;
    throw error;
  }

  if (!input.force && !canChangeStatus(order.status, nextStatus)) {
    const error = new Error(
      `Transition ${order.status} -> ${nextStatus} is not allowed`
    );
    (error as any).statusCode = 409;
    throw error;
  }

  return db.transaction(async (trx) => {
    const updated = await updateOrderRepo(
      order.id,
      {
        status: nextStatus,
      },
      trx
    );

    await insertOrderEventRepo(
      {
        id: makeId("oev"),
        order_id: order.id,
        type: "status_changed",
        from_status: order.status,
        to_status: nextStatus,
        actor: asText(input.actor) ?? "dashboard",
        note: asText(input.note),
        payload: JSON.stringify(input),
      },
      trx
    );

    return updated;
  });
}

export async function getOrdersStatusSummary() {
  const counts = await getOrderStatusCountsRepo();

  return ORDER_STATUSES.reduce<Record<OrderStatus, number>>((acc, status) => {
    acc[status] = counts[status] ?? 0;
    return acc;
  }, { ...DEFAULT_ORDER_STATUS_COUNTS });
}