import { createHash } from "node:crypto";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ownAdapterBundle,
  ownRegularFile,
  reownInputSnapshot,
  SandboxInputError,
} from "./owned-input.js";

describe("owned sandbox inputs", () => {
  it("owns and hashes exact regular-file bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "runbook-owned-input-"));
    const path = join(directory, "adapter.mjs");
    const bytes = Buffer.from("export default {};\n");
    writeFileSync(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const owned = ownAdapterBundle(path, sha256);
    writeFileSync(path, "changed");
    expect(Buffer.from(owned.bytes)).toEqual(bytes);
    expect(owned.sha256).toBe(sha256);
  });

  it("rejects symlinks, oversize inputs, and digest mismatch", () => {
    const directory = mkdtempSync(join(tmpdir(), "runbook-owned-input-"));
    const path = join(directory, "adapter.mjs");
    const link = join(directory, "adapter-link.mjs");
    writeFileSync(path, "x");
    symlinkSync(path, link);
    expect(() => ownRegularFile(link, { maxBytes: 10 })).toThrow(SandboxInputError);
    expect(() => ownRegularFile(path, { maxBytes: 0 })).toThrowError("input.max-bytes-invalid");
    expect(() => ownAdapterBundle(path, "0".repeat(64))).toThrowError("input.digest-mismatch");
  });

  it("recomputes and reowns a structurally supplied snapshot", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const owned = reownInputSnapshot({ byteCount: 3, bytes, sha256 }, 10);
    bytes[0] = 9;
    expect([...owned.bytes]).toEqual([1, 2, 3]);
    expect(() => reownInputSnapshot({ byteCount: 3, bytes, sha256 }, 10))
      .toThrowError("input.snapshot-binding-invalid");
  });
});
