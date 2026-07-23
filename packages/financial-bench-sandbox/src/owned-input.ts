import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  type BigIntStats,
} from "node:fs";
import { createHash } from "node:crypto";
import { MAX_ADAPTER_BYTES, MAX_CONFIGURATION_BYTES } from "./protocol.js";

export type OwnedInput = Readonly<{
  bytes: Uint8Array;
  byteCount: number;
  sha256: string;
}>;

export class SandboxInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SandboxInputError";
  }
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fingerprint = (stats: BigIntStats) =>
  `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;

export function ownRegularFile(
  path: string,
  options: Readonly<{ expectedSha256?: string; maxBytes: number }>,
): OwnedInput {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new SandboxInputError("input.max-bytes-invalid");
  }
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch {
    throw new SandboxInputError("input.open-failed");
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new SandboxInputError("input.not-regular-file");
    if (before.size > BigInt(options.maxBytes)) {
      throw new SandboxInputError("input.too-large");
    }
    const bytes = new Uint8Array(readFileSync(descriptor));
    const after = fstatSync(descriptor, { bigint: true });
    if (fingerprint(before) !== fingerprint(after) || bytes.byteLength !== Number(after.size)) {
      throw new SandboxInputError("input.changed-during-read");
    }
    const sha256 = digest(bytes);
    if (options.expectedSha256 !== undefined && sha256 !== options.expectedSha256) {
      throw new SandboxInputError("input.digest-mismatch");
    }
    return Object.freeze({ bytes, byteCount: bytes.byteLength, sha256 });
  } finally {
    closeSync(descriptor);
  }
}

export function ownAdapterBundle(path: string, expectedSha256: string): OwnedInput {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new SandboxInputError("input.expected-digest-invalid");
  }
  return ownRegularFile(path, { expectedSha256, maxBytes: MAX_ADAPTER_BYTES });
}

export function ownPublicConfiguration(path: string): OwnedInput {
  return ownRegularFile(path, { maxBytes: MAX_CONFIGURATION_BYTES });
}

export function reownInputSnapshot(input: OwnedInput, maxBytes: number): OwnedInput {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new SandboxInputError("input.max-bytes-invalid");
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > maxBytes) {
    throw new SandboxInputError("input.snapshot-bytes-invalid");
  }
  const bytes = new Uint8Array(input.bytes);
  const sha256 = digest(bytes);
  if (input.byteCount !== bytes.byteLength || input.sha256 !== sha256) {
    throw new SandboxInputError("input.snapshot-binding-invalid");
  }
  return Object.freeze({ bytes, byteCount: bytes.byteLength, sha256 });
}
