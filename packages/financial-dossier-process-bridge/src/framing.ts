import {
  canonicalizeAdapterJcs,
  parseRunnerToTargetFrameV2,
  parseTargetToRunnerFrameV2,
  type RunnerToTargetFrameV2,
  type TargetToRunnerFrameV2,
} from "@runbook/financial-dossier-adapter";

export const MAX_FRAME_BYTES = 131_072;
export const MAX_CHANNEL_BYTES = 1_048_576;
export const MAX_CHANNEL_FRAMES = 128;

export class ProcessFrameError extends Error {
  override readonly name = "ProcessFrameError";
  constructor(readonly code: string) { super(code); }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function encodeRunnerFrame(frame: unknown): Uint8Array {
  const normalized = parseRunnerToTargetFrameV2(frame);
  const payload = encoder.encode(canonicalizeAdapterJcs(normalized));
  if (payload.byteLength < 1 || payload.byteLength > MAX_FRAME_BYTES) {
    throw new ProcessFrameError("bridge.frame-size-invalid");
  }
  const output = new Uint8Array(4 + payload.byteLength);
  new DataView(output.buffer).setUint32(0, payload.byteLength, false);
  output.set(payload, 4);
  return output;
}

export function encodeTargetFrame(frame: unknown): Uint8Array {
  const normalized = parseTargetToRunnerFrameV2(frame);
  const payload = encoder.encode(canonicalizeAdapterJcs(normalized));
  if (payload.byteLength < 1 || payload.byteLength > MAX_FRAME_BYTES) {
    throw new ProcessFrameError("bridge.frame-size-invalid");
  }
  const output = new Uint8Array(4 + payload.byteLength);
  new DataView(output.buffer).setUint32(0, payload.byteLength, false);
  output.set(payload, 4);
  return output;
}

export class TargetFrameDecoder {
  #buffer = new Uint8Array(0);
  #totalBytes = 0;
  #frameCount = 0;
  #finished = false;

  get totalBytes(): number { return this.#totalBytes; }
  get frameCount(): number { return this.#frameCount; }

  push(chunk: Uint8Array): TargetToRunnerFrameV2[] {
    if (this.#finished) throw new ProcessFrameError("bridge.channel-already-finished");
    const owned = new Uint8Array(chunk.byteLength);
    owned.set(chunk);
    this.#totalBytes += owned.byteLength;
    if (this.#totalBytes > MAX_CHANNEL_BYTES) {
      throw new ProcessFrameError("bridge.channel-byte-limit");
    }
    const combined = new Uint8Array(this.#buffer.byteLength + owned.byteLength);
    combined.set(this.#buffer);
    combined.set(owned, this.#buffer.byteLength);
    this.#buffer = combined;
    const frames: TargetToRunnerFrameV2[] = [];
    while (this.#buffer.byteLength >= 4) {
      const length = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset,
        this.#buffer.byteLength,
      ).getUint32(0, false);
      if (length < 1 || length > MAX_FRAME_BYTES) {
        throw new ProcessFrameError("bridge.frame-size-invalid");
      }
      if (this.#buffer.byteLength < 4 + length) break;
      const payload = this.#buffer.slice(4, 4 + length);
      this.#buffer = this.#buffer.slice(4 + length);
      let text: string;
      let parsed: unknown;
      try {
        text = decoder.decode(payload);
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new ProcessFrameError("bridge.frame-json-invalid");
      }
      let canonical: Uint8Array;
      try {
        canonical = encoder.encode(canonicalizeAdapterJcs(parsed));
      } catch {
        throw new ProcessFrameError("bridge.frame-jcs-invalid");
      }
      if (!equal(payload, canonical)) throw new ProcessFrameError("bridge.frame-not-exact-jcs");
      let frame: TargetToRunnerFrameV2;
      try {
        frame = parseTargetToRunnerFrameV2(parsed);
      } catch {
        throw new ProcessFrameError("bridge.frame-contract-invalid");
      }
      this.#frameCount += 1;
      if (this.#frameCount > MAX_CHANNEL_FRAMES) {
        throw new ProcessFrameError("bridge.channel-frame-limit");
      }
      frames.push(frame);
    }
    return frames;
  }

  finish(): void {
    if (this.#finished) throw new ProcessFrameError("bridge.channel-already-finished");
    this.#finished = true;
    if (this.#buffer.byteLength !== 0) throw new ProcessFrameError("bridge.frame-truncated");
  }
}
