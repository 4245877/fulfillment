import {
  createOrchestratorClientFromEnv,
  OrchestratorError,
  type OrchestratorClient,
  type OrchestratorPrinterConfig,
  type OrchestratorPrinterInventory,
} from "../../infra/integrations/orchestrator/client";

/**
 * The printer directory: this service's view of **which printers exist and what
 * they are**, read from atelier's `GET /api/printers/inventory`.
 *
 * atelier owns the fleet. Nothing here is editable, nothing is persisted, and
 * there is no second copy of the configuration in this repository — only a
 * short-lived cache in front of the one source of truth.
 *
 * Three rules it holds to:
 *
 *  - **a change appears without a redeploy or a restart.** The cache is a few
 *    tens of seconds long, so a printer added, edited, disabled or deleted in
 *    atelier is visible here within one TTL, with no operator action;
 *  - **staleness is bounded and never silent.** Past {@link maxStaleMs} the
 *    cached fleet stops being usable for decisions: a request that would assign
 *    work fails with a typed error instead of quietly trusting an old snapshot.
 *    Display paths may still show the last known fleet, clearly marked;
 *  - **concurrent readers share one request.** A burst of calls during a cold
 *    cache produces a single upstream fetch, not one per caller.
 */

/** Default freshness window: below this age no upstream request is made. */
export const DEFAULT_DIRECTORY_TTL_MS = 30_000;

/**
 * Default hard staleness bound. A cached fleet older than this may not decide
 * anything — that is the difference between "atelier hiccupped for a moment"
 * and "we have no idea what the farm looks like".
 */
export const DEFAULT_DIRECTORY_MAX_STALE_MS = 120_000;

export type PrinterDirectoryErrorCode =
  /** No orchestrator configured (PRINTER_ORCHESTRATOR_URL is empty). */
  | "printer_directory_not_configured"
  /** atelier unreachable / invalid answer and no sufficiently fresh cache. */
  | "printer_directory_unavailable"
  /** The id is not in the fleet: never configured, or deleted in atelier. */
  | "unknown_printer"
  /** Configured, but switched off in atelier — it takes no new work. */
  | "printer_disabled";

export class PrinterDirectoryError extends Error {
  readonly code: PrinterDirectoryErrorCode;
  /** HTTP status the routes answer with; set at the throw site's discretion. */
  readonly statusCode: number;
  readonly printerId: string | null;

  constructor(
    code: PrinterDirectoryErrorCode,
    message: string,
    statusCode: number,
    printerId: string | null = null
  ) {
    super(message);
    this.name = "PrinterDirectoryError";
    this.code = code;
    this.statusCode = statusCode;
    this.printerId = printerId;
  }
}

export type PrinterDirectorySnapshot = {
  revision: string;
  /** atelier's own "last edited" timestamp for the fleet; null when empty. */
  updatedAt: string | null;
  printers: OrchestratorPrinterConfig[];
  /** When this service last successfully read the fleet (epoch ms). */
  fetchedAtMs: number;
  ageMs: number;
  /** Within the TTL — i.e. read from atelier moments ago. */
  fresh: boolean;
};

type LoggerLike = {
  info?: (obj: unknown, message?: string) => void;
  warn?: (obj: unknown, message?: string) => void;
  error?: (obj: unknown, message?: string) => void;
};

export type PrinterDirectoryOptions = {
  ttlMs?: number;
  maxStaleMs?: number;
  /** Injectable for tests; defaults to the env-configured orchestrator client. */
  client?: OrchestratorClient | null;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
  logger?: LoggerLike;
};

type CacheEntry = {
  inventory: OrchestratorPrinterInventory;
  fetchedAtMs: number;
};

export class PrinterDirectory {
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly now: () => number;
  private readonly explicitClient: OrchestratorClient | null | undefined;
  private logger: LoggerLike;

  private cache: CacheEntry | null = null;
  /** The single in-flight refresh shared by every concurrent caller. */
  private inFlight: Promise<CacheEntry> | null = null;
  /** Last upstream failure, for diagnostics and for the ops overview. */
  private lastError: { message: string; atMs: number } | null = null;
  /** Revision of the last snapshot, so a fleet change can be logged once. */
  private lastLoggedRevision: string | null = null;

