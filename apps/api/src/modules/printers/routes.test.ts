import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBambuStatusFromPayload,
  getBambuMqttErrorMessage,
  mergeBambuRawPrint,
  mergeBambuStatus,
  type PrinterConfig,
  type PrinterStatus,
} from "./routes";

function bambuPrinter(overrides: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id: "bambu-1",
    name: "Bambu X1C",
    protocol: "bambu",
    host: "192.168.0.10",
    serial: "01PXXXXXXXXXXX",
    accessCode: "12345678",
    ...overrides,
  };
}

function status(overrides: Partial<PrinterStatus> = {}): PrinterStatus {
  return {
    id: "bambu-1",
    name: "Bambu X1C",
    protocol: "bambu",
    online: true,
    status: "printing",
    currentFile: null,
    progressPct: null,
    printed: null,
    remainingMinutes: null,
    nozzleTemp: null,
    bedTemp: null,
    updatedAt: "2026-06-20T10:00:00.000Z",
    ...overrides,
  };
}

test("buildBambuStatusFromPayload maps a full Bambu report", () => {
  const result = buildBambuStatusFromPayload(bambuPrinter(), {
    print: {
      gcode_state: "RUNNING",
      mc_percent: 42,
      layer_num: 14,
      total_layer_num: 910,
      mc_remaining_time: 87,
      nozzle_temper: 215.4,
      bed_temper: 60.7,
      subtask_name: "vase.gcode",
    },
  });

  assert.ok(result);
  assert.equal(result.online, true);
  assert.equal(result.status, "printing");
  assert.equal(result.currentFile, "vase.gcode");
  assert.equal(result.progressPct, 42);
  assert.equal(result.printed, "14/910 шар");
  assert.equal(result.remainingMinutes, 87);
  assert.equal(result.nozzleTemp, 215); // rounded
  assert.equal(result.bedTemp, 61); // rounded
  assert.equal(result.stateText, "RUNNING");
  assert.equal(result.error, undefined);
});

test("buildBambuStatusFromPayload reads flat and nested payload shapes", () => {
  const flat = buildBambuStatusFromPayload(bambuPrinter(), {
    gcode_state: "PAUSE",
    mc_percent: 12,
  });
  assert.equal(flat?.status, "paused");
  assert.equal(flat?.progressPct, 12);

  const nested = buildBambuStatusFromPayload(bambuPrinter(), {
    payload: { print: { gcode_state: "FINISH", mc_percent: 100 } },
  });
  assert.equal(nested?.status, "idle");
  assert.equal(nested?.progressPct, 100);
});

test("buildBambuStatusFromPayload surfaces a print error", () => {
  const result = buildBambuStatusFromPayload(bambuPrinter(), {
    print: { gcode_state: "RUNNING", mc_percent: 30, print_error: 5 },
  });
  assert.equal(result?.status, "error");
  assert.match(result?.error ?? "", /код 5/);

  // A zero error code is the "no fault" sentinel and must not flip to error.
  const healthy = buildBambuStatusFromPayload(bambuPrinter(), {
    print: { gcode_state: "RUNNING", mc_percent: 30, print_error: 0 },
  });
  assert.equal(healthy?.status, "printing");
  assert.equal(healthy?.error, undefined);
});

test("buildBambuStatusFromPayload returns null when nothing usable is present", () => {
  assert.equal(buildBambuStatusFromPayload(bambuPrinter(), { print: {} }), null);
  assert.equal(buildBambuStatusFromPayload(bambuPrinter(), null), null);
  assert.equal(buildBambuStatusFromPayload(bambuPrinter(), { foo: "bar" }), null);
});

test("mergeBambuStatus returns next when there is no previous snapshot", () => {
  const next = status({ progressPct: 10 });
  assert.equal(mergeBambuStatus(undefined, next), next);
});

test("mergeBambuStatus does not merge across an offline transition", () => {
  const previous = status({ online: true, printed: "14/910 шар" });
  const next = status({ online: false, status: "offline", printed: null });
  // The offline snapshot is returned verbatim — no stale layer string carried over.
  assert.equal(mergeBambuStatus(previous, next), next);
});

test("mergeBambuStatus carries forward fields a partial report omits", () => {
  const previous = status({
    status: "printing",
    currentFile: "vase.gcode",
    progressPct: 10,
    printed: "14/910 шар",
    nozzleTemp: 200,
    bedTemp: 60,
  });

  // A later report only refreshed progress; everything else is null and its
  // state could not be classified.
  const next = status({
    status: "unknown",
    currentFile: null,
    progressPct: 42,
    printed: null,
    nozzleTemp: null,
    bedTemp: null,
  });

  const merged = mergeBambuStatus(previous, next);
  assert.equal(merged.status, "printing"); // unknown falls back to previous
  assert.equal(merged.progressPct, 42); // refreshed
  assert.equal(merged.currentFile, "vase.gcode"); // carried forward
  assert.equal(merged.printed, "14/910 шар"); // carried forward
  assert.equal(merged.nozzleTemp, 200);
  assert.equal(merged.bedTemp, 60);
});

// Replays the MQTT message handler's pipeline: each incoming report is folded
// into the accumulated raw print state, then the status is rebuilt from that
// complete snapshot.
function applyReport(printerId: string, print: Record<string, unknown>) {
  const merged = mergeBambuRawPrint(printerId, print);
  return buildBambuStatusFromPayload(bambuPrinter({ id: printerId }), {
    print: merged,
  });
}

test("Bambu partial reports keep the layer counter while progress advances", () => {
  const id = "bambu-partial";

  const full = applyReport(id, {
    subtask_id: "job-A",
    subtask_name: "vase.gcode",
    gcode_state: "RUNNING",
    mc_percent: 10,
    layer_num: 14,
    total_layer_num: 910,
    nozzle_temper: 200,
  });
  assert.equal(full?.printed, "14/910 шар");
  assert.equal(full?.progressPct, 10);

  // Bambu's frequent partial reports carry only mc_percent. Without merging the
  // raw payload the layer counter would otherwise freeze or vanish while
  // progress keeps climbing (the "14/910 шар at 42%" bug).
  const partial = applyReport(id, { subtask_id: "job-A", mc_percent: 42 });
  assert.equal(partial?.printed, "14/910 шар");
  assert.equal(partial?.progressPct, 42);
  assert.equal(partial?.currentFile, "vase.gcode");
  assert.equal(partial?.nozzleTemp, 200);
});

test("a new Bambu job resets the carried-over layer counter", () => {
  const id = "bambu-jobchange";

  applyReport(id, {
    subtask_id: "job-A",
    subtask_name: "vase.gcode",
    gcode_state: "RUNNING",
    mc_percent: 80,
    layer_num: 900,
    total_layer_num: 910,
  });

  // A different subtask starts and its first report is partial (no layer info).
  // The previous job's 900/910 must not leak into it.
  const newJob = applyReport(id, { subtask_id: "job-B", mc_percent: 3 });
  assert.equal(newJob?.printed, null);
  assert.equal(newJob?.progressPct, 3);
});

test("getBambuMqttErrorMessage explains common local-MQTT failures", () => {
  assert.match(
    getBambuMqttErrorMessage("Connection refused: Not authorized"),
    /access code/i
  );
  assert.match(
    getBambuMqttErrorMessage(
      new Error("Connection refused: Server unavailable")
    ),
    /LAN mode/i
  );
  // Unknown errors pass through unchanged.
  assert.equal(getBambuMqttErrorMessage("boom"), "boom");
});
