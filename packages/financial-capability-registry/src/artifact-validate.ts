import { canonicalizeJcs, rawStringCompare, sha256Jcs } from "./canonical.js";
import { StrictJsonError, parseStrictJson } from "./strict-json.js";
import {
  ADMISSION_POLICY_SCHEMA,
  ADMISSION_RECEIPT_SCHEMA,
  CAPABILITY_DIFF_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  PORTABLE_LIMITATIONS,
  REVIEW_ARTIFACT_SCHEMA,
  REVIEW_CLAIMS_SCHEMA,
  SOURCE_AUTHORITIES,
  type AdmissionCheckV1,
  type AdmissionPolicyV1,
  type AdmissionReceiptV1,
  type CapabilityChangeEvidenceV1,
  type CapabilityChangedFieldV1,
  type CapabilityDiffV1,
  type ReviewArtifactV1,
  type ReviewChangeDecisionV1,
  type ReviewClaimsV1,
  type SourceChangedFieldV1,
  type SourceChangeEvidenceV1,
} from "./types.js";
import { RegistryValidationError } from "./validate.js";

const HASH = /^[0-9a-f]{64}$/;
const KEY_ID = /^sha256:[0-9a-f]{64}$/;
const IDENTITY = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const CODE = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const MAX_SEVEN_DAYS_SECONDS = 604_800;

const CHANGED_FIELDS = [
  "account-scope",
  "action-families",
  "approval-semantics",
  "capital-authority",
  "capability-added",
  "capability-omitted",
  "capability-removed",
  "credential-release",
  "data-scopes",
  "decision-influence",
  "description-contract",
  "identity-evidence",
  "identity-kind",
  "influence-path",
  "mutation-class",
  "mutation-scopes",
  "provider-tool-name",
  "request-contract",
  "response-contract",
  "risk-evidence",
  "source-assertion",
  "source-ids",
  "state-read-domains",
  "state-write-domains",
  "workflow-prerequisites",
] as const satisfies readonly CapabilityChangedFieldV1[];

const SOURCE_CHANGED_FIELDS = [
  "source-added",
  "source-authority",
  "source-completeness",
  "source-projection",
  "source-public-uri",
  "source-removed",
] as const satisfies readonly SourceChangedFieldV1[];

const fail = (code: string): never => {
  throw new RegistryValidationError(code);
};

function ownPlainData(value: unknown, code: string): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  const copy = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) fail(code);
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean" ||
      typeof current === "number"
    ) {
      return current;
    }
    if (typeof current !== "object" || active.has(current)) fail(code);
    const object = current as object;
    active.add(object);
    try {
      const prototype = Object.getPrototypeOf(object);
      const descriptors = Object.getOwnPropertyDescriptors(object);
      const ownKeys = Reflect.ownKeys(object);
      if (ownKeys.some((key) => typeof key !== "string")) fail(code);
      if (Array.isArray(object)) {
        if (prototype !== Array.prototype) fail(code);
        const lengthDescriptor = descriptors.length;
        if (
          lengthDescriptor === undefined ||
          !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0 ||
          ownKeys.length !== lengthDescriptor.value + 1
        ) {
          fail(code);
        }
        const length = (
          lengthDescriptor as PropertyDescriptor & { value: number }
        ).value;
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            descriptor === undefined ||
            !("value" in descriptor) ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined ||
            descriptor.enumerable !== true
          ) {
            fail(code);
          }
          const owned = descriptor as PropertyDescriptor & { value: unknown };
          output.push(copy(owned.value, depth + 1));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) fail(code);
      const output: Record<string, unknown> = {};
      for (const key of ownKeys as string[]) {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true
        ) {
          fail(code);
        }
        const owned = descriptor as PropertyDescriptor & { value: unknown };
        output[key] = copy(owned.value, depth + 1);
      }
      return output;
    } catch (error) {
      if (error instanceof RegistryValidationError) throw error;
      fail(code);
    } finally {
      active.delete(object);
    }
  };
  return copy(value, 0);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code);
  }
}

function string(value: unknown, code: string, max = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) fail(code);
  return value as string;
}

