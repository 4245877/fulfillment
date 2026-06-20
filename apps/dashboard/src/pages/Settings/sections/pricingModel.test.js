// Pure-function tests for the pricing editor model. No DOM / build step needed:
//   node --test src/pages/Settings/sections/pricingModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectErrors,
  deleteAt,
  initialValueForType,
  isUnsafeKey,
  parseNumberInput,
  remapFormatsForRename,
  renameKeyAt,
  resolveNumberDisplay,
  setAt,
} from "./pricingModel.js";

const key = (...segments) => JSON.stringify(segments);

// ---------------------------------------------------------------------------
// Trailing-zero display (issue #1)
// ---------------------------------------------------------------------------
test("resolveNumberDisplay shows the file's representation, falling back when edited", () => {
  assert.equal(resolveNumberDisplay(6, "6.00"), "6.00");
  assert.equal(resolveNumberDisplay(0, "0.00"), "0.00");
  assert.equal(resolveNumberDisplay(850, "850.0"), "850.0");
  // No hint → plain numeric string.
  assert.equal(resolveNumberDisplay(6, undefined), "6");
  // Hint no longer matches the (edited) value → fall back, don't lie.
  assert.equal(resolveNumberDisplay(7, "6.00"), "7");
});

// ---------------------------------------------------------------------------
// Number validation (issues #2 / #4): never silently coerce bad input to 0.
// ---------------------------------------------------------------------------
test("parseNumberInput accepts decimal notation (signs, comma, exponent, zeros)", () => {
  const cases = {
    "6.5": 6.5,
    "6,5": 6.5, // UA/RU decimal comma
    "6.00": 6,
    "850.0": 850,
    "0.00": 0,
    "+5": 5,
    "-3": -3,
    "1e3": 1000,
    "2E2": 200,
    ".5": 0.5,
    "6.": 6,
    "06": 6,
  };
  for (const [text, value] of Object.entries(cases)) {
    const parsed = parseNumberInput(text);
    assert.equal(parsed.ok, true, `expected ok for ${JSON.stringify(text)}`);
    assert.equal(parsed.value, value, `value for ${JSON.stringify(text)}`);
  }
});

test("parseNumberInput rejects empty, non-numeric, hex/binary and non-finite input", () => {
  for (const text of [
    "",
    "   ",
    "abc",
    "0x10", // Number("0x10") === 16 — must NOT be accepted
    "0b101", // Number("0b101") === 5
    "Infinity",
    "-Infinity",
    "1e309", // Number(...) === Infinity
    "NaN",
    "1_000",
    "1,2,3",
    "--5",
    "5px",
  ]) {
    assert.equal(
      parseNumberInput(text).ok,
      false,
      `expected reject for ${JSON.stringify(text)}`
    );
  }
});

// ---------------------------------------------------------------------------
// "Add field" types (array support — issue #4) + safe defaults
// ---------------------------------------------------------------------------
test("initialValueForType produces the right empty value per type", () => {
  assert.deepEqual(initialValueForType("array", ""), []);
  assert.deepEqual(initialValueForType("group", ""), {});
  assert.equal(initialValueForType("number", "6.5"), 6.5);
  assert.equal(initialValueForType("number", "abc"), 0); // UI blocks "abc"; fn defaults
  assert.equal(initialValueForType("boolean", "true"), true);
  assert.equal(initialValueForType("boolean", "false"), false);
  assert.equal(initialValueForType("string", "hi"), "hi");
});

// ---------------------------------------------------------------------------
// Validation surfacing (issue #2 client side)
// ---------------------------------------------------------------------------
test("collectErrors flags negative prices and out-of-range fractions, skips arrays", () => {
  const bad = {};
  collectErrors(
    {
      materials: { HYPER_PLA: { price_per_kg: -5 } },
      process: { FDM: { yield: 1.5 } },
    },
    [],
    bad
  );
  assert.equal(bad[key("materials", "HYPER_PLA", "price_per_kg")], "Не може бути від’ємним");
  assert.equal(bad[key("process", "FDM", "yield")], "Має бути частка від 0 до 1");

  const good = {};
  collectErrors(
    { materials: { X: { price_per_kg: 5 } }, process: { FDM: { yield: 0.9 } } },
    [],
    good
  );
  assert.equal(Object.keys(good).length, 0);

  // Arrays are edited as raw JSON, so their elements are not range-checked.
  const arr = {};
  collectErrors({ list: [1, 2, -3] }, [], arr);
  assert.equal(Object.keys(arr).length, 0);
});

