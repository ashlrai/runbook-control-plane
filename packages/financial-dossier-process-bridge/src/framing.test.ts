import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { FRAME_SCHEMA } from "@runbook/financial-dossier-adapter";
import {
  MAX_CHANNEL_BYTES,
  MAX_CHANNEL_FRAMES,
  MAX_FRAME_BYTES,
  ProcessFrameError,
  TargetFrameDecoder,
  encodeRunnerFrame,
  encodeTargetFrame,
} from "./framing.js";

const digest = "a".repeat(64);
const targetErrorFrame = (sequence = 0) => ({
  schemaVersion: FRAME_SCHEMA,
  sequence,
  type: "target-error",
  value: { errorCode: "target-failed" },
});
const readyFrame = (sequence = 0) => ({
  schemaVersion: FRAME_SCHEMA,
  sequence,
  type: "ready",
  value: { sessionBindingSha256: digest },
});

function framedPayload(payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(4 + payload.byteLength);
  new DataView(bytes.buffer).setUint32(0, payload.byteLength, false);
  bytes.set(payload, 4);
  return bytes;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function expectFrameError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProcessFrameError);
  expect(thrown).toMatchObject({ code });
}

describe("process bridge target-channel framing boundary", () => {
  it("accepts an exact JCS frame split at every byte boundary", () => {
    const encoded = encodeTargetFrame(readyFrame());
    for (let split = 0; split <= encoded.byteLength; split += 1) {
      const decoder = new TargetFrameDecoder();
      const frames = [
        ...decoder.push(encoded.slice(0, split)),
        ...decoder.push(encoded.slice(split)),
      ];
      expect(frames).toEqual([
        expect.objectContaining({ type: "ready", sequence: 0 }),
      ]);
      decoder.finish();
      expect(decoder.totalBytes).toBe(encoded.byteLength);
      expect(decoder.frameCount).toBe(1);
    }
  });

  it("rejects valid JSON whose payload bytes are not exact JCS", () => {
    const exact = encodeTargetFrame(readyFrame());
    const payload = exact.slice(4);
    const nonCanonical = new Uint8Array(payload.byteLength + 2);
    nonCanonical[0] = 0x20;
    nonCanonical.set(payload, 1);
    nonCanonical[nonCanonical.byteLength - 1] = 0x0a;
    const decoder = new TargetFrameDecoder();
    expectFrameError(
      () => decoder.push(framedPayload(nonCanonical)),
      "bridge.frame-not-exact-jcs",
    );
  });

  it("rejects invalid UTF-8 before contract parsing", () => {
    const decoder = new TargetFrameDecoder();
    expectFrameError(
      () => decoder.push(framedPayload(Uint8Array.of(0xc3, 0x28))),
      "bridge.frame-json-invalid",
    );
  });

  it.each([
    [0, "zero"],
    [MAX_FRAME_BYTES + 1, "oversized"],
  ] as const)("rejects a %s-byte declared frame (%s)", (length) => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, length, false);
    const decoder = new TargetFrameDecoder();
    expectFrameError(() => decoder.push(header), "bridge.frame-size-invalid");
  });

  it.each([
    [Uint8Array.of(0x00, 0x00), "partial header"],
    [Uint8Array.of(0x00, 0x00, 0x00, 0x02, 0x7b), "partial payload"],
  ] as const)("rejects a truncated %s at EOF", (bytes) => {
    const decoder = new TargetFrameDecoder();
    expect(decoder.push(bytes)).toEqual([]);
    expectFrameError(() => decoder.finish(), "bridge.frame-truncated");
  });

  it("rejects a runner-direction frame on target ingress", () => {
    const encoded = encodeRunnerFrame({
      schemaVersion: FRAME_SCHEMA,
      sequence: 0,
      type: "terminate",
      value: { reason: "runner-abort" },
    });
    const decoder = new TargetFrameDecoder();
    expectFrameError(() => decoder.push(encoded), "bridge.frame-contract-invalid");
  });

  it("enforces the aggregate channel byte limit before buffering", () => {
    const decoder = new TargetFrameDecoder();
    expectFrameError(
      () => decoder.push(new Uint8Array(MAX_CHANNEL_BYTES + 1)),
      "bridge.channel-byte-limit",
    );
  });

  it("enforces the aggregate frame-count limit", () => {
    const frames = Array.from(
      { length: MAX_CHANNEL_FRAMES + 1 },
      (_, sequence) => encodeTargetFrame(targetErrorFrame(sequence)),
    );
    const decoder = new TargetFrameDecoder();
    expectFrameError(
      () => decoder.push(concatenate(frames)),
      "bridge.channel-frame-limit",
    );
  });

  it("makes finish terminal for both repeat finish and later pushes", () => {
    const decoder = new TargetFrameDecoder();
    decoder.finish();
    expectFrameError(() => decoder.finish(), "bridge.channel-already-finished");
    expectFrameError(
      () => decoder.push(encodeTargetFrame(targetErrorFrame())),
      "bridge.channel-already-finished",
    );
  });

  it("rejects accessor, sparse-array, and cross-realm frame objects", () => {
    let accessorInvoked = false;
    const accessorFrame = Object.defineProperties({}, {
      schemaVersion: {
        enumerable: true,
        get() {
          accessorInvoked = true;
          return FRAME_SCHEMA;
        },
      },
      sequence: { enumerable: true, value: 0 },
      type: { enumerable: true, value: "ready" },
      value: { enumerable: true, value: { sessionBindingSha256: digest } },
    });
    expect(() => encodeTargetFrame(accessorFrame)).toThrow();
    expect(accessorInvoked).toBe(false);

    const sparse: unknown[] = [];
    sparse.length = 4;
    sparse[3] = readyFrame();
    expect(() => encodeTargetFrame(sparse)).toThrow();

    const crossRealm = runInNewContext(
      `({schemaVersion:${JSON.stringify(FRAME_SCHEMA)},sequence:0,type:"ready",value:{sessionBindingSha256:${JSON.stringify(digest)}}})`,
    ) as unknown;
    expect(() => encodeTargetFrame(crossRealm)).toThrow();
  });

  it("accepts a genuine cross-realm Uint8Array while still owning its bytes", () => {
    const encoded = encodeTargetFrame(readyFrame());
    const crossRealm = runInNewContext(
      `new Uint8Array(${JSON.stringify([...encoded])})`,
    ) as Uint8Array;
    const decoder = new TargetFrameDecoder();
    expect(decoder.push(crossRealm)).toEqual([
      expect.objectContaining({ type: "ready", sequence: 0 }),
    ]);
    decoder.finish();
  });
});