function hash(value: unknown, code: string): string {
  const output = string(value, code, 64);
  if (!HASH.test(output)) fail(code);
  return output;
}

function nullableHash(value: unknown, code: string): string | null {
  return value === null ? null : hash(value, code);
}

function keyId(value: unknown, code: string): string {
  const output = string(value, code, 71);
  if (!KEY_ID.test(output)) fail(code);
  return output;
}

function identifier(value: unknown, code: string): string {
  const output = string(value, code, 128);
  if (!IDENTITY.test(output)) fail(code);
  return output;
}

function findingCode(value: unknown, code: string): string {
  const output = string(value, code, 128);
  if (!CODE.test(output)) fail(code);
  return output;
}

function choice<T extends string>(value: unknown, options: readonly T[], code: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail(code);
  return value as T;
}

function exact<T extends string | boolean>(value: unknown, expected: T, code: string): T {
  if (value !== expected) fail(code);
  return expected;
}

function array(value: unknown, code: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(code);
  return value as unknown[];
}

function integer(value: unknown, code: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail(code);
  }
  return value as number;
}

function boolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") fail(code);
  return value as boolean;
}

function sortedUnique(values: readonly string[], code: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (rawStringCompare(values[index - 1] ?? "", values[index] ?? "") >= 0) fail(code);
  }
}

function hashArray(value: unknown, code: string, min: number, max: number): string[] {
  const output = array(value, code, min, max).map((entry) => hash(entry, code));
  sortedUnique(output, code);
  return output;
}

function utcTimestamp(value: unknown, code: string): string {
  const output = string(value, code, 24);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(
    output,
  );
  if (match === null || match[1] === "0000") fail(code);
  const matched = match as RegExpExecArray;
  const milliseconds = Date.parse(output);
  if (!Number.isFinite(milliseconds)) fail(code);
  const normalized =
    matched[7] === undefined ? output.replace("Z", ".000Z") : output;
  if (new Date(milliseconds).toISOString() !== normalized) fail(code);
  return output;
}

function limitations(value: unknown, code: string): typeof PORTABLE_LIMITATIONS {
  const input = array(value, code, PORTABLE_LIMITATIONS.length, PORTABLE_LIMITATIONS.length);
  if (input.some((entry, index) => entry !== PORTABLE_LIMITATIONS[index])) fail(code);
  return PORTABLE_LIMITATIONS;
}

function bounded(value: unknown, maxBytes: number, code: string): void {
  try {
    if (new TextEncoder().encode(canonicalizeJcs(value)).byteLength > maxBytes) fail(code);
  } catch (error) {
    if (error instanceof RegistryValidationError) throw error;
    fail(code);
  }
}

export function parseAdmissionPolicy(value: unknown): AdmissionPolicyV1 {
  const code = "policy.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "allowedSourceAuthorities",
      "maximumCandidateAgeSeconds",
      "maximumFutureSkewSeconds",
      "maximumReviewValiditySeconds",
      "partialSourceOmissionDecision",
      "policyId",
      "productId",
      "profileVersion",
      "providerId",
      "requiredEvidenceSha256",
      "requireReviewForMaterialChanges",
      "schemaVersion",
      "sourceSeriesId",
      "trustedReviewerKeyIds",
      "unknownRiskDecision",
    ],
    code,
  );
  const allowedSourceAuthorities = array(
    input.allowedSourceAuthorities,
    code,
    1,
    SOURCE_AUTHORITIES.length,
  ).map((entry) => choice(entry, SOURCE_AUTHORITIES, code));
  sortedUnique(allowedSourceAuthorities, code);
  const trustedReviewerKeyIds = array(input.trustedReviewerKeyIds, code, 0, 64).map(
    (entry) => keyId(entry, code),
  );
  sortedUnique(trustedReviewerKeyIds, code);
  const output: AdmissionPolicyV1 = {
    allowedSourceAuthorities,
    maximumCandidateAgeSeconds: integer(
      input.maximumCandidateAgeSeconds,
      code,
      0,
      MAX_SEVEN_DAYS_SECONDS,
    ),
    maximumFutureSkewSeconds: integer(
      input.maximumFutureSkewSeconds,
      code,
      0,
      MAX_SEVEN_DAYS_SECONDS,
    ),
    maximumReviewValiditySeconds: integer(
      input.maximumReviewValiditySeconds,
      code,
      1,
      MAX_SEVEN_DAYS_SECONDS,
    ),
    partialSourceOmissionDecision: exact(
      input.partialSourceOmissionDecision,
      "reject",
      code,
    ),
    policyId: identifier(input.policyId, code),
    productId: identifier(input.productId, code),
    profileVersion: exact(
      input.profileVersion,
      FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
      code,
    ),
    providerId: identifier(input.providerId, code),
    requiredEvidenceSha256: hashArray(input.requiredEvidenceSha256, code, 0, 16),
    requireReviewForMaterialChanges: exact(
      input.requireReviewForMaterialChanges,
      true,
      code,
    ),
    schemaVersion: exact(input.schemaVersion, ADMISSION_POLICY_SCHEMA, code),
    sourceSeriesId: identifier(input.sourceSeriesId, code),
    trustedReviewerKeyIds,
    unknownRiskDecision: exact(input.unknownRiskDecision, "reject", code),
  };
  bounded(output, 64 * 1024, code);
  return output;
}

