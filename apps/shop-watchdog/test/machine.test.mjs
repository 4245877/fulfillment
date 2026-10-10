import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkHeartbeat,
  drainOutbox,
  enqueueNotifications,
  humanDuration,
  initialState,
  observeHeartbeat,
  observeShop,
  outboxAgeMs,
} from "../lib/machine.mjs";

const T0 = Date.parse("2026-10-10T12:00:00.000Z");
const STEP = 30_000;

const config = (overrides = {}) => ({
  serviceName: "Lite Forest (магазин)",
  baseUrl: "http://192.168.0.135",
  runbook: "docs/alerts.md § «Внешний сторож»",
  intervalMs: STEP,
  downAfter: 3,
  upAfter: 2,
  emptyCatalogAfter: 30,
  reminderMs: 3_600_000,
  heartbeatEnabled: true,
  heartbeatMaxAgeMs: 900_000,
  ...overrides,
});

const ok = { ok: true, kind: "ok", durationMs: 3 };
const refused = { ok: false, kind: "network", detail: "ECONNREFUSED" };
const CHECKS = {
  ok: { edge: ok, api: ok, catalog: { ...ok, empty: false }, storefront: ok },
  unreachable: { edge: refused, api: refused, catalog: refused, storefront: refused },
  backend_down: { edge: ok, api: { ok: false, kind: "http", detail: "HTTP 502" }, catalog: { ok: false, kind: "http", detail: "HTTP 502" }, storefront: ok },
  not_ready: { edge: ok, api: ok, catalog: { ok: false, kind: "http", detail: "HTTP 500" }, storefront: ok },
  catalog_empty: { edge: ok, api: ok, catalog: { ...ok, empty: true }, storefront: ok },
};

/** Feed a sequence of statuses, one per cycle; returns every notification with its cycle index. */
function run(state, cfg, statuses, startMs = T0) {
  const out = [];
  statuses.forEach((status, index) => {
    const nowMs = startMs + index * STEP;
    const notifications = observeShop(state, { status, checks: CHECKS[status], observedAt: new Date(nowMs).toISOString() }, cfg, nowMs);
    for (const n of notifications) out.push({ cycle: index, ...n });
  });
  return out;
}

