import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { get, type IncomingMessage } from "node:http";
import path from "node:path";
import test from "node:test";

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`server drains its workers and exits cleanly on ${signal}`, { timeout: 60000 }, async (t) => {
    // Use the actual server lifecycle on an ephemeral port; workers and
    // migrations are disabled so this process cannot touch printers or outbox.
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", NODE_ENV: "test",
        DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
        MIGRATE_ON_START: "false", TELEGRAM_ENABLED: "false", PRINTER_MONITOR_ENABLED: "false",
        PRINTER_ORCHESTRATOR_URL: "", PRINTER_SNAPSHOT_ORCHESTRATOR_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
    let output = "";
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (data) => {
        output += String(data);
        if (output.includes("Server listening")) resolve();
      });
      child.stderr.on("data", (data) => { output += String(data); });
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Server exited before listening")));
    });
    child.kill(signal);
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.match(output, /Stopping fulfillment API/);
    assert.doesNotMatch(output, /shutdown failed/);
  });
}


test("server ends open event streams before draining workers on SIGTERM", { timeout: 60000 }, async (t) => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", NODE_ENV: "test",
      DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
      MIGRATE_ON_START: "false", TELEGRAM_ENABLED: "false", PRINTER_MONITOR_ENABLED: "false",
      PRINTER_ORCHESTRATOR_URL: "", PRINTER_SNAPSHOT_ORCHESTRATOR_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "";
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const baseUrl = await new Promise<string>((resolve, reject) => {
    child.stdout.on("data", (data) => {
      output += String(data);
      const match = output.match(/Server listening at (http:[^"\s]+)/);
      if (match) resolve(match[1]);
    });
    child.stderr.on("data", (data) => { output += String(data); });
    child.once("error", reject);
    child.once("exit", () => reject(new Error("Server exited before listening")));
  });
  const stream = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(`${baseUrl}/api/events/stream`, (response) => {
      response.once("data", () => resolve(response));
      response.once("error", reject);
    });
    request.once("error", reject);
    t.after(() => { request.destroy(); });
  });
  assert.equal(stream.statusCode, 200);
  assert.equal(stream.headers["content-type"], "text/event-stream; charset=utf-8");
  const streamEnded = new Promise<void>((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  child.kill("SIGTERM");
  const [exit] = await Promise.all([exited, streamEnded]);
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.match(output, /Stopping fulfillment API/);
  assert.doesNotMatch(output, /shutdown failed/);
});
