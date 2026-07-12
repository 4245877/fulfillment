/**
 * Typed HTTP client for the atelier print-orchestrator — the single service
 * that talks to the physical printers (Moonraker/Bambu MQTT/Creality WS) and
 * cameras (go2rtc). This API never opens a device connection itself: printer
 * statuses and camera snapshots are only ever read through this client.
 *
 * Security: the optional API token is sent as `Authorization: Bearer …` and is
 * never logged or embedded in error messages; orchestrator responses are
 * treated as untrusted input, normalized field-by-field and bounded in size.
 */

export type OrchestratorErrorKind =
  | "timeout"
  | "network"
  | "http"
  | "invalid_response"
  | "aborted";

export class OrchestratorError extends Error {
  readonly kind: OrchestratorErrorKind;
  /** HTTP status code, present when kind === "http". */
  readonly status?: number;

  constructor(kind: OrchestratorErrorKind, message: string, status?: number) {
    super(message);
    this.name = "OrchestratorError";
    this.kind = kind;
    this.status = status;
  }
}

export type OrchestratorPrinterState =
  | "idle"
  | "printing"
  | "paused"
  | "error"
  | "offline"
  | "unknown";

/**
 * One printer as reported by the orchestrator's `GET /api/printers`, reduced
 * to the fields fulfillment consumes (monitoring, health, the read-only
 * dashboard page). No hosts, ports, protocols or credentials — those are the
 * orchestrator's internal connection parameters.
 */
export type OrchestratorPrinterStatus = {
  id: string;
  name: string;
  model: string | null;
  online: boolean;
  status: OrchestratorPrinterState;
  currentFile: string | null;
  progressPct: number | null;
  remainingMinutes: number | null;
  nozzleTemp: number | null;
  bedTemp: number | null;
  /** Live loaded material when the device reports it, else the configured one. */
  material: string | null;
  stateText: string | null;
  stateMessage: string | null;
  updatedAt: string | null;
  error: string | null;
};

/** One operator queue job from the orchestrator's `GET /api/queue`. */
export type OrchestratorQueueJob = {
  id: string;
  title: string;
  printer: string | null;
  material: string | null;
  eta: string | null;
  status: string;
};

/** Today's throughput counters from the orchestrator's `GET /api/today`. */
export type OrchestratorToday = {
  done: number | null;
  active: number | null;
  failed: number | null;
};

export type OrchestratorSnapshot = {
  data: Buffer;
  mime: string;
};

export type FetchSnapshotOptions = {
  /** Ask the orchestrator to switch the chamber light on before capturing. */
  ensureLight?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
};

