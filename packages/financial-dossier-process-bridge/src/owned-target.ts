import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, type BigIntStats } from "node:fs";

const MAX_TARGET_MODULE_BYTES = 1_048_576;
const privateBytes = new WeakMap<OwnedPinnedTargetModule, Uint8Array>();
const CONSTRUCTION_TOKEN = Symbol("owned-pinned-target-module");

export class ProcessBridgeInfrastructureError extends Error {
  override readonly name = "ProcessBridgeInfrastructureError";
  constructor(readonly code: string) { super(code); }
}

export class OwnedPinnedTargetModule {
  constructor(
    token: symbol,
    readonly byteCount: number,
    readonly sha256: string,
    bytes: Uint8Array,
  ) {
    if (token !== CONSTRUCTION_TOKEN) {
      throw new ProcessBridgeInfrastructureError("bridge.target-ownership-invalid");
    }
    privateBytes.set(this, bytes);
    Object.freeze(this);
  }
}

const fingerprint = (stats: BigIntStats) =>
  `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function ownPinnedTargetModule(path: string, expectedSha256: string): OwnedPinnedTargetModule {
  if (typeof path !== "string" || path.length < 1 || path.includes("\0")) {
    throw new ProcessBridgeInfrastructureError("bridge.target-path-invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new ProcessBridgeInfrastructureError("bridge.target-digest-invalid");
  }
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new ProcessBridgeInfrastructureError("bridge.target-open-failed");
  }
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new ProcessBridgeInfrastructureError("bridge.target-not-regular-file");
    if (before.size < 1n || before.size > BigInt(MAX_TARGET_MODULE_BYTES)) {
      throw new ProcessBridgeInfrastructureError("bridge.target-size-invalid");
    }
    const expectedLength = Number(before.size);
    const bytes = new Uint8Array(expectedLength);
    let offset = 0;
    while (offset < expectedLength) {
      const count = readSync(fd, bytes, offset, expectedLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (offset !== expectedLength || fingerprint(before) !== fingerprint(after)) {
      throw new ProcessBridgeInfrastructureError("bridge.target-changed-during-read");
    }
    try {
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new ProcessBridgeInfrastructureError("bridge.target-utf8-invalid");
    }
    const sha256 = hash(bytes);
    if (sha256 !== expectedSha256) {
      throw new ProcessBridgeInfrastructureError("bridge.target-digest-mismatch");
    }
    return new OwnedPinnedTargetModule(CONSTRUCTION_TOKEN, bytes.byteLength, sha256, bytes);
  } finally {
    closeSync(fd);
  }
}

export function copyOwnedTargetBytes(target: OwnedPinnedTargetModule): Uint8Array {
  const bytes = privateBytes.get(target);
  if (bytes === undefined) throw new ProcessBridgeInfrastructureError("bridge.target-ownership-invalid");
  const copy = bytes.slice();
  if (target.byteCount !== copy.byteLength || target.sha256 !== hash(copy)) {
    throw new ProcessBridgeInfrastructureError("bridge.target-ownership-invalid");
  }
  return copy;
}
