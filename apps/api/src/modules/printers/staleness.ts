/**
 * Staleness of orchestrator-reported printer statuses. Kept dependency-free
 * (no env/db imports) so both the HTTP routes and the monitor can use it, and
 * their tests can run without a configured environment.
 */

export const DEFAULT_STALE_MS = 120_000;

/**
 * The stale budget from PRINTER_STATUS_STALE_MS, read lazily so tests can set
 * the variable without re-importing modules. Falls back to 2 minutes — well
 * above the orchestrator's own 10s poll cadence, so only a genuinely frozen
 * upstream poll loop trips it.
 */
export function resolveStaleAfterMs(): number {
  const raw = Number(process.env.PRINTER_STATUS_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_MS;
}

/**
 * True when the orchestrator-side status timestamp is older than
 * `staleAfterMs`. A status without `updatedAt` (older orchestrator build) has
 * an unknown age and is NOT stale — staleness must be proven, not assumed.
 */
export function isStaleStatus(
  status: { updatedAt: string | null },
  staleAfterMs: number,
  nowMs: number = Date.now()
): boolean {
  if (!status.updatedAt) return false;

  const updated = Date.parse(status.updatedAt);
  if (!Number.isFinite(updated)) return false;

  return nowMs - updated > staleAfterMs;
}
