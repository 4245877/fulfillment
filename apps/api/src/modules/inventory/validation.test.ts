import assert from "node:assert/strict";
import { test } from "node:test";

/*
 * Pure tests for the request-validation parsers. No database and no service are
 * loaded (validation.ts only pulls the source vocabulary from types.ts at
 * runtime), so these run anywhere. They pin the `source` vocabulary alignment
 * (scenario 10) and the numeric guards.
 */

import {
  InventoryValidationError,
  parseAddFilamentBody,
  parseConsumeFilamentBody,
  parseUpdateFilamentBody,
} from "./validation";

test("consume accepts the canonical sources incl. telegram", () => {
  for (const source of ["dashboard", "telegram", "printer", "system"]) {
    const parsed = parseConsumeFilamentBody({
      material: "PLA",
      color: "black",
      quantityG: 100,
      source,
    });
    assert.equal(parsed.source, source);
  }
});

test("consume rejects the stale `api` source and any unknown source", () => {
  for (const source of ["api", "webhook", "ADMIN", ""]) {
    if (source === "") {
      // Empty is treated as absent (source defaults later), not an error.
      const parsed = parseConsumeFilamentBody({
        material: "PLA",
        color: "black",
        quantityG: 100,
        source,
      });
      assert.equal(parsed.source, undefined);
      continue;
    }
    assert.throws(
      () =>
        parseConsumeFilamentBody({
          material: "PLA",
          color: "black",
          quantityG: 100,
          source,
        }),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "invalid_source",
      `source=${source} must be rejected`
    );
  }
});

test("add requires a positive, finite quantity", () => {
  for (const quantityG of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "abc", "Infinity"]) {
    assert.throws(
      () => parseAddFilamentBody({ material: "PLA", color: "black", quantityG }),
      InventoryValidationError,
      `quantityG=${String(quantityG)} must be rejected`
    );
  }

  const ok = parseAddFilamentBody({ material: "PLA", color: "black", quantityG: 250 });
  assert.equal(ok.quantityG, 250);
});

test("add requires material and color", () => {
  assert.throws(
    () => parseAddFilamentBody({ color: "black", quantityG: 1 }),
    (err: unknown) =>
      err instanceof InventoryValidationError && err.code === "missing_material"
  );
  assert.throws(
    () => parseAddFilamentBody({ material: "PLA", quantityG: 1 }),
    (err: unknown) =>
      err instanceof InventoryValidationError && err.code === "missing_color"
  );
});

test("a note beyond the length cap is rejected", () => {
  assert.throws(
    () =>
      parseAddFilamentBody({
        material: "PLA",
        color: "black",
        quantityG: 1,
        note: "x".repeat(2001),
      }),
    (err: unknown) =>
      err instanceof InventoryValidationError && err.code === "too_long_note"
  );
});

test("consume requires at least one quantity field", () => {
  assert.throws(
    () => parseConsumeFilamentBody({ material: "PLA", color: "black" }),
    (err: unknown) =>
      err instanceof InventoryValidationError && err.code === "missing_quantity"
  );
});

test("consume rejects an out-of-range AMS tray", () => {
  for (const amsTray of [-1, 1.5, 999]) {
    assert.throws(
      () =>
        parseConsumeFilamentBody({
          printerId: "bambu",
          grams: 10,
          amsTray,
        }),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "invalid_amsTray"
    );
  }
});

test("update requires an identifier (id, or material+color)", () => {
  assert.throws(
    () => parseUpdateFilamentBody({ lowStockG: 100 }),
    (err: unknown) =>
      err instanceof InventoryValidationError &&
      err.code === "missing_identifier"
  );

  const byId = parseUpdateFilamentBody({ id: "filament_stock_x", enabled: false });
  assert.equal(byId.id, "filament_stock_x");
  assert.equal(byId.enabled, false);
});

test("a non-object body is rejected", () => {
  for (const body of [null, undefined, 42, "x", []]) {
    assert.throws(
      () => parseAddFilamentBody(body),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "invalid_body"
    );
  }
});
