import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, parseDocument } from "yaml";

import {
  applyPricingChanges,
  collectNumberFormats,
  isPlainObject,
  sha256,
  type NumberFormats,
} from "./service";

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

// A sample with hand-aligned inline comments — the alignment must survive an
// edit to an unrelated field (the core of issue #1).
const ALIGNED = `currency: UAH            # валюта
process:
  FDM:
    yield: 0.92            # доля удачных печатей
    waste_pct: 0.10        # двойной учёт?
energy:
  kwh_rate: 5.0            # грн/кВт·ч
`;

test("editing one field leaves all other lines byte-for-byte (alignment preserved)", () => {
  const tree = parse(ALIGNED) as Record<string, any>;
  tree.energy.kwh_rate = 6.0;

  const out = applyPricingChanges(ALIGNED, tree);

  const before = ALIGNED.split("\n");
  const after = out.split("\n");

  // Every line except the edited kwh_rate one is identical down to the byte.
  for (let i = 0; i < before.length; i++) {
    if (before[i].includes("kwh_rate")) continue;
    assert.equal(after[i], before[i], `line ${i} changed: ${JSON.stringify(after[i])}`);
  }
  // The aligned comment on the untouched yield line is intact.
  assert.match(out, /yield: 0\.92 {12}# доля удачных печатей/);
  assert.equal(parse(out).energy.kwh_rate, 6);
});

test("rename keeps the key's value subtree and comments in place", () => {
  const src = `materials:
  HYPER_PLA:           # ⚠ waste_pct учитывается дважды
    unit: kg
    waste_pct: 0.0     # RESIN из Chitubox уже учтён
    price_per_kg: 850.0
`;
  const tree = parse(src) as Record<string, any>;
  const value = tree.materials.HYPER_PLA;
  delete tree.materials.HYPER_PLA;
  tree.materials.HYPER_PLA_V2 = value; // in-place rename preserves order

  const out = applyPricingChanges(src, tree);

  assert.match(out, /HYPER_PLA_V2:/);
  assert.doesNotMatch(out, /HYPER_PLA:/);
  // Domain warnings attached to the renamed block survive.
  assert.match(out, /⚠ waste_pct учитывается дважды/);
  assert.match(out, /RESIN из Chitubox уже учтён/);
  // Untouched neighbour formatting (trailing zero) is preserved.
  assert.match(out, /price_per_kg: 850\.0/);
});

test("deleting a key does not eat the next sibling's leading comment", () => {
  const src = `materials:
  HYPER_PLA:
    price_per_kg: 850.0
  # ⚠ RESIN waste_pct=0 (Chitubox уже учёл)
  RESIN:
    price_per_l: 1200.0
`;
  const tree = parse(src) as Record<string, any>;
  delete tree.materials.HYPER_PLA;

  const out = applyPricingChanges(src, tree);

  assert.doesNotMatch(out, /HYPER_PLA/);
  // The comment belonging to the surviving RESIN block stays.
  assert.match(out, /⚠ RESIN waste_pct=0/);
  assert.equal(parse(out).materials.RESIN.price_per_l, 1200);
});

test("adding a field leaves every other line byte-for-byte", () => {
  const tree = parse(ALIGNED) as Record<string, any>;
  tree.process.FDM.consumables = 1.5;

  const out = applyPricingChanges(ALIGNED, tree);

  const before = ALIGNED.split("\n");
  const after = out.split("\n");
  for (const line of before) {
    assert.ok(after.includes(line), `original line lost: ${JSON.stringify(line)}`);
  }
  assert.match(out, /yield: 0\.92 {12}# доля удачных печатей/);
  assert.equal(parse(out).process.FDM.consumables, 1.5);
});

test("falls back safely when a value changes shape (object <-> scalar)", () => {
  const tree = parse(ALIGNED) as Record<string, any>;
  tree.energy = 5; // was an object { kwh_rate } -> now a scalar

  const out = applyPricingChanges(ALIGNED, tree);
  const parsed = parse(out);

  // Data is correct even though this edit takes the document-rewrite fallback.
  assert.equal(parsed.energy, 5);
  assert.equal(parsed.process.FDM.yield, 0.92);
});

test("string keys that look like numbers stay quoted on rename", () => {
  const src = `options:
  nozzle_mm:
    "0.2":
      time_mult: 1.35
`;
  const tree = parse(src) as Record<string, any>;
  const value = tree.options.nozzle_mm["0.2"];
  delete tree.options.nozzle_mm["0.2"];
  tree.options.nozzle_mm["0.3"] = value;

  const out = applyPricingChanges(src, tree);
  assert.match(out, /"0\.3":/);
  assert.equal(parse(out).options.nozzle_mm["0.3"].time_mult, 1.35);
});

test("collectNumberFormats keeps the file's representation of trailing zeros (issue #1)", () => {
  const src = `energy:
  kwh_rate: 6.00
process:
  FDM:
    yield: 0.92
    waste_pct: 40.0
rounding:
  min_price: 850
  discount: 0.00
`;
  const formats: NumberFormats = {};
  collectNumberFormats(parseDocument(src).contents, [], formats);

  // Sources whose canonical String() form differs are captured...
  assert.equal(formats[JSON.stringify(["energy", "kwh_rate"])], "6.00");
  assert.equal(formats[JSON.stringify(["process", "FDM", "waste_pct"])], "40.0");
  assert.equal(formats[JSON.stringify(["rounding", "discount"])], "0.00");
  // ...while numbers that already match their canonical form are not.
  assert.equal(formats[JSON.stringify(["process", "FDM", "yield"])], undefined);
  assert.equal(formats[JSON.stringify(["rounding", "min_price"])], undefined);
});

test("refuses to write a file using YAML anchors/aliases (issue #9)", () => {
  const withAnchor = `defaults: &base
  yield: 0.9
process:
  FDM: *base
`;
  const tree = parse(withAnchor) as Record<string, any>;
  tree.process.FDM.yield = 0.95;

  assert.throws(() => applyPricingChanges(withAnchor, tree), /anchor|alias|якор|псевдонім/i);
});

test("refuses to write a file using YAML merge keys (issue #9)", () => {
  const withMerge = `defaults: &base
  yield: 0.9
process:
  FDM:
    <<: *base
    waste_pct: 0.1
`;
  const tree = parse(withMerge) as Record<string, any>;
  tree.process.FDM.waste_pct = 0.2;

  assert.throws(() => applyPricingChanges(withMerge, tree), /anchor|alias|merge|злит|якор|псевдонім/i);
});

test("isPlainObject and sha256 behave as expected", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(sha256("a"), sha256("a"));
  assert.notEqual(sha256("a"), sha256("b"));
});
