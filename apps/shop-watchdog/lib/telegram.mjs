// Shop watchdog — Telegram delivery.
//
// A deliberately tiny client (one method) instead of the API's own: this
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
 * Build a `send(text)` function for the configured chat/topic.
 * Throws TelegramError on any failure; the caller keeps the message queued.
 */
export function createTelegramSender(telegram, { fetchImpl = fetch } = {}) {
  const url = `${telegram.apiBaseUrl}/bot${telegram.botToken}/sendMessage`;

  return async function send(text) {
    const body = {
      chat_id: telegram.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (telegram.messageThreadId) body.message_thread_id = telegram.messageThreadId;

    let response;
    try {
      response = await fetchImpl(url, {
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
    // 4xx other than 429 will not fix itself: wrong token, chat or topic.
    const retryable = response.status === 429 || response.status >= 500;
    throw new TelegramError(`Telegram refused the message: ${description}`, { retryable, statusCode: response.status });
  };
}
