import { describe, expect, it } from "vitest";
import {
  bootstrapBytes,
  encodeCanonicalFrame,
  LengthPrefixedFrameDecoder,
  parseExactCanonicalFrame,
  SandboxProtocolError,
} from "./protocol.js";

describe("sandbox protocol", () => {
  it("round-trips fragmented exact-JCS frames", () => {
    const encoded = encodeCanonicalFrame({ schemaVersion: "test.v1", type: "ready" });
    const decoder = new LengthPrefixedFrameDecoder();
    expect(decoder.push(encoded.subarray(0, 3))).toEqual([]);
    expect(decoder.push(encoded.subarray(3))).toEqual([
      { schemaVersion: "test.v1", type: "ready" },
    ]);
    expect(() => decoder.finish()).not.toThrow();
  });

  it("rejects whitespace, duplicate fields, truncation, and oversized frames", () => {
    expect(() => parseExactCanonicalFrame(new TextEncoder().encode('{"a":1 }'))).toThrow(
      SandboxProtocolError,
    );
    expect(() => parseExactCanonicalFrame(new TextEncoder().encode('{"a":1,"a":1}'))).toThrow(
      SandboxProtocolError,
    );
    const decoder = new LengthPrefixedFrameDecoder();
    decoder.push(new Uint8Array([0, 0, 0, 2, 123]));
    expect(() => decoder.finish()).toThrowError("protocol.truncated-frame");
    expect(() => encodeCanonicalFrame({ value: "x".repeat(33 * 1024) })).toThrowError(
      "protocol.frame-too-large",
    );
  });

  it("keeps raw adapter and configuration sections byte exact", () => {
    const adapter = new Uint8Array([0, 255, 10, 1]);
    const configuration = new TextEncoder().encode('{"a":1}');
    const bytes = bootstrapBytes({ type: "init" }, adapter, configuration);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = view.getUint32(0, false);
    const adapterOffset = 4 + headerLength;
    expect(view.getUint32(adapterOffset, false)).toBe(adapter.byteLength);
    expect(bytes.slice(adapterOffset + 4, adapterOffset + 4 + adapter.byteLength)).toEqual(adapter);
  });
});
