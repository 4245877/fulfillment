// Shop watchdog — runtime: the probe loop, the HTTP surface and persistence.
//
// Everything with a side effect is injected (fetch, clock, sender, logger), so
// the tests drive the real loop against a fake shop and a fake Telegram.

import http from "node:http";
import crypto from "node:crypto";

import { describeConfig } from "./config.mjs";
import { probeShop, SHOP_STATUSES } from "./probe.mjs";
import {
  checkHeartbeat,
  drainOutbox,
  enqueueNotifications,
  initialState,
  observeHeartbeat,
  observeShop,
  outboxAgeMs,
} from "./machine.mjs";
import { loadState, saveState } from "./store.mjs";

const HEARTBEAT_BODY_LIMIT = 256 * 1024;
/** Notifications undelivered for longer than this make the watchdog "not working". */
const DELIVERY_STUCK_MS = 10 * 60_000;
/**
 * Consecutive definitive refusals of the notification channel (wrong token,
 * bot removed from the chat) before the watchdog calls itself "not working".
 * While a refusal is unconfirmed or stands, the channel is re-checked every
 * cycle — so the verdict takes about a minute, and a repaired channel is
 * noticed at once.
 */
const CHANNEL_REFUSALS_TO_CONFIRM = 3;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  // Compare digests: equal length, constant time, no early exit on length.
  const hash = (value) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(hash(left), hash(right)) && left.length === right.length;
}

/**
 * After a restart the consecutive-cycle counters describe the past. If the last
 * observation is older than a few cycles, drop them: three failures spread over
 * a night are not "three in a row". Open incidents are kept — they are facts
 * that were already reported.
 */
export function resumeState(state, config, nowMs) {
  const last = state.shop.observedAt ? Date.parse(state.shop.observedAt) : null;
  if (last === null || nowMs - last > 3 * config.intervalMs) {
    state.shop.bad = 0;
    state.shop.good = 0;
    state.shop.emptyRun = 0;
    state.shop.firstBadAt = null;
    if (state.shop.incident) state.shop.incident.changeRun = null;
  }
  return state;
}

