import assert from "node:assert/strict";
import test from "node:test";

import { resolveSnapshotUrl } from "./snapshot";
import type { PrinterConfig } from "./routes";

function printer(overrides: Partial<PrinterConfig>): PrinterConfig {
  return {
    id: "p1",
    name: "Printer",
    protocol: "moonraker",
    host: "192.168.0.10",
    ...overrides,
  };
}

test("resolveSnapshotUrl uses conventional endpoints per protocol", () => {
  assert.equal(
    resolveSnapshotUrl(printer({ protocol: "moonraker" })),
    "http://192.168.0.10/webcam/?action=snapshot"
  );
  assert.equal(
    resolveSnapshotUrl(printer({ protocol: "creality" })),
    "http://192.168.0.10:8080/?action=snapshot"
  );
});

test("resolveSnapshotUrl returns null for Bambu (no plain snapshot endpoint)", () => {
  assert.equal(resolveSnapshotUrl(printer({ protocol: "bambu" })), null);
});

test("resolveSnapshotUrl honours an explicit absolute snapshotUrl", () => {
  assert.equal(
    resolveSnapshotUrl(
      printer({ snapshotUrl: "http://cam.local:8081/snap.jpg" })
    ),
    "http://cam.local:8081/snap.jpg"
  );
});

test("resolveSnapshotUrl resolves a relative snapshotUrl against the host", () => {
  assert.equal(
    resolveSnapshotUrl(
      printer({ host: "10.0.0.5:4408", snapshotUrl: "/webcam2/?action=snapshot" })
    ),
    "http://10.0.0.5/webcam2/?action=snapshot"
  );
});

test("resolveSnapshotUrl strips the API port for default endpoints", () => {
  assert.equal(
    resolveSnapshotUrl(printer({ protocol: "moonraker", host: "10.0.0.5:4408" })),
    "http://10.0.0.5/webcam/?action=snapshot"
  );
});
