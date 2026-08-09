import type { FastifyInstance } from "fastify";

import {
  requireAdmin,
  requireAdminOrService,
  requireFilamentAvailabilityToken,
} from "../../core/auth";
import {
  addFilament,
  adjustFilament,
  consumeFilament,
  getFilamentAvailability,
  getInventoryMaterialsSummary,
  listFilamentMovements,
  listFilamentStock,
  listPrinterFilamentState,
  loadPrinterFilament,
  syncPrinterFilament,
  updateFilamentStock,
} from "./service";
import {
  getPrinterDirectory,
  PrinterDirectoryError,
  type PrinterDirectory,
} from "../printers/directory";
import {
  InventoryValidationError,
  isDatabaseError,
  parseAddFilamentBody,
  parseAdjustFilamentBody,
  parseConsumeFilamentBody,
  parseLoadPrinterFilamentBody,
  parseSyncPrinterFilamentBody,
  parseUpdateFilamentBody,
} from "./validation";

export type InventoryRoutesOptions = {
  /** Injectable for tests; defaults to the process-wide printer directory. */
  directory?: PrinterDirectory;
};

export default async function inventoryRoutes(
  app: FastifyInstance,
  opts: InventoryRoutesOptions = {}
) {
  const directory = opts.directory ?? getPrinterDirectory();

  // Encapsulated error handler for THIS plugin only: validation rejections
  // become 400 { error, code }; a driver/Postgres error becomes a generic 500
  // (the raw DB message is logged server-side, never returned); any other
  // service error keeps its human-readable message at 400. Nothing here ever
  // returns an unhandled Postgres error to the caller.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof InventoryValidationError) {
      reply.code(error.statusCode);
      return { error: error.message, code: error.code };
    }

    // A refusal from the printer directory: an unknown/disabled printer, or a
    // fleet this service could not confirm. Answered with its own code so the
    // caller (dashboard or atelier) can tell "you asked for the wrong printer"
    // from "we could not check" — and retry only the latter.
    if (error instanceof PrinterDirectoryError) {
      request.log.warn(
        {
          operation: "printer_directory_gate",
          code: error.code,
          printerId: error.printerId,
        },
        "Refused a reel binding: the printer could not be confirmed"
      );
      reply.code(error.statusCode);
      return { error: error.message, code: error.code };
    }

    if (isDatabaseError(error)) {
      request.log.error({ err: error }, "inventory: unexpected database error");
      reply.code(500);
      return { error: "Internal server error", code: "internal_error" };
    }

    const status =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 400;
    reply.code(status >= 400 && status <= 599 ? status : 400);
    const message = error instanceof Error ? error.message : "Bad request";
    return { error: message || "Bad request", code: "bad_request" };
  });

  // ── Reads (no token; the dashboard fetches these same-origin) ──────────────

  app.get("/filament/stock", async () => {
    return {
      items: await listFilamentStock(),
    };
  });

  // Read-only availability feed for the online shop: aggregated material×color
  // availability from filament_stock. Guarded by its OWN bearer token
  // (FILAMENT_AVAILABILITY_TOKEN), never the dashboard's; strictly read-only and
  // it opens none of the mutating routes below. 503 when the token is unset,
  // 401 on a missing/wrong token.
  app.get("/filament/availability", async (req, reply) => {
    const denied = requireFilamentAvailabilityToken(req, reply);
    if (denied) return denied;

    return getFilamentAvailability();
  });

  app.get("/filament/movements", async (req) => {
    const query = req.query as { limit?: string | number };
    const limit = Number(query.limit || 100);

    return {
      items: await listFilamentMovements(limit),
    };
  });

  app.get("/summary", async () => {
    return getInventoryMaterialsSummary();
  });

  // Reel bindings, each annotated with what atelier currently knows about the
  // printer. `printerKnown: false` is a binding whose printer was deleted in
  // atelier — the row is kept (it is a record of what was physically loaded)
  // and labelled from its stored name snapshot. A directory outage leaves the
  // annotations null rather than failing the read: this is a display route.
  app.get("/printer-filament", async () => {
    const [items, snapshot] = await Promise.all([
      listPrinterFilamentState(),
      directory.peek(),
    ]);

    const configured = new Map(
      (snapshot?.printers ?? []).map((printer) => [printer.id, printer])
    );

    return {
      printerDirectory: snapshot
        ? { available: true, stale: !snapshot.fresh, revision: snapshot.revision }
        : { available: false, stale: true, revision: null },
      items: items.map((item) => {
        const printer = configured.get(item.printerId);
        return {
          ...item,
          // Live name wins (it may have been renamed), then the snapshot taken
          // when the reel was bound, then the bare id.
          printerName: printer?.name ?? item.printerName ?? null,
          printerKnown: snapshot ? Boolean(printer) : null,
          printerEnabled: printer ? printer.enabled : null,
        };
      }),
    };
  });

  // ── Admin-only warehouse mutations (operator dashboard) ────────────────────
  // These require an admin token; the atelier service token does NOT open them.

  app.post("/filament/add", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    return addFilament(parseAddFilamentBody(req.body));
  });

  app.post("/filament/adjust", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    return adjustFilament(parseAdjustFilamentBody(req.body));
  });

  app.post("/filament/update", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    return updateFilamentStock(parseUpdateFilamentBody(req.body));
  });

  // Manual "which reel is on this printer" entry from the dashboard — admin only
  // (creates stock if needed). The automatic device-driven binding is /sync.
  //
  // Binding a reel is an ASSIGNMENT: it decides which stock a later print
  // deducts from. So the printer is confirmed against atelier first — an id
  // that was deleted, was never configured, or is currently disabled is refused
  // rather than bound, and a fleet this service cannot confirm refuses too
  // (see PrinterDirectory.requireAssignable).
  app.post("/printer-filament/load", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    const input = parseLoadPrinterFilamentBody(req.body);
    const printer = await directory.requireAssignable(input.printerId);

    return loadPrinterFilament({ ...input, printerName: printer.name });
  });

  // ── Inter-service routes (dashboard OR atelier) ───────────────────────────
  // Accept EITHER an admin token (manual dashboard action) OR the atelier
  // service token (x-service-token) — these are the only two routes the service
  // token unlocks.

  // Manual consume from the dashboard AND automatic per-print deduction from the
  // atelier orchestrator.
  app.post("/filament/consume", async (req, reply) => {
    const denied = requireAdminOrService(req, reply);
    if (denied) return denied;

    return consumeFilament(parseConsumeFilamentBody(req.body));
  });

  // Auto-binds the reel a printer reports loaded to a stock position (called by
  // the atelier orchestrator, no manual entry). A hint that matches no stock is
  // a 200 `{ resolved: false }`, not an error, so the caller does not
  // retry-storm; only malformed input (missing printerId/material) is a 400.
  //
  // The same assignment gate as /load applies: atelier only polls printers it
  // has enabled, so a sync for an unknown or disabled id means the caller and
  // this service disagree about the fleet — binding it anyway would attach a
  // reel (and future deductions) to a machine that takes no work. atelier
  // retries a refused sync on its next poll, so a momentarily unconfirmable
  // fleet delays the binding instead of losing it.
  app.post("/printer-filament/sync", async (req, reply) => {
    const denied = requireAdminOrService(req, reply);
    if (denied) return denied;

    const input = parseSyncPrinterFilamentBody(req.body);
    const printer = await directory.requireAssignable(input.printerId);

    return syncPrinterFilament({ ...input, printerName: printer.name });
  });
}