export function createWatchdog({ config, errors = [], fetchImpl = fetch, now = () => Date.now(), send, checkChannel = null, log = () => {} }) {
  const startedMs = now();
  const loaded = errors.length ? { state: initialState(), restored: false, problem: null } : loadState(config.stateFile);
  const state = resumeState(loaded.state, config, startedMs);

  const runtime = {
    lastCycleFinishedMs: null,
    lastCycleDurationMs: null,
    cycleInFlight: null,
    saveProblem: loaded.problem,
    stopped: false,
    timer: null,
    server: null,
  };

  // The notification channel as Telegram itself last described it. Not part of
  // the persisted state: it is a fact about now, re-established at every start.
  const channel = { checkedMs: null, okMs: null, refusals: 0, error: null };
  const channelCheckOn = Boolean(checkChannel) && !errors.length && config.channelCheckMs > 0;

  if (loaded.problem) log("warn", "state was not restored", { problem: loaded.problem });
  if (loaded.restored) {
    log("info", "state restored", {
      shopIncident: state.shop.incident?.id ?? null,
      monitoringIncident: state.monitoring.incident?.id ?? null,
      outbox: state.outbox.length,
    });
  }

  function persist() {
    try {
      saveState(config.stateFile, state);
      runtime.saveProblem = null;
    } catch (error) {
      runtime.saveProblem = `state cannot be saved: ${error.code ?? error.message}`;
      log("error", "state save failed", { error: String(error.code ?? error.message) });
    }
  }

  async function deliver() {
    if (!send || state.outbox.length === 0) return 0;
    const before = state.counters.notificationsFailed;
    const delivered = await drainOutbox(state, send, now());
    if (state.counters.notificationsFailed > before) {
      const head = state.outbox[0];
      log("warn", "notification was not delivered, will retry", { key: head?.key, attempts: head?.attempts, error: head?.lastError });
    }
    if (delivered > 0) log("info", "notifications delivered", { delivered, left: state.outbox.length });
    return delivered;
  }

  /**
   * Ask Telegram whether this bot may still use the configured chat. Never throws.
   *
   * Without it a watchdog whose token was regenerated elsewhere (or whose bot was
   * removed from the group) probes happily, answers /metrics with 200 — and can
   * tell nobody about the outage it exists to report: the failure would surface
   * only with the first alert, as a message stuck in the queue.
   *
   * Only a definitive answer is a verdict. A Telegram that is unreachable, busy
   * or rate-limiting says nothing about the credentials: the previous verdict
   * stands, and undelivered messages are covered by the age of the queue.
   */
  async function verifyChannel() {
    if (!channelCheckOn) return;
    const startedAt = now();
    const due = channel.checkedMs === null || channel.refusals > 0 || startedAt - channel.checkedMs >= config.channelCheckMs;
    if (!due) return;
    channel.checkedMs = startedAt;
    try {
      await checkChannel();
      if (channel.refusals >= CHANNEL_REFUSALS_TO_CONFIRM) log("info", "notification channel works again", {});
      channel.okMs = now();
      channel.refusals = 0;
      channel.error = null;
    } catch (error) {
      if (error?.retryable !== false) return;
      channel.refusals += 1;
      channel.error = String(error?.message ?? error).slice(0, 300);
      if (channel.refusals === CHANNEL_REFUSALS_TO_CONFIRM) {
        log("error", "notification channel is refused: an outage could not be reported", { error: channel.error });
      }
    }
  }

  /** One full iteration. Never runs concurrently with itself; never throws. */
  async function cycle() {
    if (errors.length) return { skipped: "configuration" };
    if (runtime.cycleInFlight) return runtime.cycleInFlight;
    runtime.cycleInFlight = (async () => {
      const startedAt = now();
      try {
        const observation = await probeShop(config, { fetchImpl, now });
        const before = state.shop.incident?.id ?? null;
        const notifications = [
          ...observeShop(state, observation, config, now()),
          ...checkHeartbeat(state, config, now(), startedMs),
        ];
        const queued = enqueueNotifications(state, notifications, now());
        const after = state.shop.incident?.id ?? null;
        if (before !== after || queued > 0) {
          log(after ? "warn" : "info", "shop state changed", { status: state.shop.status, incident: after, queued });
        }
        // Persist BEFORE sending: a crash between the two re-sends from the
        // queue instead of forgetting the incident.
        persist();
        if ((await deliver()) > 0 || queued > 0) persist();
        await verifyChannel();
        return { status: state.shop.status, queued };
      } catch (error) {
        log("error", "cycle failed", { error: String(error?.message ?? error) });
        return { error: true };
      } finally {
        runtime.lastCycleFinishedMs = now();
        runtime.lastCycleDurationMs = runtime.lastCycleFinishedMs - startedAt;
        runtime.cycleInFlight = null;
      }
    })();
    return runtime.cycleInFlight;
  }

  /** Why this watchdog must not be trusted right now, or null. */
  function healthProblem() {
    if (errors.length) return `configuration: ${errors.join("; ")}`;
    const nowMs = now();
    const allowed = 3 * config.intervalMs + config.timeoutMs;
    const reference = runtime.lastCycleFinishedMs ?? startedMs;
    if (nowMs - reference > allowed) return "probe loop is stalled: no completed cycle recently";
    // Set when the state file could not be read or written; cleared by the next
    // successful save. A watchdog that cannot remember what it reported would
    // repeat itself after every restart.
    if (runtime.saveProblem) return runtime.saveProblem;
    if (channel.refusals >= CHANNEL_REFUSALS_TO_CONFIRM) return `notifications cannot be delivered: ${channel.error}`;
    if (outboxAgeMs(state, nowMs) > DELIVERY_STUCK_MS) return "notifications are not being delivered";
    return null;
  }

  function snapshot() {
    const nowMs = now();
    return {
      ok: healthProblem() === null,
      problem: healthProblem(),
      startedAt: new Date(startedMs).toISOString(),
      config: describeConfig(config),
      lastCycleAt: runtime.lastCycleFinishedMs ? new Date(runtime.lastCycleFinishedMs).toISOString() : null,
      lastCycleDurationMs: runtime.lastCycleDurationMs,
      shop: {
        status: state.shop.status,
        observedAt: state.shop.observedAt,
        consecutiveBad: state.shop.bad,
        consecutiveGood: state.shop.good,
        incident: state.shop.incident ? { id: state.shop.incident.id, status: state.shop.incident.status, openedAt: state.shop.incident.openedAt } : null,
        checks: state.shop.checks,
      },
      monitoring: {
        heartbeatEnabled: config.heartbeatEnabled,
        lastHeartbeatAt: state.monitoring.lastHeartbeatAt,
        heartbeats: state.monitoring.heartbeats,
        incident: state.monitoring.incident ? { id: state.monitoring.incident.id, silentSince: state.monitoring.incident.silentSince } : null,
      },
      outbox: { pending: state.outbox.length, oldestAgeMs: outboxAgeMs(state, nowMs), lastError: state.outbox[0]?.lastError ?? null },
      // What Telegram last said about the bot and the chat (no message is sent to find out).
      channel: {
        checkEnabled: channelCheckOn,
        checkedAt: channel.checkedMs ? new Date(channel.checkedMs).toISOString() : null,
        lastOkAt: channel.okMs ? new Date(channel.okMs).toISOString() : null,
        refused: channel.refusals >= CHANNEL_REFUSALS_TO_CONFIRM,
        error: channel.error,
      },
      counters: { ...state.counters },
      stateRestored: loaded.restored,
    };
  }

  function metricsText() {
    const seconds = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);
    const lines = [
      "# HELP shop_watchdog_up The external shop watchdog is probing, persisting and able to notify (always 1 here: an unhealthy watchdog answers 503)",
      "# TYPE shop_watchdog_up gauge",
      "shop_watchdog_up 1",
      "# HELP shop_watchdog_start_timestamp_seconds When this watchdog process started",
      "# TYPE shop_watchdog_start_timestamp_seconds gauge",
      `shop_watchdog_start_timestamp_seconds ${Math.floor(startedMs / 1000)}`,
      "# HELP shop_watchdog_last_cycle_timestamp_seconds When the last probe cycle finished",
      "# TYPE shop_watchdog_last_cycle_timestamp_seconds gauge",
      `shop_watchdog_last_cycle_timestamp_seconds ${runtime.lastCycleFinishedMs ? Math.floor(runtime.lastCycleFinishedMs / 1000) : 0}`,
      "# HELP shop_watchdog_shop_status What the last probe cycle saw (1 for the current status)",
      "# TYPE shop_watchdog_shop_status gauge",
      ...SHOP_STATUSES.map((status) => `shop_watchdog_shop_status{status="${status}"} ${state.shop.status === status ? 1 : 0}`),
      "# HELP shop_watchdog_incident_open An incident is open and was reported (track: shop or monitoring)",
      "# TYPE shop_watchdog_incident_open gauge",
      `shop_watchdog_incident_open{track="shop"} ${state.shop.incident ? 1 : 0}`,
      `shop_watchdog_incident_open{track="monitoring"} ${state.monitoring.incident ? 1 : 0}`,
      "# HELP shop_watchdog_heartbeat_enabled The dead-man track is armed (a heartbeat token is configured)",
      "# TYPE shop_watchdog_heartbeat_enabled gauge",
      `shop_watchdog_heartbeat_enabled ${config.heartbeatEnabled ? 1 : 0}`,
      "# HELP shop_watchdog_last_heartbeat_timestamp_seconds When the shop's Alertmanager last delivered its heartbeat (0 = never)",
      "# TYPE shop_watchdog_last_heartbeat_timestamp_seconds gauge",
      `shop_watchdog_last_heartbeat_timestamp_seconds ${seconds(state.monitoring.lastHeartbeatAt)}`,
      "# HELP shop_watchdog_channel_last_ok_timestamp_seconds When Telegram last confirmed that the bot may use the configured chat (0 = not yet, or the check is off)",
      "# TYPE shop_watchdog_channel_last_ok_timestamp_seconds gauge",
      `shop_watchdog_channel_last_ok_timestamp_seconds ${channel.okMs ? Math.floor(channel.okMs / 1000) : 0}`,
      "# HELP shop_watchdog_outbox_pending Notifications waiting for delivery",
      "# TYPE shop_watchdog_outbox_pending gauge",
      `shop_watchdog_outbox_pending ${state.outbox.length}`,
      "# HELP shop_watchdog_cycles_total Probe cycles completed",
      "# TYPE shop_watchdog_cycles_total counter",
      `shop_watchdog_cycles_total ${state.counters.cycles}`,
      "# HELP shop_watchdog_notifications_sent_total Notifications accepted by Telegram",
      "# TYPE shop_watchdog_notifications_sent_total counter",
      `shop_watchdog_notifications_sent_total ${state.counters.notificationsSent}`,
      "# HELP shop_watchdog_notifications_failed_total Failed delivery attempts",
      "# TYPE shop_watchdog_notifications_failed_total counter",
      `shop_watchdog_notifications_failed_total ${state.counters.notificationsFailed}`,
      "# HELP shop_watchdog_state_restored The state file was read at start (1) or the watchdog started clean (0)",
      "# TYPE shop_watchdog_state_restored gauge",
      `shop_watchdog_state_restored ${loaded.restored ? 1 : 0}`,
    ];
    return `${lines.join("\n")}\n`;
  }

  function reply(res, statusCode, body, type = "application/json; charset=utf-8") {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(statusCode, { "content-type": type, "cache-control": "no-store" });
    res.end(text);
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > HEARTBEAT_BODY_LIMIT) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async function handleHeartbeat(req, res) {
    if (!config.heartbeatEnabled) return reply(res, 503, { error: "heartbeat is not configured" });
    const header = String(req.headers.authorization || "");
    const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!presented || !safeEqual(presented, config.heartbeatToken)) {
      state.counters.heartbeatsRejected += 1;
      return reply(res, 401, { error: "unauthorized" });
    }
    const body = await readBody(req);
    if (body === null) return reply(res, 413, { error: "body too large" });
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }
    // Only the always-firing Watchdog alert is a heartbeat: any other alert
    // routed here by mistake must not keep the dead-man switch quiet.
    const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
    const alive = alerts.some((alert) => alert?.labels?.alertname === "Watchdog" && alert?.status === "firing");
    if (!alive) {
      state.counters.heartbeatsRejected += 1;
      return reply(res, 422, { error: "not a Watchdog heartbeat" });
    }
    const notifications = observeHeartbeat(state, config, now());
    const queued = enqueueNotifications(state, notifications, now());
    persist();
    if (queued > 0) {
      log("info", "monitoring heartbeat is back", { queued });
      if ((await deliver()) > 0) persist();
    }
    return reply(res, 200, { ok: true });
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url || "/", "http://watchdog");
      if (req.method === "GET" && url.pathname === "/health") return reply(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/status") return reply(res, 200, snapshot());
      if (req.method === "GET" && url.pathname === "/metrics") {
        const problem = healthProblem();
        // Health-gated on purpose: the shop-side Prometheus needs ONE signal —
        // `up == 0` — for "the external watcher cannot be trusted", whatever the reason.
        if (problem) return reply(res, 503, `shop watchdog is not working: ${problem}\n`, "text/plain; charset=utf-8");
        return reply(res, 200, metricsText(), "text/plain; version=0.0.4; charset=utf-8");
      }
      if (req.method === "POST" && url.pathname === "/heartbeat") return await handleHeartbeat(req, res);
      return reply(res, 404, { error: "not found" });
    } catch (error) {
      log("error", "request failed", { error: String(error?.message ?? error) });
      if (!res.headersSent) reply(res, 500, { error: "internal error" });
    }
  }

  async function start() {
    runtime.server = http.createServer((req, res) => void handle(req, res));
    await new Promise((resolve, reject) => {
      runtime.server.once("error", reject);
      runtime.server.listen(config.port, config.host, resolve);
    });
    if (errors.length) {
      log("error", "watchdog is NOT running: configuration errors", { errors });
      return;
    }
    log("info", "watchdog started", { config: describeConfig(config), restored: loaded.restored });
    void cycle();
    runtime.timer = setInterval(() => void cycle(), config.intervalMs);
  }

  /** Stop probing, let an in-flight cycle finish, persist, close the listener. */
  async function stop() {
    if (runtime.stopped) return;
    runtime.stopped = true;
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.timer = null;
    if (runtime.cycleInFlight) await runtime.cycleInFlight.catch(() => {});
    if (!errors.length) persist();
    if (runtime.server) {
      await new Promise((resolve) => {
        runtime.server.close(() => resolve());
        // Keep-alive connections (a scraper, a webhook client) would otherwise
        // hold the listener open until they time out on their own.
        runtime.server.closeAllConnections?.();
      });
    }
    log("info", "watchdog stopped", {});
  }

  return { start, stop, cycle, handle, snapshot, healthProblem, metricsText, state, address: () => runtime.server?.address() ?? null };
}