  constructor(options: PrinterDirectoryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_DIRECTORY_TTL_MS;
    this.maxStaleMs = Math.max(
      options.maxStaleMs ?? DEFAULT_DIRECTORY_MAX_STALE_MS,
      this.ttlMs
    );
    this.now = options.now ?? (() => Date.now());
    this.explicitClient = options.client;
    this.logger = options.logger ?? {};
  }

  /** Attaches the app logger once it exists (the directory is built earlier). */
  setLogger(logger: LoggerLike): void {
    this.logger = logger;
  }

  /** Drops the cache; the next read goes upstream. Used by tests and shutdown. */
  reset(): void {
    this.cache = null;
    this.inFlight = null;
    this.lastError = null;
    this.lastLoggedRevision = null;
  }

  private resolveClient(): OrchestratorClient | null {
    return this.explicitClient !== undefined
      ? this.explicitClient
      : createOrchestratorClientFromEnv();
  }

  private toSnapshot(entry: CacheEntry): PrinterDirectorySnapshot {
    const ageMs = Math.max(0, this.now() - entry.fetchedAtMs);
    return {
      revision: entry.inventory.revision,
      updatedAt: entry.inventory.updatedAt,
      printers: entry.inventory.printers,
      fetchedAtMs: entry.fetchedAtMs,
      ageMs,
      fresh: ageMs <= this.ttlMs,
    };
  }

  /**
   * Reads the fleet from atelier, collapsing concurrent callers onto one
   * request. The cache is replaced only on success — a failed refresh leaves
   * the previous snapshot (and its age) untouched, so callers can decide for
   * themselves whether it is still good enough.
   */
  private async refresh(): Promise<CacheEntry> {
    if (this.inFlight) return this.inFlight;

    const client = this.resolveClient();
    if (!client) {
      throw new PrinterDirectoryError(
        "printer_directory_not_configured",
        "Оркестратор печати не настроен (PRINTER_ORCHESTRATOR_URL) — список принтеров недоступен",
        503
      );
    }

    const request = (async (): Promise<CacheEntry> => {
      try {
        const inventory = await client.listPrinterInventory();
        const entry: CacheEntry = { inventory, fetchedAtMs: this.now() };
        this.cache = entry;
        this.lastError = null;

        if (this.lastLoggedRevision !== inventory.revision) {
          this.logger.info?.(
            {
              operation: "printer_directory_refresh",
              revision: inventory.revision,
              printers: inventory.printers.length,
              enabled: inventory.printers.filter((printer) => printer.enabled).length,
            },
            this.lastLoggedRevision === null
              ? "Printer directory loaded from the orchestrator"
              : "Printer fleet changed in atelier"
          );
          this.lastLoggedRevision = inventory.revision;
        }

        return entry;
      } catch (error) {
        const message =
          error instanceof OrchestratorError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);

        this.lastError = { message, atMs: this.now() };
        this.logger.warn?.(
          {
            operation: "printer_directory_refresh",
            errorKind: error instanceof OrchestratorError ? error.kind : "unknown",
            error: message,
            cachedAgeMs: this.cache ? this.now() - this.cache.fetchedAtMs : null,
          },
          "Printer directory refresh failed"
        );

        throw new PrinterDirectoryError(
          "printer_directory_unavailable",
          `Список принтеров недоступен: ${message}`,
          502
        );
      } finally {
        this.inFlight = null;
      }
    })();

