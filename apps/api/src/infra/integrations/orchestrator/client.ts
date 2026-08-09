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

/**
 * One printer's **configuration** as published by the orchestrator's
 * `GET /api/printers/inventory` — what the printer *is*, as an operator
 * configured it in atelier. Deliberately separate from
 * {@link OrchestratorPrinterStatus}, which is what the printer is *doing*:
 *
 *  - configuration changes only when someone edits it, live state every 10 s;
 *  - the inventory contains DISABLED printers (`enabled: false`), the status
 *    endpoint does not — which is the only way this service can tell a printer
 *    that was switched off from one that was deleted.
 *
 * Never carries a host, port, credential or camera URL: the orchestrator owns
 * the devices, this service only needs to know the fleet.
 */
export type OrchestratorPrinterConfig = {
  /** Permanent identifier, immutable in atelier; the key of every reference here. */
  id: string;
  name: string;
  model: string | null;
  /** "FDM" | "Resin" today; an unrecognized value is passed through verbatim. */
  type: string;
  /** Interchangeability class used by atelier's slicing; null when unset. */
  printerClass: string | null;
  /** Device dialect ("moonraker" | "bambu" | "creality"); passed through verbatim. */
  protocol: string;
  /** False = configured but switched off in atelier: no new work may go to it. */
  enabled: boolean;
  /** Operator-facing ordering from atelier; the order lists should use. */
  position: number;
  /** Declared loaded material from the configuration (NOT live telemetry). */
  material: string | null;
  swatch: string | null;
  nozzleDiameterMm: number | null;
  nozzleType: string | null;
  buildVolume: { x: number; y: number; z: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Bumped by atelier on every stored change. */
  version: number | null;
};

/** The whole printer fleet as one snapshot, with a fingerprint of the set. */
export type OrchestratorPrinterInventory = {
  /** Changes on any add, edit or delete — including deletions, which no timestamp shows. */
  revision: string;
  updatedAt: string | null;
  printers: OrchestratorPrinterConfig[];
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

function toBuildVolume(value: unknown): { x: number; y: number; z: number } | null {
  if (!isObject(value)) return null;

  const x = toFiniteNumber(value.x);
  const y = toFiniteNumber(value.y);
  const z = toFiniteNumber(value.z);

  return x === null || y === null || z === null ? null : { x, y, z };
}

/**
 * Validates one printer-configuration entry. Throws — it never returns a
 * partial entry and never silently drops one, because a dropped entry is
 * indistinguishable from a deleted printer, and "the printer disappeared" is
 * exactly the conclusion that must not be reached from a malformed response.
 *
 * Strict where a wrong value would be acted on (`id`, `enabled`), tolerant
 * where it would only be displayed (`type`, `protocol` are passed through
 * verbatim, so atelier can add a device dialect without taking this service's
 * assignment path down mid-rollout).
 */
export function normalizeOrchestratorPrinterConfig(
  value: unknown
): OrchestratorPrinterConfig {
  if (!isObject(value)) {
    throw new OrchestratorError(
      "invalid_response",
      "Printer inventory entry is not an object"
    );
  }

  const id = toText(value.id);
  if (!id) {
    throw new OrchestratorError(
      "invalid_response",
      "Printer inventory entry has no id"
    );
  }

  // `enabled` decides whether work may be sent to this printer. A missing or
  // non-boolean value must never default to "usable".
  if (typeof value.enabled !== "boolean") {
    throw new OrchestratorError(
      "invalid_response",
      `Printer "${id}" has no boolean "enabled" flag`
    );
  }

  return {
    id,
    name: toText(value.name) ?? id,
    model: toText(value.model),
    type: toText(value.type) ?? "unknown",
    printerClass: toText(value.printerClass),
    protocol: toText(value.protocol) ?? "unknown",
    enabled: value.enabled,
    position: toFiniteNumber(value.position) ?? 0,
    material: toText(value.material),
    swatch: toText(value.swatch),
    nozzleDiameterMm: toFiniteNumber(value.nozzleDiameterMm),
    nozzleType: toText(value.nozzleType),
    buildVolume: toBuildVolume(value.buildVolume),
    createdAt: toText(value.createdAt),
    updatedAt: toText(value.updatedAt),
    version: toFiniteNumber(value.version),
  };
}

/**
 * Validates a whole `GET /api/printers/inventory` payload. Rejects the payload
 * as a unit: a snapshot of the fleet is only useful if it is complete, so one
 * bad entry fails the read (the caller then keeps its previous snapshot and
 * reports the failure) rather than yielding a fleet with a hole in it.
 *
 * Duplicate ids are rejected too — with an ambiguous key, "is this printer
 * enabled?" has two answers.
 */
export function normalizeOrchestratorPrinterInventory(
  value: unknown
): OrchestratorPrinterInventory {
  if (!isObject(value) || !Array.isArray(value.printers)) {
    throw new OrchestratorError(
      "invalid_response",
      "Print orchestrator returned an unexpected printer-inventory shape"
    );
  }

  const printers = value.printers.map(normalizeOrchestratorPrinterConfig);

  const seen = new Set<string>();
  for (const printer of printers) {
    if (seen.has(printer.id)) {
      throw new OrchestratorError(
        "invalid_response",
        `Printer inventory contains duplicate id "${printer.id}"`
      );
    }
    seen.add(printer.id);
  }

  // The revision is what lets a consumer detect a changed fleet cheaply; a
  // payload without one is from something that is not this contract.
  const revision = toText(value.revision);
  if (!revision) {
    throw new OrchestratorError(
      "invalid_response",
      "Printer inventory has no revision"
    );
  }

  return {
    revision,
    updatedAt: toText(value.updatedAt),
    printers: printers.sort(
      (a, b) => a.position - b.position || a.id.localeCompare(b.id)
    ),
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

  /**
   * The printer fleet's CONFIGURATION via `GET /api/printers/inventory` — the
   * inter-service contract, including printers that are currently disabled.
   * Throws a typed {@link OrchestratorError} on an unreachable orchestrator or
   * a payload that fails validation; it never returns a partial fleet.
   */
  async listPrinterInventory(): Promise<OrchestratorPrinterInventory> {
    return normalizeOrchestratorPrinterInventory(
      await this.requestJson("/api/printers/inventory")
    );
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
