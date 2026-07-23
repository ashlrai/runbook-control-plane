import { describe, expect, it } from "vitest";
import {
  parseAdmissionPolicy,
  parseAdmissionReceipt,
  parseCapabilityDiff,
  parseExactJcsAdmissionPolicyBytes,
  parseExactJcsAdmissionReceiptBytes,
  parseExactJcsCapabilityDiffBytes,
  parseExactJcsReviewArtifactBytes,
  parseExactJcsReviewClaimsBytes,
  parseReviewArtifact,
  parseReviewClaims,
  serializeAdmissionPolicy,
  serializeAdmissionReceipt,
  serializeCapabilityDiff,
  serializeReviewArtifact,
  serializeReviewClaims,
} from "./artifact-validate.js";
import { canonicalizeJcs, sha256Jcs } from "./canonical.js";
import {
  ADMISSION_POLICY_SCHEMA,
  ADMISSION_RECEIPT_SCHEMA,
  CAPABILITY_DIFF_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  PORTABLE_LIMITATIONS,
  REVIEW_ARTIFACT_SCHEMA,
  REVIEW_CLAIMS_SCHEMA,
  type AdmissionPolicyV1,
  type AdmissionReceiptV1,
  type CapabilityDiffV1,
  type ReviewArtifactV1,
  type ReviewClaimsV1,
} from "./types.js";
import { RegistryValidationError } from "./validate.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const KEY_A = `sha256:${A}`;
const KEY_B = `sha256:${B}`;
const SIGNATURE = `${"A".repeat(86)}==`;

function policy(overrides: Partial<AdmissionPolicyV1> = {}): AdmissionPolicyV1 {
  return {
    allowedSourceAuthorities: ["public-documentation"],
    maximumCandidateAgeSeconds: 86_400,
    maximumFutureSkewSeconds: 300,
    maximumReviewValiditySeconds: 604_800,
    partialSourceOmissionDecision: "reject",
    policyId: "public-docs-default",
    productId: "trading-mcp",
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    providerId: "robinhood",
    requiredEvidenceSha256: [A],
    requireReviewForMaterialChanges: true,
    schemaVersion: ADMISSION_POLICY_SCHEMA,
    sourceSeriesId: "public-docs",
    trustedReviewerKeyIds: [KEY_A],
    unknownRiskDecision: "reject",
    ...overrides,
  };
}

function diff(overrides: Partial<CapabilityDiffV1> = {}): CapabilityDiffV1 {
  const withoutDigest = {
    baselineSnapshotSha256: A,
    blockedChangeSetSha256: B,
    candidateSnapshotSha256: C,
    changes: [
      {
        capabilityReferenceSha256: D,
        changeId: E,
        changedFields: ["capability-added"],
        currentCapabilitySha256: B,
        findingCodes: ["capability-added"],
        materiality: "material",
        previousCapabilitySha256: null,
      },
    ],
    limitations: PORTABLE_LIMITATIONS,
    materialChangeIds: [E],
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    schemaVersion: CAPABILITY_DIFF_SCHEMA,
    sourceChanges: [],
    sourceSetSha256: D,
  } as const;
  return { ...withoutDigest, diffSha256: sha256Jcs(withoutDigest), ...overrides };
}

function claims(overrides: Partial<ReviewClaimsV1> = {}): ReviewClaimsV1 {
  return {
    baselineSnapshotSha256: A,
    blockedChangeSetSha256: B,
    candidateSnapshotSha256: C,
    decisions: [{ changeId: E, decision: "approve", rationaleSha256: D }],
    diffSha256: D,
    expiresAt: "2026-07-28T00:00:00Z",
    issuedAt: "2026-07-22T00:00:00Z",
    nonceSha256: E,
    notBefore: "2026-07-22T00:00:00Z",
    policySha256: A,
    purpose: "registry-admission-only",
    requiredEvidenceSha256: [B],
    reviewId: "review-001",
    reviewerKeyId: KEY_A,
    schemaVersion: REVIEW_CLAIMS_SCHEMA,
    sourceSetSha256: C,
    ...overrides,
  };
}

