import {
  parseAdmissionPolicy,
  parseExactJcsAdmissionPolicyBytes,
  parseExactJcsReviewArtifactBytes,
} from "./artifact-validate.js";
import { rawStringCompare, sha256Jcs } from "./canonical.js";
import { buildCapabilityDiff } from "./diff.js";
import { verifyReviewArtifactSignature } from "./review.js";
import {
  ADMISSION_RECEIPT_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  PORTABLE_LIMITATIONS,
  type AdmissionCheckV1,
  type AdmissionPolicyV1,
  type AdmissionReceiptV1,
  type CapabilityDiffV1,
  type CapabilitySnapshotV1,
  type ReviewArtifactV1,
} from "./types.js";
import {
  RegistryValidationError,
  parseExactJcsCapabilitySnapshotBytes,
} from "./validate.js";

const EMPTY_BLOCKED_SET_DOMAIN =
  "runbook.financial-capability-blocked-change-set.v1";
const NO_CHANGE_DIFF_DOMAIN =
  "runbook.financial-capability-no-change-diff.v1";
const REJECTED_LINEAGE_DOMAIN =
  "runbook.financial-capability-rejected-lineage.v1";

export type CapabilityAdmissionInputV1 = Readonly<{
  baselineSnapshotBytes: Uint8Array;
  candidateSnapshotBytes: Uint8Array;
  evaluatedAtDeclared: string;
  policyBytes: Uint8Array;
  reviewerSpki?: Uint8Array;
  reviewArtifactBytes?: Uint8Array;
}>;

const compare = (left: string, right: string): number =>
  rawStringCompare(left, right);

function utcMilliseconds(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(
    value,
  );
  if (match === null || match[1] === "0000") {
    throw new RegistryValidationError("admission.evaluated-at-invalid");
  }
  const milliseconds = Date.parse(value);
  const normalized = match[7] === undefined ? value.replace("Z", ".000Z") : value;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new RegistryValidationError("admission.evaluated-at-invalid");
  }
  return milliseconds;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function check(code: string, passed: boolean): AdmissionCheckV1 {
  return { code, passed };
}

function failureChecks(codes: readonly string[]): AdmissionCheckV1[] {
  return [...new Set(codes)].map((code) => check(code, false));
}

function candidateTimeFailureCodes(
  policy: AdmissionPolicyV1,
  snapshot: CapabilitySnapshotV1,
  evaluatedMilliseconds: number,
): string[] {
  const declaredTimes = [
    Date.parse(snapshot.observedAtDeclared),
    ...snapshot.sources.map((source) => Date.parse(source.retrievedAtDeclared)),
  ];
  const codes: string[] = [];
  if (declaredTimes.some((declared) =>
    declared - evaluatedMilliseconds > policy.maximumFutureSkewSeconds * 1_000)) {
    codes.push("snapshot-time-future");
  }
  if (declaredTimes.some((declared) =>
    evaluatedMilliseconds - declared > policy.maximumCandidateAgeSeconds * 1_000)) {
    codes.push("snapshot-stale");
  }
  return codes;
}

function lineageFailureCodes(
  baseline: CapabilitySnapshotV1,
  candidate: CapabilitySnapshotV1,
  baselineSnapshotSha256: string,
): string[] {
  const codes: string[] = [];
  if (baseline.providerId !== candidate.providerId) codes.push("registry-provider-mismatch");
  if (baseline.productId !== candidate.productId) codes.push("registry-product-mismatch");
  if (baseline.profileVersion !== candidate.profileVersion) codes.push("registry-profile-mismatch");
  if (baseline.sourceSeriesId !== candidate.sourceSeriesId) {
    codes.push("registry-source-series-mismatch");
  }
  if (candidate.previousAdmittedSnapshotSha256 !== baselineSnapshotSha256) {
    codes.push("registry-baseline-mismatch");
  }
  if (candidate.registryRevision !== baseline.registryRevision + 1) {
    codes.push("registry-revision-invalid");
  }
  if (Date.parse(candidate.observedAtDeclared) < Date.parse(baseline.observedAtDeclared)) {
    codes.push("snapshot-time-regressed");
  }
  const baselineSources = new Map(
    baseline.sources.map((source) => [source.sourceId, source]),
  );
  if (candidate.sources.some((source) => {
    const previous = baselineSources.get(source.sourceId);
    return previous !== undefined &&
      Date.parse(source.retrievedAtDeclared) < Date.parse(previous.retrievedAtDeclared);
  })) {
    codes.push("snapshot-time-regressed");
  }
  return codes;
}

