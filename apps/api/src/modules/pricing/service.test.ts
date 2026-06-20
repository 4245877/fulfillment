import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";

import { applyPricingChanges, isPlainObject, sha256 } from "./service";

// A trimmed-down stand-in for the real pricing.yml, carrying the kind of inline
// comments that must survive an edit.
const SAMPLE = `# pricing.yml header
currency: UAH

process:
  FDM:
    # доля удачных печатей
    yield: 0.92
    waste_pct: 0.10

# Материалы каталога
materials:
  HYPER_PLA:
    unit: kg
    price_per_kg: 850.0

rounding:
  strategy: nearest_9
  min_price: 50
`;

test("changing a value keeps comments and other fields intact", () => {
  const tree = parse(SAMPLE) as Record<string, any>;
  tree.process.FDM.yield = 0.95;

  const out = applyPricingChanges(SAMPLE, tree);

  assert.match(out, /yield: 0\.95/);
  assert.match(out, /# pricing\.yml header/);
  assert.match(out, /# доля удачных печатей/);
  assert.match(out, /# Материалы каталога/);
  // Untouched neighbour keeps its original formatting (incl. trailing zero).
  assert.match(out, /price_per_kg: 850\.0/);
  assert.equal(parse(out).process.FDM.yield, 0.95);
});

test("adding a new top-level scalar appends it and preserves comments", () => {
  const tree = parse(SAMPLE) as Record<string, any>;
  tree.energy = { kwh_rate: 6.0 };

  const out = applyPricingChanges(SAMPLE, tree);

  assert.match(out, /energy:/);
  assert.match(out, /kwh_rate: 6/);
  assert.match(out, /# доля удачных печатей/);
  assert.equal(parse(out).energy.kwh_rate, 6);
});

test("adding a nested object (new material) works", () => {
  const tree = parse(SAMPLE) as Record<string, any>;
  tree.materials.PETG_BASIC = { unit: "kg", price_per_kg: 400 };

  const out = applyPricingChanges(SAMPLE, tree);
  const parsed = parse(out);

  assert.equal(parsed.materials.PETG_BASIC.price_per_kg, 400);
  assert.equal(parsed.materials.PETG_BASIC.unit, "kg");
  // Existing material untouched.
  assert.equal(parsed.materials.HYPER_PLA.price_per_kg, 850);
});

test("deleting a value removes only that key", () => {
  const tree = parse(SAMPLE) as Record<string, any>;
  delete tree.process.FDM.waste_pct;

  const out = applyPricingChanges(SAMPLE, tree);
  const parsed = parse(out);

  assert.equal(parsed.process.FDM.waste_pct, undefined);
  assert.equal(parsed.process.FDM.yield, 0.92);
  assert.match(out, /# доля удачных печатей/);
});

test("handles keys that contain dots (e.g. nozzle sizes)", () => {
  const withDottedKeys = `options:
  nozzle_mm:
    "0.2":
      time_mult: 1.35
    "0.4":
      time_mult: 1.00
`;

  const tree = parse(withDottedKeys) as Record<string, any>;
  tree.options.nozzle_mm["0.4"].time_mult = 0.9;
  tree.options.nozzle_mm["0.6"] = { time_mult: 0.82 };

  const out = applyPricingChanges(withDottedKeys, tree);
  const parsed = parse(out);

  assert.equal(parsed.options.nozzle_mm["0.2"].time_mult, 1.35);
  assert.equal(parsed.options.nozzle_mm["0.4"].time_mult, 0.9);
  assert.equal(parsed.options.nozzle_mm["0.6"].time_mult, 0.82);
});

test("refuses to write an empty config", () => {
  assert.throws(() => applyPricingChanges(SAMPLE, {}), /empty/i);
});

test("rejects a non-object root payload", () => {
  assert.throws(() => applyPricingChanges(SAMPLE, "nope" as unknown), /root/i);
});

test("isPlainObject and sha256 behave as expected", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(sha256("a"), sha256("a"));
  assert.notEqual(sha256("a"), sha256("b"));
});
