import { randomUUID } from "node:crypto";

import type { Knex } from "knex";

import { db } from "../infra/db/knex";

const OUTBOX_TABLE = "outbox_events";
const DEFAULT_LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 5000;
// Hard cap on delivery attempts. Without it a permanently-failing retryable
// error (Telegram 5xx, or a non-Telegram error treated as retryable) would be
// re-queued and re-claimed every cycle forever; past the cap the event is
// parked in "failed" as a dead letter instead.
export const DEFAULT_MAX_OUTBOX_ATTEMPTS = 10;

type DbLike = Knex | Knex.Transaction;

export type OutboxEventStatus = "pending" | "processing" | "sent" | "failed";

export type OutboxEvent = {
  id: string;
  event_type: string;
  payload: unknown;
  dedupe_key: string | null;
  status: OutboxEventStatus;
  attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type EnqueueOutboxEventInput = {
  eventType: string;
  payload: unknown;
  dedupeKey?: string | null;
};

export type ClaimOutboxEventsInput = {
  eventTypes: readonly string[];
  limit?: number;
  lockTimeoutMs?: number;
};

export type MarkOutboxEventFailedOptions = {
  retryAfterMs?: number;
  retryable?: boolean;
  maxAttempts?: number;
};

/**
 * Decides whether a just-failed event should be re-queued. Retryable errors are
 * retried only while attempts (including this failure) stay under the cap;
 * non-retryable errors and exhausted attempts are dead-lettered.
 */
export function shouldRetryOutboxEvent(
  attemptsAfterFailure: number,
  retryable: boolean,
  maxAttempts: number = DEFAULT_MAX_OUTBOX_ATTEMPTS
): boolean {
  return retryable && attemptsAfterFailure < maxAttempts;
}

function id() {
  return `outbox_${randomUUID()}`;
}

function toIso(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function toOutboxEvent(row: any): OutboxEvent {
  return {
    id: row.id,
    event_type: row.event_type,
    payload: row.payload ?? {},
    dedupe_key: row.dedupe_key ?? null,
    status: row.status,
    attempts: Number(row.attempts || 0),
    next_attempt_at: toIso(row.next_attempt_at) || "",
    locked_at: toIso(row.locked_at),
    delivered_at: toIso(row.delivered_at),
    last_error: row.last_error ?? null,
    created_at: toIso(row.created_at) || "",
    updated_at: toIso(row.updated_at) || "",
  };
}

function truncateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

export function calculateOutboxBackoffMs(
  attemptsAfterFailure: number,
  retryAfterMs?: number
) {
  if (retryAfterMs !== undefined) {
    return Math.max(0, retryAfterMs);
  }

  const exponent = Math.max(1, Math.min(attemptsAfterFailure, 10));
  return Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, exponent));
}

export async function enqueueOutboxEvent(
  input: EnqueueOutboxEventInput,
  trx: DbLike = db
): Promise<OutboxEvent> {
  const row = {
    id: id(),
    event_type: input.eventType,
    payload: input.payload ?? {},
    dedupe_key: input.dedupeKey ?? null,
  };

  if (!row.dedupe_key) {
    const [created] = await trx(OUTBOX_TABLE).insert(row).returning("*");
    return toOutboxEvent(created);
  }

  const [created] = await trx(OUTBOX_TABLE)
    .insert(row)
    .onConflict("dedupe_key")
    .ignore()
    .returning("*");

  if (created) {
    return toOutboxEvent(created);
  }

  const existing = await trx(OUTBOX_TABLE)
    .select("*")
    .where({ dedupe_key: row.dedupe_key })
    .first();

  return toOutboxEvent(existing);
}

export async function claimOutboxEvents(
  input: ClaimOutboxEventsInput
): Promise<OutboxEvent[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
  const lockTimeoutMs = input.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleBefore = new Date(Date.now() - lockTimeoutMs);

  if (input.eventTypes.length === 0) {
    return [];
  }

  return db.transaction(async (trx) => {
    const rows = await trx(OUTBOX_TABLE)
      .select("*")
      .whereIn("event_type", input.eventTypes)
      .andWhere((builder) => {
        builder
          .where((pending) => {
            pending
              .where("status", "pending")
              .where("next_attempt_at", "<=", trx.fn.now());
          })
          .orWhere((stale) => {
            stale
              .where("status", "processing")
              .where("locked_at", "<", staleBefore);
          });
      })
      .orderBy("created_at", "asc")
      .limit(limit)
      .forUpdate()
      .skipLocked();

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row: any) => row.id);

    await trx(OUTBOX_TABLE)
      .whereIn("id", ids)
      .update({
        status: "processing",
        locked_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    const claimed = await trx(OUTBOX_TABLE)
      .select("*")
      .whereIn("id", ids)
      .orderBy("created_at", "asc");

    return claimed.map(toOutboxEvent);
  });
}

export async function markOutboxEventSent(id: string): Promise<void> {
  await db(OUTBOX_TABLE)
    .where({ id })
    .update({
      status: "sent",
      delivered_at: db.fn.now(),
      locked_at: null,
      last_error: null,
      updated_at: db.fn.now(),
    });
}

export async function markOutboxEventFailed(
  event: OutboxEvent,
  error: unknown,
  options: MarkOutboxEventFailedOptions = {}
): Promise<void> {
  const attempts = event.attempts + 1;
  const retryable = shouldRetryOutboxEvent(
    attempts,
    options.retryable ?? true,
    options.maxAttempts
  );
  const backoffMs = calculateOutboxBackoffMs(attempts, options.retryAfterMs);

  await db(OUTBOX_TABLE)
    .where({ id: event.id })
    .update({
      status: retryable ? "pending" : "failed",
      attempts: db.raw("attempts + 1"),
      next_attempt_at: retryable ? new Date(Date.now() + backoffMs) : db.fn.now(),
      locked_at: null,
      last_error: truncateError(error),
      updated_at: db.fn.now(),
    });
}
