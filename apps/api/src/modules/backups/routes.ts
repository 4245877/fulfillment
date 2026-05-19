import type { FastifyPluginAsync } from "fastify";
import {
  getBackupStatus,
  listBackups,
  runBackupNow,
  testRestoreLatest,
} from "./service";

const backupsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/status", async () => {
    return getBackupStatus();
  });

  app.post("/run", async () => {
    return runBackupNow();
  });

  app.post("/test-restore", async () => {
    return testRestoreLatest();
  });

  app.get("/list", async () => {
    return listBackups();
  });
};

export default backupsRoutes;