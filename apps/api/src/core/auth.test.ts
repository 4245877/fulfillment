import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { FastifyReply, FastifyRequest } from "fastify";

import { requireAdmin, requireAdminOrService } from "./auth";

/*
 * Unit tests for the authorization guards, with minimal request/reply fakes (no
 * Fastify, no DB — auth.ts only reads process.env and node:crypto). Covers the
 * admin gate, the inter-service gate, the scoping (a service token is NOT an
 * admin token), and the staged-rollout compatibility switch.
 */

let warnings: number;

function makeReq(headers: Record<string, string> = {}): FastifyRequest {
  return {
    headers,
    url: "/api/inventory/filament/consume",
    log: {
      warn() {
        warnings += 1;
      },
    },
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { statusCode: number } {
  const reply = {
    statusCode: 200,
    code(value: number) {
      this.statusCode = value;
      return this;
    },
  };
  return reply as unknown as FastifyReply & { statusCode: number };
}

beforeEach(() => {
  warnings = 0;
  delete process.env.ADMIN_TOKEN;
  delete process.env.ATELIER_FULFILLMENT_TOKEN;
  delete process.env.ATELIER_FULFILLMENT_AUTH_OPTIONAL;
});

// ── requireAdmin ─────────────────────────────────────────────────────────────

test("requireAdmin fails closed with 503 when no ADMIN_TOKEN is configured", () => {
  const reply = makeReply();
  const denied = requireAdmin(makeReq({ "x-admin-token": "anything" }), reply);
  assert.ok(denied);
  assert.equal(reply.statusCode, 503);
});

test("requireAdmin rejects a missing or wrong token with 401", () => {
  process.env.ADMIN_TOKEN = "admin-secret";

  const noToken = makeReply();
  assert.ok(requireAdmin(makeReq(), noToken));
  assert.equal(noToken.statusCode, 401);

  const wrong = makeReply();
  assert.ok(requireAdmin(makeReq({ "x-admin-token": "nope" }), wrong));
  assert.equal(wrong.statusCode, 401);
});

test("requireAdmin authorises the correct token", () => {
  process.env.ADMIN_TOKEN = "admin-secret";
  const reply = makeReply();
  assert.equal(requireAdmin(makeReq({ "x-admin-token": "admin-secret" }), reply), null);
});

test("requireAdmin does not accept the service token as an admin token", () => {
  process.env.ADMIN_TOKEN = "admin-secret";
  process.env.ATELIER_FULFILLMENT_TOKEN = "service-secret";
  const reply = makeReply();
  // The service token sent in the admin header must not authorise.
  assert.ok(requireAdmin(makeReq({ "x-admin-token": "service-secret" }), reply));
  assert.equal(reply.statusCode, 401);
});

// ── requireAdminOrService ────────────────────────────────────────────────────

test("requireAdminOrService authorises a valid admin token", () => {
  process.env.ADMIN_TOKEN = "admin-secret";
  process.env.ATELIER_FULFILLMENT_TOKEN = "service-secret";
  assert.equal(
    requireAdminOrService(makeReq({ "x-admin-token": "admin-secret" }), makeReply()),
    null
  );
});

test("requireAdminOrService authorises a valid service token", () => {
  process.env.ADMIN_TOKEN = "admin-secret";
  process.env.ATELIER_FULFILLMENT_TOKEN = "service-secret";
  assert.equal(
    requireAdminOrService(
      makeReq({ "x-service-token": "service-secret" }),
      makeReply()
    ),
    null
  );
});

test("requireAdminOrService works with only the service token configured", () => {
  process.env.ATELIER_FULFILLMENT_TOKEN = "service-secret";
  assert.equal(
    requireAdminOrService(
      makeReq({ "x-service-token": "service-secret" }),
      makeReply()
    ),
    null
  );
});

test("requireAdminOrService rejects a wrong service token with 401", () => {
  process.env.ADMIN_TOKEN = "admin-secret";
  process.env.ATELIER_FULFILLMENT_TOKEN = "service-secret";
  const reply = makeReply();
  assert.ok(
    requireAdminOrService(makeReq({ "x-service-token": "wrong" }), reply)
  );
  assert.equal(reply.statusCode, 401);
});

test("requireAdminOrService rejects a token-less call (401) when configured", () => {
  process.env.ADMIN_TOKEN = "admin-secret";
  process.env.ATELIER_FULFILLMENT_TOKEN = "service-secret";
  const reply = makeReply();
  assert.ok(requireAdminOrService(makeReq(), reply));
  assert.equal(reply.statusCode, 401);
});

test("requireAdminOrService fails closed with 503 when nothing is configured", () => {
  const reply = makeReply();
  assert.ok(requireAdminOrService(makeReq({ "x-service-token": "x" }), reply));
  assert.equal(reply.statusCode, 503);
});

test("compat mode allows a token-less inter-service call and warns", () => {
  process.env.ATELIER_FULFILLMENT_AUTH_OPTIONAL = "true";
  const req = makeReq();
  assert.equal(requireAdminOrService(req, makeReply()), null);
  assert.equal(warnings, 1, "the bypass is warned about, not silent");
});
