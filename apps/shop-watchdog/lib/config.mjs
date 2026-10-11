// Shop watchdog — configuration.
//
// Every knob is an explicit environment variable with a validated default; an
// invalid value is a configuration ERROR (reported, never silently replaced by
// something that looks like it works). Nothing is read from disk here and no
// secret has a default.

const DEFAULTS = Object.freeze({
  serviceName: "Lite Forest (магазин)",
  intervalMs: 30_000,
  timeoutMs: 5_000,
  downAfter: 3,
  upAfter: 2,
  emptyCatalogAfter: 30,
  reminderMs: 60 * 60_000,
  heartbeatMaxAgeMs: 15 * 60_000,
  stateFile: "/state/state.json",
  port: 8090,
  host: "0.0.0.0",
  telegramApiBaseUrl: "https://api.telegram.org",
  telegramTimeoutMs: 10_000,
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value, fallback) {
  const raw = text(value).toLowerCase();
  if (raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function integer(env, name, fallback, { min, max }, errors) {
  const raw = text(env[name]);
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer in [${min}, ${max}], got "${raw}"`);
    return fallback;
  }
  return value;
}

/**
 * Parse and validate the environment.
 *
 * Returns `{ config, errors }`. With errors the watchdog does NOT probe or
 * notify: it stays up, reports the reason on /status and answers /metrics with
 * 503 — the shop-side Prometheus sees its watcher as down instead of trusting
 * a half-configured one.
 */
export function loadConfig(env = process.env) {
  const errors = [];

  let baseUrl = text(env.SHOP_WATCHDOG_BASE_URL).replace(/\/+$/, "");
  if (!baseUrl) {
    errors.push("SHOP_WATCHDOG_BASE_URL is required (e.g. http://192.168.0.135)");
  } else {
    try {
      const url = new URL(baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("scheme");
      // Credentials in the URL would end up in logs and in /status.
      if (url.username || url.password) throw new Error("credentials");
      baseUrl = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      errors.push("SHOP_WATCHDOG_BASE_URL must be an http(s) URL without credentials");
    }
  }

  const telegramEnabled = bool(env.TELEGRAM_ENABLED, false);
  if (telegramEnabled === null) errors.push('TELEGRAM_ENABLED must be "true" or "false"');

  const botToken = text(env.TELEGRAM_BOT_TOKEN);
  // Destination: the API's chat and its "critical errors" topic, unless the
  // watchdog is pinned to its own (SHOP_WATCHDOG_TELEGRAM_*). A topic id means
  // something only inside its own chat, so a pinned chat never inherits the
  // API's topic: with a chat of another group Telegram would refuse every
  // message ("message thread not found") — at the moment an outage has to be
  // reported.
  const pinnedChatId = text(env.SHOP_WATCHDOG_TELEGRAM_CHAT_ID);
  const chatId = pinnedChatId || text(env.TELEGRAM_CHAT_ID);
  const threadRaw =
    text(env.SHOP_WATCHDOG_TELEGRAM_THREAD_ID) || (pinnedChatId ? "" : text(env.TELEGRAM_TOPIC_CRITICAL_ERRORS_ID));
  let messageThreadId = null;
  if (threadRaw !== "") {
    const value = Number(threadRaw);
    if (!Number.isInteger(value) || value <= 0) {
      errors.push("Telegram thread id must be a positive integer");
    } else {
      messageThreadId = value;
    }
  }
  if (telegramEnabled === true) {
    if (!botToken) errors.push("TELEGRAM_BOT_TOKEN is required when TELEGRAM_ENABLED=true");
    if (!chatId) errors.push("TELEGRAM_CHAT_ID is required when TELEGRAM_ENABLED=true");
  } else if (telegramEnabled === false) {
    // A watchdog that cannot tell anyone is not a watchdog.
    errors.push("TELEGRAM_ENABLED is not true: the watchdog has no way to notify the owner");
  }

  const heartbeatToken = text(env.SHOP_WATCHDOG_HEARTBEAT_TOKEN);
  if (heartbeatToken && heartbeatToken.length < 24) {
    errors.push("SHOP_WATCHDOG_HEARTBEAT_TOKEN must be at least 24 characters");
  }

  const config = {
    serviceName: text(env.SHOP_WATCHDOG_SERVICE_NAME) || DEFAULTS.serviceName,
    baseUrl,
    intervalMs: integer(env, "SHOP_WATCHDOG_INTERVAL_MS", DEFAULTS.intervalMs, { min: 1_000, max: 3_600_000 }, errors),
    timeoutMs: integer(env, "SHOP_WATCHDOG_TIMEOUT_MS", DEFAULTS.timeoutMs, { min: 200, max: 60_000 }, errors),
    downAfter: integer(env, "SHOP_WATCHDOG_DOWN_AFTER", DEFAULTS.downAfter, { min: 1, max: 100 }, errors),
    upAfter: integer(env, "SHOP_WATCHDOG_UP_AFTER", DEFAULTS.upAfter, { min: 1, max: 100 }, errors),
    // 0 disables the "catalog is empty" condition.
    emptyCatalogAfter: integer(env, "SHOP_WATCHDOG_EMPTY_CATALOG_AFTER", DEFAULTS.emptyCatalogAfter, { min: 0, max: 10_000 }, errors),
    // 0 disables reminders while an incident stays open.
    reminderMs: integer(env, "SHOP_WATCHDOG_REMINDER_MS", DEFAULTS.reminderMs, { min: 0, max: 7 * 86_400_000 }, errors),
    heartbeatToken,
    // The dead-man track is armed only when a token is configured: without it
    // nobody can send a heartbeat, and "silence" would mean nothing.
    heartbeatEnabled: Boolean(heartbeatToken),
    heartbeatMaxAgeMs: integer(env, "SHOP_WATCHDOG_HEARTBEAT_MAX_AGE_MS", DEFAULTS.heartbeatMaxAgeMs, { min: 60_000, max: 86_400_000 }, errors),
    stateFile: text(env.SHOP_WATCHDOG_STATE_FILE) || DEFAULTS.stateFile,
    runbook: text(env.SHOP_WATCHDOG_RUNBOOK),
    // 0 = any free port (tests); the compose service sets it explicitly.
    port: integer(env, "PORT", DEFAULTS.port, { min: 0, max: 65_535 }, errors),
    host: text(env.HOST) || DEFAULTS.host,
    telegram: {
      enabled: telegramEnabled === true,
      botToken,
      chatId,
      chatSource: pinnedChatId ? "watchdog" : "api",
      messageThreadId,
      apiBaseUrl: (text(env.SHOP_WATCHDOG_TELEGRAM_API_BASE_URL) || DEFAULTS.telegramApiBaseUrl).replace(/\/+$/, ""),
      timeoutMs: integer(env, "TELEGRAM_REQUEST_TIMEOUT_MS", DEFAULTS.telegramTimeoutMs, { min: 500, max: 120_000 }, errors),
    },
  };

  if (config.timeoutMs >= config.intervalMs) {
    errors.push("SHOP_WATCHDOG_TIMEOUT_MS must be smaller than SHOP_WATCHDOG_INTERVAL_MS");
  }

  return { config, errors };
}

/** The configuration as it may be shown to a human or a log: no secrets. */
export function describeConfig(config) {
  return {
    serviceName: config.serviceName,
    baseUrl: config.baseUrl,
    intervalMs: config.intervalMs,
    timeoutMs: config.timeoutMs,
    downAfter: config.downAfter,
    upAfter: config.upAfter,
    emptyCatalogAfter: config.emptyCatalogAfter,
    reminderMs: config.reminderMs,
    heartbeatEnabled: config.heartbeatEnabled,
    heartbeatMaxAgeMs: config.heartbeatMaxAgeMs,
    telegram: {
      enabled: config.telegram.enabled,
      chatConfigured: Boolean(config.telegram.chatId),
      // Whose chat it is, not which: "watchdog" = pinned by SHOP_WATCHDOG_TELEGRAM_CHAT_ID,
      // "api" = the fulfillment API's own chat.
      chatSource: config.telegram.chatSource,
      thread: config.telegram.messageThreadId,
    },
  };
}