test("debounce: one or two failed cycles are a blip; the third confirms the outage — exactly one message", () => {
  const state = initialState();
  const sent = run(state, config(), ["ok", "unreachable", "unreachable", "ok", "unreachable", "unreachable", "unreachable"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cycle, 6, "raised on the third consecutive failure");
  assert.match(sent[0].key, /:down$/);
  assert.equal(state.shop.incident.status, "unreachable");
});

test("the outage message identifies the service, the failure, the time and what was observed", () => {
  const state = initialState();
  const [down] = run(state, config(), ["unreachable", "unreachable", "unreachable"]);
  assert.match(down.text, /🔴 <b>Lite Forest \(магазин\): сервер не отвечает<\/b>/);
  assert.match(down.text, /Первый отказ: 2026-10-10 12:00:00 UTC; подтверждён 3 проверками подряд/);
  assert.match(down.text, /прокси \/nginx-healthz: ECONNREFUSED/);
  assert.match(down.text, /API \/api\/health: ECONNREFUSED/);
  assert.match(down.text, /Адрес: http:\/\/192\.168\.0\.135/);
  assert.match(down.text, /внешний сторож/);
  assert.match(down.text, /Что делать: docs\/alerts\.md/);
  assert.equal(state.shop.incident.openedAt, "2026-10-10T12:00:00.000Z", "the incident starts at the FIRST failed cycle, not at confirmation");
});

test("a long outage produces one message, not a stream; reminders are bounded by the cooldown", () => {
  const state = initialState();
  // 6 hours of failures at 30 s = 720 cycles.
  const sent = run(state, config(), Array(720).fill("unreachable"));
  const down = sent.filter((n) => n.key.endsWith(":down"));
  const reminders = sent.filter((n) => n.key.includes(":reminder:"));
  assert.equal(down.length, 1);
  assert.equal(reminders.length, 5, "one reminder per hour over six hours");
  assert.equal(sent.length, 6);
  assert.match(reminders[0].text, /⏰ <b>Lite Forest \(магазин\): всё ещё сервер не отвечает<\/b>/);
  assert.equal(new Set(sent.map((n) => n.key)).size, sent.length, "every message has its own key");

  const quiet = initialState();
  assert.equal(run(quiet, config({ reminderMs: 0 }), Array(720).fill("unreachable")).length, 1, "reminders can be turned off");
});

test("recovery needs consecutive good cycles and is announced once, with the duration", () => {
  const state = initialState();
  const sent = run(state, config(), [
    "unreachable", "unreachable", "unreachable", // down at 2
    "ok", "unreachable", // one lucky poll inside an outage is not a recovery
    "ok", "ok", // recovered at 6
    "ok", "ok", "ok",
  ]);
  assert.deepEqual(sent.map((n) => [n.cycle, n.key.split(":").pop()]), [[2, "down"], [6, "recovered"]]);
  assert.match(sent[1].text, /✅ <b>Lite Forest \(магазин\): восстановлен<\/b>/);
  assert.match(sent[1].text, /Было: сервер не отвечает — с 2026-10-10 12:00:00 UTC, 3 мин/);
  assert.equal(state.shop.incident, null);
});

test("flapping (ok, fail, ok, fail…) neither opens an incident nor closes one", () => {
  const flapping = Array.from({ length: 60 }, (_, i) => (i % 2 ? "unreachable" : "ok"));
  assert.equal(run(initialState(), config(), flapping).length, 0);

  const state = initialState();
  const sent = run(state, config(), ["unreachable", "unreachable", "unreachable", ...flapping]);
  assert.equal(sent.length, 1, "only the original outage; no recovered/down ping-pong");
  assert.ok(state.shop.incident, "still open");
});

test("a new outage after a recovery is a new incident with a new key", () => {
  const state = initialState();
  const sent = run(state, config(), ["unreachable", "unreachable", "unreachable", "ok", "ok", "unreachable", "unreachable", "unreachable"]);
  assert.deepEqual(sent.map((n) => n.key.split(":").pop()), ["down", "recovered", "down"]);
  assert.notEqual(sent[0].key, sent[2].key);
});

test("what is broken changed: reported once, after the new picture is itself confirmed", () => {
  const state = initialState();
  const sent = run(state, config(), [
    "unreachable", "unreachable", "unreachable", // down
    "backend_down", "unreachable", // not confirmed: a single different reading
    "backend_down", "backend_down", "backend_down", // changed at 7
    "backend_down", "backend_down",
  ]);
  assert.deepEqual(sent.map((n) => [n.cycle, n.key.match(/:(down|recovered|changed:\d+|reminder:\d+)$/)[1]]), [[2, "down"], [7, "changed:1"]]);
  assert.match(sent[1].text, /Состояние изменилось: было «сервер не отвечает», стало «прокси отвечает, API недоступен»/);
  assert.equal(state.shop.incident.status, "backend_down");
});

test("an empty catalog is a slow condition with its own threshold; 0 turns it off", () => {
  const state = initialState();
  const sent = run(state, config({ emptyCatalogAfter: 5 }), Array(12).fill("catalog_empty"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cycle, 4);
  assert.match(sent[0].text, /каталог пуст/);
  assert.match(sent[0].text, /каталог \/api\/products: 200, товаров нет/);

  assert.equal(run(initialState(), config({ emptyCatalogAfter: 0 }), Array(200).fill("catalog_empty")).length, 0);
  // Disabled means "healthy answer": it also closes an open incident.
  const recovering = initialState();
  const closed = run(recovering, config({ emptyCatalogAfter: 0 }), ["unreachable", "unreachable", "unreachable", "catalog_empty", "catalog_empty"]);
  assert.deepEqual(closed.map((n) => n.key.split(":").pop()), ["down", "recovered"]);
});

test("heartbeat: silence longer than the limit opens one incident; a heartbeat closes it", () => {
  const state = initialState();
  const cfg = config();
  const started = T0;
  observeHeartbeat(state, cfg, T0);
  assert.deepEqual(checkHeartbeat(state, cfg, T0 + 14 * 60_000, started), [], "within the limit");
  const silent = checkHeartbeat(state, cfg, T0 + 16 * 60_000, started);
  assert.equal(silent.length, 1);
  assert.match(silent[0].key, /^monitoring:.*:silent$/);
  assert.match(silent[0].text, /🔴 <b>Lite Forest \(магазин\): мониторинг молчит<\/b>/);
  assert.match(silent[0].text, /Последний сигнал: 2026-10-10 12:00:00 UTC/);
  assert.match(silent[0].text, /node ops\/prometheus\/status\.mjs/);
  assert.deepEqual(checkHeartbeat(state, cfg, T0 + 17 * 60_000, started), [], "one message, not one per cycle");

  const back = observeHeartbeat(state, cfg, T0 + 40 * 60_000);
  assert.equal(back.length, 1);
  assert.match(back[0].text, /✅ <b>Lite Forest \(магазин\): мониторинг снова на связи<\/b>/);
  assert.match(back[0].text, /40 мин/);
  assert.equal(state.monitoring.incident, null);
});

test("heartbeat: never received since start is reported as such; a restart gets its own grace", () => {
  const cfg = config();
  const state = initialState();
  const started = T0;
  assert.deepEqual(checkHeartbeat(state, cfg, T0 + 10 * 60_000, started), []);
  const never = checkHeartbeat(state, cfg, T0 + 16 * 60_000, started);
  assert.match(never[0].text, /не получено ни одного сигнала/);

  // The watchdog was down for an hour: silence is measured from its restart.
  const restarted = initialState();
  observeHeartbeat(restarted, cfg, T0);
  const restartAt = T0 + 60 * 60_000;
  assert.deepEqual(checkHeartbeat(restarted, cfg, restartAt + 60_000, restartAt), [], "no false alarm right after a restart");
  assert.equal(checkHeartbeat(restarted, cfg, restartAt + 16 * 60_000, restartAt).length, 1, "but real silence is still caught");
});

test("heartbeat silence is not a second incident while the host itself is confirmed unreachable", () => {
  const cfg = config();
  const state = initialState();
  observeHeartbeat(state, cfg, T0);
  run(state, cfg, ["unreachable", "unreachable", "unreachable"]);
  assert.deepEqual(checkHeartbeat(state, cfg, T0 + 30 * 60_000, T0), [], "the outage already explains the silence");

  // The host is back, the monitoring is still silent → now it is reported.
  run(state, cfg, ["ok", "ok"], T0 + 31 * 60_000);
  assert.equal(state.shop.incident, null);
  assert.equal(checkHeartbeat(state, cfg, T0 + 33 * 60_000, T0).length, 1);
});

test("the dead-man track is off without a token", () => {
  assert.deepEqual(checkHeartbeat(initialState(), config({ heartbeatEnabled: false }), T0 + 86_400_000, T0), []);
});

test("delivery queue: order is kept, a failure stops the pass, nothing is lost or sent twice", async () => {
  const state = initialState();
  const a = { key: "shop:x:down", text: "A" };
  const b = { key: "shop:x:recovered", text: "B" };
  assert.equal(enqueueNotifications(state, [a, b], T0), 2);
  assert.equal(enqueueNotifications(state, [a], T0), 0, "already queued");

  const delivered = [];
  let fail = true;
  const send = async (text) => {
    if (fail) throw new Error("Telegram is unreachable (ECONNREFUSED)");
    delivered.push(text);
  };
  assert.equal(await drainOutbox(state, send, T0), 0);
  assert.equal(state.outbox.length, 2, "kept for a retry");
  assert.equal(state.outbox[0].attempts, 1);
  assert.match(state.outbox[0].lastError, /unreachable/);
  assert.equal(state.counters.notificationsFailed, 1);

  fail = false;
  assert.equal(await drainOutbox(state, send, T0 + 1000), 0, "backoff: not before the next attempt time");
  assert.equal(await drainOutbox(state, send, T0 + 60_000), 2);
  assert.deepEqual(delivered, ["A", "B"], "recovered never overtakes its own down");
  assert.equal(state.outbox.length, 0);
  assert.equal(outboxAgeMs(state, T0 + 60_000), 0);
  assert.equal(enqueueNotifications(state, [a, b], T0 + 61_000), 0, "delivered keys are remembered: a replay after a crash sends nothing");
});

test("a dead channel cannot grow the queue without bound, and never at the cost of a state change", () => {
  const state = initialState();
  const reminders = Array.from({ length: 150 }, (_, i) => ({ key: `shop:x:reminder:${i}`, text: `r${i}` }));
  enqueueNotifications(state, reminders, T0);
  assert.equal(state.outbox.length, 100);
  assert.equal(enqueueNotifications(state, [{ key: "shop:x:recovered", text: "back" }], T0), 1, "a state change is always queued");
});

test("durations read like a person would say them", () => {
  assert.equal(humanDuration(20_000), "меньше минуты");
  assert.equal(humanDuration(5 * 60_000), "5 мин");
  assert.equal(humanDuration(125 * 60_000), "2 ч 5 мин");
  assert.equal(humanDuration(3 * 86_400_000), "3 сут 0 ч");
});

test("text from the outside world cannot break the message markup", () => {
  const state = initialState();
  const hostile = { ok: false, kind: "body", detail: 'витрина отдала <script>alert("x")</script> & co' };
  const cfg = config({ serviceName: "Shop <b>&" });
  const checks = { ...CHECKS.ok, storefront: hostile };
  let sent = [];
  for (let i = 0; i < 3; i += 1) {
    sent = sent.concat(observeShop(state, { status: "storefront_down", checks, observedAt: new Date(T0 + i * STEP).toISOString() }, cfg, T0 + i * STEP));
  }
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].text.includes("<script>"));
  assert.match(sent[0].text, /&lt;script&gt;/);
  assert.match(sent[0].text, /Shop &lt;b&gt;&amp;/);
});
