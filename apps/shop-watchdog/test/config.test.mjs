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
});
