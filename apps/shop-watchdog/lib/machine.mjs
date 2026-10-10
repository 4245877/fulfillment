// Shop watchdog — incident state machine.
//
// Pure: every function takes the state, the current time and what was observed,
// and returns notifications to enqueue. No I/O, no timers, no globals — the
// whole alerting behaviour is tested by feeding it observations.
//
// Two independent tracks:
//
//   shop        what the probes see (probe.mjs → status)
//   monitoring  the dead-man switch: the shop's own Alertmanager must POST a
//               heartbeat regularly; silence means its Prometheus/Alertmanager
//               (or the path from them) is dead, so the shop's internal alerts
//               would not reach anyone
//
// Rules that keep the owner's phone quiet until something is real:
//
//   debounce    an incident opens only after `downAfter` consecutive failed
//               cycles; it closes only after `upAfter` consecutive good ones.
//               A flapping link (ok, fail, ok, fail…) does neither.
//   one message per fact
//               open → one "down"; a CONFIRMED change of what is broken → one
//               "changed"; close → one "recovered". Each has a deterministic
//               key, so a restart or a retry cannot send it twice.
//   reminders   while an incident stays open, at most one reminder per
//               `reminderMs` (0 = none). Never a stream.
//   inhibition  heartbeat silence is not reported while the shop host itself is
//               confirmed unreachable — that outage already explains it.

import { describeChecks } from "./probe.mjs";

export const STATE_VERSION = 1;

/** Statuses that open an incident after `downAfter` cycles. */
const HARD = new Set(["unreachable", "backend_down", "not_ready", "storefront_down"]);

export const STATUS_TITLES = Object.freeze({
  unreachable: "сервер не отвечает",
  backend_down: "прокси отвечает, API недоступен",
  not_ready: "API жив, но данные не отдаёт",
  storefront_down: "витрина не открывается",
  catalog_empty: "каталог пуст",
});

const STATUS_MEANING = Object.freeze({
  unreachable: "Не отвечают ни прокси, ни API, ни витрина: выключен или недоступен сам сервер, сеть до него или nginx.",
  backend_down: "nginx отвечает, а бэкенд за ним — нет: контейнер api остановлен, перезапускается или завис.",
  not_ready: "Процесс api отвечает на /api/health, но запрос к данным каталога не проходит: база данных, схема или проекция каталога.",
  storefront_down: "API работает, но страница витрины покупателю не отдаётся: nginx или каталог статики.",
  catalog_empty: "Все проверки отвечают, но в каталоге нет ни одного товара: продажа всего каталога закрыта (пересчёт прав не завершён) или потеряна проекция.",
});

export function initialState() {
  return {
    version: STATE_VERSION,
    shop: {
      status: "unknown",
      observedAt: null,
      checks: null,
      bad: 0,
      good: 0,
      emptyRun: 0,
      firstBadAt: null,
      incident: null,
    },
    monitoring: { lastHeartbeatAt: null, heartbeats: 0, incident: null },
    outbox: [],
    sent: [],
    counters: { cycles: 0, notificationsSent: 0, notificationsFailed: 0, heartbeatsRejected: 0 },
  };
}

const iso = (ms) => new Date(ms).toISOString();
const clock = (value) => `${String(value).slice(0, 19).replace("T", " ")} UTC`;

export function humanDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "меньше минуты";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  return `${Math.floor(hours / 24)} сут ${hours % 24} ч`;
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function footer(config) {
  const lines = [`Адрес: ${escapeHtml(config.baseUrl)}`, "Источник: внешний сторож (отдельный сервер, свой канал Telegram)"];
  if (config.runbook) lines.push(`Что делать: ${escapeHtml(config.runbook)}`);
  return lines;
}

function checkLines(checks) {
  return checks ? describeChecks(checks).map((line) => `• ${escapeHtml(line)}`) : [];
}

