import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  normalizeOrchestratorPrinter,
  OrchestratorClient,
  OrchestratorError,
} from "./client";

type FetchImpl = typeof fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function clientWith(fetchImpl: FetchImpl, options: Partial<ConstructorParameters<typeof OrchestratorClient>[0]> = {}) {
  return new OrchestratorClient({
    baseUrl: "http://orchestrator:3100",
    fetchImpl,
    // Tests must not sleep through the real jittered retry backoff.
    sleepImpl: async () => {},
    ...options,
  });
}

async function rejects(promise: Promise<unknown>): Promise<OrchestratorError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof OrchestratorError, `expected OrchestratorError, got ${error}`);
    return error;
  }
  throw new Error("expected the promise to reject");
}

test("listPrinterStatuses returns normalized printers on success", async () => {
  let requestedUrl = "";
  const client = clientWith(async (url) => {
    requestedUrl = String(url);
    return jsonResponse([
      {
        id: "k2",
        name: "Creality K2",
        model: "K2",
        type: "FDM",
        status: "printing",
        online: true,
        job: "vase.gcode",
        progress: 42,
        nozzle: [215, 220],
        bed: [60, 60],
        minutesLeft: 87,
        liveMaterial: "PLA",
        stateText: "printing",
        stateMessage: null,
        updatedAt: "2026-07-12T10:00:00.000Z",
      },
    ]);
  });

  const printers = await client.listPrinterStatuses();

  assert.equal(requestedUrl, "http://orchestrator:3100/api/printers");
  assert.equal(printers.length, 1);
  const [printer] = printers;
  assert.equal(printer.id, "k2");
  assert.equal(printer.status, "printing");
  assert.equal(printer.online, true);
  assert.equal(printer.currentFile, "vase.gcode");
  assert.equal(printer.progressPct, 42);
  assert.equal(printer.nozzleTemp, 215);
  assert.equal(printer.bedTemp, 60);
  assert.equal(printer.remainingMinutes, 87);
  assert.equal(printer.material, "PLA");
  assert.equal(printer.updatedAt, "2026-07-12T10:00:00.000Z");
});

test("listPrinterStatuses accepts the {printers: [...]} envelope", async () => {
  const client = clientWith(async () =>
    jsonResponse({ printers: [{ id: "a", status: "idle" }] })
  );
  const printers = await client.listPrinterStatuses();
  assert.equal(printers.length, 1);
  assert.equal(printers[0].id, "a");
});

test("listPrinterStatuses tolerates partially missing fields and drops unusable entries", async () => {
  const client = clientWith(async () =>
    jsonResponse([
      { id: "bare" },
      { name: "no id — dropped" },
      "not an object",
      null,
    ])
  );

  const printers = await client.listPrinterStatuses();
  assert.equal(printers.length, 1);

  const [printer] = printers;
  assert.equal(printer.id, "bare");
  assert.equal(printer.name, "bare");
  assert.equal(printer.status, "unknown");
  assert.equal(printer.online, false);
  assert.equal(printer.progressPct, null);
  assert.equal(printer.nozzleTemp, null);
  assert.equal(printer.error, null);
});

test("listPrinterStatuses raises a typed timeout error", async () => {
  const client = clientWith(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError"))
        );
      }),
    { timeoutMs: 25 }
  );

  const error = await rejects(client.listPrinterStatuses());
  assert.equal(error.kind, "timeout");
});

test("listPrinterStatuses raises a typed network error", async () => {
  const client = clientWith(async () => {
    throw new TypeError("fetch failed");
  });

  const error = await rejects(client.listPrinterStatuses());
  assert.equal(error.kind, "network");
  assert.match(error.message, /unreachable/);
});

test("listPrinterStatuses raises typed http errors for 4xx and 5xx", async () => {
  for (const status of [401, 404, 500, 503]) {
    const client = clientWith(async () => new Response("nope", { status }));
    const error = await rejects(client.listPrinterStatuses());
    assert.equal(error.kind, "http");
    assert.equal(error.status, status);
  }
});

