import tls from "node:tls";

import type { PrinterConfig } from "./routes";
import type { CaptureSnapshotOptions, PrinterSnapshot } from "./snapshot";

// Bambu printers (X1, P1, A1/A1 mini) expose a local "LAN liveview" camera on a
// TLS socket at port 6000. There is no HTTP snapshot endpoint, so a still frame
// is grabbed by speaking the small binary protocol directly: open a TLS socket,
// send an 80-byte auth packet built from the LAN access code, then read the
// MJPEG-like stream and slice out the first complete JPEG frame.
const BAMBU_CAMERA_PORT = 6000;
const BAMBU_CAMERA_USERNAME = "bblp";

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_BYTES = 3_000_000;

// JPEG frame delimiters (Start/End Of Image markers).
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

function hostWithoutPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

/**
 * Builds the 80-byte authentication payload the Bambu camera expects before it
 * starts streaming: a 16-byte header (`0x40`, `0x3000`, two zero words) followed
 * by the username and the LAN access code, each in a zero-padded 32-byte field.
 */
export function buildBambuCameraAuthPacket(accessCode: string): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0x40, 0);
  header.writeUInt32LE(0x3000, 4);
  // Bytes 8..15 stay zero.

  const username = Buffer.alloc(32);
  username.write(BAMBU_CAMERA_USERNAME, "ascii");

  const code = Buffer.alloc(32);
  code.write(accessCode, "ascii");

  return Buffer.concat([header, username, code]);
}

/**
 * Extracts the first complete JPEG frame (SOI…EOI inclusive) from a stream
 * buffer, or `null` when a full frame has not arrived yet. The Bambu stream
 * prefixes each frame with a binary length header; scanning for the markers
 * skips that framing without having to parse it.
 */
export function extractJpegFrame(buffer: Buffer): Buffer | null {
  const start = buffer.indexOf(JPEG_SOI);
  if (start < 0) {
    return null;
  }

  const end = buffer.indexOf(JPEG_EOI, start + JPEG_SOI.length);
  if (end < 0) {
    return null;
  }

  return buffer.subarray(start, end + JPEG_EOI.length);
}

/**
 * Grabs a single still frame from a Bambu printer's local camera. Returns `null`
 * (never throws) when the access code is missing, the printer has LAN liveview
 * disabled, or the socket fails/times out — callers degrade to a text-only
 * notification, exactly as with the HTTP snapshot path.
 */
export function captureBambuCameraSnapshot(
  printer: PrinterConfig,
  options: CaptureSnapshotOptions = {}
): Promise<PrinterSnapshot | null> {
  const accessCode = (printer.accessCode || "").trim();
  const host = hostWithoutPort((printer.host || "").trim());

  if (!accessCode || !host) {
    return Promise.resolve(null);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return new Promise((resolve) => {
    let buffer: Buffer = Buffer.alloc(0);
    let settled = false;
    let socket: tls.TLSSocket;

    const finish = (result: PrinterSnapshot | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      try {
        socket?.destroy();
      } catch {
        // ignore
      }

      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      socket = tls.connect(
        {
          host,
          port: BAMBU_CAMERA_PORT,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        () => {
          socket.write(buildBambuCameraAuthPacket(accessCode));
        }
      );
    } catch {
      finish(null);
      return;
    }

    socket.on("data", (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

      const frame = extractJpegFrame(buffer);
      if (frame) {
        finish({ base64: frame.toString("base64"), mime: "image/jpeg" });
        return;
      }

      // Guard against an endless stream that never yields a full frame.
      if (buffer.byteLength > maxBytes) {
        finish(null);
      }
    });

    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));
  });
}