export type OrchestratorClientOptions = {
  baseUrl: string;
  apiToken?: string | null;
  timeoutMs?: number;
  /**
   * Extra attempts for idempotent GET JSON reads after a timeout, network
   * error or 5xx. Bounded (default 1) with a short jittered backoff, so the
   * worst case stays well below the monitor poll interval.
   */
  retries?: number;
  /** Hard cap for JSON response bodies (defense against endless streams). */
  jsonMaxBytes?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to a real jittered sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SNAPSHOT_MAX_BYTES = 3_000_000;
const DEFAULT_JSON_MAX_BYTES = 2_000_000;
const DEFAULT_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 250;

const PRINTER_STATES: readonly OrchestratorPrinterState[] = [
  "idle",
  "printing",
  "paused",
  "error",
  "offline",
  "unknown",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function toState(value: unknown): OrchestratorPrinterState {
  const state = String(value ?? "").trim().toLowerCase();
  return (PRINTER_STATES as readonly string[]).includes(state)
    ? (state as OrchestratorPrinterState)
    : "unknown";
}

/** First element of the orchestrator's `[current, target]` temperature pair. */
function toCurrentTemp(value: unknown): number | null {
  if (Array.isArray(value)) return toFiniteNumber(value[0]);
  return toFiniteNumber(value);
}

/**
 * Normalizes one orchestrator printer entry. Entries without a usable `id`
 * are unusable and dropped; every other field degrades to null so a partially
 * filled response never throws.
 */
export function normalizeOrchestratorPrinter(
  value: unknown
): OrchestratorPrinterStatus | null {
  if (!isObject(value)) return null;

  const id = toText(value.id);
  if (!id) return null;

  const status = toState(value.status);

  return {
    id,
    name: toText(value.name) ?? id,
    model: toText(value.model),
    online:
      typeof value.online === "boolean"
        ? value.online
        : status !== "offline" && status !== "unknown",
    status,
    currentFile: toText(value.job) ?? toText(value.currentFile),
    progressPct: toFiniteNumber(value.progress ?? value.progressPct),
    remainingMinutes: toFiniteNumber(value.minutesLeft ?? value.remainingMinutes),
    nozzleTemp: toCurrentTemp(value.nozzle ?? value.nozzleTemp),
    bedTemp: toCurrentTemp(value.bed ?? value.bedTemp),
    material: toText(value.liveMaterial) ?? toText(value.material),
    stateText: toText(value.stateText),
    stateMessage: toText(value.stateMessage),
    updatedAt: toText(value.updatedAt),
    error: toText(value.error),
  };
}

/** Normalizes one orchestrator queue job; entries without an id are dropped. */
export function normalizeOrchestratorQueueJob(
  value: unknown
): OrchestratorQueueJob | null {
  if (!isObject(value)) return null;

  const id = toText(value.id);
  if (!id) return null;

  return {
    id,
    title: toText(value.title) ?? id,
    printer: toText(value.printer),
    material: toText(value.material),
    eta: toText(value.eta),
    status: toText(value.status) ?? "unknown",
  };
}

function jitteredSleep(ms: number): Promise<void> {
  const jittered = ms / 2 + Math.random() * ms;
  return new Promise((resolve) => setTimeout(resolve, jittered));
}

export class OrchestratorClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly jsonMaxBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  /** In-flight request controllers, so shutdown can abort them all at once. */
  private readonly inFlight = new Set<AbortController>();
  private closed = false;

  constructor(options: OrchestratorClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    this.apiToken = options.apiToken?.trim() || "";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
    this.jsonMaxBytes = options.jsonMaxBytes ?? DEFAULT_JSON_MAX_BYTES;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? jitteredSleep;
  }

  /**
   * Graceful shutdown: aborts every in-flight request and rejects new ones,
   * so a stopping process never hangs on an orchestrator that stopped
   * answering mid-request.
   */
  close(): void {
    this.closed = true;
    for (const controller of this.inFlight) {
      controller.abort();
    }
    this.inFlight.clear();
  }

  private headers(accept: string): Record<string, string> {
    return {
      Accept: accept,
      ...(this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : {}),
    };
  }

  private async request(
    path: string,
    timeoutMs: number,
    accept: string
  ): Promise<Response> {
    if (this.closed) {
      throw new OrchestratorError(
        "aborted",
        "Orchestrator client is shutting down"
      );
    }

    const controller = new AbortController();
    this.inFlight.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: this.headers(accept),
      });
    } catch (error) {
      if (timedOut) {
        throw new OrchestratorError(
          "timeout",
          `Print orchestrator did not answer within ${timeoutMs} ms`
        );
      }
      if (controller.signal.aborted) {
        throw new OrchestratorError(
          "aborted",
          "Orchestrator request aborted by shutdown"
        );
      }
      // fetch network errors carry no secrets (the token lives in a header).
      throw new OrchestratorError(
        "network",
        `Print orchestrator is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(controller);
    }
  }

  /**
   * Reads a response body up to `maxBytes`. Returns null past the limit (the
   * body is cancelled either way, so the connection never leaks).
   */
  private async readBounded(
    response: Response,
    maxBytes: number
  ): Promise<Buffer | null> {
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);

    const chunks: Buffer[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }

        chunks.push(Buffer.from(value));
      }
    } catch {
      return null;
    }

    return Buffer.concat(chunks);
  }

  /** Cancels an unread body so an error path does not hold the socket open. */
  private async discardBody(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      /* already closed */
    }
  }

  /**
   * Bounded GET returning parsed JSON. Retries timeouts, network errors and
   * 5xx up to `retries` extra attempts with a short jittered backoff — never
   * 4xx or malformed payloads, and never once the client is closed.
   */
  private async requestJson(path: string): Promise<unknown> {
    let lastError: OrchestratorError | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (attempt > 0) {
        await this.sleepImpl(RETRY_BASE_DELAY_MS * attempt);
        if (this.closed) {
          throw new OrchestratorError(
            "aborted",
            "Orchestrator client is shutting down"
          );
        }
      }

      try {
        return await this.requestJsonOnce(path);
      } catch (error) {
        const typed =
          error instanceof OrchestratorError
            ? error
            : new OrchestratorError("network", String(error));

        const retryable =
          typed.kind === "timeout" ||
          typed.kind === "network" ||
          (typed.kind === "http" && (typed.status ?? 0) >= 500);

        if (!retryable || attempt === this.retries) {
          throw typed;
        }

        lastError = typed;
      }
    }

    // Unreachable: the loop either returns or throws. Kept for type safety.
    throw lastError ?? new OrchestratorError("network", "Request failed");
  }

  private async requestJsonOnce(path: string): Promise<unknown> {
    const response = await this.request(path, this.timeoutMs, "application/json");

    if (!response.ok) {
      await this.discardBody(response);
      throw new OrchestratorError(
        "http",
        `Print orchestrator answered HTTP ${response.status}`,
        response.status
      );
    }

    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (contentType && !contentType.includes("json")) {
      await this.discardBody(response);
      throw new OrchestratorError(
        "invalid_response",
        `Print orchestrator returned ${contentType} instead of JSON`
      );
    }

    const body = await this.readBounded(response, this.jsonMaxBytes);
    if (body === null) {
      throw new OrchestratorError(
        "invalid_response",
        `Print orchestrator JSON response exceeded ${this.jsonMaxBytes} bytes`
      );
    }

    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw new OrchestratorError(
        "invalid_response",
        "Print orchestrator returned invalid JSON"
      );
    }
  }

  /**
   * All printers with their live statuses via `GET /api/printers`. Throws a
   * typed {@link OrchestratorError}; unusable entries are dropped rather than
   * failing the whole list.
   */
  async listPrinterStatuses(): Promise<OrchestratorPrinterStatus[]> {
    const parsed = await this.requestJson("/api/printers");

    // Accept both the raw array and a `{ printers: [...] }` envelope so a
    // future orchestrator-side wrapping does not break consumers.
    const list = Array.isArray(parsed)
      ? parsed
      : isObject(parsed) && Array.isArray(parsed.printers)
        ? parsed.printers
        : null;

    if (!list) {
      throw new OrchestratorError(
        "invalid_response",
        "Print orchestrator returned an unexpected payload shape"
      );
    }

    return list
      .map(normalizeOrchestratorPrinter)
      .filter((printer): printer is OrchestratorPrinterStatus => Boolean(printer));
  }

  /** Operator print queue via `GET /api/queue`; unusable entries are dropped. */
  async listQueueJobs(): Promise<OrchestratorQueueJob[]> {
    const parsed = await this.requestJson("/api/queue");

    const list = Array.isArray(parsed)
      ? parsed
      : isObject(parsed) && Array.isArray(parsed.jobs)
        ? parsed.jobs
        : null;

    if (!list) {
      throw new OrchestratorError(
        "invalid_response",
        "Print orchestrator returned an unexpected queue shape"
      );
    }

    return list
      .map(normalizeOrchestratorQueueJob)
      .filter((job): job is OrchestratorQueueJob => Boolean(job));
  }

  /** Today's farm counters via `GET /api/today`; missing fields become null. */
  async fetchToday(): Promise<OrchestratorToday> {
    const parsed = await this.requestJson("/api/today");

    if (!isObject(parsed)) {
      throw new OrchestratorError(
        "invalid_response",
        "Print orchestrator returned an unexpected today shape"
      );
    }

    return {
      done: toFiniteNumber(parsed.done),
      active: toFiniteNumber(parsed.active),
      failed: toFiniteNumber(parsed.failed),
    };
  }

  /**
   * A live camera frame via `GET /api/printers/:id/camera.jpg`. Returns `null`
   * (never throws) when the orchestrator has no frame, the response is not an
   * image, exceeds `maxBytes`, or the request fails/times out — callers degrade
   * to text-only notifications. Deliberately no retry: a snapshot is optional
   * decoration and a retry would delay the notification it accompanies.
   */
  async fetchSnapshot(
    printerId: string,
    options: FetchSnapshotOptions = {}
  ): Promise<OrchestratorSnapshot | null> {
    const ensureLight = options.ensureLight ?? true;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxBytes = options.maxBytes ?? DEFAULT_SNAPSHOT_MAX_BYTES;
    const query = ensureLight ? "?ensureLight=1" : "";

    let response: Response;
    try {
      response = await this.request(
        `/api/printers/${encodeURIComponent(printerId)}/camera.jpg${query}`,
        timeoutMs,
        "image/*"
      );
    } catch {
      return null;
    }

    if (!response.ok) {
      await this.discardBody(response);
      return null;
    }

    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (contentType && !contentType.startsWith("image/")) {
      await this.discardBody(response);
      return null;
    }

    const data = await this.readBounded(response, maxBytes);
    if (data === null || data.byteLength === 0) return null;

    return {
      data,
      mime: contentType || "image/jpeg",
    };
  }
}

/**
 * The client configured from the environment, or `null` when no orchestrator
 * URL is set (printer features then degrade to "not configured" instead of
 * failing). Reads env lazily so tests can set variables before first use.
 *
 * `overrides` tune the env-derived config per call site — e.g. health probes
 * pass `{ retries: 0 }` because a probe must answer within its own budget,
 * not mask an outage behind retry latency.
 */
export function createOrchestratorClientFromEnv(
  overrides: Partial<Omit<OrchestratorClientOptions, "baseUrl">> = {}
): OrchestratorClient | null {
  const baseUrl =
    process.env.PRINTER_ORCHESTRATOR_URL?.trim() ||
    // Back-compat: the old variable configured snapshot delegation only.
    process.env.PRINTER_SNAPSHOT_ORCHESTRATOR_URL?.trim();

  if (!baseUrl) return null;

  const timeoutMs = Number(process.env.PRINTER_ORCHESTRATOR_TIMEOUT_MS);

  return new OrchestratorClient({
    baseUrl,
    apiToken: process.env.PRINTER_ORCHESTRATOR_API_TOKEN,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
    ...overrides,
  });
}
