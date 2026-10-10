import { test, after } from "node:test";
import assert from "node:assert/strict";

import { classify, describeChecks, probeShop } from "../lib/probe.mjs";
import { fakeShop } from "./helpers.mjs";

const shop = await fakeShop();
after(() => shop.down());
const config = () => ({ baseUrl: shop.url, timeoutMs: 300 });

test("a healthy shop: all four public checks pass", async () => {
  shop.mode = "ok";
  const result = await probeShop(config());
  assert.equal(result.status, "ok");
  for (const name of ["edge", "api", "catalog", "storefront"]) assert.equal(result.checks[name].ok, true, name);
  assert.equal(result.checks.catalog.empty, false);
  assert.match(result.observedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("proxy answers, backend does not → backend_down (not 'shop is fine because / is 200')", async () => {
  shop.mode = "backend_down";
  const result = await probeShop(config());
  assert.equal(result.status, "backend_down");
  assert.equal(result.checks.edge.ok, true, "nginx itself is alive");
  assert.equal(result.checks.storefront.ok, true, "the static page is still served");
  assert.equal(result.checks.api.kind, "http");
  assert.equal(result.checks.api.httpStatus, 502);
});

test("backend alive but cannot serve data → not_ready (HTTP error and garbage body alike)", async () => {
  shop.mode = "not_ready";
  let result = await probeShop(config());
  assert.equal(result.status, "not_ready");
  assert.equal(result.checks.api.ok, true);
  assert.equal(result.checks.catalog.httpStatus, 500);

  shop.mode = "bad_json";
  result = await probeShop(config());
  assert.equal(result.status, "not_ready");
  assert.equal(result.checks.catalog.kind, "body");
});

test("API works, storefront page is not served → storefront_down", async () => {
  shop.mode = "storefront_down";
  assert.equal((await probeShop(config())).status, "storefront_down");
});

test("everything answers but the catalog has no products → catalog_empty", async () => {
  shop.mode = "empty";
  const result = await probeShop(config());
  assert.equal(result.status, "catalog_empty");
  assert.equal(result.checks.catalog.ok, true);
  assert.equal(result.checks.catalog.empty, true);
});

test("a redirect is not a healthy answer: it is not followed", async () => {
  shop.mode = "redirect";
  const result = await probeShop(config());
  assert.equal(result.checks.api.httpStatus, 302);
  assert.notEqual(result.status, "ok");
});

test("a shop that accepts connections but never answers → unreachable within the timeout", async () => {
  shop.mode = "hang";
  const started = Date.now();
  const result = await probeShop(config());
  assert.equal(result.status, "unreachable");
  assert.equal(result.checks.api.kind, "timeout");
  assert.ok(Date.now() - started < 1500, "four checks in parallel cost one timeout, not four");
  shop.mode = "ok";
});

test("nothing listens at all → unreachable, with the socket error named", async () => {
  await shop.down();
  const result = await probeShop(config());
  assert.equal(result.status, "unreachable");
  assert.equal(result.checks.edge.kind, "network");
  assert.match(result.checks.edge.detail, /ECONNREFUSED/);
  await shop.up();
  shop.mode = "ok";
  assert.equal((await probeShop(config())).status, "ok", "and back");
});

test("classification is a pure function of the four observations", () => {
  const ok = { ok: true, kind: "ok" };
  const net = { ok: false, kind: "network" };
  const http = { ok: false, kind: "http" };
  assert.equal(classify({ edge: net, api: net, catalog: net, storefront: net }), "unreachable");
  assert.equal(classify({ edge: ok, api: net, catalog: net, storefront: ok }), "backend_down");
  // The proxy answered with an error page: the host is reachable.
  assert.equal(classify({ edge: net, api: http, catalog: http, storefront: net }), "backend_down");
  assert.equal(classify({ edge: ok, api: ok, catalog: http, storefront: ok }), "not_ready");
  assert.equal(classify({ edge: ok, api: ok, catalog: ok, storefront: http }), "storefront_down");
  assert.equal(classify({ edge: ok, api: ok, catalog: { ...ok, empty: true }, storefront: ok }), "catalog_empty");
  assert.equal(classify({ edge: ok, api: ok, catalog: ok, storefront: ok }), "ok");
});

test("the description of checks states what was observed for each of them", async () => {
  shop.mode = "backend_down";
  const lines = describeChecks((await probeShop(config())).checks);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /прокси \/nginx-healthz: 200/);
  assert.match(lines[1], /API \/api\/health: HTTP 502/);
  shop.mode = "ok";
});
