/// <reference types="node" />

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateCapabilityAdmission } from "./admission.js";
import {
  parseAdmissionReceipt,
  parseExactJcsReviewArtifactBytes,
  serializeAdmissionReceipt,
} from "./artifact-validate.js";
import { canonicalizeJcs, sha256Jcs } from "./canonical.js";
import { buildCapabilityDiff } from "./diff.js";
import {
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  PORTABLE_LIMITATIONS,
  SNAPSHOT_VERIFICATION_SCHEMA,
  type AdmissionReceiptV1,
  type SnapshotVerificationReceiptV1,
} from "./types.js";
import {
  RegistryValidationError,
  parseExactJcsCapabilitySnapshotBytes,
} from "./validate.js";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_REVIEW_BYTES = 320 * 1024;
const MAX_REVIEWER_SPKI_BYTES = 1_024;
const MIN_REVIEWER_SPKI_BYTES = 32;
const STABLE_CODE = /^[a-z0-9][a-z0-9.-]{0,127}$/;

export type OwnedRegularFile = Readonly<{
  bytes: Uint8Array;
  sha256: string;
}>;

export type OwnRegularFileOptions = Readonly<{
  maxBytes: number;
  minBytes?: number;
}>;

export class RegistryNodeError extends Error {
  readonly name = "RegistryNodeError";

  constructor(readonly code: string) {
    super(code);
  }
}

/** Owns one symlink-resistant regular file through a single open descriptor. */
export async function ownRegularFile(
  path: string,
  options: OwnRegularFileOptions,
): Promise<OwnedRegularFile> {
  if (
    typeof path !== "string" ||
    path.length < 1 ||
    path.length > 4_096 ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    !Number.isSafeInteger(options.minBytes ?? 1) ||
    (options.minBytes ?? 1) < 1 ||
    (options.minBytes ?? 1) > options.maxBytes
  ) {
    throw new RegistryNodeError("file.invocation-invalid");
  }
  let handle;
  try {
    handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    const minimum = options.minBytes ?? 1;
    if (!before.isFile() || before.size < minimum || before.size > options.maxBytes) {
      throw new RegistryNodeError("file.resource-invalid");
    }
    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) throw new RegistryNodeError("file.changed-during-read");
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new RegistryNodeError("file.changed-during-read");
    }
    return {
      bytes: new Uint8Array(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof RegistryNodeError) throw error;
    throw new RegistryNodeError("file.open-or-read-failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export type RegistryCliResult = Readonly<{
  exitCode: 0 | 1 | 2;
  stderr: string;
  stdout: string;
}>;

export type RegistryCliDependencies = Readonly<{
  evaluateCapabilityAdmission: typeof evaluateCapabilityAdmission;
}>;

const DEFAULT_DEPENDENCIES: RegistryCliDependencies = {
  evaluateCapabilityAdmission,
};

function stableError(code: string, fallback: string): string {
  return canonicalizeJcs({ error: STABLE_CODE.test(code) ? code : fallback });
}

function invalidResult(code: string, fallback: string): RegistryCliResult {
  return { exitCode: 1, stderr: stableError(code, fallback), stdout: "" };
}

function resourceResult(): RegistryCliResult {
  return {
    exitCode: 2,
    stderr: canonicalizeJcs({ error: "cli.invocation-or-io-failed" }),
    stdout: "",
  };
}

function snapshotVerificationReceipt(
  inputSha256: string,
  snapshotSha256: string | null,
  errorCode: string | null,
): SnapshotVerificationReceiptV1 {
  return {
    errors:
      errorCode === null
        ? []
        : [{ code: STABLE_CODE.test(errorCode) ? errorCode : "snapshot.invalid", pathSha256: null }],
    inputSha256,
    limitations: PORTABLE_LIMITATIONS,
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    schemaVersion: SNAPSHOT_VERIFICATION_SCHEMA,
    snapshotSha256,
    valid: errorCode === null,
  };
}

function positional(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !value.startsWith("--");
}

type AdmitArguments = Readonly<{
  baselinePath: string;
  candidatePath: string;
  evaluatedAtDeclared: string;
  policyPath: string;
  reviewKeyPath: string | null;
  reviewPath: string | null;
}>;

function parseAdmitArguments(args: readonly string[]): AdmitArguments | null {
  if (
    args.length < 6 ||
    args[0] !== "admit" ||
    !positional(args[1]) ||
    !positional(args[2]) ||
    !positional(args[3])
  ) {
    return null;
  }
  const options = new Map<string, string>();
  for (let index = 4; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      name === undefined ||
      value === undefined ||
      !["--evaluated-at", "--review", "--review-key"].includes(name) ||
      options.has(name) ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      return null;
    }
    options.set(name, value);
  }
  const evaluatedAtDeclared = options.get("--evaluated-at");
  const reviewPath = options.get("--review") ?? null;
  const reviewKeyPath = options.get("--review-key") ?? null;
  if (
    evaluatedAtDeclared === undefined ||
    ((reviewPath === null) !== (reviewKeyPath === null))
  ) {
    return null;
  }
  return {
    baselinePath: args[1],
    candidatePath: args[2],
    evaluatedAtDeclared,
    policyPath: args[3],
    reviewKeyPath,
    reviewPath,
  };
}