function parseChange(value: unknown): CapabilityChangeEvidenceV1 {
  const code = "diff.invalid";
  const input = record(value, code);
  keys(
    input,
    [
      "capabilityReferenceSha256",
      "changeId",
      "changedFields",
      "currentCapabilitySha256",
      "findingCodes",
      "materiality",
      "previousCapabilitySha256",
    ],
    code,
  );
  const changedFields = array(input.changedFields, code, 1, CHANGED_FIELDS.length).map(
    (entry) => choice(entry, CHANGED_FIELDS, code),
  );
  sortedUnique(changedFields, code);
  const findingCodes = array(input.findingCodes, code, 1, 64).map((entry) =>
    findingCode(entry, code),
  );
  sortedUnique(findingCodes, code);
  const previousCapabilitySha256 = nullableHash(input.previousCapabilitySha256, code);
  const currentCapabilitySha256 = nullableHash(input.currentCapabilitySha256, code);
  if (previousCapabilitySha256 === null && currentCapabilitySha256 === null) fail(code);
  if (
    (changedFields.includes("capability-added") && previousCapabilitySha256 !== null) ||
    ((changedFields.includes("capability-removed") ||
      changedFields.includes("capability-omitted")) &&
      currentCapabilitySha256 !== null) ||
    (previousCapabilitySha256 === null && !changedFields.includes("capability-added")) ||
    (currentCapabilitySha256 === null &&
      !changedFields.includes("capability-removed") &&
      !changedFields.includes("capability-omitted")) ||
    (changedFields.includes("capability-removed") &&
      changedFields.includes("capability-omitted"))
  ) {
    fail(code);
  }
  return {
    capabilityReferenceSha256: hash(input.capabilityReferenceSha256, code),
    changeId: hash(input.changeId, code),
    changedFields,
    currentCapabilitySha256,
    findingCodes,
    materiality: choice(input.materiality, ["material", "non-material"], code),
    previousCapabilitySha256,
  };
}

function parseSourceChange(value: unknown): SourceChangeEvidenceV1 {
  const code = "diff.invalid";
  const input = record(value, code);
  keys(input, [
    "changeId",
    "changedFields",
    "currentSourceSha256",
    "findingCodes",
    "materiality",
    "previousSourceSha256",
    "sourceReferenceSha256",
  ], code);
  const changedFields = array(
    input.changedFields,
    code,
    1,
    SOURCE_CHANGED_FIELDS.length,
  ).map((entry) => choice(entry, SOURCE_CHANGED_FIELDS, code));
  sortedUnique(changedFields, code);
  const findingCodes = array(input.findingCodes, code, 1, 64).map((entry) =>
    findingCode(entry, code),
  );
  sortedUnique(findingCodes, code);
  const previousSourceSha256 = nullableHash(input.previousSourceSha256, code);
  const currentSourceSha256 = nullableHash(input.currentSourceSha256, code);
  if (
    (previousSourceSha256 === null && currentSourceSha256 === null) ||
    (changedFields.includes("source-added") !== (previousSourceSha256 === null)) ||
    (changedFields.includes("source-removed") !== (currentSourceSha256 === null)) ||
    (changedFields.includes("source-added") && changedFields.length !== 1) ||
    (changedFields.includes("source-removed") && changedFields.length !== 1)
  ) {
    fail(code);
  }
  return {
    changeId: hash(input.changeId, code),
    changedFields,
    currentSourceSha256,
    findingCodes,
    materiality: exact(input.materiality, "material", code),
    previousSourceSha256,
    sourceReferenceSha256: hash(input.sourceReferenceSha256, code),
  };
}