    this.inFlight = request;
    return request;
  }

  /**
   * The fleet, refreshed when the cache is older than the TTL.
   *
   * `maxAgeMs` is the caller's tolerance for a failed refresh: with a cache
   * younger than it, an atelier hiccup is absorbed (and warned about); past it
   * the failure is raised. Decision paths pass the default bound; display paths
   * use {@link peek} instead and never throw.
   */
  async load(maxAgeMs: number = this.maxStaleMs): Promise<PrinterDirectorySnapshot> {
    const cached = this.cache;
    if (cached && this.now() - cached.fetchedAtMs <= this.ttlMs) {
      return this.toSnapshot(cached);
    }

    try {
      return this.toSnapshot(await this.refresh());
    } catch (error) {
      const fallback = this.cache;
      const ageMs = fallback ? this.now() - fallback.fetchedAtMs : Infinity;

      if (fallback && ageMs <= maxAgeMs) {
        this.logger.warn?.(
          {
            operation: "printer_directory_stale",
            ageMs,
            maxAgeMs,
            revision: fallback.inventory.revision,
          },
          "Serving the last known printer fleet: the orchestrator did not answer"
        );
        return this.toSnapshot(fallback);
      }

      throw error;
    }
  }

  /**
   * Best-effort read for display: returns the last known fleet however old it
   * is (marked `fresh: false`), or null when nothing was ever read. Never
   * throws — a printers list that degrades to "last known" is fine; a decision
   * made on it is not, which is why decisions go through {@link load}.
   */
  async peek(): Promise<PrinterDirectorySnapshot | null> {
    try {
      return await this.load(Number.POSITIVE_INFINITY);
    } catch {
      return this.cache ? this.toSnapshot(this.cache) : null;
    }
  }

  /**
   * The printer a new assignment may target, or a typed refusal. This is the
   * gate every "send work to printer X" path goes through:
   *
   *  - unknown id (never configured, or deleted in atelier) → `unknown_printer`;
   *  - configured but switched off → `printer_disabled`;
   *  - fleet unknown or too stale to trust → `printer_directory_unavailable`.
   *
   * It never answers "probably fine": with no sufficiently fresh fleet the
   * caller is refused rather than allowed to act on an old snapshot.
   */
  async requireAssignable(printerId: string): Promise<OrchestratorPrinterConfig> {
    const id = String(printerId || "").trim();
    if (!id) {
      throw new PrinterDirectoryError(
        "unknown_printer",
        "Не указан идентификатор принтера",
        400
      );
    }

    const snapshot = await this.load();
    const printer = snapshot.printers.find((entry) => entry.id === id);

    if (!printer) {
      throw new PrinterDirectoryError(
        "unknown_printer",
        `Принтер «${id}» не настроен в atelier — проверьте идентификатор или добавьте принтер в дашборде фермы`,
        400,
        id
      );
    }

    if (!printer.enabled) {
      throw new PrinterDirectoryError(
        "printer_disabled",
        `Принтер «${printer.name}» отключён в atelier — включите его, прежде чем назначать работу`,
        409,
        id
      );
    }

    return printer;
  }

  /**
   * What is known about an id, for reads and for labelling historical rows.
   * `known: false` is the honest answer for a deleted printer — the history
   * that references it stays valid, it simply has no configuration behind it
   * any more.
   */
  async describe(printerId: string): Promise<{
    known: boolean;
    printer: OrchestratorPrinterConfig | null;
    /** True when the answer comes from a cache past its freshness window. */
    stale: boolean;
  }> {
    const id = String(printerId || "").trim();
    const snapshot = await this.peek();

    if (!snapshot) {
      return { known: false, printer: null, stale: true };
    }

    const printer = snapshot.printers.find((entry) => entry.id === id) ?? null;
    return { known: Boolean(printer), printer, stale: !snapshot.fresh };
  }

  /** Diagnostics for the ops overview; no upstream request. */
  stats(): {
    configured: boolean;
    revision: string | null;
    printers: number | null;
    enabled: number | null;
    ageMs: number | null;
    lastError: string | null;
  } {
    const cached = this.cache;
    return {
      configured: Boolean(this.resolveClient()),
      revision: cached?.inventory.revision ?? null,
      printers: cached?.inventory.printers.length ?? null,
      enabled: cached
        ? cached.inventory.printers.filter((printer) => printer.enabled).length
        : null,
      ageMs: cached ? this.now() - cached.fetchedAtMs : null,
      lastError: this.lastError?.message ?? null,
    };
  }
}

/**
 * The process-wide directory. One instance so the cache (and its single-flight
 * refresh) is shared by every route and worker — a per-request instance would
 * turn the cache into a per-request fetch.
 */
let singleton: PrinterDirectory | null = null;

export function getPrinterDirectory(): PrinterDirectory {
  if (!singleton) {
    singleton = new PrinterDirectory({
      ttlMs: readMs("PRINTER_DIRECTORY_TTL_MS", DEFAULT_DIRECTORY_TTL_MS),
      maxStaleMs: readMs(
        "PRINTER_DIRECTORY_MAX_STALE_MS",
        DEFAULT_DIRECTORY_MAX_STALE_MS
      ),
    });
  }
  return singleton;
}

/** Replaces the singleton (tests) or drops it so the next read reconfigures. */
export function setPrinterDirectory(directory: PrinterDirectory | null): void {
  singleton = directory;
}

/**
 * Read lazily rather than through shared/env: the directory is constructed on
 * first use, and tests set these variables per case.
 */
function readMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
