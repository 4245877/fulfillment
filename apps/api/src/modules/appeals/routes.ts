import type { FastifyPluginAsync } from "fastify";

import {
  getAppeal,
  listAppeals,
  markAppealRead,
  sendAppealMessage,
  setAppealStatus,
} from "./service";
import { isAppealStatus } from "./types";

function errorStatus(error: unknown): number {
  const status = Number((error as { statusCode?: number })?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  return 502;
}

function errorMessage(error: unknown, fallback: string): string {
  const message = String((error as Error)?.message || "").trim();
  return message || fallback;
}

const appealsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/appeals — full inbox, newest activity first.
  app.get("/", async (_req, reply) => {
    try {
      return { items: await listAppeals() };
    } catch (error) {
      app.log.error({ err: error }, "failed to list appeals");
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося завантажити звернення") };
    }
  });

  // GET /api/appeals/:id — single conversation.
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { item: await getAppeal(id) };
    } catch (error) {
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося завантажити звернення") };
    }
  });

  // POST /api/appeals/:id/read — clear the unread counter for the operator.
  app.post("/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { item: await markAppealRead(id) };
    } catch (error) {
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося оновити звернення") };
    }
  });

  // POST /api/appeals/:id/messages { text } — operator reply.
  app.post("/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const text = String((req.body as { text?: unknown })?.text || "").trim();

    if (!text) {
      reply.code(400);
      return { ok: false, error: "Порожнє повідомлення" };
    }

    try {
      return await sendAppealMessage(id, text);
    } catch (error) {
      app.log.error({ err: error }, "failed to send appeal message");
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося надіслати повідомлення") };
    }
  });

  // PATCH /api/appeals/:id { status } — change appeal status.
  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = (req.body as { status?: unknown })?.status;

    if (!isAppealStatus(status)) {
      reply.code(400);
      return { ok: false, error: "Невідомий статус звернення" };
    }

    try {
      return { item: await setAppealStatus(id, status) };
    } catch (error) {
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося змінити статус") };
    }
  });
};

export default appealsRoutes;
