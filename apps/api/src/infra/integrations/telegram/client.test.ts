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

test("TelegramClient sendPhoto uploads multipart photo with caption", async () => {
  let requestUrl = "";
  let requestBody: unknown = null;

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = init?.body;

    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 9, date: 1, chat: {} } }),
      { status: 200 }
    );
  };

  const client = new TelegramClient({
    botToken: "123456:secret-token",
    apiBaseUrl: "https://telegram.test",
    timeoutMs: 1000,
  });

  await client.sendPhoto({
    chatId: "-100123",
    messageThreadId: 55,
    caption: "<b>Печать завершена</b>",
    parseMode: "HTML",
    photo: new Uint8Array([1, 2, 3, 4]),
    mimeType: "image/png",
    filename: "model.png",
  });

  assert.equal(
    requestUrl,
    "https://telegram.test/bot123456:secret-token/sendPhoto"
  );
  assert.equal(requestBody instanceof FormData, true);

  const form = requestBody as FormData;
  assert.equal(form.get("chat_id"), "-100123");
  assert.equal(form.get("message_thread_id"), "55");
  assert.equal(form.get("caption"), "<b>Печать завершена</b>");
  assert.equal(form.get("parse_mode"), "HTML");

  const photo = form.get("photo");
  assert.equal(photo instanceof Blob, true);
  assert.equal((photo as Blob).type, "image/png");
  assert.equal((photo as Blob).size, 4);
  assert.equal((photo as File).name, "model.png");
});

test("TelegramClient sendPhoto surfaces API errors without leaking token", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error_code: 400,
        description: "Bad Request: message thread not found",
      }),
      { status: 400 }
    );

  const client = new TelegramClient({
    botToken: "123456:secret-token",
    apiBaseUrl: "https://telegram.test",
  });

  await assert.rejects(
    () =>
      client.sendPhoto({
        chatId: "-100123",
        photo: new Uint8Array([1, 2, 3]),
      }),
    (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.equal((error as TelegramApiError).retryable, false);
      assert.equal(
        String((error as Error).message).includes("secret-token"),
        false
      );
      return true;
    }
  );
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


test("TelegramClient retries a non-JSON rate-limit response", async () => {
  globalThis.fetch = async () => new Response("Too Many Requests", { status: 429 });
  const client = new TelegramClient({ botToken: "test-token", apiBaseUrl: "https://telegram.test" });
  await assert.rejects(() => client.sendMessage({ chatId: "test-chat", text: "hello" }), (error) => {
    assert.equal(error instanceof TelegramApiError, true);
    assert.equal((error as TelegramApiError).retryable, true);
    assert.equal((error as TelegramApiError).statusCode, 429);
    return true;
  });
});

test("TelegramClient aborts a stalled request and classifies it as retryable", async () => {
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  const client = new TelegramClient({ botToken: "test-token", apiBaseUrl: "https://telegram.test", timeoutMs: 20 });
  await assert.rejects(() => client.sendMessage({ chatId: "test-chat", text: "hello" }), (error) => {
    assert.equal(error instanceof TelegramApiError, true);
    assert.equal((error as TelegramApiError).retryable, true);
    assert.match((error as Error).message, /timed out after 20ms/);
    return true;
  });
});


test("TelegramClient keeps malformed successful responses retryable instead of confirming or discarding delivery", async () => {
  const client = new TelegramClient({ botToken: "test-token", apiBaseUrl: "https://telegram.test" });
  const responses = [
    "<html>proxy response</html>", "", "{}", "[]",
    JSON.stringify({ ok: false }),
    JSON.stringify({ ok: "true", result: { message_id: 1 } }),
    JSON.stringify({ ok: true }), JSON.stringify({ ok: true, result: null }),
    JSON.stringify({ ok: true, result: { message_id: "1" } }),
    JSON.stringify({ ok: true, result: { message_id: -1 } }),
  ];
  for (const body of responses) {
    globalThis.fetch = async () => new Response(body, { status: 200 });
    await assert.rejects(() => client.sendMessage({ chatId: "test-chat", text: "hello" }), (error) => {
      assert.ok(error instanceof TelegramApiError);
      assert.equal(error.retryable, true, `malformed response ${body}`);
      assert.equal(error.statusCode, 200);
      return true;
    });
  }
});

test("TelegramClient preserves definitive API errors inside HTTP 200 responses", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false, error_code: 400, description: "Bad Request: PHOTO_INVALID_DIMENSIONS",
  }), { status: 200 });
  const client = new TelegramClient({ botToken: "test-token", apiBaseUrl: "https://telegram.test" });
  await assert.rejects(() => client.sendPhoto({ chatId: "test-chat", photo: new Uint8Array([1]) }), (error) => {
    assert.ok(error instanceof TelegramApiError);
    assert.equal(error.telegramErrorCode, 400);
    assert.equal(error.retryable, false);
    return true;
  });
});
