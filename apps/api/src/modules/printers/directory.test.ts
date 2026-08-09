import assert from "node:assert/strict";
import test from "node:test";

import {
  OrchestratorError,
  type OrchestratorClient,
  type OrchestratorPrinterConfig,
  type OrchestratorPrinterInventory,
} from "../../infra/integrations/orchestrator/client";
import { PrinterDirectory, PrinterDirectoryError } from "./directory";

/*
 * The printer directory is the boundary where atelier's fleet becomes decisions
 * in this service, so these tests are about the decisions:
 *   • a change in atelier lands here without a restart, within one TTL;
 *   • disabled and deleted printers stop receiving new work — differently;
 *   • an atelier outage degrades in a bounded, non-silent way, and never ends
 *     with "probably fine, go ahead";
 *   • concurrent callers never turn a cold cache into a request storm.
 */

function printer(
  overrides: Partial<OrchestratorPrinterConfig> = {}
): OrchestratorPrinterConfig {
  return {
    id: "k2",
    name: "Creality K2",
    model: "K2 Plus",
    type: "FDM",
    printerClass: "k2",
    protocol: "moonraker",
    enabled: true,
    position: 10,
    material: "PETG",
    swatch: "#4c4f55",
    nozzleDiameterMm: 0.4,
    nozzleType: "hardened_steel",
    buildVolume: { x: 350, y: 350, z: 350 },
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function inventory(
  printers: OrchestratorPrinterConfig[],
  revision = "rev-1"
): OrchestratorPrinterInventory {
  return { revision, updatedAt: "2026-07-12T12:00:00.000Z", printers };
}

/** A client stub that only implements the one method the directory calls. */
function fakeClient(
  answer: () => Promise<OrchestratorPrinterInventory>
): { client: OrchestratorClient; calls: () => number } {
  let calls = 0;
  const client = {
    listPrinterInventory: async () => {
      calls += 1;
      return answer();
    },
  } as unknown as OrchestratorClient;

  return { client, calls: () => calls };
}

/** A directory over a fixed answer with a controllable clock. */
function directoryOf(
  answer: () => Promise<OrchestratorPrinterInventory>,
  options: { ttlMs?: number; maxStaleMs?: number } = {}
) {
  let nowMs = 1_000_000;
  const { client, calls } = fakeClient(answer);
  const directory = new PrinterDirectory({
    client,
    now: () => nowMs,
    ttlMs: options.ttlMs ?? 30_000,
    maxStaleMs: options.maxStaleMs ?? 120_000,
  });

  return {
    directory,
    calls,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

test("a printer added in atelier becomes assignable without a restart", async () => {
  let fleet = inventory([printer()]);
  const { directory, advance } = directoryOf(async () => fleet);

  await assert.rejects(directory.requireAssignable("a1"), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "unknown_printer");
    return true;
  });

  fleet = inventory([printer(), printer({ id: "a1", name: "Bambu A1" })], "rev-2");
  advance(31_000); // one TTL later: the next read goes upstream

  const resolved = await directory.requireAssignable("a1");
  assert.equal(resolved.name, "Bambu A1");
});

test("edited characteristics are picked up within one TTL", async () => {
  let fleet = inventory([printer()]);
  const { directory, advance } = directoryOf(async () => fleet);

  assert.equal((await directory.requireAssignable("k2")).nozzleDiameterMm, 0.4);

  fleet = inventory(
    [
      printer({
        model: "K2 Pro",
        printerClass: "k2-pro",
        nozzleDiameterMm: 0.6,
        nozzleType: "brass",
        material: "PLA",
        buildVolume: { x: 300, y: 300, z: 300 },
        version: 2,
      }),
    ],
    "rev-2"
  );

  // Still inside the TTL: the cached copy answers, no upstream request.
  assert.equal((await directory.requireAssignable("k2")).nozzleDiameterMm, 0.4);

  advance(31_000);
  const updated = await directory.requireAssignable("k2");
  assert.equal(updated.model, "K2 Pro");
  assert.equal(updated.printerClass, "k2-pro");
  assert.equal(updated.nozzleDiameterMm, 0.6);
  assert.equal(updated.nozzleType, "brass");
  assert.equal(updated.material, "PLA");
  assert.deepEqual(updated.buildVolume, { x: 300, y: 300, z: 300 });
});

test("a disabled printer is refused for new work but stays visible", async () => {
  let fleet = inventory([printer({ enabled: false })]);
  const { directory, advance } = directoryOf(async () => fleet);

  await assert.rejects(directory.requireAssignable("k2"), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "printer_disabled");
    // 409, not 404: the printer exists, its state is the problem.
    assert.equal(error.statusCode, 409);
    return true;
  });

  // It is still in the fleet, which is how history can keep naming it.
  const described = await directory.describe("k2");
  assert.equal(described.known, true);
  assert.equal(described.printer?.enabled, false);

  // Re-enabled in atelier: assignable again, no restart involved.
  fleet = inventory([printer({ enabled: true, version: 2 })], "rev-2");
  advance(31_000);
  assert.equal((await directory.requireAssignable("k2")).enabled, true);
});

