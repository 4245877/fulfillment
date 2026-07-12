import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, parseDocument } from "yaml";

import {
  applyPricingChanges,
  buildWriteScript,
  collectNumberFormats,
  detectAnchors,
  isPlainObject,
  sha256,
  type NumberFormats,
} from "./service";

// Status code carried by a thrown CodedError, or undefined if the call did not
// throw. Lets us assert the precise 4xx the route layer will surface (issue #2).
function statusOf(fn: () => void): number | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
}

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

// ---------------------------------------------------------------------------
// HTTP status mapping (issue #2): validation errors must be 4xx, not 502.
// ---------------------------------------------------------------------------
test("validation errors carry the right HTTP status code (issue #2)", () => {
  // Empty config → 422 (semantically invalid entity).
  assert.equal(statusOf(() => applyPricingChanges(SAMPLE, {})), 422);
  // Non-object root → 400 (bad request shape).
  assert.equal(statusOf(() => applyPricingChanges(SAMPLE, "nope" as unknown)), 400);
  // Anchors/aliases → 422 (valid request, file can't be written safely).
  const withAnchor = `defaults: &b\n  y: 1\nprocess:\n  FDM: *b\n`;
  const anchorTree = parse(withAnchor) as Record<string, any>;
  anchorTree.process.FDM.y = 2;
  assert.equal(statusOf(() => applyPricingChanges(withAnchor, anchorTree)), 422);
});

