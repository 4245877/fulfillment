// Pure-function tests for the movements table rendering rules. No DOM / build:
//   node --test src/pages/inventoryMovements.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPrinterNameMap,
  resolvePrinterLabel,
  resolvePositionLabel,
  shortId,
} from "./inventoryMovements.js";
import { MOVEMENT_SOURCES, getMovementSourceLabel } from "./inventoryVocab.js";

const printers = buildPrinterNameMap({
  printers: [
    { id: "bambu-a1-combo", name: "Bambu Lab A1 Combo" },
    { id: "creality-k2", name: "Creality K2" },
  ],
});

// ── 1. Automatic write-off shows the printer name ────────────────────────────

test("an automatic consume resolves the printer id to its name", () => {
  const label = resolvePrinterLabel("bambu-a1-combo", printers);
  assert.equal(label.text, "Bambu Lab A1 Combo");
  assert.equal(label.unknown, false);
  assert.equal(label.title, "bambu-a1-combo");
});

// ── 2. Manual write-off shows "—" ────────────────────────────────────────────

test("a manual movement (no printerId) shows an em dash", () => {
  const label = resolvePrinterLabel(null, printers);
  assert.equal(label.text, "—");
  assert.equal(label.manual, true);
  assert.equal(label.unknown, false);
});

// ── 3. Unknown printer and position do not break rendering ───────────────────

test("an unknown/deleted printer id renders safely as the raw id", () => {
  const label = resolvePrinterLabel("ghost-printer", printers);
  assert.equal(label.text, "ghost-printer");
  assert.equal(label.unknown, true);
  assert.ok(label.title, "carries an explanatory tooltip");
});

test("a movement whose position is missing renders '—', not a crash", () => {
  const label = resolvePositionLabel({ stockId: "filament_stock_x" });
  assert.equal(label.text, "—");
  assert.equal(label.unknown, true);
});

test("the printer map tolerates a missing/degraded status payload", () => {
  for (const payload of [null, undefined, {}, { printers: null }, "boom", 42]) {
    const map = buildPrinterNameMap(payload);
    assert.ok(map instanceof Map);
    assert.equal(map.size, 0);
    // And resolving against an empty map still yields a usable label.
    assert.equal(resolvePrinterLabel("bambu-a1-combo", map).text, "bambu-a1-combo");
  }
});

// ── Position labelling: resolvable + archived ────────────────────────────────

test("a resolvable position shows material + colour", () => {
  const label = resolvePositionLabel({
    stockMaterial: "PLA",
    stockColor: "black",
    stockColorName: "Чорний",
    stockEnabled: true,
  });
  assert.equal(label.text, "PLA Чорний");
  assert.equal(label.unknown, false);
  assert.equal(label.archived, false);
});

test("an archived position is flagged but still readable", () => {
  const label = resolvePositionLabel({
    stockMaterial: "PLA",
    stockColorName: "Чорний",
    stockEnabled: false,
  });
  assert.equal(label.archived, true);
  assert.match(label.text, /PLA Чорний/);
});

test("position colour name falls back to the colour vocabulary", () => {
  const label = resolvePositionLabel({ stockMaterial: "PETG", stockColor: "white" });
  assert.equal(label.text, "PETG Білий");
});

// ── Source vocabulary alignment ──────────────────────────────────────────────

test("the source vocabulary includes telegram and excludes the stale `api`", () => {
  const values = MOVEMENT_SOURCES.map(([value]) => value);
  assert.ok(values.includes("telegram"), "telegram is a real source");
  assert.ok(!values.includes("api"), "api is not a real source");
  assert.equal(getMovementSourceLabel("telegram"), "Telegram");
  // An unexpected value degrades gracefully rather than throwing.
  assert.equal(getMovementSourceLabel("api"), "Невідомо");
});

test("shortId keeps ids compact for the table", () => {
  assert.equal(shortId("filament_movement_1234567890abcdef"), "…90abcdef");
  assert.equal(shortId("job7"), "job7");
  assert.equal(shortId(null), "");
});