test("a deleted printer stops taking work and is reported as unknown", async () => {
  let fleet = inventory([printer()]);
  const { directory, advance } = directoryOf(async () => fleet);

  await directory.requireAssignable("k2");

  fleet = inventory([], "rev-2");
  advance(31_000);

  await assert.rejects(directory.requireAssignable("k2"), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "unknown_printer");
    assert.equal(error.printerId, "k2");
    return true;
  });

  const described = await directory.describe("k2");
  assert.equal(described.known, false);
  assert.equal(described.printer, null);
});

test("an unreachable orchestrator is absorbed while the cache is recent…", async () => {
  let fail = false;
  const { directory, advance } = directoryOf(async () => {
    if (fail) throw new OrchestratorError("network", "connect ECONNREFUSED");
    return inventory([printer()]);
  });

  await directory.requireAssignable("k2");

  fail = true;
  advance(31_000); // past the TTL, well inside the staleness bound

  const stillAssignable = await directory.requireAssignable("k2");
  assert.equal(stillAssignable.id, "k2");
});

test("…and refused once the cache is older than the staleness bound", async () => {
  let fail = false;
  const { directory, advance } = directoryOf(async () => {
    if (fail) throw new OrchestratorError("network", "connect ECONNREFUSED");
    return inventory([printer()]);
  });

  await directory.requireAssignable("k2");

  fail = true;
  advance(121_000);

  await assert.rejects(directory.requireAssignable("k2"), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "printer_directory_unavailable");
    assert.equal(error.statusCode, 502);
    return true;
  });
});

test("with no cache at all, an outage refuses rather than guesses", async () => {
  const { directory } = directoryOf(async () => {
    throw new OrchestratorError("timeout", "Print orchestrator did not answer");
  });

  await assert.rejects(directory.requireAssignable("k2"), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "printer_directory_unavailable");
    return true;
  });

  // And nothing is invented for reads either.
  assert.equal(await directory.peek(), null);
  assert.deepEqual(await directory.describe("k2"), {
    known: false,
    printer: null,
    stale: true,
  });
});

test("an invalid answer never becomes an assignable printer", async () => {
  const { directory } = directoryOf(async () => {
    throw new OrchestratorError("invalid_response", "Printer \"k2\" has no boolean \"enabled\" flag");
  });

  await assert.rejects(directory.requireAssignable("k2"), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "printer_directory_unavailable");
    return true;
  });
});

test("an unconfigured orchestrator says so instead of failing open", async () => {
  const directory = new PrinterDirectory({ client: null });

  await assert.rejects(directory.requireAssignable("k2"), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "printer_directory_not_configured");
    assert.equal(error.statusCode, 503);
    return true;
  });
});

test("the cache serves reads without hitting the orchestrator, and expires", async () => {
  const { directory, calls, advance } = directoryOf(async () =>
    inventory([printer()])
  );

  await directory.load();
  await directory.load();
  await directory.load();
  assert.equal(calls(), 1, "repeated reads inside the TTL must not refetch");

  advance(31_000);
  await directory.load();
  assert.equal(calls(), 2, "a read past the TTL must refetch");
});

test("concurrent readers of a cold cache share ONE upstream request", async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const { directory, calls } = directoryOf(async () => {
    await gate;
    return inventory([printer()]);
  });

  const pending = Promise.all([
    directory.load(),
    directory.load(),
    directory.load(),
    directory.requireAssignable("k2"),
  ]);

  release?.();
  await pending;

  assert.equal(calls(), 1, "a burst on a cold cache must not stampede atelier");
});

test("a stale answer is flagged, so callers can say the data may be old", async () => {
  let fail = false;
  const { directory, advance } = directoryOf(async () => {
    if (fail) throw new OrchestratorError("network", "down");
    return inventory([printer()]);
  });

  const fresh = await directory.load();
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.ageMs, 0);

  fail = true;
  advance(60_000);

  const stale = await directory.peek();
  assert.equal(stale?.fresh, false);
  assert.equal(stale?.ageMs, 60_000);
});

test("the directory preserves the client's ordering rather than re-sorting", async () => {
  // Ordering (position, then id) is applied once, in the client's validator —
  // see normalizeOrchestratorPrinterInventory. The directory must not impose a
  // second, possibly different, order on top of it.
  const { directory } = directoryOf(async () =>
    inventory([
      printer({ id: "b", position: 20 }),
      printer({ id: "c", position: 20 }),
      printer({ id: "a", position: 30 }),
    ])
  );

  const snapshot = await directory.load();
  assert.deepEqual(
    snapshot.printers.map((entry) => entry.id),
    ["b", "c", "a"]
  );
});

test("an empty printer id is refused without an upstream request", async () => {
  const { directory, calls } = directoryOf(async () => inventory([printer()]));

  await assert.rejects(directory.requireAssignable("  "), (error: unknown) => {
    assert.ok(error instanceof PrinterDirectoryError);
    assert.equal(error.code, "unknown_printer");
    return true;
  });
  assert.equal(calls(), 0);
});
