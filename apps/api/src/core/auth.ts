import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

// Centralised admin gate for every mutating/dangerous endpoint (remote backups,
// pricing writes over SSH, notification dispatch, printer config with secrets).
//
// Fail-closed: an admin endpoint must NEVER be open just because no token is
// configured. The previous per-module copies allowed everyone whenever
// ADMIN_TOKEN was unset and NODE_ENV was not exactly "production" — which is the
// case in this deployment — so the gate was effectively off. Here, a missing
// token means the endpoint is refused (503) rather than opened.
//
// The token is read live from process.env (not cached at import) so tests and
// hot config changes take effect without a restart.

type AdminDenied = { error: string };

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Guards an admin-only route. Returns `null` when the caller is authorised;
 * otherwise sets the HTTP status on `reply` and returns the error body the route
 * should return. Usage:
 *
 *   const denied = requireAdmin(request, reply);
 *   if (denied) return denied;
 */
export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): AdminDenied | null {
  const expectedToken = process.env.ADMIN_TOKEN?.trim();

  if (!expectedToken) {
    reply.code(503);
    return { error: "ADMIN_TOKEN is not configured on the server" };
  }

  const token = getHeaderValue(request.headers["x-admin-token"])?.trim();

  if (!token || !safeEqual(token, expectedToken)) {
    reply.code(401);
    return { error: "Unauthorized" };
  }

  return null;
}

/**
 * Constant-time secret comparison. A length mismatch returns false immediately
 * (a random token's length is not a useful secret and timingSafeEqual throws on
 * unequal-length buffers); equal-length inputs are compared without a
 * data-dependent early return.
 */
function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

// ── Inter-service auth (apps/atelier → apps/fulfillment) ────────────────────
//
// The atelier print-orchestrator drives two inter-service inventory calls:
// automatic filament consumption (POST /filament/consume) and loaded-reel
// binding (POST /filament/../printer-filament/sync). They authenticate with a
// SERVICE token (ATELIER_FULFILLMENT_TOKEN), distinct from the operator's
// ADMIN_TOKEN, sent in the `x-service-token` header. The service token opens
// ONLY those two routes (see requireAdminOrService) — never the admin-only
// mutations — so a leaked service token cannot edit thresholds, archive stock,
// change order statuses, etc.
//
// The token is read live from process.env (never cached at import) and never
// logged. Comparison is constant-time (safeEqual).

const SERVICE_TOKEN_HEADER = "x-service-token";

function readAdminToken(): string | undefined {
  return process.env.ADMIN_TOKEN?.trim() || undefined;
}

function readServiceToken(): string | undefined {
  return process.env.ATELIER_FULFILLMENT_TOKEN?.trim() || undefined;
}

/**
 * Staged-rollout escape hatch. When ATELIER_FULFILLMENT_AUTH_OPTIONAL is on,
 * the inter-service routes accept a caller with no/invalid service token (so
 * an older atelier build that does not yet send it keeps syncing/consuming).
 * OFF by default in every environment; a request that uses it emits a warning.
 * Turn it off once atelier is deployed with the token.
 */
function serviceAuthOptional(): boolean {
  const raw = process.env.ATELIER_FULFILLMENT_AUTH_OPTIONAL?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

// Rate-limit the compatibility-mode warning so it flags the misconfiguration
// without flooding the log on every inter-service call.
let lastServiceAuthOptionalWarnAt = 0;

function warnServiceAuthOptional(request: FastifyRequest): void {
  const now = Date.now();
  if (now - lastServiceAuthOptionalWarnAt < 60_000) {
    return;
  }
  lastServiceAuthOptionalWarnAt = now;

  request.log.warn(
    {
      route: request.url,
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
    "ATELIER_FULFILLMENT_AUTH_OPTIONAL is enabled: an inter-service request " +
      "was accepted WITHOUT a valid service token. This is a temporary " +
      "staged-rollout mode — disable it once apps/atelier sends " +
      "x-service-token (ATELIER_FULFILLMENT_TOKEN)."
  );
}

/**
 * Guards a route that both the operator dashboard AND the atelier orchestrator
 * call (filament consume / loaded-reel sync). Authorises when EITHER a valid
 * admin token (x-admin-token) OR a valid service token (x-service-token) is
 * presented; the service token is scoped to these routes only.
 *
 * Fail-closed like {@link requireAdmin}: returns null when authorised, else sets
 * the status on `reply` and returns the error body. Tokens are never logged.
 *   - neither ADMIN_TOKEN nor ATELIER_FULFILLMENT_TOKEN configured → 503
 *   - a missing/wrong token → 401
 *   - ATELIER_FULFILLMENT_AUTH_OPTIONAL on → allowed with a warning
 */
export function requireAdminOrService(
  request: FastifyRequest,
  reply: FastifyReply
): AdminDenied | null {
  const adminToken = readAdminToken();
  const serviceToken = readServiceToken();

  const providedAdmin = getHeaderValue(request.headers["x-admin-token"])?.trim();
  if (adminToken && providedAdmin && safeEqual(providedAdmin, adminToken)) {
    return null;
  }

  const providedService = getHeaderValue(
    request.headers[SERVICE_TOKEN_HEADER]
  )?.trim();
  if (serviceToken && providedService && safeEqual(providedService, serviceToken)) {
    return null;
  }

  if (serviceAuthOptional()) {
    warnServiceAuthOptional(request);
    return null;
  }

  if (!adminToken && !serviceToken) {
    reply.code(503);
    return {
      error:
        "Service authorization is not configured on the server " +
        "(ADMIN_TOKEN / ATELIER_FULFILLMENT_TOKEN)",
    };
  }

  reply.code(401);
  return { error: "Unauthorized" };
}

/**
 * Read-only guard for the shop's filament-availability feed. Uses its OWN bearer
 * token (FILAMENT_AVAILABILITY_TOKEN) — never the dashboard's ADMIN_TOKEN, and
 * it opens no mutating route. Mirrors {@link requireAdmin}: returns null when
 * authorised, otherwise sets the status on `reply` and returns the body.
 *
 * The token is read live from process.env (never cached at import) and never
 * logged. Fail-closed like the admin gate:
 *   - token not configured on the server → 503 (never open when unset)
 *   - missing / malformed `Authorization` header, or a token that does not
 *     match → 401
 */
export function requireFilamentAvailabilityToken(
  request: FastifyRequest,
  reply: FastifyReply
): AdminDenied | null {
  const expectedToken = process.env.FILAMENT_AVAILABILITY_TOKEN?.trim();

  if (!expectedToken) {
    reply.code(503);
    return {
      error: "FILAMENT_AVAILABILITY_TOKEN is not configured on the server",
    };
  }

  const header = getHeaderValue(request.headers.authorization)?.trim();
  const provided = header ? /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() : undefined;

  if (!provided || !safeEqual(provided, expectedToken)) {
    reply.code(401);
    return { error: "Unauthorized" };
  }

  return null;
}
