import { test } from "node:test";
import assert from "node:assert/strict";

import { describeConfig, loadConfig } from "../lib/config.mjs";

const valid = {
  SHOP_WATCHDOG_BASE_URL: "http://192.168.0.135/",
  SHOP_WATCHDOG_HEARTBEAT_TOKEN: "a-heartbeat-token-of-enough-length-0123",
  TELEGRAM_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: "123456789:secret-token-value-do-not-print",
  TELEGRAM_CHAT_ID: "-100123",
  TELEGRAM_TOPIC_CRITICAL_ERRORS_ID: "42",
};

test("a complete environment gives a usable configuration with the documented defaults", () => {
  const { config, errors } = loadConfig(valid);
  assert.deepEqual(errors, []);
  assert.equal(config.baseUrl, "http://192.168.0.135", "the trailing slash is not part of the base");
  assert.equal(config.intervalMs, 30_000);
  assert.equal(config.downAfter, 3);
  assert.equal(config.upAfter, 2);
  assert.equal(config.reminderMs, 3_600_000);
  assert.equal(config.heartbeatEnabled, true);
  assert.equal(config.heartbeatMaxAgeMs, 900_000);
  assert.equal(config.channelCheckMs, 300_000, "the notification channel is checked every five minutes");
  assert.equal(loadConfig({ ...valid, SHOP_WATCHDOG_CHANNEL_CHECK_MS: "0" }).config.channelCheckMs, 0, "0 turns the check off");
  assert.equal(config.telegram.enabled, true);
  assert.equal(config.telegram.messageThreadId, 42, "the critical-errors topic of the fulfillment chat");
});

test("a watchdog that cannot notify, or does not know what to watch, is a configuration error", () => {
  assert.match(loadConfig({ ...valid, SHOP_WATCHDOG_BASE_URL: "" }).errors.join("|"), /SHOP_WATCHDOG_BASE_URL is required/);
  assert.match(loadConfig({ ...valid, TELEGRAM_ENABLED: "false" }).errors.join("|"), /no way to notify/);
  assert.match(loadConfig({ ...valid, TELEGRAM_BOT_TOKEN: "" }).errors.join("|"), /TELEGRAM_BOT_TOKEN is required/);
  assert.match(loadConfig({ ...valid, TELEGRAM_CHAT_ID: "" }).errors.join("|"), /TELEGRAM_CHAT_ID is required/);
});

test("invalid values are reported, never silently replaced", () => {
  const cases = {
    SHOP_WATCHDOG_BASE_URL: "ftp://shop",
    SHOP_WATCHDOG_INTERVAL_MS: "soon",
    SHOP_WATCHDOG_DOWN_AFTER: "0",
    SHOP_WATCHDOG_HEARTBEAT_TOKEN: "short",
    SHOP_WATCHDOG_CHANNEL_CHECK_MS: "often",
    TELEGRAM_ENABLED: "maybe",
    TELEGRAM_TOPIC_CRITICAL_ERRORS_ID: "-3",
  };
  for (const [name, value] of Object.entries(cases)) {
    const { errors } = loadConfig({ ...valid, [name]: value });
    assert.ok(errors.length > 0, `${name}=${value} must be rejected`);
  }
  assert.match(loadConfig({ ...valid, SHOP_WATCHDOG_BASE_URL: "http://user:pass@shop" }).errors.join("|"), /without credentials/);
  assert.match(
    loadConfig({ ...valid, SHOP_WATCHDOG_INTERVAL_MS: "2000", SHOP_WATCHDOG_TIMEOUT_MS: "5000" }).errors.join("|"),
    /must be smaller than/,
  );
});

test("the destination is the API's chat and topic unless the watchdog is pinned to its own", () => {
  const inherited = loadConfig(valid).config.telegram;
  assert.deepEqual([inherited.chatId, inherited.messageThreadId, inherited.chatSource], ["-100123", 42, "api"]);

  const pinned = loadConfig({ ...valid, SHOP_WATCHDOG_TELEGRAM_CHAT_ID: "-1009876543210", SHOP_WATCHDOG_TELEGRAM_THREAD_ID: "7" });
  assert.deepEqual(pinned.errors, []);
  assert.deepEqual([pinned.config.telegram.chatId, pinned.config.telegram.messageThreadId, pinned.config.telegram.chatSource], ["-1009876543210", 7, "watchdog"]);

  // A topic id belongs to its chat: a pinned chat does not inherit the API's
  // topic (Telegram would answer "message thread not found" to every message).
  const chatOnly = loadConfig({ ...valid, SHOP_WATCHDOG_TELEGRAM_CHAT_ID: "-1009876543210" });
  assert.deepEqual(chatOnly.errors, []);
  assert.equal(chatOnly.config.telegram.messageThreadId, null);

  // Another topic of the API's own chat is a legitimate pin.
  const topicOnly = loadConfig({ ...valid, SHOP_WATCHDOG_TELEGRAM_THREAD_ID: "9" }).config.telegram;
  assert.deepEqual([topicOnly.chatId, topicOnly.messageThreadId, topicOnly.chatSource], ["-100123", 9, "api"]);

  // Empty overrides (what compose passes when the variables are not set) change nothing.
  const empty = loadConfig({ ...valid, SHOP_WATCHDOG_TELEGRAM_CHAT_ID: "", SHOP_WATCHDOG_TELEGRAM_THREAD_ID: " " }).config.telegram;
  assert.deepEqual([empty.chatId, empty.messageThreadId, empty.chatSource], ["-100123", 42, "api"]);

  assert.match(loadConfig({ ...valid, SHOP_WATCHDOG_TELEGRAM_THREAD_ID: "seven" }).errors.join("|"), /thread id must be a positive integer/);
});

test("without a heartbeat token the dead-man track is off, not broken", () => {
  const { config, errors } = loadConfig({ ...valid, SHOP_WATCHDOG_HEARTBEAT_TOKEN: "" });
  assert.deepEqual(errors, []);
  assert.equal(config.heartbeatEnabled, false);
});

test("the printable configuration carries no secret", () => {
  const { config } = loadConfig(valid);
  const printed = JSON.stringify(describeConfig(config));
  assert.ok(!printed.includes(valid.TELEGRAM_BOT_TOKEN));
  assert.ok(!printed.includes(valid.SHOP_WATCHDOG_HEARTBEAT_TOKEN));
  assert.ok(!printed.includes(valid.TELEGRAM_CHAT_ID));
  const pinned = loadConfig({ ...valid, SHOP_WATCHDOG_TELEGRAM_CHAT_ID: "-1009876543210", SHOP_WATCHDOG_TELEGRAM_THREAD_ID: "7" }).config;
  const shown = describeConfig(pinned);
  assert.ok(!JSON.stringify(shown).includes("9876543210"), "the chat id is not shown; whose chat it is — is");
  assert.deepEqual(shown.telegram, { enabled: true, chatConfigured: true, chatSource: "watchdog", thread: 7 });
});