test("listPrinterStatuses raises invalid_response on bad JSON and wrong shapes", async () => {
  const badJson = clientWith(
    async () => new Response("{not json", { status: 200 })
  );
  assert.equal((await rejects(badJson.listPrinterStatuses())).kind, "invalid_response");

  const wrongShape = clientWith(async () => jsonResponse({ hello: "world" }));
  assert.equal(
    (await rejects(wrongShape.listPrinterStatuses())).kind,
    "invalid_response"
  );
});

test("the API token is sent as a Bearer header and never leaks into errors", async () => {
  const token = "super-secret-token-value";
  let seenAuth: string | null = null;

  const okClient = clientWith(
    async (_url, init) => {
      seenAuth = new Headers(init?.headers).get("authorization");
      return jsonResponse([]);
    },
    { apiToken: token }
  );
  await okClient.listPrinterStatuses();
  assert.equal(seenAuth, `Bearer ${token}`);

  const failingClient = clientWith(
    async () => new Response("denied", { status: 401 }),
    { apiToken: token }
  );
  const error = await rejects(failingClient.listPrinterStatuses());
  assert.ok(!error.message.includes(token), "token must not appear in error text");
  assert.ok(!JSON.stringify({ ...error }).includes(token));
});

test("fetchSnapshot passes ensureLight and preserves binary data exactly", async () => {
  const imageBytes = randomBytes(64 * 1024);
  let requestedUrl = "";

  const client = clientWith(async (url) => {
    requestedUrl = String(url);
    return new Response(new Uint8Array(imageBytes), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  });

  const snapshot = await client.fetchSnapshot("bambu a1", { ensureLight: true });

  assert.equal(
    requestedUrl,
    "http://orchestrator:3100/api/printers/bambu%20a1/camera.jpg?ensureLight=1"
  );
  assert.ok(snapshot);
  assert.equal(snapshot.mime, "image/jpeg");
  assert.ok(snapshot.data.equals(imageBytes), "bytes must round-trip unchanged");
});

test("fetchSnapshot omits ensureLight when disabled", async () => {
  let requestedUrl = "";
  const client = clientWith(async (url) => {
    requestedUrl = String(url);
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });

  const snapshot = await client.fetchSnapshot("k2", { ensureLight: false });
  assert.equal(requestedUrl, "http://orchestrator:3100/api/printers/k2/camera.jpg");
  assert.equal(snapshot?.mime, "image/png");
});

test("fetchSnapshot returns null when there is no usable image", async () => {
  // HTTP error (printer unknown / camera offline).
  assert.equal(
    await clientWith(async () => new Response("nope", { status: 404 })).fetchSnapshot("x"),
    null
  );

  // Not an image.
  assert.equal(
    await clientWith(async () => jsonResponse({ error: "no frame" })).fetchSnapshot("x"),
    null
  );

  // Empty body.
  assert.equal(
    await clientWith(
      async () =>
        new Response(new Uint8Array(0), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })
    ).fetchSnapshot("x"),
    null
  );

  // Network failure degrades to null instead of throwing.
  assert.equal(
    await clientWith(async () => {
      throw new TypeError("fetch failed");
    }).fetchSnapshot("x"),
    null
  );
});

test("fetchSnapshot rejects oversized images via maxBytes", async () => {
  const big = randomBytes(256 * 1024);
  const client = clientWith(
    async () =>
      new Response(new Uint8Array(big), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })
  );

  assert.equal(await client.fetchSnapshot("x", { maxBytes: 1024 }), null);
  assert.ok(await client.fetchSnapshot("x", { maxBytes: big.length }));
});

test("GET reads retry once on network errors and 5xx, then succeed", async () => {
  let calls = 0;
  const flaky = clientWith(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return jsonResponse([{ id: "a", status: "idle" }]);
  });

  const printers = await flaky.listPrinterStatuses();
  assert.equal(calls, 2);
  assert.equal(printers[0].id, "a");

  calls = 0;
  const flaky5xx = clientWith(async () => {
    calls += 1;
    if (calls === 1) return new Response("boom", { status: 503 });
    return jsonResponse([{ id: "b", status: "idle" }]);
  });
  assert.equal((await flaky5xx.listPrinterStatuses())[0].id, "b");
  assert.equal(calls, 2);
});

