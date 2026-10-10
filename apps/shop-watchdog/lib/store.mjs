// Shop watchdog — durable state.
//
// One small JSON file on a named volume. It is what makes a restart (deploy,
// crash, host reboot) invisible to the owner: an incident that was already
// reported stays "reported", its recovery is still announced, and queued
// notifications are still delivered.
//
// Writes are atomic (temp file + fsync + rename): a power cut leaves either
// the previous state or the new one, never half a file. A file that cannot be
// parsed is kept aside for inspection and the watchdog starts from a clean
// state — losing dedupe memory is better than not watching at all.

import fs from "node:fs";
import path from "node:path";

import { initialState, STATE_VERSION } from "./machine.mjs";

/** Fill in fields a state written by an older build may lack. */
function normalize(raw) {
  const fresh = initialState();
  if (!raw || typeof raw !== "object" || raw.version !== STATE_VERSION) return null;
  return {
    version: STATE_VERSION,
    shop: { ...fresh.shop, ...(raw.shop ?? {}) },
    monitoring: { ...fresh.monitoring, ...(raw.monitoring ?? {}) },
    outbox: Array.isArray(raw.outbox) ? raw.outbox.filter((entry) => entry && typeof entry.key === "string" && typeof entry.text === "string") : [],
    sent: Array.isArray(raw.sent) ? raw.sent.filter((key) => typeof key === "string") : [],
    counters: { ...fresh.counters, ...(raw.counters ?? {}) },
  };
}

/**
 * Load the state.
 *
 * Returns `{ state, restored, problem }`: `restored` is true when a previous
 * state was read, `problem` names why it was not (absent file is not a problem).
 */
export function loadState(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { state: initialState(), restored: false, problem: null };
    return { state: initialState(), restored: false, problem: `state file is not readable: ${error.code ?? error.message}` };
  }
  let parsed = null;
  try {
    parsed = normalize(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (parsed) return { state: parsed, restored: true, problem: null };

  const aside = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, aside);
  } catch {
    /* keep going: the next save overwrites it */
  }
  return { state: initialState(), restored: false, problem: `state file was unreadable and was moved to ${path.basename(aside)}` };
}

/** Persist the state atomically. Throws when the volume is not writable. */
export function saveState(file, state) {
  const dir = path.dirname(file);
  // One level only, on purpose: the directory is the mounted state volume. A
  // recursive mkdir can spin forever on special filesystems, and the probe
  // loop must never block on persistence.
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(state));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
