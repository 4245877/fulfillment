import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  normalizeOrchestratorPrinter,
  type OrchestratorPrinterStatus,
} from "./client";

/**
 * Runtime contract between the atelier print-orchestrator DTO (PrinterView,
 * `GET /api/printers`) and this client's validator. The fixture is generated
 * by the orchestrator's own contract test
 * (apps/atelier/apps/print-orchestrator/src/app/printerView.contract.test.ts,
 * `UPDATE_CONTRACT=1 pnpm test`) and committed VERBATIM in both repos, because
 * the projects build and deploy independently — matching TypeScript types
 * alone prove nothing across that boundary.
 *
 * When the sibling atelier checkout is present (the normal layout on the
 * deployment host), the two copies are also compared byte-for-byte so they
 * cannot drift apart silently.
 */
const LOCAL_FIXTURE = path.resolve(__dirname, "printer-view.contract.json");

/** The atelier copy: env override first, then the standard sibling layout. */
function atelierFixturePath(): string | null {
  const fromEnv = process.env.ATELIER_PRINTER_VIEW_CONTRACT?.trim();
  if (fromEnv) return fromEnv;

  const sibling = path.resolve(
    __dirname,
    "../../../../../../../atelier/apps/print-orchestrator/contracts/printer-view.contract.json"
  );
  return existsSync(sibling) ? sibling : null;
}

type ContractFixture = Record<string, Record<string, unknown>>;

function loadLocalFixture(): ContractFixture {
  return JSON.parse(readFileSync(LOCAL_FIXTURE, "utf8"));
}

test("every contract payload passes the runtime validator with the expected mapping", () => {
  const fixture = loadLocalFixture();
  const names = Object.keys(fixture);
  assert.ok(names.length >= 3, "fixture must cover several printer states");

  for (const [name, payload] of Object.entries(fixture)) {
    const printer = normalizeOrchestratorPrinter(payload);
    assert.ok(printer, `${name}: the orchestrator payload must be accepted`);

    const typed: OrchestratorPrinterStatus = printer;

    // Identity and classification fields the monitor depends on.
    assert.equal(typed.id, payload.id, name);
    assert.equal(typed.name, payload.name, name);
    assert.equal(typeof typed.online, "boolean", name);
    assert.equal(typed.online, payload.online, name);
    assert.equal(typed.status, payload.status, name);
    assert.equal(typed.stateText, payload.stateText ?? null, name);
    assert.equal(typed.stateMessage, payload.stateMessage ?? null, name);
    assert.equal(typed.updatedAt, payload.updatedAt ?? null, name);

    // Telemetry mapping: orchestrator wire names -> client names.
    assert.equal(typed.currentFile, payload.job ?? null, name);
    assert.equal(typed.progressPct, payload.progress ?? null, name);
    assert.equal(typed.remainingMinutes, payload.minutesLeft ?? null, name);
    if (Array.isArray(payload.nozzle)) {
      assert.equal(typed.nozzleTemp, payload.nozzle[0], name);
    } else {
      assert.equal(typed.nozzleTemp, null, name);
    }
    if (Array.isArray(payload.bed)) {
      assert.equal(typed.bedTemp, payload.bed[0], name);
    } else {
      assert.equal(typed.bedTemp, null, name);
    }
    // Live material wins over the configured one.
    assert.equal(
      typed.material,
      (payload.liveMaterial ?? payload.material ?? null) as string | null,
      name
    );
    assert.equal(typed.error, payload.error ?? null, name);
  }
});

test("contract dates are ISO-8601 and consistent across payloads", () => {
  for (const [name, payload] of Object.entries(loadLocalFixture())) {
    const updatedAt = payload.updatedAt;
    if (updatedAt === null || updatedAt === undefined) continue;

    assert.equal(typeof updatedAt, "string", name);
    const parsed = Date.parse(String(updatedAt));
    assert.ok(Number.isFinite(parsed), `${name}: updatedAt must parse as a date`);
    assert.equal(
      new Date(parsed).toISOString(),
      updatedAt,
      `${name}: updatedAt must be canonical ISO-8601 UTC`
    );
  }
});

test("the contract never carries connection parameters or credentials", () => {
  const forbidden = [
    "host",
    "port",
    "protocol",
    "apiKey",
    "serial",
    "accessCode",
    "snapshotUrl",
    "streamUrl",
    "deviceUi",
  ];

  for (const [name, payload] of Object.entries(loadLocalFixture())) {
    for (const key of forbidden) {
      assert.ok(
        !(key in payload),
        `${name}: forbidden field "${key}" appeared in the orchestrator contract`
      );
    }
  }
});

test("an offline printer is distinguishable from a down orchestrator", () => {
  const fixture = loadLocalFixture();
  const offline = Object.values(fixture).find(
    (payload) => payload.online === false
  );
  assert.ok(offline, "the contract must include an offline printer example");

  const printer = normalizeOrchestratorPrinter(offline);
  assert.ok(printer);
  // online=false is a per-printer fact delivered by a HEALTHY orchestrator;
  // a down orchestrator throws in the client instead and never reaches here.
  assert.equal(printer.online, false);
  assert.ok(["offline", "unknown"].includes(printer.status));
});

test("the local fixture copy matches the atelier checkout (when present)", (t) => {
  const atelierPath = atelierFixturePath();
  if (!atelierPath || !existsSync(atelierPath)) {
    t.skip("atelier checkout not found — verbatim-copy check skipped");
    return;
  }

  const local = readFileSync(LOCAL_FIXTURE, "utf8");
  const upstream = readFileSync(atelierPath, "utf8");
  assert.equal(
    local,
    upstream,
    "printer-view.contract.json diverged between the repos. Regenerate in atelier " +
      "(UPDATE_CONTRACT=1 pnpm test) and copy it here verbatim."
  );
});
