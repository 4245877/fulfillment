import type { PrinterConfig } from "./routes";
import { captureBambuCameraSnapshot } from "./bambuCamera";

export type PrinterSnapshot = {
  base64: string;
  mime: string;
};

export type CaptureSnapshotOptions = {
  timeoutMs?: number;
  maxBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_BYTES = 3_000_000;

function hostWithoutPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

/**
 * Resolves a still-image (snapshot) URL for a printer's camera.
 *
 * Honours an explicit `snapshotUrl` from the printer config (absolute URL or a
 * path relative to the host). Otherwise falls back to the conventional snapshot
 * endpoint per protocol. Bambu cameras have no plain HTTP snapshot endpoint, so
 * they return `null` here and are captured over their local TLS stream instead
 * (see `captureBambuCameraSnapshot`).
 */
export function resolveSnapshotUrl(printer: PrinterConfig): string | null {
  const explicit = (printer.snapshotUrl || "").trim();

  if (explicit) {
    if (/^https?:\/\//i.test(explicit)) {
      return explicit;
    }

    const path = explicit.startsWith("/") ? explicit : `/${explicit}`;
    return `http://${hostWithoutPort(printer.host)}${path}`;
  }

  const host = hostWithoutPort(printer.host);

  if (printer.protocol === "moonraker") {
    return `http://${host}/webcam/?action=snapshot`;
  }

  if (printer.protocol === "creality") {
    return `http://${host}:8080/?action=snapshot`;
  }

  return null;
}

/**
 * Fetches a single camera frame for the printer. Returns `null` (never throws)
 * when no camera is configured/available, the request fails or times out, or
 * the response is not a reasonably sized image — callers degrade to text-only.
 *
 * Bambu printers have no HTTP snapshot endpoint, so without an explicit
 * `snapshotUrl` they are captured over their local TLS camera stream.
 */
export async function captureSnapshot(
  printer: PrinterConfig,
  options: CaptureSnapshotOptions = {}
): Promise<PrinterSnapshot | null> {
  const url = resolveSnapshotUrl(printer);

  if (!url) {
    if (printer.protocol === "bambu") {
      return captureBambuCameraSnapshot(printer, options);
    }

    return null;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return fetchImageSnapshot(url, timeoutMs, maxBytes);
}

/**
 * Fetches a single image from `url` and returns it as a snapshot. Returns `null`
 * (never throws) on any failure — a non-OK response, a non-image body, an empty
 * body, a body larger than `maxBytes`, or a timeout. Shared by the direct camera
 * path and the orchestrator-delegated path.
 */
async function fetchImageSnapshot(
  url: string,
  timeoutMs: number,
  maxBytes: number
): Promise<PrinterSnapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (contentType && !contentType.startsWith("image/")) {
      return null;
    }

    // Read the body incrementally and bail out the moment it exceeds maxBytes,
    // aborting the request. Buffering the whole response first (arrayBuffer())
    // would let a misconfigured endpoint (e.g. an endless MJPEG ?action=stream)
    // grow unbounded in memory before the size check ever ran.
    const reader = response.body?.getReader();

    if (!reader) {
      return null;
    }

    const chunks: Buffer[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;

      if (total > maxBytes) {
        controller.abort();
        return null;
      }

      chunks.push(Buffer.from(value));
    }

    if (total === 0) {
      return null;
    }

    return {
      base64: Buffer.concat(chunks).toString("base64"),
      mime: contentType || "image/jpeg",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Captures a snapshot via the atelier print-orchestrator's camera endpoint with
 * `ensureLight`, so the orchestrator (which owns light control and the night
 * schedule) switches the chamber light on before grabbing the frame when it is
 * night — avoiding the dark night photos this API would otherwise send.
 *
 * The printer `id` must match the orchestrator's config (both read the same
 * `printers.json` shape). Returns `null` (never throws) when the orchestrator is
 * unreachable, does not know the printer, or has no frame, so the caller can
 * fall back to a direct device capture.
 */
export async function captureSnapshotViaOrchestrator(
  baseUrl: string,
  printer: PrinterConfig,
  options: CaptureSnapshotOptions = {}
): Promise<PrinterSnapshot | null> {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  const url = `${trimmed}/api/printers/${encodeURIComponent(printer.id)}/camera.jpg?ensureLight=1`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return fetchImageSnapshot(url, timeoutMs, maxBytes);
}
