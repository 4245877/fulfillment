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
