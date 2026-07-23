import {
  IndependentVerifierError,
  canonicalJcs,
  compareCodeUnits,
  parseExactJcs,
  sameBytes,
  sha256Bytes,
  sha256Jcs,
} from "./primitives.js";
import {
  PORTABLE_LIMITATIONS,
  PROFILE,
  type CapabilitySnapshot,
  parseSnapshotBytes,
} from "./schema.js";
import {
  type AdmissionBytesInput,
  type AdmissionReceipt,
  type CapabilityDiff,
  evaluateAdmissionBytes,
  recomputeCapabilityDiff,
  serializeAdmissionReceipt,
  serializeCapabilityDiff,
} from "./semantic.js";

export { IndependentVerifierError } from "./primitives.js";
export {
  PORTABLE_LIMITATIONS,
  PROFILE as FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  parseSnapshotBytes,
  type CapabilitySnapshot,
} from "./schema.js";
export {
  evaluateAdmissionBytes,
  recomputeCapabilityDiff,
  serializeAdmissionReceipt,
  serializeCapabilityDiff,
  type AdmissionBytesInput,
  type AdmissionReceipt,
  type CapabilityDiff,
} from "./semantic.js";

export const INDEPENDENT_VERIFICATION_SCHEMA =
  "runbook.financial-capability-independent-verification.v1" as const;

export const INDEPENDENT_VERIFICATION_LIMITATIONS = [
  ...PORTABLE_LIMITATIONS,
  "same-repository-independent-implementation-is-not-third-party-certification",
  "browser-runtime-and-webcrypto-are-not-independent-trust-anchors",
  "verification-recomputes-evidence-but-does-not-apply-or-mutate-a-registry-head",
] as const;

export type SnapshotVerificationResult = Readonly<{
  inputSha256: string;
  profileVersion: typeof PROFILE;
  snapshot: CapabilitySnapshot;
  snapshotSha256: string;
  valid: true;
}>;

/** Exact-byte snapshot verification; malformed artifacts throw a stable code. */
export function verifySnapshotBytes(bytes: Uint8Array): SnapshotVerificationResult {
  const snapshot = parseSnapshotBytes(bytes);
  return {
    inputSha256: sha256Bytes(bytes),
    profileVersion: PROFILE,
    snapshot,
    snapshotSha256: sha256Jcs(snapshot),
    valid: true,
  };
}

export type CapabilityRegistryBundleInput = AdmissionBytesInput & Readonly<{
  claimedAdmissionReceiptBytes?: Uint8Array;
  claimedDiffBytes?: Uint8Array;
}>;

export type IndependentVerificationReceipt = Readonly<{
  admissionOutcome: AdmissionReceipt["outcome"] | null;
  baselineSnapshotSha256: string;
  candidateSnapshotSha256: string;
  claimedAdmissionReceiptMatches: boolean | null;
  claimedAdmissionReceiptSha256: string | null;
  claimedDiffMatches: boolean | null;
  claimedDiffSha256: string | null;
  codes: readonly string[];
  limitations: typeof INDEPENDENT_VERIFICATION_LIMITATIONS;
  policySha256: string;
  profileVersion: typeof PROFILE;
  recomputedAdmissionReceiptSha256: string | null;
  recomputedDiffSha256: string | null;
  reviewArtifactSha256: string | null;
  reviewerSpkiSha256: string | null;
  schemaVersion: typeof INDEPENDENT_VERIFICATION_SCHEMA;
  recomputationComplete: boolean;
}>;

function optionalOwned(bytes: Uint8Array | undefined, code: string, maximum: number): Uint8Array | undefined {
  if (bytes === undefined) return undefined;
  parseExactJcs(bytes, maximum, code);
  return new Uint8Array(bytes);
}

function boundedOwned(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
  code: string,
): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < minimumBytes ||
    value.byteLength > maximumBytes) {
    throw new IndependentVerifierError(code);
  }
  return new Uint8Array(value);
}

