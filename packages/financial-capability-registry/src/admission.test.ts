import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateCapabilityAdmission } from "./admission.js";
import { canonicalizeJcs, sha256Jcs } from "./canonical.js";
import { buildCapabilityDiff } from "./diff.js";
import { reviewerKeyIdFromSpki, reviewSigningBytes } from "./review.js";
import {
  ADMISSION_POLICY_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  REVIEW_ARTIFACT_SCHEMA,
  REVIEW_CLAIMS_SCHEMA,
  type AdmissionPolicyV1,
  type CapabilitySnapshotV1,
  type ReviewArtifactV1,
  type ReviewClaimsV1,
} from "./types.js";
import { parseExactJcsCapabilitySnapshotBytes } from "./validate.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/robinhood/", import.meta.url));
const baselineBytes = readFileSync(`${FIXTURE_DIR}/trading-45-snapshot.jcs`);
const candidateBytes = readFileSync(`${FIXTURE_DIR}/trading-50-snapshot.jcs`);
const evidence = "e".repeat(64);

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJcs(value));
}

function policy(reviewerKeyIds: readonly string[] = []): AdmissionPolicyV1 {
  return {
    allowedSourceAuthorities: ["public-documentation"],
    maximumCandidateAgeSeconds: 86_400,
    maximumFutureSkewSeconds: 60,
    maximumReviewValiditySeconds: 86_400,
    partialSourceOmissionDecision: "reject",
    policyId: "robinhood-docs-v1",
    productId: "robinhood-trading-mcp",
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    providerId: "robinhood",
    requiredEvidenceSha256: [evidence],
    requireReviewForMaterialChanges: true,
    schemaVersion: ADMISSION_POLICY_SCHEMA,
    sourceSeriesId: "robinhood-trading-public-documentation",
    trustedReviewerKeyIds: reviewerKeyIds,
    unknownRiskDecision: "reject",
  };
}

async function trustedPolicyAndReview(decision: "approve" | "deny" = "approve") {
  const keys = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const reviewerKeyId = await reviewerKeyIdFromSpki(spki);
  const admissionPolicy = policy([reviewerKeyId]);
  const baseline = parseExactJcsCapabilitySnapshotBytes(baselineBytes);
  const candidate = parseExactJcsCapabilitySnapshotBytes(candidateBytes);
  const diff = buildCapabilityDiff(baseline, candidate);
  const claims: ReviewClaimsV1 = {
    baselineSnapshotSha256: diff.baselineSnapshotSha256,
    blockedChangeSetSha256: diff.blockedChangeSetSha256,
    candidateSnapshotSha256: diff.candidateSnapshotSha256,
    decisions: diff.materialChangeIds.map((changeId) => ({
      changeId,
      decision,
      rationaleSha256: "a".repeat(64),
    })),
    diffSha256: diff.diffSha256,
    expiresAt: "2026-07-22T12:00:00Z",
    issuedAt: "2026-07-22T08:00:00Z",
    nonceSha256: "b".repeat(64),
    notBefore: "2026-07-22T08:00:00Z",
    policySha256: sha256Jcs(admissionPolicy),
    purpose: "registry-admission-only",
    requiredEvidenceSha256: [evidence],
    reviewId: "review-robinhood-45-to-50",
    reviewerKeyId,
    schemaVersion: REVIEW_CLAIMS_SCHEMA,
    sourceSetSha256: diff.sourceSetSha256,
  };
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    keys.privateKey,
    reviewSigningBytes(claims),
  ));
  const artifact: ReviewArtifactV1 = {
    algorithm: "ed25519",
    claims,
    schemaVersion: REVIEW_ARTIFACT_SCHEMA,
    signatureBase64: btoa(String.fromCharCode(...signature)),
  };
  return { admissionPolicy, artifact, spki };
}

