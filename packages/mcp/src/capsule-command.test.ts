import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { serializeProofVerificationReceipt } from "@runbook/capsule";
import {
  capsuleVerificationExitCode,
  runCapsuleVerificationCommand,
  verifyCapsuleFile,
} from "./capsule-command.js";

const directories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-capsule-command-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("capsule verification command", () => {
  it("verifies the frozen independent golden capsule with exit zero", async () => {
    const path = fileURLToPath(new URL("../../../conformance/fixtures/minimal-synthetic-root.runbook", import.meta.url));
    const output: string[] = [];

    const result = await runCapsuleVerificationCommand([path], (value) => output.push(value));

    expect(result.exitCode).toBe(0);
    expect(result.verification).toMatchObject({
      valid: true,
      capsuleId: "66b200560e20f723ece402931277043b85316687aac30f73c4da6a4d5a323578",
      assurance: {
        transportProfile: "valid",
        packageIntegrity: "valid",
        authorSignature: "valid",
        brokerExecution: "not-evaluated",
      },
      errors: [],
    });
    const exactReceipt = serializeProofVerificationReceipt(result.verification);
    expect(Buffer.from(output[0] as string, "utf8")).toEqual(exactReceipt);
    expect(output[0]?.endsWith("\n")).toBe(false);
    expect(output[0]?.endsWith("\r")).toBe(false);
  });

  it("keeps a valid author signature but exits one for the frozen payload mutation", async () => {
    const path = fileURLToPath(new URL("../../../conformance/fixtures/minimal-synthetic-root-payload-tampered.runbook", import.meta.url));
    const result = await runCapsuleVerificationCommand([path], () => undefined);

    expect(result.exitCode).toBe(1);
    expect(result.verification.assurance).toMatchObject({
      transportProfile: "valid",
      packageIntegrity: "invalid",
      authorSignature: "valid",
    });
    expect(result.verification.errors).toEqual([{
      code: "manifest.member-digest-mismatch",
      path: "payload/charter.json",
    }]);
  });

  it("emits a deterministic receipt and exit one for a parsed-invalid capsule", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "invalid.runbook");
    await writeFile(path, "not a zip");
    const output: string[] = [];

    const result = await runCapsuleVerificationCommand([path], (value) => output.push(value));

    expect(result.exitCode).toBe(1);
    expect(result.verification.valid).toBe(false);
    expect(result.verification.errors.length).toBeGreaterThan(0);
    expect(Buffer.from(output[0] as string, "utf8")).toEqual(serializeProofVerificationReceipt(result.verification));
    expect(output[0]?.endsWith("\n")).toBe(false);
  });

  it("writes exact no-newline JCS bytes to stdout through the default writer", async () => {
    const path = fileURLToPath(new URL("../../../conformance/fixtures/minimal-synthetic-root.runbook", import.meta.url));
    const chunks: Buffer[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    let result;
    try {
      result = await runCapsuleVerificationCommand([path]);
    } finally {
      process.stdout.write = originalWrite;
    }
    const stdout = Buffer.concat(chunks);
    expect(stdout).toEqual(serializeProofVerificationReceipt(result.verification));
    expect(stdout.at(-1)).not.toBe(0x0a);
    expect(stdout.at(-1)).not.toBe(0x0d);
    expect(result.exitCode).toBe(0);
  });

  it("maps valid, ordinary invalid, and resource-rejected results to 0, 1, and 2", () => {
    expect(capsuleVerificationExitCode({ valid: true, errors: [] })).toBe(0);
    expect(capsuleVerificationExitCode({ valid: false, errors: [{ code: "signature.invalid" }] })).toBe(1);
    expect(capsuleVerificationExitCode({ valid: false, errors: [{ code: "input.size-limit" }] })).toBe(2);
    expect(capsuleVerificationExitCode({ valid: false, errors: [{ code: "zip.entry-count-limit" }] })).toBe(2);
  });

  it("refuses symlink inputs before reading capsule bytes", async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, "target.runbook");
    const link = join(directory, "link.runbook");
    await writeFile(target, "not a zip");
    await symlink(target, link);

    await expect(verifyCapsuleFile(link)).rejects.toThrow();
  });

  it("rejects ambiguous or incomplete arguments", async () => {
    await expect(runCapsuleVerificationCommand([])).rejects.toThrow("exactly one");
    await expect(runCapsuleVerificationCommand(["a.runbook", "b.runbook"])).rejects.toThrow("exactly one");
    await expect(runCapsuleVerificationCommand(["--json"])).rejects.toThrow("exactly one");
  });
});
