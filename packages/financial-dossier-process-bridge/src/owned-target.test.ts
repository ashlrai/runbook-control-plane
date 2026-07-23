import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OwnedPinnedTargetModule,
  ProcessBridgeInfrastructureError,
  copyOwnedTargetBytes,
  ownPinnedTargetModule,
} from "./owned-target.js";

const MAX_TARGET_MODULE_BYTES = 1_048_576;
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "runbook-owned-target-"));
  temporaryDirectories.push(directory);
  return directory;
}

function expectInfrastructureError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProcessBridgeInfrastructureError);
  expect(thrown).toMatchObject({ code });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("owned pinned target module boundary", () => {
  it("owns exact regular-file bytes and returns independent consumable copies", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "target.mjs");
    const original = new TextEncoder().encode("export default 'original';\n");
    writeFileSync(path, original, { mode: 0o600 });

    const owned = ownPinnedTargetModule(path, sha256(original));
    const first = copyOwnedTargetBytes(owned);
    first.fill(0);
    const second = copyOwnedTargetBytes(owned);

    expect(owned).toMatchObject({ byteCount: original.byteLength, sha256: sha256(original) });
    expect(second).toEqual(original);
    expect(second).not.toBe(first);
    expect(Object.isFrozen(owned)).toBe(true);
  });

  it("keeps consuming pinned bytes after the source path is replaced", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "target.mjs");
    const original = new TextEncoder().encode("export default 'pinned';\n");
    const replacement = new TextEncoder().encode("export default 'replacement';\n");
    writeFileSync(path, original, { mode: 0o600 });
    const owned = ownPinnedTargetModule(path, sha256(original));

    writeFileSync(path, replacement, { mode: 0o600 });

    expect(copyOwnedTargetBytes(owned)).toEqual(original);
    expect(copyOwnedTargetBytes(owned)).not.toEqual(new Uint8Array(readFileSync(path)));
  });

  it("rejects a wrong expected digest and malformed digest text", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "target.mjs");
    writeFileSync(path, "export default 1;\n", { mode: 0o600 });

    expectInfrastructureError(
      () => ownPinnedTargetModule(path, "0".repeat(64)),
      "bridge.target-digest-mismatch",
    );
    expectInfrastructureError(
      () => ownPinnedTargetModule(path, "not-a-sha256"),
      "bridge.target-digest-invalid",
    );
    expectInfrastructureError(
      () => ownPinnedTargetModule(path, sha256(readFileSync(path)).toUpperCase()),
      "bridge.target-digest-invalid",
    );
  });

  it("rejects target bytes that are not fatal-decodable UTF-8 source", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "invalid-utf8.mjs");
    const bytes = Uint8Array.of(0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20, 0xc3, 0x28);
    writeFileSync(path, bytes, { mode: 0o600 });
    expectInfrastructureError(
      () => ownPinnedTargetModule(path, sha256(bytes)),
      "bridge.target-utf8-invalid",
    );
  });

  it("rejects a symlink and a non-regular directory", () => {
    const directory = temporaryDirectory();
    const target = join(directory, "target.mjs");
    const link = join(directory, "target-link.mjs");
    const nestedDirectory = join(directory, "nested");
    writeFileSync(target, "export default 1;\n", { mode: 0o600 });
    symlinkSync(target, link);
    mkdirSync(nestedDirectory);

    expectInfrastructureError(
      () => ownPinnedTargetModule(link, sha256(readFileSync(target))),
      "bridge.target-open-failed",
    );
    expectInfrastructureError(
      () => ownPinnedTargetModule(nestedDirectory, sha256("directory")),
      "bridge.target-not-regular-file",
    );
  });

  it.each([
    [0, "empty"],
    [MAX_TARGET_MODULE_BYTES + 1, "oversized"],
  ] as const)("rejects an %s target module", (size) => {
    const directory = temporaryDirectory();
    const path = join(directory, "target.mjs");
    const bytes = new Uint8Array(size);
    writeFileSync(path, bytes, { mode: 0o600 });

    expectInfrastructureError(
      () => ownPinnedTargetModule(path, sha256(bytes)),
      "bridge.target-size-invalid",
    );
  });

  it("accepts the exact maximum target size", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "target.mjs");
    const bytes = new Uint8Array(MAX_TARGET_MODULE_BYTES);
    bytes[0] = 1;
    bytes[bytes.byteLength - 1] = 2;
    writeFileSync(path, bytes, { mode: 0o600 });

    const owned = ownPinnedTargetModule(path, sha256(bytes));
    expect(owned.byteCount).toBe(MAX_TARGET_MODULE_BYTES);
    expect(Buffer.compare(Buffer.from(copyOwnedTargetBytes(owned)), Buffer.from(bytes))).toBe(0);
  }, 15_000);

  it("rejects direct construction and prototype-shaped forgeries", () => {
    expectInfrastructureError(
      () => new OwnedPinnedTargetModule(Symbol("forged"), 1, "0".repeat(64), Uint8Array.of(0)),
      "bridge.target-ownership-invalid",
    );

    const prototypeForgery = Object.create(OwnedPinnedTargetModule.prototype) as OwnedPinnedTargetModule;
    expectInfrastructureError(
      () => copyOwnedTargetBytes(prototypeForgery),
      "bridge.target-ownership-invalid",
    );
    expectInfrastructureError(
      () => copyOwnedTargetBytes({ byteCount: 1, sha256: "0".repeat(64) } as OwnedPinnedTargetModule),
      "bridge.target-ownership-invalid",
    );
  });

  it("rejects invalid paths without touching the filesystem", () => {
    expectInfrastructureError(
      () => ownPinnedTargetModule("", "0".repeat(64)),
      "bridge.target-path-invalid",
    );
    expectInfrastructureError(
      () => ownPinnedTargetModule("bad\0path", "0".repeat(64)),
      "bridge.target-path-invalid",
    );
  });
});