function message(lines) {
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function enqueue(out, key, text) {
  out.push({ key, text });
}

/**
 * Feed one probe result.
 *
 * Mutates `state.shop` and returns the notifications this observation caused
 * (possibly none). `emptyCatalogAfter = 0` makes an empty catalog a healthy
 * answer; otherwise it is a slow condition with its own, longer confirmation.
 */
export function observeShop(state, observation, config, nowMs) {
  const out = [];
  const shop = state.shop;
  state.counters.cycles += 1;

  let status = observation.status;
  if (status === "catalog_empty" && config.emptyCatalogAfter === 0) status = "ok";

  shop.status = status;
  shop.observedAt = observation.observedAt ?? iso(nowMs);
  shop.checks = observation.checks ?? null;

  if (status === "ok") {
    shop.good += 1;
    shop.bad = 0;
    shop.emptyRun = 0;
    shop.firstBadAt = null;
    if (shop.incident) shop.incident.changeRun = null;

    if (shop.incident && shop.good >= config.upAfter) {
      const incident = shop.incident;
      const lasted = nowMs - Date.parse(incident.openedAt);
      enqueue(
        out,
        `${incident.id}:recovered`,
        message([
          `✅ <b>${escapeHtml(config.serviceName)}: восстановлен</b>`,
          `Было: ${STATUS_TITLES[incident.status]} — с ${clock(incident.openedAt)}, ${humanDuration(lasted)}.`,
          `Сейчас все проверки проходят (${config.upAfter} подряд):`,
          ...checkLines(shop.checks),
          ...footer(config),
        ]),
      );
      shop.incident = null;
    }
    return out;
  }

  // Not ok.
  shop.good = 0;
  if (shop.firstBadAt === null) shop.firstBadAt = shop.observedAt;
  if (status === "catalog_empty") {
    shop.emptyRun += 1;
  } else {
    shop.emptyRun = 0;
    shop.bad += 1;
  }

  const confirmed = HARD.has(status) ? shop.bad >= config.downAfter : shop.emptyRun >= config.emptyCatalogAfter;

  if (!shop.incident) {
    if (!confirmed) return out;
    const openedAt = shop.firstBadAt;
    const id = `shop:${openedAt}`;
    shop.incident = { id, status, openedAt, notifiedAt: iso(nowMs), lastReminderAt: null, reminders: 0, changes: 0, changeRun: null };
    enqueue(
      out,
      `${id}:down`,
      message([
        `🔴 <b>${escapeHtml(config.serviceName)}: ${STATUS_TITLES[status]}</b>`,
        STATUS_MEANING[status],
        `Первый отказ: ${clock(openedAt)}; подтверждён ${HARD.has(status) ? shop.bad : shop.emptyRun} проверками подряд.`,
        "Что видно снаружи:",
        ...checkLines(shop.checks),
        ...footer(config),
      ]),
    );
    return out;
  }

  const incident = shop.incident;

  // What is broken changed (e.g. the host came back but the backend did not).
  // Reported once, and only when the new picture is itself confirmed.
  if (status !== incident.status) {
    const run = incident.changeRun && incident.changeRun.status === status ? incident.changeRun : { status, count: 0 };
    run.count += 1;
    incident.changeRun = run;
    const needed = HARD.has(status) ? config.downAfter : config.emptyCatalogAfter;
    if (run.count >= needed) {
      const previous = incident.status;
      incident.status = status;
      incident.changes += 1;
      incident.changeRun = null;
      enqueue(
        out,
        `${incident.id}:changed:${incident.changes}`,
        message([
          `🔴 <b>${escapeHtml(config.serviceName)}: ${STATUS_TITLES[status]}</b>`,
          `Состояние изменилось: было «${STATUS_TITLES[previous]}», стало «${STATUS_TITLES[status]}».`,
          STATUS_MEANING[status],
          `Инцидент открыт с ${clock(incident.openedAt)} (${humanDuration(nowMs - Date.parse(incident.openedAt))}).`,
          "Что видно снаружи:",
          ...checkLines(shop.checks),
          ...footer(config),
        ]),
      );
      return out;
    }
  } else {
    incident.changeRun = null;
  }

  if (config.reminderMs > 0) {
    const since = Date.parse(incident.lastReminderAt ?? incident.notifiedAt);
    if (nowMs - since >= config.reminderMs) {
      incident.reminders += 1;
      incident.lastReminderAt = iso(nowMs);
      enqueue(
        out,
        `${incident.id}:reminder:${incident.reminders}`,
        message([
          `⏰ <b>${escapeHtml(config.serviceName)}: всё ещё ${STATUS_TITLES[incident.status]}</b>`,
          `Уже ${humanDuration(nowMs - Date.parse(incident.openedAt))} (с ${clock(incident.openedAt)}).`,
          "Что видно снаружи:",
          ...checkLines(shop.checks),
          ...footer(config),
        ]),
      );
    }
  }
  return out;
}

/** A valid heartbeat arrived from the shop's Alertmanager. */
export function observeHeartbeat(state, config, nowMs) {
  const out = [];
  const monitoring = state.monitoring;
  monitoring.lastHeartbeatAt = iso(nowMs);
  monitoring.heartbeats += 1;
  if (monitoring.incident) {
    const incident = monitoring.incident;
    enqueue(
      out,
      `${incident.id}:recovered`,
      message([
        `✅ <b>${escapeHtml(config.serviceName)}: мониторинг снова на связи</b>`,
        `Контрольный сигнал Prometheus → Alertmanager получен. Молчал с ${clock(incident.silentSince)} (${humanDuration(nowMs - Date.parse(incident.silentSince))}).`,
        ...footer(config),
      ]),
    );
    monitoring.incident = null;
  }
  return out;
}

/**
 * Check the dead-man switch.
 *
 * `processStartedMs` gives a restart its own grace: while the watchdog was
 * down it could not receive heartbeats, so silence is measured from whichever
 * is later — the last heartbeat or this process start.
 */
export function checkHeartbeat(state, config, nowMs, processStartedMs) {
  const out = [];
  if (!config.heartbeatEnabled) return out;
  const monitoring = state.monitoring;
  const last = monitoring.lastHeartbeatAt ? Date.parse(monitoring.lastHeartbeatAt) : null;
  const reference = Math.max(last ?? 0, processStartedMs);
  const silentMs = nowMs - reference;

  if (!monitoring.incident) {
    if (silentMs <= config.heartbeatMaxAgeMs) return out;
    // The host being down already explains the silence — one incident, not two.
    if (state.shop.incident?.status === "unreachable") return out;
    const silentSince = iso(last ?? processStartedMs);
    const id = `monitoring:${silentSince}`;
    monitoring.incident = { id, silentSince, notifiedAt: iso(nowMs), lastReminderAt: null, reminders: 0 };
    enqueue(
      out,
      `${id}:silent`,
      message([
        `🔴 <b>${escapeHtml(config.serviceName)}: мониторинг молчит</b>`,
        `Prometheus и Alertmanager магазина не присылают контрольный сигнал уже ${humanDuration(silentMs)} (порог ${humanDuration(config.heartbeatMaxAgeMs)}).`,
        last
          ? `Последний сигнал: ${clock(iso(last))}.`
          : `С запуска сторожа (${clock(iso(processStartedMs))}) не получено ни одного сигнала.`,
        state.shop.status === "ok"
          ? "Сам магазин при этом отвечает — значит правила не вычисляются или уведомления не уходят: внутренние алерты магазина сейчас НЕ дойдут."
          : `Магазин: ${STATUS_TITLES[state.shop.status] ?? "состояние ещё не определено"}.`,
        "Проверить на сервере магазина: node ops/prometheus/status.mjs",
        ...footer(config),
      ]),
    );
    return out;
  }

  if (config.reminderMs > 0) {
    const incident = monitoring.incident;
    const since = Date.parse(incident.lastReminderAt ?? incident.notifiedAt);
    if (nowMs - since >= config.reminderMs) {
      incident.reminders += 1;
      incident.lastReminderAt = iso(nowMs);
      enqueue(
        out,
        `${incident.id}:reminder:${incident.reminders}`,
        message([
          `⏰ <b>${escapeHtml(config.serviceName)}: мониторинг всё ещё молчит</b>`,
          `Контрольного сигнала нет ${humanDuration(nowMs - Date.parse(incident.silentSince))} (с ${clock(incident.silentSince)}).`,
          "Проверить на сервере магазина: node ops/prometheus/status.mjs",
          ...footer(config),
        ]),
      );
    }
  }
  return out;
}

// ── delivery queue ──────────────────────────────────────────────────────────

const SENT_MEMORY = 200;
const OUTBOX_LIMIT = 100;

/**
 * Put notifications into the persistent queue.
 *
 * A key that is already queued or already delivered is ignored — this is what
 * makes re-processing after a crash harmless. When the queue is full (the
 * channel has been dead for a long time) the newest reminder is dropped rather
 * than a state-changing message.
 */
export function enqueueNotifications(state, notifications, nowMs) {
  let added = 0;
  for (const notification of notifications) {
    if (state.sent.includes(notification.key)) continue;
    if (state.outbox.some((entry) => entry.key === notification.key)) continue;
    if (state.outbox.length >= OUTBOX_LIMIT && notification.key.includes(":reminder:")) continue;
    state.outbox.push({ key: notification.key, text: notification.text, createdAt: iso(nowMs), attempts: 0, lastError: null, nextAttemptAt: iso(nowMs) });
    added += 1;
  }
  return added;
}

function backoffMs(attempts) {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.min(attempts, 6));
}

