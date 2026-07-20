function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function optionalString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }

  return value;
}

function optionalNumberEnv(name: string): number | null {
  const raw = process.env[name];

  if (raw === undefined || raw === "") {
    return null;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }

  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = raw.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new Error(`Invalid boolean environment variable: ${name}`);
}

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: numberEnv("PORT", 8080),
  HOST: optional("HOST", "0.0.0.0"),
  DATABASE_URL: required("DATABASE_URL"),

  // Comma-separated list of browser origins allowed to call the API cross-site
  // (e.g. "https://ops.example.com"). When set, only these origins are allowed
  // and credentials are permitted. When empty, any origin may call the API but
  // WITHOUT credentials — never the wildcard-origin + credentials combo, which
  // lets any site make credentialed cross-site requests. The dashboard is served
  // same-origin via nginx, so it needs no entry here.
  CORS_ALLOWED_ORIGINS: optionalString("CORS_ALLOWED_ORIGINS"),

  // Run pending DB migrations automatically on API startup. On by default so a
  // fresh deployment doesn't boot against a schema-less database. Set to false
  // to manage migrations out of band (e.g. a dedicated migration job).
  MIGRATE_ON_START: booleanEnv("MIGRATE_ON_START", true),

  TELEGRAM_ENABLED: booleanEnv("TELEGRAM_ENABLED", false),
  TELEGRAM_BOT_TOKEN: optionalString("TELEGRAM_BOT_TOKEN"),
  TELEGRAM_CHAT_ID: optionalString("TELEGRAM_CHAT_ID"),
  TELEGRAM_TOPIC_ORDERS_ID: optionalNumberEnv("TELEGRAM_TOPIC_ORDERS_ID"),
  TELEGRAM_TOPIC_PRODUCT_REPORTS_ID: optionalNumberEnv(
    "TELEGRAM_TOPIC_PRODUCT_REPORTS_ID"
  ),
  TELEGRAM_TOPIC_PRINTS_ID: optionalNumberEnv("TELEGRAM_TOPIC_PRINTS_ID"),
  TELEGRAM_TOPIC_CRITICAL_ERRORS_ID: optionalNumberEnv(
    "TELEGRAM_TOPIC_CRITICAL_ERRORS_ID"
  ),
  TELEGRAM_REQUEST_TIMEOUT_MS: numberEnv("TELEGRAM_REQUEST_TIMEOUT_MS", 5000),
  NOTIFICATIONS_POLL_INTERVAL_MS: numberEnv(
    "NOTIFICATIONS_POLL_INTERVAL_MS",
    5000
  ),
  NOTIFICATIONS_BATCH_SIZE: numberEnv("NOTIFICATIONS_BATCH_SIZE", 10),
  NOTIFICATIONS_MAX_ATTEMPTS: numberEnv("NOTIFICATIONS_MAX_ATTEMPTS", 10),
  NOTIFICATIONS_CRITICAL_DEDUPE_WINDOW_MS: numberEnv(
    "NOTIFICATIONS_CRITICAL_DEDUPE_WINDOW_MS",
    5 * 60 * 1000
  ),

  PRINTER_MONITOR_ENABLED: booleanEnv("PRINTER_MONITOR_ENABLED", false),
  PRINTER_MONITOR_POLL_INTERVAL_MS: numberEnv(
    "PRINTER_MONITOR_POLL_INTERVAL_MS",
    15000
  ),
  PRINTER_SNAPSHOT_ENABLED: booleanEnv("PRINTER_SNAPSHOT_ENABLED", true),
  // Generous default: a go2rtc-bridged camera (e.g. the Creality K2's
  // proprietary WebRTC stream) negotiates a peer connection and waits for a
  // keyframe before it can return the first JPEG, which can take several
  // seconds when cold. Plain MJPEG/Bambu sources still return as soon as a
  // frame arrives, so they are unaffected by the higher ceiling.
  PRINTER_SNAPSHOT_TIMEOUT_MS: numberEnv("PRINTER_SNAPSHOT_TIMEOUT_MS", 8000),
  PRINTER_SNAPSHOT_MAX_BYTES: numberEnv(
    "PRINTER_SNAPSHOT_MAX_BYTES",
    3_000_000
  ),
  // Base URL of the atelier print-orchestrator (e.g. `http://print-orchestrator:3100`),
  // the ONLY source of printer statuses and camera snapshots for this API — no
  // direct device connections are made here. Empty means the printer features
  // (monitoring, health, the dashboard page) report "not configured".
  // PRINTER_SNAPSHOT_ORCHESTRATOR_URL is honoured as a legacy fallback name.
  PRINTER_ORCHESTRATOR_URL:
    optionalString("PRINTER_ORCHESTRATOR_URL") ||
    optionalString("PRINTER_SNAPSHOT_ORCHESTRATOR_URL"),
  // Optional bearer token for the orchestrator API (ORCHESTRATOR_API_TOKEN on
  // the atelier side). Read lazily by the client; never logged.
  PRINTER_ORCHESTRATOR_API_TOKEN: optionalString(
    "PRINTER_ORCHESTRATOR_API_TOKEN"
  ),
  PRINTER_ORCHESTRATOR_TIMEOUT_MS: numberEnv(
    "PRINTER_ORCHESTRATOR_TIMEOUT_MS",
    5000
  ),
  // A printer status whose orchestrator-side `updatedAt` is older than this is
  // treated as stale: it is flagged in GET /api/printers/status and the monitor
  // refuses to derive Telegram events from it (a frozen poll loop must not look
  // like a print transition). Statuses without updatedAt (older orchestrator
  // builds) are exempt — their age is unknown, not stale.
  PRINTER_STATUS_STALE_MS: numberEnv("PRINTER_STATUS_STALE_MS", 120_000),

  // Minimum grams a material×color must hold to count as available in the
  // read-only shop feed (GET /api/inventory/filament/availability):
  // `available = stock_g >= FILAMENT_AVAILABILITY_MIN_G`. Deliberately separate
  // from the low_stock_g / critical_stock_g warehouse warning bands. The bearer
  // token that guards the feed (FILAMENT_AVAILABILITY_TOKEN) is read live in
  // core/auth.ts, not here, so it is never cached and never logged.
  FILAMENT_AVAILABILITY_MIN_G: numberEnv("FILAMENT_AVAILABILITY_MIN_G", 100),

  // Appeals (Обращения) source. By default this API IS the appeals store:
  // threads live in a file-backed store (apps/api/data/appeals.json), created by
  // the shop's "Задать вопрос мастеру" chat via POST /api/appeals/ingest
  // and answered by operators from the dashboard. Set APPEALS_SERVICE_URL only
  // to instead proxy to a separate external appeals service.
  APPEALS_SERVICE_URL: optionalString("APPEALS_SERVICE_URL"),
  // Dev/demo escape hatch: serve the in-memory seed store (./modules/appeals/
  // store.ts) instead of the real file-backed store. Ignored when
  // APPEALS_SERVICE_URL is set. Never enable in production — it shows demo
  // chats, not real appeals.
  APPEALS_USE_MOCK: booleanEnv("APPEALS_USE_MOCK", false),
};