// ---------------------------------------------------------------------------
// Prototype pollution on write (issue #10): unsafe keys rejected at any depth.
// JSON.parse is used so the "__proto__" / "constructor" keys are real own
// enumerable properties, exactly as they would arrive in a request body.
// ---------------------------------------------------------------------------
test("refuses to write unsafe keys at any depth (issue #10)", () => {
  for (const payload of [
    '{"__proto__":{"x":1}}',
    '{"materials":{"__proto__":{"x":1}}}',
    '{"a":{"b":{"constructor":1}}}',
    '{"prototype":1}',
  ]) {
    const tree = JSON.parse(payload);
    assert.equal(
      statusOf(() => applyPricingChanges(SAMPLE, tree)),
      400,
      `expected 400 for ${payload}`
    );
  }

  // The global prototype must stay clean after all of that.
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

// ---------------------------------------------------------------------------
// Anchor detection runs on the AST, so strings/comments never false-positive
// and a read-only file is flagged up front (issues #6 / #9).
// ---------------------------------------------------------------------------
test("detectAnchors ignores `<<` in strings and `&anchor` in comments (issue #6)", () => {
  const benign = `# приклад з &anchor усередині коментаря
note: "значення з << усередині рядка"
math: "a << b"
price: 10
`;
  assert.equal(detectAnchors(parseDocument(benign)), null);

  assert.match(detectAnchors(parseDocument("a: &x 1\nb: *x\n")) || "", /якор|псевдонім/);
  assert.match(
    detectAnchors(parseDocument("base: &b\n  x: 1\nm:\n  <<: *b\n")) || "",
    /якор|псевдонім|злит/
  );
});

// ---------------------------------------------------------------------------
// Format map keys are JSON-encoded segment arrays, so paths cannot collide and
// odd key characters round-trip (issue #3).
// ---------------------------------------------------------------------------
test("number-format keys never collide between nested and dotted keys (issue #3)", () => {
  const nested: NumberFormats = {};
  collectNumberFormats(parseDocument(`a:\n  b:\n    c: 1.0\n`).contents, [], nested);

  const dotted: NumberFormats = {};
  collectNumberFormats(parseDocument(`"a.b":\n  c: 1.0\n`).contents, [], dotted);

  const nestedKey = Object.keys(nested)[0];
  const dottedKey = Object.keys(dotted)[0];

  assert.equal(nestedKey, JSON.stringify(["a", "b", "c"]));
  assert.equal(dottedKey, JSON.stringify(["a.b", "c"]));
  assert.notEqual(nestedKey, dottedKey);
});

test("number-format keys survive slashes, tildes, brackets and quotes (issue #3)", () => {
  const src = `"a/b":\n  "c~d": 1.0\n"x[0]":\n  "q\\"t": 2.0\n`;
  const formats: NumberFormats = {};
  collectNumberFormats(parseDocument(src).contents, [], formats);

  assert.equal(formats[JSON.stringify(["a/b", "c~d"])], "1.0");
  assert.equal(formats[JSON.stringify(["x[0]", 'q"t'])], "2.0");
});

// ---------------------------------------------------------------------------
// Atomic write script (issues #1 / #7 / #8). We execute the *real* script the
// server ships to the remote host, but against a local temp dir and with PATH
// shims to force cp/chmod/mv failures — no SSH, no production host touched.
// Requires GNU coreutils (chmod --reference, ls -t, xargs -r): on busybox
// (the alpine test containers) these tests are skipped rather than failed —
// the script's real target is the GNU remote host, which CI-on-GNU covers.
// ---------------------------------------------------------------------------
const hasGnuCoreutils = (() => {
  const probe = spawnSync("sh", ["-c", "chmod --help 2>&1"], { encoding: "utf8" });
  return `${probe.stdout ?? ""}${probe.stderr ?? ""}`.includes("--reference");
})();
const gnuOnly = { skip: hasGnuCoreutils ? false : "requires GNU coreutils (busybox detected)" } as const;

type RunResult = {
  exitCode: number | null;
  stderr: string;
  fileContent: string | null;
  bakContent: string | null;
  historical: string[];
  tempLeft: string[];
  mode: number | null;
};

function runWriteScript(opts: {
  original: string;
  input: string;
  bytes?: number;
  fileMode?: number;
  fileName?: string;
  preexisting?: Array<{ name: string; mtimeMs: number }>;
  shim?: { cmd: string; body: string };
}): RunResult {
  const dir = mkdtempSync(path.join(tmpdir(), "pricing-write-"));
  const fileName = opts.fileName ?? "pricing.yml";
  const file = path.join(dir, fileName);

  writeFileSync(file, opts.original);
  if (opts.fileMode != null) chmodSync(file, opts.fileMode);

  for (const pre of opts.preexisting ?? []) {
    const p = path.join(dir, pre.name);
    writeFileSync(p, "old-backup");
    utimesSync(p, new Date(pre.mtimeMs), new Date(pre.mtimeMs));
  }

  const env = { ...process.env };
  if (opts.shim) {
    const binDir = mkdtempSync(path.join(tmpdir(), "pricing-bin-"));
    const shimPath = path.join(binDir, opts.shim.cmd);
    writeFileSync(shimPath, `#!/bin/sh\n${opts.shim.body}\n`);
    chmodSync(shimPath, 0o755);
    env.PATH = `${binDir}:${env.PATH}`;
  }

  const bytes = opts.bytes ?? Buffer.byteLength(opts.input, "utf8");
  const script = buildWriteScript({ file, bytes });
  const res = spawnSync("sh", ["-c", script], {
    input: opts.input,
    env,
    encoding: "utf8",
  });

  const list = readdirSync(dir);
  return {
    exitCode: res.status,
    stderr: res.stderr || "",
    fileContent: existsSync(file) ? readFileSync(file, "utf8") : null,
    bakContent: existsSync(`${file}.bak`) ? readFileSync(`${file}.bak`, "utf8") : null,
    historical: list.filter((n) => n.startsWith(`${fileName}.bak.`)),
    tempLeft: list.filter((n) => n.startsWith(`${fileName}.tmp.`)),
    mode: existsSync(file) ? statSync(file).mode & 0o777 : null,
  };
}

test("write script: success replaces the file, keeps .bak + history, preserves mode", gnuOnly, () => {
  const r = runWriteScript({ original: "old: 1\n", input: "new: 2\n", fileMode: 0o640 });

  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.fileContent, "new: 2\n");
  assert.equal(r.bakContent, "old: 1\n");
  assert.equal(r.historical.length, 1);
  assert.equal(r.tempLeft.length, 0);
  assert.equal(r.mode, 0o640);
});

test("write script: a truncated stream (byte mismatch) aborts without touching the file", gnuOnly, () => {
  const r = runWriteScript({ original: "old: 1\n", input: "new: 2\n", bytes: 999 });

  assert.notEqual(r.exitCode, 0);
  assert.equal(r.fileContent, "old: 1\n"); // unchanged
  assert.equal(r.bakContent, null); // never reached the backup step
  assert.equal(r.tempLeft.length, 0); // temp cleaned by the EXIT trap
});

test("write script: a failing mandatory cp (.bak) aborts the write (issue #8)", gnuOnly, () => {
  const r = runWriteScript({
    original: "old: 1\n",
    input: "new: 2\n",
    shim: { cmd: "cp", body: "exit 1" },
  });

  assert.notEqual(r.exitCode, 0);
  assert.equal(r.fileContent, "old: 1\n"); // original intact, no false success
  assert.equal(r.tempLeft.length, 0);
});

test("write script: a failing chmod aborts the write (issue #1 — no `|| true`)", gnuOnly, () => {
  const r = runWriteScript({
    original: "old: 1\n",
    input: "new: 2\n",
    shim: { cmd: "chmod", body: "exit 1" },
  });

  assert.notEqual(r.exitCode, 0);
  assert.equal(r.fileContent, "old: 1\n");
  assert.equal(r.bakContent, null); // chmod runs before the backup
  assert.equal(r.tempLeft.length, 0);
});

test("write script: a failing mv aborts and never reports success", gnuOnly, () => {
  const r = runWriteScript({
    original: "old: 1\n",
    input: "new: 2\n",
    shim: { cmd: "mv", body: "exit 1" },
  });

  assert.notEqual(r.exitCode, 0);
  assert.equal(r.fileContent, "old: 1\n"); // mv failed → original kept
  assert.equal(r.tempLeft.length, 0); // trap removed the temp
});

test("write script: prunes timestamped history to the 10 newest (issue #7)", gnuOnly, () => {
  const now = Date.now();
  const preexisting = Array.from({ length: 12 }, (_, i) => ({
    name: `pricing.yml.bak.h${String(i).padStart(2, "0")}`,
    mtimeMs: now - (12 - i) * 60_000, // h00 oldest … h11 newest
  }));

  const r = runWriteScript({ original: "old: 1\n", input: "new: 2\n", preexisting });

  assert.equal(r.exitCode, 0, r.stderr);
  // 12 existing + 1 new = 13, pruned down to the 10 newest.
  assert.equal(r.historical.length, 10);
  assert.ok(!r.historical.includes("pricing.yml.bak.h00"));
  assert.ok(!r.historical.includes("pricing.yml.bak.h01"));
  assert.ok(!r.historical.includes("pricing.yml.bak.h02"));
  assert.ok(r.historical.includes("pricing.yml.bak.h11"));
});

test("write script: two saves in the same second get unique history names (issue #8)", gnuOnly, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pricing-write-"));
  const file = path.join(dir, "pricing.yml");
  writeFileSync(file, "v: 0\n");

  // Freeze `date` so both runs share the same second — uniqueness must come
  // from the `$$` suffix, not the timestamp.
  const binDir = mkdtempSync(path.join(tmpdir(), "pricing-bin-"));
  writeFileSync(path.join(binDir, "date"), "#!/bin/sh\necho 20260101-000000\n");
  chmodSync(path.join(binDir, "date"), 0o755);
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

  for (const input of ["v: 1\n", "v: 2\n"]) {
    const script = buildWriteScript({ file, bytes: Buffer.byteLength(input, "utf8") });
    const res = spawnSync("sh", ["-c", script], { input, env, encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
  }

  const historical = readdirSync(dir).filter((n) =>
    n.startsWith("pricing.yml.bak.20260101-000000-")
  );
  assert.equal(new Set(historical).size, 2);
});

test("write script: handles a path with spaces and special characters", gnuOnly, () => {
  const r = runWriteScript({
    original: "old: 1\n",
    input: "new: 2\n",
    fileName: "weird name (v2) #1.yml",
  });

  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.fileContent, "new: 2\n");
  assert.equal(r.bakContent, "old: 1\n");
});
