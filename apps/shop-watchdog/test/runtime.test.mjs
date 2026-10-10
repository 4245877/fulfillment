// The real loop against a fake shop and a fake Telegram: what the owner would
// actually receive, including across a restart of the watchdog itself.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createWatchdog } from "../lib/runtime.mjs";
import { createTelegramSender } from "../lib/telegram.mjs";
import { BOT_TOKEN, HEARTBEAT_TOKEN, fakeClock, fakeShop, fakeTelegram, tempStateFile, testConfig, watchdogWebhook } from "./helpers.mjs";

const STEP = 30_000;
let shop;
let telegram;
let store;
let clock;
let logs;
const running = [];

beforeEach(async () => {
  shop = await fakeShop();
  telegram = await fakeTelegram();
  store = tempStateFile();
  clock = fakeClock();
  logs = [];
});

afterEach(async () => {
  for (const watchdog of running.splice(0)) await watchdog.stop();
  await shop.down();
  await telegram.close();
  store.cleanup();
});

function boot(overrides = {}) {
  const { config, errors } = testConfig({ shopUrl: shop.url, telegramUrl: telegram.url, stateFile: store.file, overrides });
  const watchdog = createWatchdog({
    config,
    errors,
    now: clock,
    send: errors.length ? null : createTelegramSender(config.telegram),
    log: (level, msg, fields) => logs.push(JSON.stringify({ level, msg, ...fields })),
  });
  running.push(watchdog);
  return watchdog;
}

/** Run `n` cycles, one per interval of fake time. */
async function cycles(watchdog, n) {
  for (let i = 0; i < n; i += 1) {
    await watchdog.cycle();
    clock.advance(STEP);
  }
}

const texts = () => telegram.messages.map((m) => m.text);

async function request(watchdog, method, path, { token, body } = {}) {
  const { port } = watchdog.address();
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
}

test("S4/S5: the shop server disappears → one alert; it comes back → one recovery", async () => {
  const watchdog = boot();
  await cycles(watchdog, 4);
  assert.equal(telegram.messages.length, 0, "a healthy shop is silent");

  await shop.down();
  await cycles(watchdog, 2);
  assert.equal(telegram.messages.length, 0, "two failed cycles are not yet an outage");
  await cycles(watchdog, 1);
  assert.equal(telegram.messages.length, 1);
  const down = telegram.messages[0];
  assert.match(down.text, /🔴 <b>Lite Forest \(магазин\): сервер не отвечает<\/b>/);
  assert.match(down.text, /ECONNREFUSED/);
  assert.equal(down.chat_id, "-1001234567890");
  assert.equal(down.message_thread_id, 7, "the critical-errors topic");
  assert.equal(down.parse_mode, "HTML");

  await cycles(watchdog, 20);
  assert.equal(telegram.messages.length, 1, "ten more minutes of outage: still one message");

  await shop.up();
  await cycles(watchdog, 1);
  assert.equal(telegram.messages.length, 1, "one good cycle is not yet a recovery");
  await cycles(watchdog, 1);
  assert.equal(telegram.messages.length, 2);
  assert.match(telegram.messages[1].text, /✅ <b>Lite Forest \(магазин\): восстановлен<\/b>/);
  assert.match(telegram.messages[1].text, /Было: сервер не отвечает/);
});

test("each kind of failure is named for what it is", async () => {
  const expected = {
    backend_down: /прокси отвечает, API недоступен/,
    not_ready: /API жив, но данные не отдаёт/,
    storefront_down: /витрина не открывается/,
  };
  for (const [mode, title] of Object.entries(expected)) {
    telegram.messages.length = 0;
    fs.rmSync(store.file, { force: true });
    const watchdog = boot();
    shop.mode = mode;
    await cycles(watchdog, 3);
    assert.equal(telegram.messages.length, 1, mode);
    assert.match(telegram.messages[0].text, title, mode);
    shop.mode = "ok";
    await cycles(watchdog, 2);
    assert.equal(telegram.messages.length, 2, `${mode}: recovered`);
    await watchdog.stop();
  }
});