/**
 * Recomputes snapshots, source-set, changes, influence paths, prerequisites,
 * blocked-set, policy, review, and admission authority. Claimed artifacts have
 * no authority: they pass only when their exact bytes equal the recomputation.
 */
export async function verifyCapabilityRegistryBundle(
  input: CapabilityRegistryBundleInput,
): Promise<IndependentVerificationReceipt> {
  // Own every caller buffer before the first asynchronous boundary. A caller
  // cannot change review or claimed-artifact authority while Web Crypto runs.
  const owned: CapabilityRegistryBundleInput = {
    baselineSnapshotBytes: boundedOwned(
      input.baselineSnapshotBytes,
      2,
      4 * 1024 * 1024,
      "snapshot.bytes-invalid",
    ),
    candidateSnapshotBytes: boundedOwned(
      input.candidateSnapshotBytes,
      2,
      4 * 1024 * 1024,
      "snapshot.bytes-invalid",
    ),
    evaluatedAtDeclared: input.evaluatedAtDeclared,
    policyBytes: boundedOwned(input.policyBytes, 2, 64 * 1024, "policy.bytes-invalid"),
    ...(input.reviewArtifactBytes === undefined
      ? {} : { reviewArtifactBytes: boundedOwned(
        input.reviewArtifactBytes,
        2,
        320 * 1024,
        "review-artifact.bytes-invalid",
      ) }),
    ...(input.reviewerSpkiBytes === undefined
      ? {} : { reviewerSpkiBytes: boundedOwned(
        input.reviewerSpkiBytes,
        32,
        1_024,
        "review-key-invalid",
      ) }),
    ...(input.claimedDiffBytes === undefined
      ? {} : { claimedDiffBytes: boundedOwned(
        input.claimedDiffBytes,
        2,
        2 * 1024 * 1024,
        "claimed-diff.bytes-invalid",
      ) }),
    ...(input.claimedAdmissionReceiptBytes === undefined
      ? {} : { claimedAdmissionReceiptBytes: boundedOwned(
        input.claimedAdmissionReceiptBytes,
        2,
        256 * 1024,
        "claimed-admission-receipt.bytes-invalid",
      ) }),
  };
  const baselineSnapshotSha256 = sha256Bytes(owned.baselineSnapshotBytes);
  const candidateSnapshotSha256 = sha256Bytes(owned.candidateSnapshotBytes);
  const policySha256 = sha256Bytes(owned.policyBytes);
  const reviewArtifactSha256 = owned.reviewArtifactBytes === undefined
    ? null : sha256Bytes(owned.reviewArtifactBytes);
  const reviewerSpkiSha256 = owned.reviewerSpkiBytes === undefined
    ? null : sha256Bytes(owned.reviewerSpkiBytes);
  const claimedDiffSha256 = owned.claimedDiffBytes === undefined
    ? null : sha256Bytes(owned.claimedDiffBytes);
  const claimedAdmissionReceiptSha256 = owned.claimedAdmissionReceiptBytes === undefined
    ? null : sha256Bytes(owned.claimedAdmissionReceiptBytes);
  const codes: string[] = [];
  let admission: AdmissionReceipt | null = null;
  let diff: CapabilityDiff | null = null;
  let claimedDiffMatches: boolean | null = null;
  let claimedAdmissionReceiptMatches: boolean | null = null;
  try {
    // Admission is the primary public result. A valid but rejected lineage has
    // an exact rejection receipt even though no semantic diff can be built.
    admission = await evaluateAdmissionBytes(owned);
    codes.push(...admission.checks.filter((check) => !check.passed).map((check) => check.code));
  } catch (error) {
    codes.push(error instanceof IndependentVerifierError ? error.code : "verifier.environment-failure");
  }
  if (admission !== null && owned.claimedAdmissionReceiptBytes !== undefined) {
    try {
      const claimed = optionalOwned(
        owned.claimedAdmissionReceiptBytes,
        "claimed-admission-receipt",
        256 * 1024,
      );
      claimedAdmissionReceiptMatches = claimed !== undefined &&
        sameBytes(claimed, serializeAdmissionReceipt(admission));
      codes.push(claimedAdmissionReceiptMatches
        ? "claimed-admission-receipt-match"
        : "claimed-admission-receipt-mismatch");
    } catch (error) {
      claimedAdmissionReceiptMatches = false;
      codes.push(error instanceof IndependentVerifierError
        ? error.code : "verifier.environment-failure");
    }
  }
  if (admission !== null) {
    const baseline = parseSnapshotBytes(owned.baselineSnapshotBytes);
    const candidate = parseSnapshotBytes(owned.candidateSnapshotBytes);
    if (!sameBytes(owned.baselineSnapshotBytes, owned.candidateSnapshotBytes)) {
      try {
        diff = recomputeCapabilityDiff(baseline, candidate);
        codes.push(...diff.changes.flatMap((change) => change.findingCodes));
        codes.push(...diff.sourceChanges.flatMap((change) => change.findingCodes));
      } catch (error) {
        codes.push(error instanceof IndependentVerifierError ? error.code : "verifier.environment-failure");
      }
      if (owned.claimedDiffBytes !== undefined && diff !== null) {
        try {
          const claimed = optionalOwned(owned.claimedDiffBytes, "claimed-diff", 2 * 1024 * 1024);
          claimedDiffMatches = claimed !== undefined && sameBytes(claimed, serializeCapabilityDiff(diff));
          codes.push(claimedDiffMatches ? "claimed-diff-match" : "claimed-diff-mismatch");
        } catch (error) {
          claimedDiffMatches = false;
          codes.push(error instanceof IndependentVerifierError
            ? error.code : "verifier.environment-failure");
        }
      } else if (owned.claimedDiffBytes !== undefined) {
        claimedDiffMatches = false;
        try {
          optionalOwned(owned.claimedDiffBytes, "claimed-diff", 2 * 1024 * 1024);
          codes.push("claimed-diff-unavailable");
        } catch (error) {
          codes.push(error instanceof IndependentVerifierError
            ? error.code : "verifier.environment-failure");
        }
      }
    } else if (owned.claimedDiffBytes !== undefined) {
      claimedDiffMatches = false;
      try {
        optionalOwned(owned.claimedDiffBytes, "claimed-diff", 2 * 1024 * 1024);
        codes.push("claimed-diff-unexpected-for-no-change");
      } catch (error) {
        codes.push(error instanceof IndependentVerifierError
          ? error.code : "verifier.environment-failure");
      }
    }
  }
  const suppliedClaimsMatch =
    (claimedDiffMatches === null || claimedDiffMatches) &&
    (claimedAdmissionReceiptMatches === null || claimedAdmissionReceiptMatches);
  const recomputationComplete = admission !== null && suppliedClaimsMatch;
  return {
    admissionOutcome: admission?.outcome ?? null,
    baselineSnapshotSha256,
    candidateSnapshotSha256,
    claimedAdmissionReceiptMatches,
    claimedAdmissionReceiptSha256,
    claimedDiffMatches,
    claimedDiffSha256,
    codes: [...new Set(codes)].sort(compareCodeUnits),
    limitations: INDEPENDENT_VERIFICATION_LIMITATIONS,
    policySha256,
    profileVersion: PROFILE,
    recomputedAdmissionReceiptSha256: admission === null
      ? null : sha256Bytes(serializeAdmissionReceipt(admission)),
    recomputedDiffSha256: diff?.diffSha256 ?? null,
    reviewArtifactSha256,
    reviewerSpkiSha256,
    schemaVersion: INDEPENDENT_VERIFICATION_SCHEMA,
    recomputationComplete,
  };
}

export function serializeIndependentVerificationReceipt(
  receipt: IndependentVerificationReceipt,
): Uint8Array {
  return new TextEncoder().encode(canonicalJcs(receipt));
}
