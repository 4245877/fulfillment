import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  getBackupConfig,
  getBackupStatus,
  listBackups,
  runBackupNow,
  testRestoreLatest,
} from "./service";

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Mutating backup operations must require the admin token. With `cors origin:true`
// an unauthenticated /run or /test-restore would let anyone who can reach the API
// trigger remote shell scripts.
function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!expectedToken && process.env.NODE_ENV === "production") {
    reply.code(500);
    return { error: "ADMIN_TOKEN is not configured" };
  }

  if (!expectedToken) {
    return null;
  }

  const token = getHeaderValue(request.headers["x-admin-token"]);

  if (token !== expectedToken) {
    reply.code(401);
    return { error: "Unauthorized" };
  }

  return null;
}

// Map a thrown error onto an HTTP status + a safe, user-facing message.
//  - `expose`-tagged errors carry an operator-safe message we authored → surface it;
//  - other 4xx tags are the operator's to fix → surface the message;
//  - a 500 tag is an internal invariant failure → generic message, detail logged;
//  - anything untagged is an SSH/transport failure → 502, never echo the raw error
//    (it may contain remote stderr / command fragments).
function classifyError(
  error: unknown,
  fallbackText: string
): { status: number; text: string } {
  const statusCode = (error as { statusCode?: number })?.statusCode;
  const expose = (error as { expose?: boolean })?.expose === true;
  const message = String((error as Error)?.message || error);

  if (expose && statusCode) {
    return { status: statusCode, text: message };
  }
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return { status: statusCode, text: message };
  }
  if (statusCode === 500) {
    return { status: 500, text: "Внутрішня помилка резервного копіювання." };
  }
  return { status: 502, text: fallbackText };
}

const backupsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/config", async () => {
    return getBackupConfig();
  });

  app.get("/status", async (_req, reply) => {
    try {
      return await getBackupStatus();
    } catch (error) {
      app.log.error({ err: error }, "failed to read backup status");
      const { status, text } = classifyError(
        error,
        "Не вдалося отримати статус резервного копіювання із сервера."
      );
      reply.code(status);
      return { ok: false, error: text };
    }
  });

  app.post("/run", async (req, reply) => {
    const authError = requireAdmin(req, reply);
    if (authError) {
      return authError;
    }

    try {
      return await runBackupNow();
    } catch (error) {
      app.log.error({ err: error }, "failed to start backup");
      const { status, text } = classifyError(
        error,
        "Не вдалося запустити резервне копіювання на сервері магазину."
      );
      reply.code(status);
      return { ok: false, error: text };
    }
  });

  app.post("/test-restore", async (req, reply) => {
    const authError = requireAdmin(req, reply);
    if (authError) {
      return authError;
    }

    try {
      return await testRestoreLatest();
    } catch (error) {
      app.log.error({ err: error }, "failed to test-restore latest backup");
      const { status, text } = classifyError(
        error,
        "Не вдалося перевірити останню резервну копію."
      );
      reply.code(status);
      return { ok: false, error: text };
    }
  });

  app.get("/list", async (_req, reply) => {
    try {
      return await listBackups();
    } catch (error) {
      app.log.error({ err: error }, "failed to list backups");
      const { status, text } = classifyError(
        error,
        "Не вдалося завантажити список резервних копій."
      );
      reply.code(status);
      return { ok: false, error: text };
    }
  });
};

export default backupsRoutes;