async function verifySnapshotCommand(path: string): Promise<RegistryCliResult> {
  const input = await ownRegularFile(path, {
    maxBytes: MAX_SNAPSHOT_BYTES,
    minBytes: 2,
  });
  try {
    const snapshot = parseExactJcsCapabilitySnapshotBytes(input.bytes);
    const receipt = snapshotVerificationReceipt(input.sha256, sha256Jcs(snapshot), null);
    return { exitCode: 0, stderr: "", stdout: canonicalizeJcs(receipt) };
  } catch (error) {
    if (!(error instanceof RegistryValidationError)) throw error;
    const receipt = snapshotVerificationReceipt(input.sha256, null, error.code);
    return { exitCode: 1, stderr: "", stdout: canonicalizeJcs(receipt) };
  }
}

async function diffCommand(
  baselinePath: string,
  candidatePath: string,
): Promise<RegistryCliResult> {
  const baselineFile = await ownRegularFile(baselinePath, {
    maxBytes: MAX_SNAPSHOT_BYTES,
    minBytes: 2,
  });
  const candidateFile = await ownRegularFile(candidatePath, {
    maxBytes: MAX_SNAPSHOT_BYTES,
    minBytes: 2,
  });
  const baseline = parseExactJcsCapabilitySnapshotBytes(baselineFile.bytes);
  const candidate = parseExactJcsCapabilitySnapshotBytes(candidateFile.bytes);
  const diff = buildCapabilityDiff(baseline, candidate);
  return { exitCode: 0, stderr: "", stdout: canonicalizeJcs(diff) };
}

async function admitCommand(
  args: AdmitArguments,
  dependencies: RegistryCliDependencies,
): Promise<RegistryCliResult> {
  const [baseline, candidate, policy] = await Promise.all([
    ownRegularFile(args.baselinePath, { maxBytes: MAX_SNAPSHOT_BYTES, minBytes: 2 }),
    ownRegularFile(args.candidatePath, { maxBytes: MAX_SNAPSHOT_BYTES, minBytes: 2 }),
    ownRegularFile(args.policyPath, { maxBytes: MAX_POLICY_BYTES, minBytes: 2 }),
  ]);
  let reviewArtifactBytes: Uint8Array | undefined;
  let reviewerSpki: Uint8Array | undefined;
  if (args.reviewPath !== null && args.reviewKeyPath !== null) {
    const [review, key] = await Promise.all([
      ownRegularFile(args.reviewPath, { maxBytes: MAX_REVIEW_BYTES, minBytes: 2 }),
      ownRegularFile(args.reviewKeyPath, {
        maxBytes: MAX_REVIEWER_SPKI_BYTES,
        minBytes: MIN_REVIEWER_SPKI_BYTES,
      }),
    ]);
    // Reject malformed/noncanonical review bytes before cryptographic evaluation.
    parseExactJcsReviewArtifactBytes(review.bytes);
    reviewArtifactBytes = review.bytes;
    reviewerSpki = key.bytes;
  }
  const receipt = await dependencies.evaluateCapabilityAdmission({
    baselineSnapshotBytes: baseline.bytes,
    candidateSnapshotBytes: candidate.bytes,
    evaluatedAtDeclared: args.evaluatedAtDeclared,
    policyBytes: policy.bytes,
    ...(reviewArtifactBytes === undefined
      ? {}
      : { reviewArtifactBytes, reviewerSpki: reviewerSpki as Uint8Array }),
  });
  const parsedReceipt: AdmissionReceiptV1 = parseAdmissionReceipt(receipt);
  return {
    exitCode:
      parsedReceipt.outcome === "admit" || parsedReceipt.outcome === "no-change" ? 0 : 1,
    stderr: "",
    stdout: serializeAdmissionReceipt(parsedReceipt),
  };
}

/** Executes one offline command without writing process streams or exiting. */
export async function runRegistryCli(
  args: readonly string[],
  dependencies: RegistryCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<RegistryCliResult> {
  try {
    if (args[0] === "verify-snapshot" && args.length === 2 && positional(args[1])) {
      return await verifySnapshotCommand(args[1]);
    }
    if (
      args[0] === "diff" &&
      args.length === 3 &&
      positional(args[1]) &&
      positional(args[2])
    ) {
      return await diffCommand(args[1], args[2]);
    }
    if (args[0] === "admit") {
      const parsed = parseAdmitArguments(args);
      if (parsed === null) return resourceResult();
      return await admitCommand(parsed, dependencies);
    }
    return resourceResult();
  } catch (error) {
    if (error instanceof RegistryValidationError) {
      if (error.code === "admission.evaluated-at-invalid") return resourceResult();
      return invalidResult(error.code, "artifact.invalid");
    }
    return resourceResult();
  }
}
