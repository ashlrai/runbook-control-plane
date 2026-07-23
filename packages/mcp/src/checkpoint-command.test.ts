import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkpointVerificationExitCode,
  runCheckpointVerificationCommand,
  verifyCheckpointFiles,
} from "./checkpoint-command.js";

// Public-only verification fixture derived from the published RFC 8032 test key.
const PUBLIC_KEY_DER = Buffer.from(
  "MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=",
  "base64",
);
const KEY_ID = "sha256:06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9";
const SIGNATURE = "KigeXcCmcmy11BDcblONF9zxmAAQoMT1vxNo4exrEs7BDv8s8GHwXcwZbQXCDm6MDtee2wty7r9WwfRBt2x7DQ==";
const directories: string[] = [];

function statementBytes() {
  return Buffer.from(JSON.stringify({
    schemaVersion: "runbook.checkpoint.v1",
    experimentDigest: "a".repeat(64),
    checkpointSequence: 1,
    createdAt: "2026-07-21T18:00:00.000Z",
    dataClass: "synthetic",
    authorKeyId: KEY_ID,
    eventChain: {
      algorithm: "runbook-jsonl-chain-v1",
      eventCount: 3,
      headHash: "b".repeat(64),
    },
    proofScope: {
      privacy: "metadata-only",
      sourceCoverage: "author-declared",
      underlyingRecordsIncluded: false,
      independentlyRecomputable: false,
      brokerAttestation: "absent",
    },
    assurancePolicy: "runbook.checkpoint-assurance.v1",
  }));
}

function envelopeBytes(statement: Buffer) {
  return Buffer.from(JSON.stringify({
    payload: statement.toString("base64"),
    payloadType: "application/vnd.runbook.checkpoint+json;version=1",
    signatures: [{ keyid: KEY_ID, sig: SIGNATURE }],
  }));
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-checkpoint-command-"));
  directories.push(directory);
  const statement = statementBytes();
  const paths = {
    envelope: join(directory, "checkpoint.dsse.json"),
    statement: join(directory, "checkpoint.statement.json"),
    publicKey: join(directory, "author-public-key.der"),
  };
  await Promise.all([
    writeFile(paths.envelope, envelopeBytes(statement)),
    writeFile(paths.statement, statement),
    writeFile(paths.publicKey, PUBLIC_KEY_DER),
  ]);
  return paths;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("checkpoint verification command", () => {
  it("prints the granular valid result and selects exit zero", async () => {
    const paths = await fixture();
    const output: string[] = [];
    const command = await runCheckpointVerificationCommand(
      [paths.envelope, paths.statement, paths.publicKey],
      (value) => output.push(value),
    );

    expect(command.exitCode).toBe(0);
    expect(command.verification).toMatchObject({
      valid: true,
      assurance: {
        authorSignature: "valid",
        authorIdentity: "self-asserted-key",
        brokerExecution: "not-evaluated",
      },
      limitations: [
        "signature-does-not-prove-broker-issuance",
        "checkpoint-does-not-prove-execution",
        "checkpoint-does-not-prove-record-completeness",
        "checkpoint-does-not-prove-investment-skill",
      ],
    });
    expect(JSON.parse(output[0] as string)).toEqual(command.verification);
  });

  it("prints a failed byte-binding result and selects exit two", async () => {
    const paths = await fixture();
    const statement = statementBytes();
    statement[10] = statement[10] === 65 ? 66 : 65;
    await writeFile(paths.statement, statement);
    const output: string[] = [];

    const command = await runCheckpointVerificationCommand(
      [paths.envelope, paths.statement, paths.publicKey],
      (value) => output.push(value),
    );

    expect(command.exitCode).toBe(2);
    expect(command.verification).toMatchObject({
      valid: false,
      assurance: { payloadBinding: "invalid", authorSignature: "valid" },
      errors: expect.arrayContaining(["payload.byte-mismatch"]),
    });
    expect(JSON.parse(output[0] as string)).toEqual(command.verification);
  });

  it("caps oversized files and delegates the granular size failure to the engine", async () => {
    const paths = await fixture();
    await writeFile(paths.publicKey, Buffer.alloc(513));

    const result = await verifyCheckpointFiles(paths.envelope, paths.statement, paths.publicKey);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("input.public-key-size-invalid");
    expect(checkpointVerificationExitCode(result)).toBe(2);
  });

  it("rejects ambiguous or incomplete CLI arguments before reading files", async () => {
    await expect(runCheckpointVerificationCommand([])).rejects.toThrow("exactly three file paths");
    await expect(runCheckpointVerificationCommand(["envelope.json", "--statement", "key.der"]))
      .rejects.toThrow("exactly three file paths");
  });
});
