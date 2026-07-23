import { canonicalizeJcs } from "./canonical.js";

export const MAX_BEHAVIORAL_FRAME_BYTES = 32 * 1024;
export const MAX_ADAPTER_BYTES = 32 * 1024 * 1024;
export const MAX_CONFIGURATION_BYTES = 2 * 1024;
export const MAX_PROTOCOL_FRAMES = 64;
export const MAX_STDOUT_BYTES = 256 * 1024;
export const MAX_STDERR_BYTES = 32 * 1024;

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

export class SandboxProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SandboxProtocolError";
  }
}

export function encodeLengthPrefixedBytes(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(4 + bytes.byteLength);
  new DataView(output.buffer).setUint32(0, bytes.byteLength, false);
  output.set(bytes, 4);
  return output;
}

export function encodeCanonicalFrame(value: unknown): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = encoder.encode(canonicalizeJcs(value));
  } catch {
    throw new SandboxProtocolError("protocol.frame-not-canonicalizable");
  }
  if (bytes.byteLength > MAX_BEHAVIORAL_FRAME_BYTES) {
    throw new SandboxProtocolError("protocol.frame-too-large");
  }
  return encodeLengthPrefixedBytes(bytes);
}

export function parseExactCanonicalFrame(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength > MAX_BEHAVIORAL_FRAME_BYTES) {
    throw new SandboxProtocolError("protocol.frame-too-large");
  }
  let text: string;
  let value: unknown;
  try {
    text = strictDecoder.decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    throw new SandboxProtocolError("protocol.frame-invalid-json");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SandboxProtocolError("protocol.frame-not-object");
  }
  let canonical: string;
  try {
    canonical = canonicalizeJcs(value);
  } catch {
    throw new SandboxProtocolError("protocol.frame-invalid-value");
  }
  if (canonical !== text) throw new SandboxProtocolError("protocol.frame-noncanonical");
  return value as Record<string, unknown>;
}

export class LengthPrefixedFrameDecoder {
  #buffer = new Uint8Array(0);
  #frames = 0;
  #totalBytes = 0;

  push(chunk: Uint8Array): readonly Record<string, unknown>[] {
    this.#totalBytes += chunk.byteLength;
    if (this.#totalBytes > MAX_STDOUT_BYTES) {
      throw new SandboxProtocolError("protocol.stdout-limit-exceeded");
    }
    const next = new Uint8Array(this.#buffer.byteLength + chunk.byteLength);
    next.set(this.#buffer);
    next.set(chunk, this.#buffer.byteLength);
    this.#buffer = next;
    const frames: Record<string, unknown>[] = [];
    while (this.#buffer.byteLength >= 4) {
      const length = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset,
        4,
      ).getUint32(0, false);
      if (length > MAX_BEHAVIORAL_FRAME_BYTES) {
        throw new SandboxProtocolError("protocol.frame-too-large");
      }
      if (this.#buffer.byteLength < 4 + length) break;
      this.#frames += 1;
      if (this.#frames > MAX_PROTOCOL_FRAMES) {
        throw new SandboxProtocolError("protocol.frame-limit-exceeded");
      }
      frames.push(parseExactCanonicalFrame(this.#buffer.subarray(4, 4 + length)));
      this.#buffer = this.#buffer.slice(4 + length);
    }
    return frames;
  }

  finish(): void {
    if (this.#buffer.byteLength !== 0) {
      throw new SandboxProtocolError("protocol.truncated-frame");
    }
  }
}

export function bootstrapBytes(
  initHeader: unknown,
  adapterBytes: Uint8Array,
  configurationBytes: Uint8Array,
): Uint8Array {
  if (adapterBytes.byteLength > MAX_ADAPTER_BYTES) {
    throw new SandboxProtocolError("protocol.adapter-too-large");
  }
  if (configurationBytes.byteLength > MAX_CONFIGURATION_BYTES) {
    throw new SandboxProtocolError("protocol.configuration-too-large");
  }
  const parts = [
    encodeCanonicalFrame(initHeader),
    encodeLengthPrefixedBytes(adapterBytes),
    encodeLengthPrefixedBytes(configurationBytes),
  ];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