describe("fail-closed capability admission", () => {
  it("quarantines the exact five public-documentation additions without review", async () => {
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: candidateBytes,
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(policy()),
    });
    expect(result.outcome).toBe("quarantine");
    expect(result.checks).toContainEqual({ code: "material-review-satisfied", passed: false });
    expect(result.checks).toContainEqual({ code: "review-required", passed: false });
  });

  it("admits only an exact, trusted, in-window signature over every change", async () => {
    const { admissionPolicy, artifact, spki } = await trustedPolicyAndReview();
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: candidateBytes,
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(admissionPolicy),
      reviewArtifactBytes: bytes(artifact),
      reviewerSpki: spki,
    });
    expect(result.outcome).toBe("admit");
    expect(result.reviewSignatureVerified).toBe(true);
    expect(result.checks.every((entry) => entry.passed)).toBe(true);
  });

  it("quarantines an authentic explicit denial", async () => {
    const { admissionPolicy, artifact, spki } = await trustedPolicyAndReview("deny");
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: candidateBytes,
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(admissionPolicy),
      reviewArtifactBytes: bytes(artifact),
      reviewerSpki: spki,
    });
    expect(result.outcome).toBe("quarantine");
    expect(result.checks).toContainEqual({ code: "review-decisions-approve", passed: false });
    expect(result.checks).toContainEqual({ code: "review-denied", passed: false });
  });

  it("rejects an exact review bound to a different policy", async () => {
    const { admissionPolicy, artifact, spki } = await trustedPolicyAndReview();
    const changedPolicy = { ...admissionPolicy, policyId: "different-policy" };
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: candidateBytes,
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(changedPolicy),
      reviewArtifactBytes: bytes(artifact),
      reviewerSpki: spki,
    });
    expect(result.outcome).toBe("reject");
    expect(result.checks).toContainEqual({ code: "review-bindings-valid", passed: false });
    expect(result.checks).toContainEqual({ code: "review-binding-mismatch", passed: false });
  });

  it("rejects stale lineage before a review can override it", async () => {
    const candidate = parseExactJcsCapabilitySnapshotBytes(candidateBytes);
    const stale: CapabilitySnapshotV1 = {
      ...candidate,
      previousAdmittedSnapshotSha256: "0".repeat(64),
    };
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: bytes(stale),
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(policy()),
    });
    expect(result.outcome).toBe("reject");
    expect(result.checks).toContainEqual({ code: "lineage-valid", passed: false });
    expect(result.checks).toContainEqual({ code: "registry-baseline-mismatch", passed: false });
  });

  it("rejects newly introduced unknown risk semantics", async () => {
    const candidate = parseExactJcsCapabilitySnapshotBytes(candidateBytes);
    const last = candidate.capabilities.at(-1);
    if (last === undefined) throw new Error("missing test capability");
    const hostile: CapabilitySnapshotV1 = {
      ...candidate,
      capabilities: [
        ...candidate.capabilities.slice(0, -1),
        { ...last, accountScope: "unknown" },
      ],
    };
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: bytes(hostile),
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(policy()),
    });
    expect(result.outcome).toBe("reject");
    expect(result.checks).toContainEqual({ code: "unknown-risk-absent", passed: false });
    expect(result.checks).toContainEqual({
      code: "capability-unknown-risk-semantics",
      passed: false,
    });
  });

  it("quarantines a partial candidate with additions but no omission", async () => {
    const candidate = parseExactJcsCapabilitySnapshotBytes(candidateBytes);
    const partial: CapabilitySnapshotV1 = {
      ...candidate,
      sources: candidate.sources.map((source) => ({
        ...source,
        completeness: "partial-enumeration",
      })),
    };
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: bytes(partial),
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(policy()),
    });
    expect(result.outcome).toBe("quarantine");
    expect(result.checks).toContainEqual({
      code: "material-review-satisfied",
      passed: false,
    });
  });

  it("quarantines unexplained source projection drift without a review", async () => {
    const baseline = parseExactJcsCapabilitySnapshotBytes(baselineBytes);
    const sourceOnly: CapabilitySnapshotV1 = {
      ...baseline,
      observedAtDeclared: "2026-07-22T08:00:00Z",
      previousAdmittedSnapshotSha256: sha256Jcs(baseline),
      registryRevision: 2,
      sources: baseline.sources.map((source) => ({
        ...source,
        retrievedAtDeclared: "2026-07-22T08:00:00Z",
        sourceProjectionSha256: "f".repeat(64),
      })),
    };
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: bytes(sourceOnly),
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(policy()),
    });
    expect(result.outcome).toBe("quarantine");
    expect(result.checks).toContainEqual({
      code: "material-review-satisfied",
      passed: false,
    });
  });

  it("rejects a fresh observation label over stale source retrieval", async () => {
    const candidate = parseExactJcsCapabilitySnapshotBytes(candidateBytes);
    const relabeled: CapabilitySnapshotV1 = {
      ...candidate,
      observedAtDeclared: "2026-07-22T09:00:00Z",
    };
    const strictPolicy = {
      ...policy(),
      maximumCandidateAgeSeconds: 60,
    };
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: bytes(relabeled),
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(strictPolicy),
    });
    expect(result.outcome).toBe("reject");
    expect(result.checks).toContainEqual({ code: "candidate-time-valid", passed: false });
    expect(result.checks).toContainEqual({ code: "snapshot-stale", passed: false });
  });

  it("emits no-change only for byte-identical snapshots under a matching policy", async () => {
    const result = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: baselineBytes,
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes: bytes(policy()),
    });
    expect(result.outcome).toBe("no-change");
    expect(result.baselineSnapshotSha256).toBe(result.candidateSnapshotSha256);
  });
});