test("GET reads never retry 4xx or malformed payloads", async () => {
  let calls = 0;
  const notFound = clientWith(async () => {
    calls += 1;
    return new Response("nope", { status: 404 });
  });
  assert.equal((await rejects(notFound.listPrinterStatuses())).status, 404);
  assert.equal(calls, 1);

  calls = 0;
  const badJson = clientWith(async () => {
    calls += 1;
    return new Response("{not json", { status: 200 });
  });
  assert.equal((await rejects(badJson.listPrinterStatuses())).kind, "invalid_response");
  assert.equal(calls, 1);
});

test("listPrinterStatuses rejects a non-JSON content type", async () => {
  const client = clientWith(
    async () =>
      new Response("<html>login</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
  );

  const error = await rejects(client.listPrinterStatuses());
  assert.equal(error.kind, "invalid_response");
  assert.match(error.message, /text\/html/);
});

test("listPrinterStatuses rejects an oversized JSON body", async () => {
  const huge = `[${Array.from({ length: 500 }, (_, i) => `{"id":"p${i}","padding":"${"x".repeat(200)}"}`).join(",")}]`;

  const client = clientWith(
    async () => jsonResponse(JSON.parse(huge)),
    { jsonMaxBytes: 1024, retries: 0 }
  );

  const error = await rejects(client.listPrinterStatuses());
  assert.equal(error.kind, "invalid_response");
  assert.match(error.message, /exceeded/);
});

test("close() aborts in-flight requests and rejects new ones", async () => {
  let sawAbort = false;
  const client = clientWith(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          sawAbort = true;
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      }),
    { timeoutMs: 60_000, retries: 0 }
  );

  const pending = rejects(client.listPrinterStatuses());
  await new Promise((resolve) => setTimeout(resolve, 5));
  client.close();

  const error = await pending;
  assert.equal(error.kind, "aborted");
  assert.equal(sawAbort, true);

  const after = await rejects(client.listPrinterStatuses());
  assert.equal(after.kind, "aborted");
});

test("listQueueJobs normalizes jobs and tolerates both payload shapes", async () => {
  const raw = clientWith(async () =>
    jsonResponse([
      { id: "q1", title: "Vase", printer: "k2", material: "PETG", eta: "14:00", status: "ready" },
      { title: "no id — dropped" },
    ])
  );
  const jobs = await raw.listQueueJobs();
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    id: "q1",
    title: "Vase",
    printer: "k2",
    material: "PETG",
    eta: "14:00",
    status: "ready",
  });

  const wrapped = clientWith(async () => jsonResponse({ jobs: [{ id: "q2" }] }));
  const wrappedJobs = await wrapped.listQueueJobs();
  assert.equal(wrappedJobs[0].id, "q2");
  assert.equal(wrappedJobs[0].status, "unknown");
});

test("fetchToday normalizes counters and degrades missing fields to null", async () => {
  const client = clientWith(async () =>
    jsonResponse({ done: 4, active: 2, failed: 0, hoursUsed: 11.5 })
  );
  assert.deepEqual(await client.fetchToday(), { done: 4, active: 2, failed: 0 });

  const sparse = clientWith(async () => jsonResponse({ done: "7" }));
  assert.deepEqual(await sparse.fetchToday(), { done: 7, active: null, failed: null });
});

test("normalizeOrchestratorPrinter derives online from status when absent", () => {
  assert.equal(
    normalizeOrchestratorPrinter({ id: "a", status: "printing" })?.online,
    true
  );
  assert.equal(
    normalizeOrchestratorPrinter({ id: "a", status: "offline" })?.online,
    false
  );
  assert.equal(
    normalizeOrchestratorPrinter({ id: "a", status: "weird" })?.status,
    "unknown"
  );
});