function artifact(overrides: Partial<ReviewArtifactV1> = {}): ReviewArtifactV1 {
  return {
    algorithm: "ed25519",
    claims: claims(),
    schemaVersion: REVIEW_ARTIFACT_SCHEMA,
    signatureBase64: SIGNATURE,
    ...overrides,
  };
}

function receipt(overrides: Partial<AdmissionReceiptV1> = {}): AdmissionReceiptV1 {
  return {
    baselineSnapshotSha256: A,
    blockedChangeSetSha256: B,
    candidateSnapshotSha256: C,
    checks: [
      { code: "registry-lineage-valid", passed: true },
      { code: "review-binding-valid", passed: true },
    ],
    diffSha256: D,
    evaluatedAtDeclared: "2026-07-22T12:00:00Z",
    limitations: PORTABLE_LIMITATIONS,
    outcome: "admit",
    policySha256: E,
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    reviewArtifactSha256: A,
    reviewSignatureVerified: true,
    schemaVersion: ADMISSION_RECEIPT_SCHEMA,
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<RegistryValidationError>>({ code }),
  );
}

describe("closed registry artifact validators", () => {
  it("owns and canonically serializes every downstream artifact", () => {
    const values = [
      [policy(), parseAdmissionPolicy, serializeAdmissionPolicy],
      [diff(), parseCapabilityDiff, serializeCapabilityDiff],
      [claims(), parseReviewClaims, serializeReviewClaims],
      [artifact(), parseReviewArtifact, serializeReviewArtifact],
      [receipt(), parseAdmissionReceipt, serializeAdmissionReceipt],
    ] as const;
    for (const [value, parser, serializer] of values) {
      expect(parser(value)).toEqual(value);
      expect(parser(value)).not.toBe(value);
      expect(serializer(value)).toBe(canonicalizeJcs(value));
    }
  });

  it("closes policy identity, duration, authority, evidence, and reviewer sets", () => {
    expectCode(
      () => parseAdmissionPolicy(policy({ maximumCandidateAgeSeconds: 604_801 })),
      "policy.invalid",
    );
    expectCode(
      () => parseAdmissionPolicy(policy({ maximumFutureSkewSeconds: 604_801 })),
      "policy.invalid",
    );
    expectCode(
      () => parseAdmissionPolicy(policy({ maximumReviewValiditySeconds: 604_801 })),
      "policy.invalid",
    );
    expectCode(
      () =>
        parseAdmissionPolicy(
          policy({
            allowedSourceAuthorities: [
              "user-supplied-export",
              "public-documentation",
            ],
          }),
        ),
      "policy.invalid",
    );
    expectCode(
      () => parseAdmissionPolicy(policy({ requiredEvidenceSha256: [B, A] })),
      "policy.invalid",
    );
    expectCode(
      () => parseAdmissionPolicy(policy({ trustedReviewerKeyIds: [KEY_B, KEY_A] })),
      "policy.invalid",
    );
    expectCode(
      () => parseAdmissionPolicy({ ...policy(), providerId: "Robinhood" }),
      "policy.invalid",
    );
  });

  it("recomputes the diff self-digest and exact material-change set", () => {
    expectCode(
      () => parseCapabilityDiff(diff({ diffSha256: A })),
      "diff.invalid",
    );
    const base = diff();
    expectCode(
      () => parseCapabilityDiff({ ...base, materialChangeIds: [] }),
      "diff.invalid",
    );
    const secondChange = {
      ...base.changes[0]!,
      capabilityReferenceSha256: A,
      changeId: D,
    };
    expectCode(
      () =>
        parseCapabilityDiff({
          ...base,
          changes: [base.changes[0], secondChange],
          materialChangeIds: [E, D],
        }),
      "diff.invalid",
    );
  });

  it("bounds review decisions/evidence and enforces one sorted decision shape", () => {
    expectCode(
      () =>
        parseReviewClaims(
          claims({ expiresAt: "2026-07-29T00:00:01Z" }),
        ),
      "review.invalid",
    );
    expectCode(
      () =>
        parseReviewClaims(
          claims({
            decisions: [
              { changeId: E, decision: "approve", rationaleSha256: A },
              { changeId: E, decision: "deny", rationaleSha256: B },
            ],
          }),
        ),
      "review.invalid",
    );
    expectCode(
      () =>
        parseReviewClaims(
          claims({ requiredEvidenceSha256: Array.from({ length: 17 }, (_, i) => i.toString(16).padStart(64, "0")) }),
        ),
      "review.invalid",
    );
    expectCode(
      () => parseReviewClaims(claims({ reviewerKeyId: A })),
      "review.invalid",
    );
  });

  it("accepts only the Ed25519 marker and canonical 64-byte signature encoding", () => {
    expectCode(
      () => parseReviewArtifact({ ...artifact(), algorithm: "rsa" }),
      "review-artifact.invalid",
    );
    expectCode(
      () => parseReviewArtifact(artifact({ signatureBase64: `${"A".repeat(85)}B==` })),
      "review-artifact.invalid",
    );
    expectCode(
      () => parseReviewArtifact(artifact({ signatureBase64: "AA==" })),
      "review-artifact.invalid",
    );
  });

  it("binds admission outcome to ordered checks, review state, and no-change identity", () => {
    expectCode(
      () =>
        parseAdmissionReceipt(
          receipt({
            checks: [
              { code: "review-binding-valid", passed: true },
              { code: "registry-lineage-valid", passed: true },
            ],
          }),
        ),
      "admission-receipt.invalid",
    );
    expectCode(
      () => parseAdmissionReceipt(receipt({ outcome: "reject" })),
      "admission-receipt.invalid",
    );
    expectCode(
      () =>
        parseAdmissionReceipt(
          receipt({ reviewArtifactSha256: null, reviewSignatureVerified: true }),
        ),
      "admission-receipt.invalid",
    );
    expectCode(
      () => parseAdmissionReceipt(receipt({ outcome: "no-change" })),
      "admission-receipt.invalid",
    );
    expect(
      parseAdmissionReceipt(
        receipt({ candidateSnapshotSha256: A, outcome: "no-change" }),
      ).outcome,
    ).toBe("no-change");
  });
});