test("S6: the watchdog restarts in the middle of an outage — no second alert, the recovery is still announced", async () => {
  let watchdog = boot();
  await shop.down();
  await cycles(watchdog, 3);
  assert.equal(telegram.messages.length, 1);
  const incident = watchdog.snapshot().shop.incident;
  assert.ok(incident);
  await watchdog.stop();

  // A new process on the same state volume, a minute later.
  clock.advance(60_000);
  watchdog = boot();
  assert.equal(watchdog.snapshot().stateRestored, true);
  assert.deepEqual(watchdog.snapshot().shop.incident, incident, "the open incident survived the restart");
  await cycles(watchdog, 10);
  assert.equal(telegram.messages.length, 1, "the outage is not reported again");

  await shop.up();
  await cycles(watchdog, 2);
  assert.equal(telegram.messages.length, 2);
  assert.match(telegram.messages[1].text, /восстановлен/);
  assert.match(telegram.messages[1].text, new RegExp(incident.openedAt.slice(0, 19).replace("T", " ")), "with the original start time");
});

test("S6: many restarts in a row do not turn into a flood", async () => {
  await shop.down();
  for (let i = 0; i < 8; i += 1) {
    const watchdog = boot();
    await cycles(watchdog, 4);
    await watchdog.stop();
    clock.advance(10_000);
  }
  assert.equal(telegram.messages.length, 1, "eight restarts during one outage: one alert");
});

test("a restart after a long pause does not count stale failures as 'in a row'", async () => {
  let watchdog = boot();
  await shop.down();
  await cycles(watchdog, 2); // two failures, not yet confirmed
  await watchdog.stop();
  await shop.up();
  clock.advance(6 * 3_600_000); // the watchdog was off for six hours; the shop is fine now
  await shop.down();
  watchdog = boot();
  await cycles(watchdog, 1);
  assert.equal(telegram.messages.length, 0, "one fresh failure after a six-hour gap is not the third in a row");
  await cycles(watchdog, 2);
  assert.equal(telegram.messages.length, 1, "three fresh ones are");
});

test("Telegram is down during the outage: nothing is lost, messages arrive later in order", async () => {
  const watchdog = boot();
  telegram.mode = "fail500";
  await shop.down();
  await cycles(watchdog, 3);
  assert.equal(telegram.messages.length, 0);
  assert.equal(watchdog.snapshot().outbox.pending, 1, "queued, not dropped");
  await shop.up();
  await cycles(watchdog, 2);
  assert.equal(watchdog.snapshot().outbox.pending, 2, "down and recovered both wait");

  telegram.mode = "ok";
  clock.advance(20 * 60_000); // past any backoff
  await cycles(watchdog, 1);
  assert.equal(telegram.messages.length, 2);
  assert.match(telegram.messages[0].text, /сервер не отвечает/);
  assert.match(telegram.messages[1].text, /восстановлен/);
  assert.equal(watchdog.snapshot().outbox.pending, 0);
});

test("the queue survives a restart: an undelivered alert is sent by the next process", async () => {
  let watchdog = boot();
  telegram.mode = "fail500";
  await shop.down();
  await cycles(watchdog, 3);
  await watchdog.stop();
  assert.equal(telegram.messages.length, 0);

  telegram.mode = "ok";
  clock.advance(20 * 60_000);
  watchdog = boot();
  await cycles(watchdog, 1);
  assert.equal(telegram.messages.length, 1);
  assert.match(telegram.messages[0].text, /сервер не отвечает/);
});

const WITH_HEARTBEAT = { SHOP_WATCHDOG_HEARTBEAT_TOKEN: HEARTBEAT_TOKEN };

