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

  if (!token || token !== expectedToken) {
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
