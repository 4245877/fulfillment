import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBambuCameraAuthPacket,
  extractJpegFrame,
} from "./bambuCamera";

test("buildBambuCameraAuthPacket lays out the 80-byte handshake", () => {
  const packet = buildBambuCameraAuthPacket("17073968");

  assert.equal(packet.byteLength, 80);
  assert.equal(packet.readUInt32LE(0), 0x40);
  assert.equal(packet.readUInt32LE(4), 0x3000);
  assert.equal(packet.readUInt32LE(8), 0);
  assert.equal(packet.readUInt32LE(12), 0);

  // Username field (offset 16, 32 bytes) holds "bblp", zero-padded.
  assert.equal(packet.subarray(16, 20).toString("ascii"), "bblp");
  assert.equal(packet[20], 0);

  // Access code field (offset 48, 32 bytes), zero-padded.
  assert.equal(packet.subarray(48, 56).toString("ascii"), "17073968");
  assert.equal(packet[56], 0);
});

test("extractJpegFrame slices a complete frame out of the stream framing", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);
  // A leading binary length header (not part of the JPEG) is skipped by the marker scan.
  const stream = Buffer.concat([Buffer.from([0x40, 0x00, 0x00, 0x00]), jpeg]);

  const frame = extractJpegFrame(stream);
  assert.ok(frame);
  assert.deepEqual([...frame], [...jpeg]);
});

test("extractJpegFrame returns null until both markers are present", () => {
  // No start-of-image marker yet.
  assert.equal(extractJpegFrame(Buffer.from([0x00, 0x01, 0x02])), null);
  // Start but no end-of-image marker yet (partial frame still arriving).
  assert.equal(
    extractJpegFrame(Buffer.from([0xff, 0xd8, 0x11, 0x22])),
    null
  );
});
