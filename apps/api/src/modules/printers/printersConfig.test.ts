// Tests for readPrintersConfig's file-vs-env precedence and corruption recovery.
// The module captures PRINTERS_CONFIG_PATH from the environment at import time,
// so the scratch path and env seed are set at module load (synchronously) and
// the module under test is pulled in lazily, after that, via dynamic import.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "printers-config-"));
const configPath = path.join(tmpDir, "printers.json");
process.env.PRINTERS_CONFIG_PATH = configPath;

const ENV_SEED = [
  {
    id: "env-bambu",
    name: "Env Bambu",
    protocol: "bambu",
    host: "192.168.0.50",
    serial: "ENV123",
    accessCode: "envcode",
  },
];
process.env.PRINTERS_CONFIG_JSON = JSON.stringify(ENV_SEED);

async function loadConfig() {
  const { readPrintersConfig } = await import("./routes");
  return readPrintersConfig();
}

function ids(printers: { id: string }[]) {
  return printers.map((printer) => printer.id);
}

async function writeConfig(contents: string) {
  await fs.promises.writeFile(configPath, contents, "utf8");
}

test("a valid file is authoritative and the env seed is ignored", async () => {
  await writeConfig(
    JSON.stringify([
      { id: "file-k2", name: "File K2", protocol: "moonraker", host: "10.0.0.2" },
    ])
  );

  assert.deepEqual(ids(await loadConfig()), ["file-k2"]);
});

test("falls back to the env seed when the file is missing", async () => {
  await fs.promises.rm(configPath, { force: true });

  assert.deepEqual(ids(await loadConfig()), ["env-bambu"]);
});

test("a corrupt file does not silently shadow the env seed", async () => {
  // The failure that wiped the farm: a broken/truncated file used to win and
  // leave the system with no printers. It must recover from the env instead.
  await writeConfig("{ not valid json ");

  assert.deepEqual(ids(await loadConfig()), ["env-bambu"]);
});

test("a file that is not a JSON array falls back to the env seed", async () => {
  await writeConfig(JSON.stringify({ printers: [] }));

  assert.deepEqual(ids(await loadConfig()), ["env-bambu"]);
});

test("a non-empty file with zero valid printers falls back to the env seed", async () => {
  // Entries lacking the required id/name/host are dropped by normalization; a
  // file that is entirely such entries is treated as corruption.
  await writeConfig(JSON.stringify([{ name: "no id or host" }, { foo: "bar" }]));

  assert.deepEqual(ids(await loadConfig()), ["env-bambu"]);
});

test("an intentionally empty file stays empty (no env resurrection)", async () => {
  // An operator clearing the farm must stick — only corruption recovers.
  await writeConfig("[]");

  assert.deepEqual(await loadConfig(), []);
});
