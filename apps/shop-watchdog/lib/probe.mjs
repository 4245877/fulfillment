// Shop watchdog — probes.
//
// Four plain GETs against the shop's PUBLIC entry, the same one a buyer uses.
// Nothing here needs a credential, an admin route, /metrics or database access:
// the watchdog must keep working when everything "inside" is gone.
//
//   edge       GET /nginx-healthz            the reverse proxy answers
//   api        GET /api/health               the proxy reaches a live backend
//   catalog    GET /api/products?limit=1     the backend answers from its data
//                                            (API → database → published catalog)
//   storefront GET /                         the buyer gets the storefront page
//
// A single 200 from a static page says nothing about the shop, so the four are
// classified TOGETHER into one status that names what is actually broken:
//
//   unreachable     nothing answers at all (host, network or proxy is down)
//   backend_down    the proxy answers, the backend does not
//   not_ready       the backend is alive but cannot serve data
//   storefront_down the API works, the storefront page is not served
//   catalog_empty   everything answers, but the catalog has no products
//   ok
//
// What this cannot see by design: internal workers, queues, rights recompute,
// backups. Those are the job of the shop's own Prometheus; whether THAT is
// alive is checked by the heartbeat (dead-man) track, not here.

export const SHOP_STATUSES = Object.freeze([
  "ok",
  "unreachable",
  "backend_down",
  "not_ready",
  "storefront_down",
  "catalog_empty",
]);

const MAX_BODY_BYTES = 256 * 1024;

/** Error classes that mean "no HTTP answer at all". */
function transportKind(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  return "network";
}

function errorCode(error) {
  // undici wraps the socket error: the useful code lives on `cause`.
  return String(error?.cause?.code || error?.code || error?.name || "error");
}

async function readBounded(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * One GET with a hard deadline covering connect, headers AND body.
 * Never throws: the outcome is the observation.
 */
async function check(url, timeoutMs, fetchImpl, validate) {
  const startedAt = Date.now();
  const done = (result) => ({ ...result, durationMs: Date.now() - startedAt });
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "lite-forest-shop-watchdog", accept: "*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await readBounded(response);
    if (response.status !== 200) {
      return done({ ok: false, kind: "http", httpStatus: response.status, detail: `HTTP ${response.status}` });
    }
    const verdict = validate(body, response);
    if (verdict !== true) {
      return done({ ok: false, kind: "body", httpStatus: 200, detail: verdict });
    }
    return done({ ok: true, kind: "ok", httpStatus: 200, detail: "200" });
  } catch (error) {
    const kind = transportKind(error);
    return done({ ok: false, kind, httpStatus: null, detail: kind === "timeout" ? `нет ответа за ${timeoutMs} мс` : errorCode(error) });
  }
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Classify the four observations into one status. Pure. */
export function classify(checks) {
  const all = [checks.edge, checks.api, checks.catalog, checks.storefront];
  const transport = (c) => c.kind === "network" || c.kind === "timeout";

  if (all.every(transport)) return "unreachable";
  if (!checks.api.ok) return "backend_down";
  if (!checks.catalog.ok) return "not_ready";
  if (!checks.storefront.ok) return "storefront_down";
  if (checks.catalog.empty) return "catalog_empty";
  return "ok";
}

/**
 * Probe the shop once.
 *
 * Returns `{ status, checks, observedAt }`. The four requests run in parallel:
 * a dead host costs one timeout, not four.
 */
export async function probeShop(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const base = config.baseUrl;
  const t = config.timeoutMs;
  let catalogEmpty = false;

  const [edge, api, catalog, storefront] = await Promise.all([
    check(`${base}/nginx-healthz`, t, fetchImpl, (body) => (body.trim() === "ok" ? true : "неожиданный ответ прокси")),
    check(`${base}/api/health`, t, fetchImpl, (body) => (parseJson(body)?.ok === true ? true : "ответ не {ok:true}")),
    check(`${base}/api/products?limit=1`, t, fetchImpl, (body) => {
      const json = parseJson(body);
      if (!json || !Array.isArray(json.items)) return "в ответе каталога нет списка товаров";
      catalogEmpty = json.items.length === 0;
      return true;
    }),
    check(`${base}/`, t, fetchImpl, (body, response) => {
      const type = String(response.headers.get("content-type") || "");
      if (!type.includes("text/html")) return `витрина отдала ${type || "ответ без типа"}`;
      return /<!doctype html/i.test(body) ? true : "витрина отдала не HTML-страницу";
    }),
  ]);

  const checks = { edge, api, catalog: { ...catalog, empty: catalog.ok && catalogEmpty }, storefront };
  return { status: classify(checks), checks, observedAt: new Date(now()).toISOString() };
}

/** One line per check for a notification: what was actually observed. */
export function describeChecks(checks) {
  const label = { edge: "прокси /nginx-healthz", api: "API /api/health", catalog: "каталог /api/products", storefront: "витрина /" };
  return Object.entries(label).map(([key, name]) => {
    const c = checks[key];
    if (!c) return `${name}: нет данных`;
    if (c.ok) return `${name}: ${key === "catalog" && c.empty ? "200, товаров нет" : "200"} (${c.durationMs} мс)`;
    return `${name}: ${c.detail}`;
  });
}
