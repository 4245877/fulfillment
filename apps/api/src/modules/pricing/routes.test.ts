import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import pricingRoutes from "./routes";
import { classifyError } from "./routes";
import { codedError } from "./service";

// ---------------------------------------------------------------------------
// classifyError: validation errors → precise 4xx; internal/SSH failures never
// leak the raw message to the client (issue #2).
// ---------------------------------------------------------------------------
test("classifyError maps tagged validation errors to their 4xx code + message", () => {
  assert.deepEqual(classifyError(codedError("empty config", 422), "fallback"), {
    status: 422,
    text: "empty config",
  });
  assert.deepEqual(classifyError(codedError("bad root", 400), "fallback"), {
    status: 400,
    text: "bad root",
  });
  assert.deepEqual(classifyError(codedError("conflict", 409), "fallback"), {
    status: 409,
    text: "conflict",
  });
});

test("classifyError hides internal (500) and upstream (502) details", () => {
  // Internal invariant failure → generic message, not the raw text.
  const internal = classifyError(codedError("serialized lost data", 500), "fallback");
  assert.equal(internal.status, 500);
  assert.doesNotMatch(internal.text, /lost data/);

  // Untagged error (e.g. an SSH/exec failure) → 502 with the safe fallback only,
  // never the raw error text (which may carry remote stderr / command fragments).
  const upstream = classifyError(
    new Error("ssh write exited with code 255: Permission denied (publickey)"),
    "Не вдалося зберегти pricing.yml на сервері."
  );
  assert.equal(upstream.status, 502);
  assert.equal(upstream.text, "Не вдалося зберегти pricing.yml на сервері.");
  assert.doesNotMatch(upstream.text, /ssh|publickey|255/i);
});

// ---------------------------------------------------------------------------
// Route wiring: a malformed body is rejected with 400 before any SSH work, so a
// bad request never becomes a 502 (issue #2). Uses app.inject (no network).
// ---------------------------------------------------------------------------
test("PUT /api/ops/pricing without a 'tree' returns 400, not 502", async () => {
  const app = Fastify();
  await app.register(pricingRoutes);

  const res = await app.inject({
    method: "PUT",
    url: "/api/ops/pricing",
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /tree/i);

  await app.close();
});
