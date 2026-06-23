// Pure-function tests for the printer manager's save/edit logic. No DOM / build:
//   node --test src/components/printers/printerForm.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildNextPrinters,
  formToPrinter,
  makeIdFromName,
} from "./printerForm.js";

// A realistic three-printer farm with distinct ids, like the committed config.
const PRINTERS = [
  {
    id: "ender3-v3-ke",
    name: "Creality Ender 3 V3 KE",
    host: "192.168.0.141",
    protocol: "moonraker",
    nozzle: "0.4",
  },
  {
    id: "creality-k2",
    name: "Creality K2",
    host: "192.168.0.132",
    protocol: "moonraker",
    nozzle: "0.4",
  },
  {
    id: "bambu-a1-combo",
    name: "Bambu Lab A1 Combo",
    host: "192.168.0.187",
    protocol: "bambu",
    nozzle: "",
    accessCode: "17073968",
  },
];

test("editing one printer's nozzle leaves every other printer untouched", () => {
  // The reported bug: changing the K2's nozzle wrote the value onto the other
  // printers because the save targeted the wrong (first) row.
  const form = { ...PRINTERS[1], nozzle: "0.6" };

  const { nextPrinters } = buildNextPrinters({
    printers: PRINTERS,
    form,
    selectedId: "creality-k2",
    isCreating: false,
  });

  assert.equal(nextPrinters.length, 3);

  const k2 = nextPrinters.find((p) => p.id === "creality-k2");
  assert.equal(k2.nozzle, "0.6");

  // The other two must be the *exact same* objects — not merely equal — proving
  // nothing about them was rewritten.
  assert.equal(nextPrinters[0], PRINTERS[0]);
  assert.equal(nextPrinters[2], PRINTERS[2]);
  assert.equal(nextPrinters[0].nozzle, "0.4");
  assert.equal(nextPrinters[2].nozzle, "");
  assert.equal(nextPrinters[2].accessCode, "17073968");
});

test("an existing edit never re-keys the printer, even if form.id is blanked", () => {
  const form = { ...PRINTERS[1], id: "", nozzle: "0.6" };

  const { nextPrinter, nextPrinters } = buildNextPrinters({
    printers: PRINTERS,
    form,
    selectedId: "creality-k2",
    isCreating: false,
  });

  assert.equal(nextPrinter.id, "creality-k2"); // pinned, not regenerated
  assert.equal(nextPrinters.filter((p) => p.id === "creality-k2").length, 1);
  assert.equal(nextPrinters.length, 3);
});

test("creating a printer appends without disturbing the existing ones", () => {
  const form = {
    id: "prusa-mk4",
    name: "Prusa MK4",
    host: "192.168.0.200",
    protocol: "moonraker",
    nozzle: "0.4",
  };

  const { nextPrinters } = buildNextPrinters({
    printers: PRINTERS,
    form,
    selectedId: "",
    isCreating: true,
  });

  assert.equal(nextPrinters.length, 4);
  assert.deepEqual(nextPrinters.slice(0, 3), PRINTERS);
  assert.equal(nextPrinters[3].id, "prusa-mk4");
});

test("a save with a stale selection appends instead of overwriting row 0", () => {
  // Guards the original failure mode: a selectedId that matches nothing must not
  // fall back to rewriting printers[0].
  const form = { id: "new-one", name: "New", host: "10.0.0.5" };

  const { nextPrinters } = buildNextPrinters({
    printers: PRINTERS,
    form,
    selectedId: "does-not-exist",
    isCreating: false,
  });

  assert.equal(nextPrinters.length, 4);
  assert.deepEqual(nextPrinters.slice(0, 3), PRINTERS);
});

test("formToPrinter trims fields, coerces the port, and defaults enabled", () => {
  const p = formToPrinter({
    id: " creality-k2 ",
    name: " Creality K2 ",
    host: " 192.168.0.132 ",
    port: "4408",
  });

  assert.equal(p.id, "creality-k2");
  assert.equal(p.name, "Creality K2");
  assert.equal(p.host, "192.168.0.132");
  assert.equal(p.port, 4408);
  assert.equal(p.enabled, true);
});

test("makeIdFromName slugifies a name and falls back for empty input", () => {
  assert.equal(makeIdFromName("Creality K2"), "creality-k2");
  assert.match(makeIdFromName(""), /^printer-\d+$/);
});
