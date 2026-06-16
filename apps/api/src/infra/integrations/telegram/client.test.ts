import assert from "node:assert/strict";
import test from "node:test";

import { TelegramApiError, TelegramClient } from "./client";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("TelegramClient sends only Telegram payload fields", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 1, date: 1, chat: {} } }),
      { status: 200 }
    );
  };

  const client = new TelegramClient({
    botToken: "123456:secret-token",
    apiBaseUrl: "https://telegram.test/",
    timeoutMs: 1000,
  });

  await client.sendMessage({
    chatId: "-100123",
    messageThreadId: 42,
    text: "hello",
    parseMode: "HTML",
  });

  assert.equal(requestUrl, "https://telegram.test/bot123456:secret-token/sendMessage");
  assert.deepEqual(requestBody, {
    chat_id: "-100123",
    text: "hello",
    disable_web_page_preview: true,
    message_thread_id: 42,
    parse_mode: "HTML",
  });
  assert.equal(JSON.stringify(requestBody).includes("secret-token"), false);
});

test("TelegramClient exposes retry_after for rate limits", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 7 },
      }),
      { status: 429 }
    );

  const client = new TelegramClient({
    botToken: "123456:secret-token",
    apiBaseUrl: "https://telegram.test",
  });

  await assert.rejects(
    () => client.sendMessage({ chatId: "-100123", text: "hello" }),
    (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.equal((error as TelegramApiError).retryAfterSeconds, 7);
      assert.equal((error as TelegramApiError).retryable, true);
      return true;
    }
  );
});

test("TelegramClient marks bad request as non-retryable", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error_code: 400,
        description: "Bad Request: chat not found",
      }),
      { status: 400 }
    );

  const client = new TelegramClient({
    botToken: "123456:secret-token",
    apiBaseUrl: "https://telegram.test",
  });

  await assert.rejects(
    () => client.sendMessage({ chatId: "-100123", text: "hello" }),
    (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.equal((error as TelegramApiError).retryable, false);
      assert.equal(String((error as Error).message).includes("secret-token"), false);
      return true;
    }
  );
});

test("TelegramClient top-level network errors do not include bot token", async () => {
  globalThis.fetch = async () => {
    throw new Error("connect failed for bot123456:secret-token");
  };

  const client = new TelegramClient({
    botToken: "123456:secret-token",
    apiBaseUrl: "https://telegram.test",
  });

  await assert.rejects(
    () => client.sendMessage({ chatId: "-100123", text: "hello" }),
    (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.equal(String((error as Error).message).includes("secret-token"), false);
      return true;
    }
  );
});
