// Shop watchdog — Telegram delivery.
//
// A deliberately tiny client (two methods) instead of the API's own: this
// service must start with nothing but the Node runtime — no install step, no
// registry, no shared code that needs a build. It talks to Telegram directly
// from this host, so it does not depend on the shop it watches.
//
// The bot token is never logged, never returned and never put into an error
// message (the request URL contains it).

export class TelegramError extends Error {
  constructor(message, { retryable = true, statusCode = null } = {}) {
    super(message);
    this.name = "TelegramError";
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

/**
 * One Bot API call. Returns `result`; throws TelegramError otherwise.
 *
 * `retryable` separates "try again later" (network, timeout, 5xx, 429) from an
 * answer that will not fix itself (other 4xx: wrong token, chat or topic).
 */
async function call(telegram, method, body, refusal, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${telegram.apiBaseUrl}/bot${telegram.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(telegram.timeoutMs),
    });
  } catch (error) {
    // Never include `error.message` of fetch blindly: undici may quote the URL.
    const code = String(error?.cause?.code || error?.name || "network error");
    throw new TelegramError(`Telegram is unreachable (${code})`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.ok && payload?.ok === true) return payload.result ?? null;

  const description = typeof payload?.description === "string" ? payload.description : `HTTP ${response.status}`;
  const retryable = response.status === 429 || response.status >= 500;
  throw new TelegramError(`${refusal}: ${description}`, { retryable, statusCode: response.status });
}

/**
 * Build a `send(text)` function for the configured chat/topic.
 * Throws TelegramError on any failure; the caller keeps the message queued.
 */
export function createTelegramSender(telegram, { fetchImpl = fetch } = {}) {
  return async function send(text) {
    const body = {
      chat_id: telegram.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (telegram.messageThreadId) body.message_thread_id = telegram.messageThreadId;
    return call(telegram, "sendMessage", body, "Telegram refused the message", fetchImpl);
  };
}

/**
 * Build a `check()` function that asks Telegram — without sending anything —
 * whether this bot may still use the configured chat (`getChat`).
 *
 * It answers the one question a healthy-looking watchdog cannot answer by
 * itself: "if the shop went down right now, could I tell anyone?". A token
 * regenerated in BotFather, or a bot removed from the group, breaks nothing
 * visible until the first alert has to go out. A non-retryable TelegramError
 * (`retryable === false`) is such a verdict; a retryable one says nothing
 * about the credentials. The topic cannot be checked this way: only a real
 * message proves it exists.
 */
export function createTelegramChannelCheck(telegram, { fetchImpl = fetch } = {}) {
  return async function check() {
    await call(telegram, "getChat", { chat_id: telegram.chatId }, "Telegram refuses the bot or the chat", fetchImpl);
  };
}
