export type TelegramSendMessageInput = {
  chatId: string;
  text: string;
  messageThreadId?: number | null;
  parseMode?: "HTML" | "MarkdownV2";
  disableWebPagePreview?: boolean;
};

export type TelegramClientOptions = {
  botToken: string;
  timeoutMs?: number;
  apiBaseUrl?: string;
};

export type TelegramSendMessageResult = {
  message_id: number;
  date: number;
  chat: unknown;
  message_thread_id?: number;
};

export class TelegramApiError extends Error {
  statusCode?: number;
  telegramErrorCode?: number;
  retryAfterSeconds?: number;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      telegramErrorCode?: number;
      retryAfterSeconds?: number;
      retryable?: boolean;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "TelegramApiError";
    this.statusCode = options.statusCode;
    this.telegramErrorCode = options.telegramErrorCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.retryable = options.retryable ?? true;

    if (options.cause) {
      (this as any).cause = options.cause;
    }
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function toTelegramErrorMessage(responseBody: any, fallback: string) {
  if (responseBody && typeof responseBody.description === "string") {
    return responseBody.description;
  }

  return fallback;
}

function getRetryAfter(responseBody: any): number | undefined {
  const value = Number(responseBody?.parameters?.retry_after);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export class TelegramClient {
  private readonly botToken: string;
  private readonly timeoutMs: number;
  private readonly apiBaseUrl: string;

  constructor(options: TelegramClientOptions) {
    const botToken = options.botToken.trim();

    if (!botToken) {
      throw new Error("Telegram bot token is required");
    }

    const timeoutMs = options.timeoutMs ?? 5000;

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Telegram request timeout must be greater than 0");
    }

    this.botToken = botToken;
    this.timeoutMs = timeoutMs;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.telegram.org").replace(
      /\/+$/,
      ""
    );
  }

  async sendMessage(
    input: TelegramSendMessageInput
  ): Promise<TelegramSendMessageResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const payload: Record<string, unknown> = {
      chat_id: input.chatId,
      text: input.text,
      disable_web_page_preview: input.disableWebPagePreview ?? true,
    };

    if (input.messageThreadId != null) {
      payload.message_thread_id = input.messageThreadId;
    }

    if (input.parseMode) {
      payload.parse_mode = input.parseMode;
    }

    try {
      const response = await fetch(this.url("sendMessage"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const body = await this.readJson(response);

      if (!response.ok) {
        throw new TelegramApiError(
          `Telegram HTTP ${response.status}: ${toTelegramErrorMessage(
            body,
            response.statusText
          )}`,
          {
            statusCode: response.status,
            telegramErrorCode: Number(body?.error_code) || undefined,
            retryAfterSeconds: getRetryAfter(body),
            retryable: response.status === 429 || response.status >= 500,
          }
        );
      }

      if (!body?.ok) {
        throw new TelegramApiError(
          `Telegram API error: ${toTelegramErrorMessage(body, "unknown error")}`,
          {
            telegramErrorCode: Number(body?.error_code) || undefined,
            retryAfterSeconds: getRetryAfter(body),
            retryable:
              Number(body?.error_code) === 429 ||
              Number(body?.error_code) >= 500,
          }
        );
      }

      return body.result as TelegramSendMessageResult;
    } catch (error) {
      if (error instanceof TelegramApiError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new TelegramApiError(
          `Telegram request timed out after ${this.timeoutMs}ms`,
          { cause: error, retryable: true }
        );
      }

      throw new TelegramApiError("Telegram request failed", {
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private url(method: string) {
    return `${this.apiBaseUrl}/bot${this.botToken}/${method}`;
  }

  private async readJson(response: Response) {
    const text = await response.text();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new TelegramApiError("Telegram returned invalid JSON", {
        statusCode: response.status,
        retryable: response.status >= 500,
      });
    }
  }
}
