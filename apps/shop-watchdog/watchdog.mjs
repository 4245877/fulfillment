#!/usr/bin/env node
// Shop watchdog — entry point.
//
// An independent observer of the Lite Forest shop that runs on THIS host, so a
// dead shop server cannot silence it:
//
//   • probes the shop's public entry every 30 s and names what is broken;
//   • is the dead-man switch for the shop's own monitoring: its Alertmanager
//     must POST /heartbeat every few minutes;
//   • notifies the owner through Telegram directly from here;
//   • exposes /metrics so the shop's Prometheus can watch the watcher.
//
// Deliberately not a module of the fulfillment API: it has no dependencies to
// install, shares no process, database or deploy with the API, and starts on a
// host with no internet access. See README.md.

import { loadConfig } from "./lib/config.mjs";
import { createWatchdog } from "./lib/runtime.mjs";
import { createTelegramSender } from "./lib/telegram.mjs";

function log(level, msg, fields = {}) {
  process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })}\n`);
}

const { config, errors } = loadConfig(process.env);
const send = errors.length ? null : createTelegramSender(config.telegram);
const watchdog = createWatchdog({ config, errors, send, log });

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal });
  // Never hang a container stop: the cycle has its own request timeouts, this
  // is the backstop.
  const backstop = setTimeout(() => process.exit(0), 8_000);
  backstop.unref();
  await watchdog.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

watchdog.start().catch((error) => {
  log("error", "watchdog failed to start", { error: String(error?.message ?? error) });
  process.exit(1);
});