test("dead-man switch: heartbeats keep it quiet; silence is reported; the next heartbeat announces recovery", async () => {
  const watchdog = boot(WITH_HEARTBEAT);
  await watchdog.start();
  const beat = () => request(watchdog, "POST", "/heartbeat", { token: HEARTBEAT_TOKEN, body: watchdogWebhook() });

  for (let i = 0; i < 6; i += 1) {
    assert.equal((await beat()).status, 200);
    await cycles(watchdog, 10); // five minutes
  }
  assert.equal(telegram.messages.length, 0, "regular heartbeats: silence");

  await cycles(watchdog, 40); // twenty minutes without a heartbeat; the shop itself answers
  assert.equal(telegram.messages.length, 1);
  assert.match(telegram.messages[0].text, /мониторинг молчит/);
  assert.match(telegram.messages[0].text, /Сам магазин при этом отвечает/);
  await cycles(watchdog, 20);
  assert.equal(telegram.messages.length, 1, "one message, not one per cycle");

  assert.equal((await beat()).status, 200);
  assert.equal(telegram.messages.length, 2);
  assert.match(telegram.messages[1].text, /мониторинг снова на связи/);
});

test("the heartbeat endpoint accepts only the shop's Watchdog alert with the shared token", async () => {
  const watchdog = boot(WITH_HEARTBEAT);
  await watchdog.start();
  assert.equal((await request(watchdog, "POST", "/heartbeat", { body: watchdogWebhook() })).status, 401, "no token");
  assert.equal((await request(watchdog, "POST", "/heartbeat", { token: "wrong-token-wrong-token-wrong-token", body: watchdogWebhook() })).status, 401);
  assert.equal((await request(watchdog, "POST", "/heartbeat", { token: HEARTBEAT_TOKEN.slice(0, -1), body: watchdogWebhook() })).status, 401, "a prefix is not the token");
  const other = watchdogWebhook({ alerts: [{ status: "firing", labels: { alertname: "BackupStale" } }] });
  assert.equal((await request(watchdog, "POST", "/heartbeat", { token: HEARTBEAT_TOKEN, body: other })).status, 422, "another alert is not a heartbeat");
  const resolved = watchdogWebhook({ alerts: [{ status: "resolved", labels: { alertname: "Watchdog" } }] });
  assert.equal((await request(watchdog, "POST", "/heartbeat", { token: HEARTBEAT_TOKEN, body: resolved })).status, 422);
  assert.equal(watchdog.snapshot().monitoring.lastHeartbeatAt, null, "none of the above counted");
  assert.equal(watchdog.snapshot().counters.heartbeatsRejected, 5);

  assert.equal((await request(watchdog, "POST", "/heartbeat", { token: HEARTBEAT_TOKEN, body: watchdogWebhook() })).status, 200);
  assert.ok(watchdog.snapshot().monitoring.lastHeartbeatAt);
  assert.equal((await request(watchdog, "GET", "/heartbeat")).status, 404);
});

test("without a token the heartbeat endpoint is closed and silence is never reported", async () => {
  const watchdog = boot();
  await watchdog.start();
  assert.equal((await request(watchdog, "POST", "/heartbeat", { token: HEARTBEAT_TOKEN, body: watchdogWebhook() })).status, 503);
  clock.advance(24 * 3_600_000);
  await cycles(watchdog, 3);
  assert.equal(telegram.messages.length, 0);
  assert.match((await request(watchdog, "GET", "/metrics")).text, /^shop_watchdog_heartbeat_enabled 0$/m);
});

test("/metrics: exposition when the watchdog works, 503 with the reason when it cannot be trusted", async () => {
  const watchdog = boot(WITH_HEARTBEAT);
  await watchdog.start();
  await cycles(watchdog, 1);
  const healthy = await request(watchdog, "GET", "/metrics");
  assert.equal(healthy.status, 200);
  assert.match(healthy.type, /text\/plain; version=0\.0\.4/);
  assert.match(healthy.text, /^shop_watchdog_up 1$/m);
  assert.match(healthy.text, /^shop_watchdog_shop_status\{status="ok"\} 1$/m);
  assert.match(healthy.text, /^shop_watchdog_incident_open\{track="shop"\} 0$/m);
  assert.match(healthy.text, /^shop_watchdog_heartbeat_enabled 1$/m);
  // Every sample line is `name{labels} number`: a scraper must be able to parse it.
  for (const line of healthy.text.split("\n").filter((l) => l && !l.startsWith("#"))) {
    assert.match(line, /^[a-z_]+(\{[a-z_]+="[a-z_]+"\})? -?\d+(\.\d+)?$/, line);
  }

  // The loop stops completing cycles (hung process, stopped timer).
  clock.advance(10 * 60_000);
  const stalled = await request(watchdog, "GET", "/metrics");
  assert.equal(stalled.status, 503);
  assert.match(stalled.text, /probe loop is stalled/);
  assert.equal((await request(watchdog, "GET", "/health")).status, 200, "liveness is a different question");

  // Delivery is stuck: the watchdog sees the outage but cannot tell anyone.
  telegram.mode = "reject400";
  await shop.down();
  await cycles(watchdog, 3);
  clock.advance(11 * 60_000);
  await watchdog.cycle();
  const mute = await request(watchdog, "GET", "/metrics");
  assert.equal(mute.status, 503);
  assert.match(mute.text, /notifications are not being delivered/);
});