// ---------------------------------------------------------------------------
// Immutable tree helpers + prototype-pollution safety (issue #10)
// ---------------------------------------------------------------------------
test("isUnsafeKey blocks exactly the dangerous keys", () => {
  for (const k of ["__proto__", "prototype", "constructor"]) {
    assert.equal(isUnsafeKey(k), true, k);
  }
  for (const k of ["price", "proto", "__prototype__", "rate"]) {
    assert.equal(isUnsafeKey(k), false, k);
  }
});

test("setAt is immutable and safe for dotted and unsafe keys", () => {
  const orig = { a: 1 };
  const copy = setAt(orig, ["a"], 2);
  assert.equal(orig.a, 1); // original untouched
  assert.equal(copy.a, 2);

  assert.deepEqual(setAt({ a: { b: 1 } }, ["a", "c"], 2), { a: { b: 1, c: 2 } });

  // Dotted key stays a single key, not a nested path.
  const dotted = setAt({}, ["0.2"], 1);
  assert.equal(dotted["0.2"], 1);

  // A literal "__proto__" becomes an own property, never pollutes the prototype.
  const safe = setAt({}, ["__proto__"], { hacked: true });
  assert.equal(({}).hacked, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, "__proto__"), true);
});

test("deleteAt removes only the targeted key, immutably", () => {
  const orig = { a: 1, b: 2 };
  assert.deepEqual(deleteAt(orig, ["b"]), { a: 1 });
  assert.deepEqual(orig, { a: 1, b: 2 });
  assert.deepEqual(deleteAt({ a: { b: 1, c: 2 } }, ["a", "c"]), { a: { b: 1 } });
});

test("renameKeyAt keeps key order and resists prototype pollution (issue #10)", () => {
  const renamed = renameKeyAt({ a: 1, b: 2 }, ["a"], "z");
  assert.deepEqual(Object.keys(renamed), ["z", "b"]); // position preserved
  assert.equal(renamed.z, 1);

  // Renaming TO an unsafe key must not pollute the prototype and must not
  // silently drop the value (the pre-fix bracket-assignment did exactly that).
  const out = renameKeyAt({ group: { x: 7 } }, ["group", "x"], "__proto__");
  assert.equal(({}).x, undefined); // global prototype clean
  assert.equal(Object.prototype.hasOwnProperty.call(out.group, "__proto__"), true);
  assert.equal(out.group.x, undefined);
});

// ---------------------------------------------------------------------------
// Format hints survive a rename without a reload (issue #3)
// ---------------------------------------------------------------------------
test("remapFormatsForRename moves a scalar's format and leaves siblings alone", () => {
  const formats = {
    [key("energy", "kwh_rate")]: "6.00",
    [key("energy", "other")]: "40.0",
    [key("misc")]: "0.00",
  };

  const out = remapFormatsForRename(formats, ["energy", "kwh_rate"], "power_rate");
  assert.equal(out[key("energy", "power_rate")], "6.00"); // moved
  assert.equal(out[key("energy", "kwh_rate")], undefined); // old key gone
  assert.equal(out[key("energy", "other")], "40.0"); // sibling untouched
  assert.equal(out[key("misc")], "0.00"); // unrelated untouched
});

test("remapFormatsForRename moves descendants when a parent key is renamed", () => {
  const formats = {
    [key("energy", "kwh_rate")]: "6.00",
    [key("energy", "other")]: "40.0",
    [key("misc")]: "0.00",
  };

  const out = remapFormatsForRename(formats, ["energy"], "power");
  assert.equal(out[key("power", "kwh_rate")], "6.00");
  assert.equal(out[key("power", "other")], "40.0");
  assert.equal(out[key("energy", "kwh_rate")], undefined);
  assert.equal(out[key("misc")], "0.00");
});