export function parseCapabilityDiff(value: unknown): CapabilityDiffV1 {
  const code = "diff.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "baselineSnapshotSha256",
      "blockedChangeSetSha256",
      "candidateSnapshotSha256",
      "changes",
      "diffSha256",
      "limitations",
      "materialChangeIds",
      "profileVersion",
      "schemaVersion",
      "sourceChanges",
      "sourceSetSha256",
    ],
    code,
  );
  const changes = array(input.changes, code, 0, 512).map(parseChange);
  sortedUnique(
    changes.map((change) => change.changeId),
    code,
  );
  const sourceChanges = array(input.sourceChanges, code, 0, 128).map(parseSourceChange);
  sortedUnique(sourceChanges.map((change) => change.changeId), code);
  const materialChangeIds = hashArray(input.materialChangeIds, code, 0, 640);
  const expectedMaterialChangeIds = [
    ...changes.filter((change) => change.materiality === "material")
      .map((change) => change.changeId),
    ...sourceChanges.map((change) => change.changeId),
  ].sort(rawStringCompare);
  if (
    materialChangeIds.length !== expectedMaterialChangeIds.length ||
    materialChangeIds.some((changeId, index) => changeId !== expectedMaterialChangeIds[index])
  ) {
    fail(code);
  }
  const declaredDiffSha256 = hash(input.diffSha256, code);
  const withoutDigest = {
    baselineSnapshotSha256: hash(input.baselineSnapshotSha256, code),
    blockedChangeSetSha256: hash(input.blockedChangeSetSha256, code),
    candidateSnapshotSha256: hash(input.candidateSnapshotSha256, code),
    changes,
    limitations: limitations(input.limitations, code),
    materialChangeIds,
    profileVersion: exact(
      input.profileVersion,
      FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
      code,
    ),
    schemaVersion: exact(input.schemaVersion, CAPABILITY_DIFF_SCHEMA, code),
    sourceChanges,
    sourceSetSha256: hash(input.sourceSetSha256, code),
  } as const;
  if (sha256Jcs(withoutDigest) !== declaredDiffSha256) fail(code);
  const output: CapabilityDiffV1 = { ...withoutDigest, diffSha256: declaredDiffSha256 };
  bounded(output, 2 * 1024 * 1024, code);
  return output;
}

function parseReviewDecision(value: unknown): ReviewChangeDecisionV1 {
  const code = "review.invalid";
  const input = record(value, code);
  keys(input, ["changeId", "decision", "rationaleSha256"], code);
  return {
    changeId: hash(input.changeId, code),
    decision: choice(input.decision, ["approve", "deny"], code),
    rationaleSha256: hash(input.rationaleSha256, code),
  };
}