function policyMatchesSnapshot(
  policy: AdmissionPolicyV1,
  snapshot: CapabilitySnapshotV1,
): boolean {
  return (
    policy.profileVersion === snapshot.profileVersion &&
    policy.productId === snapshot.productId &&
    policy.providerId === snapshot.providerId &&
    policy.sourceSeriesId === snapshot.sourceSeriesId
  );
}

function sourceAuthoritiesAllowed(
  policy: AdmissionPolicyV1,
  snapshot: CapabilitySnapshotV1,
): boolean {
  const allowed = new Set(policy.allowedSourceAuthorities);
  return snapshot.sources.every((source) => allowed.has(source.authority));
}

function candidateTimeAllowed(
  policy: AdmissionPolicyV1,
  snapshot: CapabilitySnapshotV1,
  evaluatedMilliseconds: number,
): boolean {
  const observed = Date.parse(snapshot.observedAtDeclared);
  return [observed, ...snapshot.sources.map((source) =>
    Date.parse(source.retrievedAtDeclared))].every((declared) =>
    declared - evaluatedMilliseconds <= policy.maximumFutureSkewSeconds * 1_000 &&
    evaluatedMilliseconds - declared <= policy.maximumCandidateAgeSeconds * 1_000
  );
}

function emptyBlockedSetSha256(): string {
  return sha256Jcs({
    domain: EMPTY_BLOCKED_SET_DOMAIN,
    materialChangeIds: [],
  });
}

function rejectedLineageDigests(
  baselineSnapshotSha256: string,
  candidateSnapshotSha256: string,
): Readonly<{ blockedChangeSetSha256: string; diffSha256: string }> {
  const evidence = {
    baselineSnapshotSha256,
    candidateSnapshotSha256,
    domain: REJECTED_LINEAGE_DOMAIN,
  };
  return {
    blockedChangeSetSha256: sha256Jcs({ ...evidence, kind: "blocked-change-set" }),
    diffSha256: sha256Jcs({ ...evidence, kind: "diff" }),
  };
}

function receipt(
  baselineSnapshotSha256: string,
  blockedChangeSetSha256: string,
  candidateSnapshotSha256: string,
  checks: readonly AdmissionCheckV1[],
  diffSha256: string,
  evaluatedAtDeclared: string,
  outcome: AdmissionReceiptV1["outcome"],
  policySha256: string,
  reviewArtifactSha256: string | null,
  reviewSignatureVerified: boolean,
): AdmissionReceiptV1 {
  return {
    baselineSnapshotSha256,
    blockedChangeSetSha256,
    candidateSnapshotSha256,
    checks: [...checks].sort((left, right) => compare(left.code, right.code)),
    diffSha256,
    evaluatedAtDeclared,
    limitations: PORTABLE_LIMITATIONS,
    outcome,
    policySha256,
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    reviewArtifactSha256,
    reviewSignatureVerified,
    schemaVersion: ADMISSION_RECEIPT_SCHEMA,
  };
}

function reviewBindingsMatch(
  review: ReviewArtifactV1,
  diff: CapabilityDiffV1,
  policySha256: string,
): boolean {
  const claims = review.claims;
  return (
    claims.baselineSnapshotSha256 === diff.baselineSnapshotSha256 &&
    claims.blockedChangeSetSha256 === diff.blockedChangeSetSha256 &&
    claims.candidateSnapshotSha256 === diff.candidateSnapshotSha256 &&
    claims.diffSha256 === diff.diffSha256 &&
    claims.policySha256 === policySha256 &&
    claims.sourceSetSha256 === diff.sourceSetSha256
  );
}

function exactReviewDecisions(review: ReviewArtifactV1, diff: CapabilityDiffV1): boolean {
  return sameStrings(
    review.claims.decisions.map((decision) => decision.changeId),
    diff.materialChangeIds,
  );
}

/**
 * Evaluates one exact candidate without mutating a durable registry head. All
 * time is caller-declared and every artifact is strict, canonical JCS.
 */
