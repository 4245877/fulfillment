import crypto from "node:crypto";

import { db } from "../../infra/db/knex";
import {
  ORDER_STATUSES,
  type ChangeOrderStatusInput,
  type OrderRecord,
  type OrderStatus,
  type ReceiveOrderInput,
} from "./types";
import { enqueueOrderNotification } from "../notifications/dispatcher";
import { publishEvent } from "../../core/events";
import {
  findOrderRepo,
  findOrderForUpdateRepo,
  getOrderStatusCountsRepo,
  getOrdersOverviewAggregatesRepo,
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

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === "23505";
}

export async function receiveOrder(payload: ReceiveOrderInput): Promise<OrderRecord> {
  const normalized = normalizeIncomingOrder(payload);
  const lookupKey = normalized.shop_order_id || normalized.id;

  // The existing-row lookup happens inside the transaction with a row lock so a
  // repeated sync serialises against a concurrent one. A brand-new order has no
  // row to lock, so two racing inserts of the same shop_order_id can still
  // collide on the unique constraint — that surfaces as a 23505 which we retry
  // once (the row now exists, so the retry takes the update path).
  const runOnce = async () =>
    db.transaction(async (trx) => {
      const existing = await findOrderForUpdateRepo(lookupKey, trx);

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

        const orderEvent = await insertOrderEventRepo(
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

        await enqueueOrderNotification(
          "synced",
          updated,
          {
            previousStatus: existing.status,
            nextStatus: updated.status,
            actor: "shop",
            note: "Order snapshot synced from shop",
            eventId: orderEvent.id,
          },
          trx
        );

        return { record: updated, kind: "synced" as const, previousStatus: existing.status };
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

      const orderEvent = await insertOrderEventRepo(
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

      await enqueueOrderNotification(
        "received",
        created,
        {
          previousStatus: null,
          nextStatus: created.status,
          actor: "shop",
          note: "Order received from shop",
          eventId: orderEvent.id,
        },
        trx
      );

      return { record: created, kind: "received" as const, previousStatus: null };
    });

  let result: { record: OrderRecord; kind: "synced" | "received"; previousStatus: OrderStatus | null };

  try {
    result = await runOnce();
  } catch (error) {
    if (isUniqueViolation(error)) {
      result = await runOnce();
    } else {
      throw error;
    }
  }

  publishEvent({
    domain: "orders",
    type: result.kind,
    payload: {
      id: result.record.id,
      shopOrderId: result.record.shop_order_id,
      status: result.record.status,
      previousStatus: result.previousStatus,
    },
  });

  return result.record;
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

  // Lock the row and re-check the transition inside the transaction so two
  // concurrent status changes can't both pass validation against a now-stale
  // status (TOCTOU).
  const { updated, previousStatus } = await db.transaction(async (trx) => {
    const order = await findOrderForUpdateRepo(id, trx);

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

    const result = await updateOrderRepo(
      order.id,
      {
        status: nextStatus,
      },
      trx
    );

    const actor = asText(input.actor) ?? "dashboard";
    const note = asText(input.note);

    const orderEvent = await insertOrderEventRepo(
      {
        id: makeId("oev"),
        order_id: order.id,
        type: "status_changed",
        from_status: order.status,
        to_status: nextStatus,
        actor,
        note,
        payload: JSON.stringify(input),
      },
      trx
    );

    await enqueueOrderNotification(
      "status_changed",
      result,
      {
        previousStatus: order.status,
        nextStatus,
        actor,
        note,
        eventId: orderEvent.id,
      },
      trx
    );

    return { updated: result, previousStatus: order.status };
  });

  publishEvent({
    domain: "orders",
    type: "status_changed",
    payload: {
      id: updated.id,
      shopOrderId: updated.shop_order_id,
      status: nextStatus,
      previousStatus,
    },
  });

  return updated;
}

export async function getOrdersStatusSummary() {
  const counts = await getOrderStatusCountsRepo();

  return ORDER_STATUSES.reduce<Record<OrderStatus, number>>((acc, status) => {
    acc[status] = counts[status] ?? 0;
    return acc;
  }, { ...DEFAULT_ORDER_STATUS_COUNTS });
}

// Best-effort mapping of the shop's free-form payment_status onto the three
// buckets the ops overview shows. Unrecognised values simply don't count toward
// any bucket (rather than being invented into one).
function sumPaymentBuckets(paymentStatusCounts: Record<string, number>) {
  let awaitingPrepay = 0;
  let awaitingRest = 0;
  let disputes = 0;

  for (const [status, count] of Object.entries(paymentStatusCounts)) {
    if (/dispute|chargeback|refund|conflict/.test(status)) {
      disputes += count;
    } else if (/partial|rest|balance|remain/.test(status)) {
      awaitingRest += count;
    } else if (/await|pending|unpaid|prepay|hold|new/.test(status)) {
      awaitingPrepay += count;
    }
  }

  return { awaitingPrepay, awaitingRest, disputes };
}

// Real ops-overview aggregates derived from the orders table. Replaces the
// hardcoded zeros the /api/ops/overview endpoint used to return for logistics
// and payments so the dashboard shows actual figures instead of fabricated ones.
export async function getOrdersOverview() {
  const [statusCounts, aggregates] = await Promise.all([
    getOrdersStatusSummary(),
    getOrdersOverviewAggregatesRepo(),
  ]);

  const logistics = {
    // Prepared but not yet dispatched (packing + awaiting handoff/pickup).
    new: statusCounts.Packaging + statusCounts.Pickup,
    inTransit: statusCounts.Shipment,
    delivered: statusCounts.Delivered + statusCounts.Issued,
    problem: statusCounts.Problem,
    byCarrier: aggregates.byCarrier,
  };

  const payments = {
    ...sumPaymentBuckets(aggregates.paymentStatusCounts),
    avgCheckUAH: aggregates.avgCheckUah,
  };

  return { statusCounts, logistics, payments };
}