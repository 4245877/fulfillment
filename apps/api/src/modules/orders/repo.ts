import type { Knex } from "knex";

import { db } from "../../infra/db/knex";
import type { OrderListFilters, OrderRecord } from "./types";

const ORDERS_TABLE = "fulfillment_orders";
const EVENTS_TABLE = "fulfillment_order_events";

type DbLike = Knex | Knex.Transaction;

function toOrderRecord(row: any): OrderRecord {
  return {
    ...row,
    total_uah: row.total_uah == null ? null : Number(row.total_uah),
    items: Array.isArray(row.items) ? row.items : [],
    received_at: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function listOrdersRepo(filters: OrderListFilters = {}): Promise<OrderRecord[]> {
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 300);

  const query = db(ORDERS_TABLE)
    .select("*")
    .orderBy("created_at", "desc")
    .limit(limit);

  if (filters.status && filters.status !== "all") {
    query.where("status", filters.status);
  }

  const search = String(filters.q || "").trim();

  if (search) {
    query.andWhere((builder) => {
      builder
        .whereILike("id", `%${search}%`)
        .orWhereILike("shop_order_id", `%${search}%`)
        .orWhereILike("customer_name", `%${search}%`)
        .orWhereILike("email", `%${search}%`)
        .orWhereILike("phone", `%${search}%`)
        .orWhereILike("status", `%${search}%`);
    });
  }

  const rows = await query;
  return rows.map(toOrderRecord);
}

export async function findOrderRepo(idOrShopId: string): Promise<OrderRecord | null> {
  const row = await db(ORDERS_TABLE)
    .select("*")
    .where("id", idOrShopId)
    .orWhere("shop_order_id", idOrShopId)
    .first();

  return row ? toOrderRecord(row) : null;
}

// Row-locking variant used inside a transaction so read-modify-write flows
// (status transition validation, order upsert) serialise against concurrent
// writers instead of racing (TOCTOU).
export async function findOrderForUpdateRepo(
  idOrShopId: string,
  trx: DbLike
): Promise<OrderRecord | null> {
  const row = await trx(ORDERS_TABLE)
    .select("*")
    .where("id", idOrShopId)
    .orWhere("shop_order_id", idOrShopId)
    .forUpdate()
    .first();

  return row ? toOrderRecord(row) : null;
}

export async function insertOrderRepo(
  row: Record<string, unknown>,
  trx: DbLike = db
): Promise<OrderRecord> {
  const [created] = await trx(ORDERS_TABLE).insert(row).returning("*");
  return toOrderRecord(created);
}

export async function updateOrderRepo(
  id: string,
  patch: Record<string, unknown>,
  trx: DbLike = db
): Promise<OrderRecord> {
  const [updated] = await trx(ORDERS_TABLE)
    .where({ id })
    .update({
      ...patch,
      updated_at: db.fn.now(),
    })
    .returning("*");

  return toOrderRecord(updated);
}

export async function insertOrderEventRepo(
  row: Record<string, unknown>,
  trx: DbLike = db
) {
  const [created] = await trx(EVENTS_TABLE).insert(row).returning("*");
  return created;
}

export async function listOrderEventsRepo(orderId: string) {
  return db(EVENTS_TABLE)
    .select("*")
    .where({ order_id: orderId })
    .orderBy("created_at", "desc");
}

export async function getOrderStatusCountsRepo(): Promise<Record<string, number>> {
  const rows = await db(ORDERS_TABLE)
    .select("status")
    .count<{ status: string; count: string }[]>({ count: "*" })
    .groupBy("status");

  return rows.reduce<Record<string, number>>((acc, row: any) => {
    acc[row.status] = Number(row.count || 0);
    return acc;
  }, {});
}

export async function getOrdersOverviewAggregatesRepo(): Promise<{
  avgCheckUah: number;
  byCarrier: Record<string, number>;
  paymentStatusCounts: Record<string, number>;
}> {
  const [avgRow, carrierRows, paymentRows] = await Promise.all([
    db(ORDERS_TABLE).whereNotNull("total_uah").avg<{ avg: string | null }>({ avg: "total_uah" }).first(),
    db(ORDERS_TABLE)
      .whereNotNull("shipping_method")
      .select("shipping_method")
      .count<{ shipping_method: string; count: string }[]>({ count: "*" })
      .groupBy("shipping_method"),
    db(ORDERS_TABLE)
      .whereNotNull("payment_status")
      .select("payment_status")
      .count<{ payment_status: string; count: string }[]>({ count: "*" })
      .groupBy("payment_status"),
  ]);

  const byCarrier = (carrierRows as any[]).reduce<Record<string, number>>((acc, row) => {
    acc[row.shipping_method] = Number(row.count || 0);
    return acc;
  }, {});

  const paymentStatusCounts = (paymentRows as any[]).reduce<Record<string, number>>(
    (acc, row) => {
      acc[String(row.payment_status).toLowerCase()] = Number(row.count || 0);
      return acc;
    },
    {}
  );

  return {
    avgCheckUah: Math.round(Number(avgRow?.avg || 0)),
    byCarrier,
    paymentStatusCounts,
  };
}