/**
 * Try to deliver queued notifications, oldest first.
 *
 * Order is preserved: a failure stops the pass, so "recovered" can never
 * overtake its own "down". Delivery is at-least-once — a message is removed
 * only after the channel accepted it.
 */
export async function drainOutbox(state, send, nowMs) {
  let delivered = 0;
  while (state.outbox.length > 0) {
    const entry = state.outbox[0];
    if (Date.parse(entry.nextAttemptAt) > nowMs) break;
    try {
      await send(entry.text);
    } catch (error) {
      entry.attempts += 1;
      entry.lastError = String(error?.message ?? error).slice(0, 300);
      entry.nextAttemptAt = iso(nowMs + backoffMs(entry.attempts));
      state.counters.notificationsFailed += 1;
      break;
    }
    state.outbox.shift();
    state.sent.push(entry.key);
    if (state.sent.length > SENT_MEMORY) state.sent.splice(0, state.sent.length - SENT_MEMORY);
    state.counters.notificationsSent += 1;
    delivered += 1;
  }
  return delivered;
}

/** Age of the oldest undelivered notification, or 0. */
export function outboxAgeMs(state, nowMs) {
  return state.outbox.length ? Math.max(0, nowMs - Date.parse(state.outbox[0].createdAt)) : 0;
}
