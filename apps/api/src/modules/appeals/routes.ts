import type { FastifyPluginAsync } from "fastify";

import { requireAdmin } from "../../core/auth";
import {
  getAppeal,
  ingestAppeal,
  listAppeals,
  markAppealRead,
  sendAppealMessage,
  setAppealStatus,
} from "./service";
import { isAppealStatus } from "./types";
import { publishEvent } from "../../core/events";

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

  // POST /api/appeals/ingest — a customer question from the shop's
  // "Поставити запитання майстру" chat. The shop forwards its OutboundQuestion
  // here (nested product/customer + thread_id); a flat variant is also accepted.
  app.post("/ingest", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const text = String(body.message ?? "").trim();

    if (!text) {
      reply.code(400);
      return { ok: false, error: "Порожнє повідомлення" };
    }

    const product = body.product ?? {};
    const customer = body.customer ?? {};

    try {
      const { item, message, created } = await ingestAppeal({
        threadId: body.thread_id ?? body.threadId ?? null,
        message: text,
        customer: {
          name: customer.name ?? body.customer_name ?? null,
          contact: customer.contact ?? body.customer_contact ?? null,
        },
        product: {
          id: product.id ?? body.product_id ?? null,
          name: product.name ?? body.product_name ?? null,
          sku: product.sku ?? body.product_sku ?? null,
          url: product.url ?? body.product_url ?? null,
        },
        at: body.received_at ?? body.client_sent_at ?? null,
      });

      publishEvent({
        domain: "appeals",
        type: created ? "created" : "message",
        payload: { threadId: item.id, author: "customer", status: item.status, unread: item.unread },
      });

      return { ok: true, thread_id: item.id, created, item, message };
    } catch (error) {
      app.log.error({ err: error }, "failed to ingest appeal");
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося прийняти звернення") };
    }
  });

  // GET /api/appeals/ingest/:threadId — public read side of the shop mini-chat.
  // The "Поставити запитання майстру" chat polls this with the thread_id it got
  // back from POST /ingest to pull operator replies. Deliberately narrow: it
  // returns ONLY this one thread's messages — never the inbox listing or other
  // customers' contacts — and is read-only, so it must NOT touch the operator's
  // unread counter. Pairs with /ingest so the shop uses the same base path for
  // both directions of the conversation.
  app.get("/ingest/:threadId", async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    try {
      const item = await getAppeal(threadId);
      return {
        ok: true,
        thread_id: item.id,
        status: item.status,
        messages: item.messages.map((m) => ({
          id: m.id,
          author: m.author,
          text: m.text,
          at: m.at,
        })),
      };
    } catch (error) {
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Звернення не знайдено") };
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
  // Operator-only (admin); the shop mini-chat never touches this.
  app.post("/:id/read", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    const { id } = req.params as { id: string };
    try {
      return { item: await markAppealRead(id) };
    } catch (error) {
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося оновити звернення") };
    }
  });

  // POST /api/appeals/:id/messages { text } — operator reply. Admin-only; the
  // shop's customer messages arrive via POST /ingest, not here.
  app.post("/:id/messages", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

    const { id } = req.params as { id: string };
    const text = String((req.body as { text?: unknown })?.text || "").trim();

    if (!text) {
      reply.code(400);
      return { ok: false, error: "Порожнє повідомлення" };
    }

    try {
      const result = await sendAppealMessage(id, text);
      publishEvent({
        domain: "appeals",
        type: "message",
        payload: { threadId: id, author: "operator", status: result.item.status },
      });
      return result;
    } catch (error) {
      app.log.error({ err: error }, "failed to send appeal message");
      reply.code(errorStatus(error));
      return { ok: false, error: errorMessage(error, "Не вдалося надіслати повідомлення") };
    }
  });

  // PATCH /api/appeals/:id { status } — change appeal status. Operator-only.
  app.patch("/:id", async (req, reply) => {
    const denied = requireAdmin(req, reply);
    if (denied) return denied;

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
