import { api } from "./client.js";

const REQUEST_TIMEOUT_MS = 10000;

function getJson(path) {
  return api.get(path, { timeoutMs: REQUEST_TIMEOUT_MS });
}

export const apiWB = {
  printsOverview: () => getJson("/api/prints/overview"),

  opsOverview: () => getJson("/api/ops/overview"),

  backupStatus: () => getJson("/api/ops/backup/status"),
};