export function parseReviewClaims(value: unknown): ReviewClaimsV1 {
  const code = "review.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "baselineSnapshotSha256",
      "blockedChangeSetSha256",
      "candidateSnapshotSha256",
      "decisions",
      "diffSha256",
      "expiresAt",
      "issuedAt",
      "nonceSha256",
      "notBefore",
      "policySha256",
      "purpose",
      "requiredEvidenceSha256",
      "reviewId",
      "reviewerKeyId",
      "schemaVersion",
      "sourceSetSha256",
    ],
    code,
  );
  const decisions = array(input.decisions, code, 1, 64).map(parseReviewDecision);
  sortedUnique(
    decisions.map((decision) => decision.changeId),
    code,
  );
  const issuedAt = utcTimestamp(input.issuedAt, code);
  const notBefore = utcTimestamp(input.notBefore, code);
  const expiresAt = utcTimestamp(input.expiresAt, code);
  const issuedMilliseconds = Date.parse(issuedAt);
  const notBeforeMilliseconds = Date.parse(notBefore);
  const expiresMilliseconds = Date.parse(expiresAt);
  if (
    notBeforeMilliseconds < issuedMilliseconds ||
    expiresMilliseconds <= notBeforeMilliseconds ||
    expiresMilliseconds - issuedMilliseconds > MAX_SEVEN_DAYS_SECONDS * 1_000
  ) {
    fail(code);
  }
  const output: ReviewClaimsV1 = {
    baselineSnapshotSha256: hash(input.baselineSnapshotSha256, code),
    blockedChangeSetSha256: hash(input.blockedChangeSetSha256, code),
    candidateSnapshotSha256: hash(input.candidateSnapshotSha256, code),
    decisions,
    diffSha256: hash(input.diffSha256, code),
    expiresAt,
    issuedAt,
    nonceSha256: hash(input.nonceSha256, code),
    notBefore,
    policySha256: hash(input.policySha256, code),
    purpose: exact(input.purpose, "registry-admission-only", code),
    requiredEvidenceSha256: hashArray(input.requiredEvidenceSha256, code, 0, 16),
    reviewId: identifier(input.reviewId, code),
    reviewerKeyId: keyId(input.reviewerKeyId, code),
    schemaVersion: exact(input.schemaVersion, REVIEW_CLAIMS_SCHEMA, code),
    sourceSetSha256: hash(input.sourceSetSha256, code),
  };
  bounded(output, 256 * 1024, code);
  return output;
}

function validCanonicalEd25519Signature(value: unknown, code: string): string {
  const output = string(value, code, 88);
  if (
    output.length !== 88 ||
    !/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(output)
  ) {
    fail(code);
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const finalDigit = alphabet.indexOf(output[85] ?? "");
  if (finalDigit < 0 || (finalDigit & 0x0f) !== 0) fail(code);
  return output;
}

export function parseReviewArtifact(value: unknown): ReviewArtifactV1 {
  const code = "review-artifact.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(input, ["algorithm", "claims", "schemaVersion", "signatureBase64"], code);
  const output: ReviewArtifactV1 = {
    algorithm: exact(input.algorithm, "ed25519", code),
    claims: parseReviewClaims(input.claims),
    schemaVersion: exact(input.schemaVersion, REVIEW_ARTIFACT_SCHEMA, code),
    signatureBase64: validCanonicalEd25519Signature(input.signatureBase64, code),
  };
  bounded(output, 320 * 1024, code);
  return output;
}

function parseAdmissionCheck(value: unknown): AdmissionCheckV1 {
  const code = "admission-receipt.invalid";
  const input = record(value, code);
  keys(input, ["code", "passed"], code);
  return { code: findingCode(input.code, code), passed: boolean(input.passed, code) };
}

export function parseAdmissionReceipt(value: unknown): AdmissionReceiptV1 {
  const code = "admission-receipt.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "baselineSnapshotSha256",
      "blockedChangeSetSha256",
      "candidateSnapshotSha256",
      "checks",
      "diffSha256",
      "evaluatedAtDeclared",
      "limitations",
      "outcome",
      "policySha256",
      "profileVersion",
      "reviewArtifactSha256",
      "reviewSignatureVerified",
      "schemaVersion",
    ],
    code,
  );
  const checks = array(input.checks, code, 1, 64).map(parseAdmissionCheck);
  sortedUnique(
    checks.map((check) => check.code),
    code,
  );
  const outcome = choice(
    input.outcome,
    ["admit", "no-change", "quarantine", "reject"],
    code,
  );
  const reviewArtifactSha256 = nullableHash(input.reviewArtifactSha256, code);
  const reviewSignatureVerified = boolean(input.reviewSignatureVerified, code);
  if (reviewSignatureVerified && reviewArtifactSha256 === null) fail(code);
  const allChecksPassed = checks.every((check) => check.passed);
  if (
    (["admit", "no-change"].includes(outcome) && !allChecksPassed) ||
    (["quarantine", "reject"].includes(outcome) && allChecksPassed)
  ) {
    fail(code);
  }
  const baselineSnapshotSha256 = hash(input.baselineSnapshotSha256, code);
  const candidateSnapshotSha256 = hash(input.candidateSnapshotSha256, code);
  if (
    outcome === "no-change" &&
    baselineSnapshotSha256 !== candidateSnapshotSha256
  ) {
    fail(code);
  }
  const output: AdmissionReceiptV1 = {
    baselineSnapshotSha256,
    blockedChangeSetSha256: hash(input.blockedChangeSetSha256, code),
    candidateSnapshotSha256,
    checks,
    diffSha256: hash(input.diffSha256, code),
    evaluatedAtDeclared: utcTimestamp(input.evaluatedAtDeclared, code),
    limitations: limitations(input.limitations, code),
    outcome,
    policySha256: hash(input.policySha256, code),
    profileVersion: exact(
      input.profileVersion,
      FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
      code,
    ),
    reviewArtifactSha256,
    reviewSignatureVerified,
    schemaVersion: exact(input.schemaVersion, ADMISSION_RECEIPT_SCHEMA, code),
  };
  bounded(output, 256 * 1024, code);
  return output;
}