test("a misconfigured watchdog does not pretend: it probes nothing and reports why", async () => {
  const watchdog = boot({ TELEGRAM_ENABLED: "false" });
  await watchdog.start();
  await shop.down();
  await cycles(watchdog, 5);
  assert.equal(telegram.attempts, 0);
  const metrics = await request(watchdog, "GET", "/metrics");
  assert.equal(metrics.status, 503);
  assert.match(metrics.text, /configuration: .*no way to notify/);
  assert.equal(JSON.parse((await request(watchdog, "GET", "/status")).text).ok, false);
});

test("/status and the logs never contain a secret", async () => {
  const watchdog = boot(WITH_HEARTBEAT);
  await watchdog.start();
  telegram.mode = "fail500";
  await shop.down();
  await cycles(watchdog, 4);
  await request(watchdog, "POST", "/heartbeat", { token: HEARTBEAT_TOKEN, body: watchdogWebhook() });
  const status = (await request(watchdog, "GET", "/status")).text;
  const everything = `${status}\n${logs.join("\n")}\n${(await request(watchdog, "GET", "/metrics")).text}`;
  assert.ok(!everything.includes(BOT_TOKEN), "bot token");
  assert.ok(!everything.includes(HEARTBEAT_TOKEN), "heartbeat token");
  assert.ok(!everything.includes("-1001234567890"), "chat id");
  assert.ok(logs.some((line) => line.includes("notification was not delivered")), "the failure itself is logged");
});

test("a corrupt state file is set aside and the watchdog starts clean", async () => {
  fs.writeFileSync(store.file, "{ this is not json");
  const watchdog = boot();
  assert.equal(watchdog.snapshot().stateRestored, false);
  assert.ok(fs.readdirSync(store.dir).some((name) => name.includes(".corrupt-")), "kept for inspection");
  await cycles(watchdog, 1);
  assert.equal(watchdog.healthProblem(), null, "and works: the next save succeeded");
  assert.equal(JSON.parse(fs.readFileSync(store.file, "utf8")).version, 1);
});

test("state that cannot be written makes the watchdog report itself as not working", async () => {
  // The "directory" of the state file is a regular file: nothing can be created in it.
  const blocker = `${store.dir}/not-a-directory`;
  fs.writeFileSync(blocker, "x");
  const watchdog = boot({ SHOP_WATCHDOG_STATE_FILE: `${blocker}/state.json` });
  await cycles(watchdog, 1);
  assert.match(String(watchdog.healthProblem()), /state (cannot be saved|file is not readable)/);
  await shop.down();
  await cycles(watchdog, 3);
  assert.equal(telegram.messages.length, 1, "it still watches and notifies — it just cannot be trusted across a restart");
});

test("stop is graceful: the state is on disk and the listener is closed", async () => {
  const watchdog = boot();
  await watchdog.start();
  await shop.down();
  await cycles(watchdog, 3);
  const { port } = watchdog.address();
  await watchdog.stop();
  const saved = JSON.parse(fs.readFileSync(store.file, "utf8"));
  assert.equal(saved.shop.incident.status, "unreachable");
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/health`), "the port is released");
});