describe("exact-JCS downstream artifact entrypoints", () => {
  it("accepts exact canonical bytes for all five artifacts", () => {
    const cases = [
      [policy(), parseExactJcsAdmissionPolicyBytes],
      [diff(), parseExactJcsCapabilityDiffBytes],
      [claims(), parseExactJcsReviewClaimsBytes],
      [artifact(), parseExactJcsReviewArtifactBytes],
      [receipt(), parseExactJcsAdmissionReceiptBytes],
    ] as const;
    for (const [value, parser] of cases) {
      expect(parser(new TextEncoder().encode(canonicalizeJcs(value)))).toEqual(value);
    }
  });

  it("rejects duplicate keys, invalid UTF-8, noncanonical whitespace, and resource excess", () => {
    const jcs = canonicalizeJcs(policy());
    expectCode(
      () =>
        parseExactJcsAdmissionPolicyBytes(
          new TextEncoder().encode(jcs.replace('"policyId":', '"policyId":"x","policyId":')),
        ),
      "policy.bytes-duplicate-key",
    );
    expectCode(
      () => parseExactJcsAdmissionPolicyBytes(new Uint8Array([0xff, 0xfe])),
      "policy.bytes-invalid-utf8",
    );
    expectCode(
      () =>
        parseExactJcsAdmissionPolicyBytes(new TextEncoder().encode(`${jcs}\n`)),
      "policy.bytes-noncanonical",
    );
    expectCode(
      () => parseExactJcsAdmissionPolicyBytes(new Uint8Array(64 * 1024 + 1)),
      "policy.bytes-invalid",
    );
  });
});