function parseExactJcsBytes<T>(
  bytes: Uint8Array,
  maximumBytes: number,
  prefix: string,
  parser: (value: unknown) => T,
): T {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > maximumBytes ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) {
    fail(`${prefix}.bytes-invalid`);
  }
  let value: unknown;
  try {
    value = parseStrictJson(bytes, {
      maxDepth: 64,
      maxNodes: 100_000,
      maxStringLength: 4_096,
    });
  } catch (error) {
    if (error instanceof StrictJsonError) {
      if (error.code === "invalid-utf8") fail(`${prefix}.bytes-invalid-utf8`);
      if (error.code === "invalid-unicode") fail(`${prefix}.bytes-invalid-unicode`);
      if (error.code === "duplicate-key") fail(`${prefix}.bytes-duplicate-key`);
    }
    fail(`${prefix}.bytes-invalid-json`);
  }
  const parsed = parser(value);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  if (canonicalizeJcs(parsed) !== source) fail(`${prefix}.bytes-noncanonical`);
  return parsed;
}

export function serializeAdmissionPolicy(value: unknown): string {
  return canonicalizeJcs(parseAdmissionPolicy(value));
}

export function serializeCapabilityDiff(value: unknown): string {
  return canonicalizeJcs(parseCapabilityDiff(value));
}

export function serializeReviewClaims(value: unknown): string {
  return canonicalizeJcs(parseReviewClaims(value));
}

export function serializeReviewArtifact(value: unknown): string {
  return canonicalizeJcs(parseReviewArtifact(value));
}

export function serializeAdmissionReceipt(value: unknown): string {
  return canonicalizeJcs(parseAdmissionReceipt(value));
}

export function parseExactJcsAdmissionPolicyBytes(bytes: Uint8Array): AdmissionPolicyV1 {
  return parseExactJcsBytes(bytes, 64 * 1024, "policy", parseAdmissionPolicy);
}

export function parseExactJcsCapabilityDiffBytes(bytes: Uint8Array): CapabilityDiffV1 {
  return parseExactJcsBytes(bytes, 2 * 1024 * 1024, "diff", parseCapabilityDiff);
}

export function parseExactJcsReviewClaimsBytes(bytes: Uint8Array): ReviewClaimsV1 {
  return parseExactJcsBytes(bytes, 256 * 1024, "review", parseReviewClaims);
}

export function parseExactJcsReviewArtifactBytes(bytes: Uint8Array): ReviewArtifactV1 {
  return parseExactJcsBytes(bytes, 320 * 1024, "review-artifact", parseReviewArtifact);
}

export function parseExactJcsAdmissionReceiptBytes(bytes: Uint8Array): AdmissionReceiptV1 {
  return parseExactJcsBytes(
    bytes,
    256 * 1024,
    "admission-receipt",
    parseAdmissionReceipt,
  );
}