export async function evaluateCapabilityAdmission(
  input: CapabilityAdmissionInputV1,
): Promise<AdmissionReceiptV1> {
  const evaluatedMilliseconds = utcMilliseconds(input.evaluatedAtDeclared);
  const baseline = parseExactJcsCapabilitySnapshotBytes(input.baselineSnapshotBytes);
  const candidate = parseExactJcsCapabilitySnapshotBytes(input.candidateSnapshotBytes);
  const policy = parseExactJcsAdmissionPolicyBytes(input.policyBytes);
  // Re-own the policy even when a future byte parser implementation changes.
  parseAdmissionPolicy(policy);

  const baselineSnapshotSha256 = sha256Jcs(baseline);
  const candidateSnapshotSha256 = sha256Jcs(candidate);
  const policySha256 = sha256Jcs(policy);
  const policyIdentityValid =
    policyMatchesSnapshot(policy, baseline) && policyMatchesSnapshot(policy, candidate);
  const sourceAuthorityValid =
    sourceAuthoritiesAllowed(policy, baseline) && sourceAuthoritiesAllowed(policy, candidate);
  const candidateTimeValid = candidateTimeAllowed(
    policy,
    candidate,
    evaluatedMilliseconds,
  );

  if (sameBytes(input.baselineSnapshotBytes, input.candidateSnapshotBytes)) {
    const checks = [
      check("candidate-time-valid", candidateTimeValid),
      check("no-change-exact", true),
      check("policy-identity-valid", policyIdentityValid),
      check("source-authority-valid", sourceAuthorityValid),
      ...failureChecks([
        ...candidateTimeFailureCodes(policy, candidate, evaluatedMilliseconds),
        ...(sourceAuthorityValid ? [] : ["source-authority-untrusted"]),
      ]),
    ];
    const allPassed = checks.every((entry) => entry.passed);
    return receipt(
      baselineSnapshotSha256,
      emptyBlockedSetSha256(),
      candidateSnapshotSha256,
      checks,
      sha256Jcs({
        baselineSnapshotSha256,
        candidateSnapshotSha256,
        domain: NO_CHANGE_DIFF_DOMAIN,
      }),
      input.evaluatedAtDeclared,
      allPassed ? "no-change" : "reject",
      policySha256,
      null,
      false,
    );
  }

  const lineageValid =
    baseline.providerId === candidate.providerId &&
    baseline.productId === candidate.productId &&
    baseline.profileVersion === candidate.profileVersion &&
    baseline.sourceSeriesId === candidate.sourceSeriesId &&
    candidate.previousAdmittedSnapshotSha256 === baselineSnapshotSha256 &&
    candidate.registryRevision === baseline.registryRevision + 1 &&
    Date.parse(candidate.observedAtDeclared) >= Date.parse(baseline.observedAtDeclared) &&
    candidate.sources.every((source) => {
      const previous = baseline.sources.find((entry) => entry.sourceId === source.sourceId);
      return previous === undefined ||
        Date.parse(source.retrievedAtDeclared) >= Date.parse(previous.retrievedAtDeclared);
    });

  if (!lineageValid || !policyIdentityValid || !sourceAuthorityValid || !candidateTimeValid) {
    const checks = [
      check("candidate-time-valid", candidateTimeValid),
      check("lineage-valid", lineageValid),
      check("policy-identity-valid", policyIdentityValid),
      check("source-authority-valid", sourceAuthorityValid),
      ...failureChecks([
        ...lineageFailureCodes(baseline, candidate, baselineSnapshotSha256),
        ...candidateTimeFailureCodes(policy, candidate, evaluatedMilliseconds),
        ...(sourceAuthorityValid ? [] : ["source-authority-untrusted"]),
      ]),
    ];
    const rejected = rejectedLineageDigests(
      baselineSnapshotSha256,
      candidateSnapshotSha256,
    );
    return receipt(
      baselineSnapshotSha256,
      rejected.blockedChangeSetSha256,
      candidateSnapshotSha256,
      checks,
      rejected.diffSha256,
      input.evaluatedAtDeclared,
      "reject",
      policySha256,
      null,
      false,
    );
  }

  const diff = buildCapabilityDiff(baseline, candidate);
  const partialSourceOmission = diff.changes.some((change) =>
    change.findingCodes.includes("source-completeness-insufficient"),
  );
  const unknownRisk = diff.changes.some((change) =>
    change.findingCodes.includes("capability-unknown-risk-semantics"),
  );
  const materialChangesPresent = diff.materialChangeIds.length > 0;
  const baseChecks = [
    check("candidate-time-valid", true),
    check("lineage-valid", true),
    check("partial-source-omission-absent", !partialSourceOmission),
    check("policy-identity-valid", true),
    check("source-authority-valid", true),
    check("unknown-risk-absent", !unknownRisk),
    ...failureChecks([
      ...(partialSourceOmission ? ["source-completeness-insufficient"] : []),
      ...(unknownRisk ? ["capability-unknown-risk-semantics"] : []),
    ]),
  ];

  if (partialSourceOmission || unknownRisk) {
    return receipt(
      diff.baselineSnapshotSha256,
      diff.blockedChangeSetSha256,
      diff.candidateSnapshotSha256,
      baseChecks,
      diff.diffSha256,
      input.evaluatedAtDeclared,
      "reject",
      policySha256,
      null,
      false,
    );
  }

  if (!materialChangesPresent) {
    return receipt(
      diff.baselineSnapshotSha256,
      diff.blockedChangeSetSha256,
      diff.candidateSnapshotSha256,
      [...baseChecks, check("material-review-satisfied", true)],
      diff.diffSha256,
      input.evaluatedAtDeclared,
      "admit",
      policySha256,
      null,
      false,
    );
  }

  if (input.reviewArtifactBytes === undefined || input.reviewerSpki === undefined) {
    return receipt(
      diff.baselineSnapshotSha256,
      diff.blockedChangeSetSha256,
      diff.candidateSnapshotSha256,
      [
        ...baseChecks,
        check("material-review-satisfied", false),
        check("review-required", false),
      ],
      diff.diffSha256,
      input.evaluatedAtDeclared,
      "quarantine",
      policySha256,
      null,
      false,
    );
  }

  const review = parseExactJcsReviewArtifactBytes(input.reviewArtifactBytes);
  const reviewArtifactSha256 = sha256Jcs(review);
  const verification = await verifyReviewArtifactSignature(review, input.reviewerSpki);
  const claims = review.claims;
  const bindingsValid = reviewBindingsMatch(review, diff, policySha256);
  const reviewerTrusted =
    verification.reviewerKeyId !== null &&
    policy.trustedReviewerKeyIds.includes(verification.reviewerKeyId);
  const decisionsExact = exactReviewDecisions(review, diff);
  const decisionsApprove = review.claims.decisions.every(
    (decision) => decision.decision === "approve",
  );
  const evidenceExact = sameStrings(
    claims.requiredEvidenceSha256,
    policy.requiredEvidenceSha256,
  );
  const issued = Date.parse(claims.issuedAt);
  const notBefore = Date.parse(claims.notBefore);
  const expires = Date.parse(claims.expiresAt);
  const reviewTimeValid =
    evaluatedMilliseconds >= notBefore &&
    evaluatedMilliseconds < expires &&
    expires - issued <= policy.maximumReviewValiditySeconds * 1_000;
  const reviewChecks = [
    ...baseChecks,
    check("review-bindings-valid", bindingsValid),
    check("review-decisions-approve", decisionsApprove),
    check("review-decisions-exact", decisionsExact),
    check("review-evidence-exact", evidenceExact),
    check("review-signature-valid", verification.valid),
    check("review-time-valid", reviewTimeValid),
    check("reviewer-trusted", reviewerTrusted),
    ...failureChecks([
      ...(bindingsValid ? [] : ["review-binding-mismatch"]),
      ...(decisionsApprove ? [] : ["review-denied"]),
      ...(decisionsExact ? [] : ["review-change-uncovered"]),
      ...(evidenceExact
        ? []
        : policy.requiredEvidenceSha256.some((digest) =>
            !claims.requiredEvidenceSha256.includes(digest))
          ? ["review-evidence-missing"]
          : ["review-evidence-mismatch"]),
      ...(verification.valid ? [] : ["review-signature-invalid"]),
      ...(evaluatedMilliseconds < notBefore ? ["review-not-yet-valid"] : []),
      ...(evaluatedMilliseconds >= expires ||
        expires - issued > policy.maximumReviewValiditySeconds * 1_000
        ? ["review-expired"]
        : []),
      ...(reviewerTrusted ? [] : ["review-authority-untrusted"]),
    ]),
  ];
  const allReviewChecksPassed = reviewChecks.every((entry) => entry.passed);
  const bindingFailure =
    !bindingsValid ||
    !decisionsExact ||
    !evidenceExact ||
    !verification.valid ||
    !reviewTimeValid ||
    !reviewerTrusted;

  return receipt(
    diff.baselineSnapshotSha256,
    diff.blockedChangeSetSha256,
    diff.candidateSnapshotSha256,
    reviewChecks,
    diff.diffSha256,
    input.evaluatedAtDeclared,
    allReviewChecksPassed ? "admit" : bindingFailure ? "reject" : "quarantine",
    policySha256,
    reviewArtifactSha256,
    verification.valid,
  );
}
