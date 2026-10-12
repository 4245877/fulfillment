// Test doubles: a shop that can break in every way the watchdog distinguishes,
// and a Telegram Bot API that records what it was asked to send.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfig } from "../lib/config.mjs";

export const BOT_TOKEN = "123456789:TEST-not-a-real-telegram-token-000000";
export const HEARTBEAT_TOKEN = "test-heartbeat-token-0123456789abcdef";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/**
 * Fake shop. `mode`:
 *   ok | backend_down | not_ready | bad_json | storefront_down | empty | hang | redirect
 * "unreachable" is `await shop.down()` — the port stops listening.
 */
export async function fakeShop(initialMode = "ok") {
  const shop = { mode: initialMode, requests: [], port: 0, server: null, url: "" };

  const handler = (req, res) => {
    shop.requests.push(`${req.method} ${req.url}`);
    const send = (status, type, body) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    if (shop.mode === "hang") return; // never answers
    if (shop.mode === "redirect") return send(302, "text/plain", "moved");
    if (req.url === "/nginx-healthz") return send(200, "text/plain", "ok\n");
    if (req.url === "/api/health") {
      if (shop.mode === "backend_down") return send(502, "text/html", "<html>502 Bad Gateway</html>");
      return send(200, "application/json; charset=utf-8", '{"ok":true}');
    }
    if (req.url.startsWith("/api/products")) {
      if (shop.mode === "backend_down") return send(502, "text/html", "<html>502 Bad Gateway</html>");
      if (shop.mode === "not_ready") return send(500, "application/json", '{"error":"Internal Server Error"}');
      if (shop.mode === "bad_json") return send(200, "application/json", "<html>not json</html>");
      if (shop.mode === "empty") return send(200, "application/json", '{"items":[],"total":0}');
      return send(200, "application/json; charset=utf-8", '{"items":[{"id":"1","sku":"A"}],"total":1115}');
    }
    if (req.url === "/") {
      if (shop.mode === "storefront_down") return send(404, "text/html", "<html>404</html>");
      return send(200, "text/html", '<!doctype html><html lang="uk"><head></head><body><div id="root"></div></body></html>');
    }
    return send(404, "application/json", '{"error":"not found"}');
  };

  shop.up = async () => {
    shop.server = http.createServer(handler);
    if (shop.port) {
      await new Promise((resolve) => shop.server.listen(shop.port, "127.0.0.1", resolve));
    } else {
      shop.port = await listen(shop.server);
    }
    shop.url = `http://127.0.0.1:${shop.port}`;
  };
  shop.down = async () => {
    if (shop.server) await close(shop.server);
    shop.server = null;
  };
  await shop.up();
  return shop;
}

/**
 * Fake Telegram Bot API.
 *
 * `mode` (how it treats a request): ok | fail500 | reject400 | rate429 | hang.
 * `auth` (what it thinks of the bot): ok | revoked — 401 to every method, as
 * after the token was regenerated in BotFather | kicked — 403, the bot was
 * removed from the chat.
 * `attempts` counts sendMessage requests, `checks` — getChat requests.
 */
export async function fakeTelegram() {
  const telegram = { mode: "ok", auth: "ok", messages: [], attempts: 0, checks: 0, port: 0, server: null, url: "" };
  telegram.server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const json = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const refused = () => {
        if (telegram.auth === "revoked") return json(401, { ok: false, error_code: 401, description: "Unauthorized" });
        return json(403, { ok: false, error_code: 403, description: "Forbidden: bot was kicked from the supergroup chat" });
      };
      const busy = () => {
        if (telegram.mode === "fail500") return json(500, { ok: false, description: "Internal Server Error" });
        return json(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 5", parameters: { retry_after: 5 } });
      };

      if (req.url === `/bot${BOT_TOKEN}/getChat`) {
        telegram.checks += 1;
        if (telegram.mode === "hang") return; // accepts the request and never answers
        if (telegram.auth !== "ok") return refused();
        if (telegram.mode === "fail500" || telegram.mode === "rate429") return busy();
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        return json(200, { ok: true, result: { id: Number(body.chat_id), type: "supergroup", is_forum: true } });
      }

      telegram.attempts += 1;
      if (req.url !== `/bot${BOT_TOKEN}/sendMessage`) return json(404, { ok: false, description: "Not Found" });
      if (telegram.mode === "hang") return; // accepts the request and never answers
      if (telegram.auth !== "ok") return refused();
      if (telegram.mode === "fail500" || telegram.mode === "rate429") return busy();
      if (telegram.mode === "reject400") return json(400, { ok: false, description: "Bad Request: message thread not found" });
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      telegram.messages.push(body);
      return json(200, { ok: true, result: { message_id: telegram.messages.length } });
    });
  });
  telegram.port = await listen(telegram.server);
  telegram.url = `http://127.0.0.1:${telegram.port}`;
  telegram.close = () => close(telegram.server);
  return telegram;
}

export function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-watchdog-"));
  return { file: path.join(dir, "state.json"), dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A valid configuration for tests; `overrides` are raw environment values. */
export function testConfig({ shopUrl, telegramUrl, stateFile, overrides = {} }) {
  const { config, errors } = loadConfig({
    SHOP_WATCHDOG_BASE_URL: shopUrl,
    SHOP_WATCHDOG_INTERVAL_MS: "30000",
    SHOP_WATCHDOG_TIMEOUT_MS: "400",
    // The dead-man track is off unless a test is about it: tests move the clock
    // by hours, and silence would (correctly) be reported in the middle of them.
    SHOP_WATCHDOG_HEARTBEAT_TOKEN: "",
    SHOP_WATCHDOG_STATE_FILE: stateFile,
    SHOP_WATCHDOG_TELEGRAM_API_BASE_URL: telegramUrl,
    SHOP_WATCHDOG_RUNBOOK: "docs/alerts.md § «Внешний сторож»",
    TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_CHAT_ID: "-1001234567890",
    TELEGRAM_TOPIC_CRITICAL_ERRORS_ID: "7",
    TELEGRAM_REQUEST_TIMEOUT_MS: "1000",
    PORT: "0",
    ...overrides,
  });
  return { config, errors };
}

/** A clock the test moves by hand. */
export function fakeClock(startIso = "2026-10-10T12:00:00.000Z") {
  let ms = Date.parse(startIso);
  const clock = () => ms;
  clock.advance = (delta) => {
    ms += delta;
    return ms;
  };
  return clock;
}

/** The Alertmanager webhook body for the always-firing Watchdog alert. */
export function watchdogWebhook(overrides = {}) {
  return {
    version: "4",
    status: "firing",
    receiver: "watchdog",
    alerts: [{ status: "firing", labels: { alertname: "Watchdog", severity: "none", contour: "meta" }, annotations: {} }],
    ...overrides,
  };
}
