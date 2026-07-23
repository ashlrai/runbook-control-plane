import {
  canonicalJcs,
  compareCodeUnits,
  fail,
  parseJsonBytes,
} from "./primitives.js";

export const PROFILE = "runbook.financial-capability-registry.v1" as const;
export const SNAPSHOT_SCHEMA = "runbook.financial-capability-snapshot.v1" as const;
export const DIFF_SCHEMA = "runbook.financial-capability-diff.v1" as const;
export const POLICY_SCHEMA =
  "runbook.financial-capability-admission-policy.v1" as const;
export const REVIEW_SCHEMA =
  "runbook.financial-capability-review-artifact.v1" as const;
export const REVIEW_CLAIMS_SCHEMA =
  "runbook.financial-capability-review-claims.v1" as const;
export const ADMISSION_SCHEMA =
  "runbook.financial-capability-admission-receipt.v1" as const;

export const PORTABLE_LIMITATIONS = [
  "unsigned-local-analysis-unless-separate-review-signature-is-verified",
  "does-not-prove-authenticated-runtime-completeness-or-current-availability",
  "does-not-grant-broker-api-permission-or-provider-endorsement",
  "does-not-authorize-execution-capital-movement-credential-release-or-purchase",
  "does-not-prove-safety-security-compliance-suitability-performance-or-future-behavior",
  "time-is-declared-not-independently-trusted",
  "does-not-prove-a-durable-registry-head-update",
  "does-not-discover-undeclared-influence-paths-or-workflow-dependencies",
] as const;

const SOURCE_AUTHORITIES = [
  "authenticated-runtime-discovery", "controlled-runtime-exercise",
  "public-documentation", "user-supplied-export",
] as const;
const SOURCE_COMPLETENESS = [
  "capabilities-only", "complete-enumeration", "partial-enumeration", "unknown",
] as const;
const EVIDENCE = [
  "public-derived", "public-explicit", "runtime-confirmed", "runtime-exercised",
] as const;
const CONTRACT_STATES = ["known", "not-authorized", "not-captured", "not-published"] as const;
const IDENTITY_KINDS = ["documented-operation", "published-tool-name", "runtime-tool-name"] as const;
const ACTION_FAMILIES = [
  "account-observation", "credential-release", "emergency-control", "market-observation",
  "order-management", "order-review", "order-submission", "policy-management",
  "policy-observation", "purchase-execution", "purchase-observation", "reconciliation",
  "research-observation", "research-state-management", "unknown",
] as const;
const DATA_SCOPES = [
  "account-balances", "account-identifiers", "account-positions", "account-transactions",
  "card-policies", "card-transactions", "company-data", "market-data", "order-data",
  "order-history", "payment-credentials", "scans", "unknown", "watchlists",
] as const;
const ACCOUNT_SCOPES = [
  "all-linked-accounts", "authorized-card", "dedicated-account", "none",
  "provider-defined", "unknown",
] as const;
const MUTATION_CLASSES = ["capital-moving", "emergency", "read", "reversible", "unknown"] as const;
const MUTATION_SCOPES = [
  "capital-orders", "control-plane", "credential-release", "emergency-state",
  "none", "payments", "research-state", "unknown",
] as const;
const STATE_DOMAINS = [
  "account-state", "card-policy-state", "card-transaction-state", "control-plane",
  "market-state", "none", "order-state", "payment-credential-state",
  "portfolio-state", "research-state", "unknown",
] as const;
const INFLUENCE = ["direct", "indirect", "none", "unknown"] as const;
const CREDENTIAL_RELEASE = [
  "account-identifier", "api-credential", "none", "opaque-session",
  "payment-credential", "private-key", "unknown",
] as const;
const CAPITAL_OPERATIONS = ["cancel", "preview", "replace", "spend", "submit", "transfer", "unknown"] as const;
const ASSET_SCOPES = [
  "card-purchase", "cash", "crypto", "equity", "event-contract", "future",
  "option", "other", "unknown",
] as const;
const APPROVAL_MODES = ["advisory", "mandatory", "none", "optional", "unknown"] as const;
const APPROVAL_PRINCIPALS = ["customer", "external-agent", "joint", "none", "provider", "unknown"] as const;
// Normative threat-profile vocabulary. `action-family` and `policy` are rejected.
const APPROVAL_ACTION_BINDINGS = ["action-class", "exact-action", "none", "unknown"] as const;
const APPROVAL_SCOPE_BINDINGS = ["monthly-budget", "none", "session", "single-action", "unknown"] as const;
const APPROVAL_EXPIRY_BINDINGS = ["fixed", "none", "provider-managed", "unknown"] as const;
const APPROVAL_BYPASS = ["none", "policy-configurable", "unknown", "user-instruction"] as const;

type Element<T extends readonly string[]> = T[number];
export type SourceAuthority = Element<typeof SOURCE_AUTHORITIES>;

export type CapabilitySource = Readonly<{
  authority: SourceAuthority;
  completeness: Element<typeof SOURCE_COMPLETENESS>;
  publicUri: string | null;
  retrievedAtDeclared: string;
  sourceId: string;
  sourceProjectionSha256: string;
}>;

export type ContractDigest = Readonly<{
  sha256: string | null;
  state: Element<typeof CONTRACT_STATES>;
}>;

export type ApprovalSemantics = Readonly<{
  actionBinding: Element<typeof APPROVAL_ACTION_BINDINGS>;
  bypassCondition: Element<typeof APPROVAL_BYPASS>;
  enforcingPrincipal: Element<typeof APPROVAL_PRINCIPALS>;
  expiryBinding: Element<typeof APPROVAL_EXPIRY_BINDINGS>;
  mode: Element<typeof APPROVAL_MODES>;
  scopeBinding: Element<typeof APPROVAL_SCOPE_BINDINGS>;
}>;

export type FinancialCapability = Readonly<{
  accountScope: Element<typeof ACCOUNT_SCOPES>;
  actionFamilies: readonly Element<typeof ACTION_FAMILIES>[];
  approvalSemantics: ApprovalSemantics;
  capitalAuthority: Readonly<{
    assetScopes: readonly Element<typeof ASSET_SCOPES>[];
    operations: readonly Element<typeof CAPITAL_OPERATIONS>[];
  }>;
  capabilityId: string;
  credentialRelease: Element<typeof CREDENTIAL_RELEASE>;
  dataScopes: readonly Element<typeof DATA_SCOPES>[];
  decisionInfluence: Element<typeof INFLUENCE>;
  descriptionContract: ContractDigest;
  identityEvidence: Element<typeof EVIDENCE>;
  identityKind: Element<typeof IDENTITY_KINDS>;
  mutationClass: Element<typeof MUTATION_CLASSES>;
  mutationScopes: readonly Element<typeof MUTATION_SCOPES>[];
  providerToolName: string | null;
  requestContract: ContractDigest;
  responseContract: ContractDigest;
  riskEvidence: Element<typeof EVIDENCE>;
  sourceAssertionSha256: string;
  sourceIds: readonly string[];
  stateReadDomains: readonly Element<typeof STATE_DOMAINS>[];
  stateWriteDomains: readonly Element<typeof STATE_DOMAINS>[];
  workflowPrerequisiteCapabilityIds: readonly string[];
}>;

export type CapabilitySnapshot = Readonly<{
  capabilities: readonly FinancialCapability[];
  observedAtDeclared: string;
  previousAdmittedSnapshotSha256: string | null;
  productId: string;
  profileVersion: typeof PROFILE;
  providerId: string;
  registryRevision: number;
  schemaVersion: typeof SNAPSHOT_SCHEMA;
  sourceSeriesId: string;
  sources: readonly CapabilitySource[];
}>;

export type AdmissionPolicy = Readonly<{
  allowedSourceAuthorities: readonly SourceAuthority[];
  maximumCandidateAgeSeconds: number;
  maximumFutureSkewSeconds: number;
  maximumReviewValiditySeconds: number;
  partialSourceOmissionDecision: "reject";
  policyId: string;
  productId: string;
  profileVersion: typeof PROFILE;
  providerId: string;
  requiredEvidenceSha256: readonly string[];
  requireReviewForMaterialChanges: true;
  schemaVersion: typeof POLICY_SCHEMA;
  sourceSeriesId: string;
  trustedReviewerKeyIds: readonly string[];
  unknownRiskDecision: "reject";
}>;

export type ReviewDecision = Readonly<{
  changeId: string;
  decision: "approve" | "deny";
  rationaleSha256: string;
}>;

export type ReviewClaims = Readonly<{
  baselineSnapshotSha256: string;
  blockedChangeSetSha256: string;
  candidateSnapshotSha256: string;
  decisions: readonly ReviewDecision[];
  diffSha256: string;
  expiresAt: string;
  issuedAt: string;
  nonceSha256: string;
  notBefore: string;
  policySha256: string;
  purpose: "registry-admission-only";
  requiredEvidenceSha256: readonly string[];
  reviewId: string;
  reviewerKeyId: string;
  schemaVersion: typeof REVIEW_CLAIMS_SCHEMA;
  sourceSetSha256: string;
}>;

export type ReviewArtifact = Readonly<{
  algorithm: "ed25519";
  claims: ReviewClaims;
  schemaVersion: typeof REVIEW_SCHEMA;
  signatureBase64: string;
}>;

const HASH = /^[0-9a-f]{64}$/;
const KEY_ID = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const TOOL = /^[a-z][a-z0-9_.-]{0,127}$/;

const object = (value: unknown, code: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, names: readonly string[], code: string): void => {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const wanted = [...names].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) fail(code);
};

const text = (value: unknown, code: string, maximum = 256): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) fail(code);
  return value as string;
};
const hash = (value: unknown, code: string): string => {
  const output = text(value, code, 64);
  if (!HASH.test(output)) fail(code);
  return output;
};
const nullableHash = (value: unknown, code: string): string | null => value === null ? null : hash(value, code);
const identifier = (value: unknown, code: string): string => {
  const output = text(value, code, 128);
  if (!ID.test(output)) fail(code);
  return output;
};
const choose = <T extends string>(value: unknown, choices: readonly T[], code: string): T => {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(code);
  return value as T;
};
const exact = <T extends string | number | boolean>(value: unknown, expected: T, code: string): T => {
  if (value !== expected) fail(code);
  return expected;
};
const list = (value: unknown, minimum: number, maximum: number, code: string): unknown[] => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(code);
  return value as unknown[];
};
const sortedUnique = (values: readonly string[], code: string): void => {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodeUnits(values[index - 1] ?? "", values[index] ?? "") >= 0) fail(code);
  }
};
const enumList = <T extends string>(
  value: unknown,
  choices: readonly T[],
  code: string,
  options: Readonly<{ empty?: boolean; exclusive?: readonly T[] }> = {},
): T[] => {
  const output = list(value, options.empty === true ? 0 : 1, choices.length, code)
    .map((entry) => choose(entry, choices, code));
  sortedUnique(output, code);
  for (const exclusive of options.exclusive ?? []) {
    if (output.includes(exclusive) && output.length !== 1) fail(code);
  }
  return output;
};
const integer = (value: unknown, minimum: number, maximum: number, code: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(code);
  return value as number;
};

export function timestamp(value: unknown, code: string): string {
  const output = text(value, code, 24);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(output);
  if (match === null) return fail(code);
  if (match[1] === "0000") fail(code);
  const milliseconds = Date.parse(output);
  const normalized = match[7] === undefined ? output.replace("Z", ".000Z") : output;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) fail(code);
  return output;
}

const parseContract = (value: unknown, code: string): ContractDigest => {
  const input = object(value, code);
  exactKeys(input, ["sha256", "state"], code);
  const state = choose(input.state, CONTRACT_STATES, code);
  const digest = nullableHash(input.sha256, code);
  if ((state === "known") !== (digest !== null)) fail(code);
  return { sha256: digest, state };
};

const parseSource = (value: unknown): CapabilitySource => {
  const code = "snapshot.source-invalid";
  const input = object(value, code);
  exactKeys(input, ["authority", "completeness", "publicUri", "retrievedAtDeclared", "sourceId", "sourceProjectionSha256"], code);
  const authority = choose(input.authority, SOURCE_AUTHORITIES, code);
  let publicUri: string | null = null;
  if (authority === "public-documentation") {
    publicUri = text(input.publicUri, code, 2_048);
    try {
      const url = new URL(publicUri);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
        url.hash !== "" || url.href !== publicUri || !/^[\x21-\x7e]+$/.test(publicUri)) fail(code);
    } catch { fail(code); }
  } else if (input.publicUri !== null) fail(code);
  return {
    authority,
    completeness: choose(input.completeness, SOURCE_COMPLETENESS, code),
    publicUri,
    retrievedAtDeclared: timestamp(input.retrievedAtDeclared, code),
    sourceId: identifier(input.sourceId, code),
    sourceProjectionSha256: hash(input.sourceProjectionSha256, code),
  };
};

function evidenceSupported(level: Element<typeof EVIDENCE>, sources: readonly CapabilitySource[]): boolean {
  const authorities = new Set(sources.map((source) => source.authority));
  if (level === "public-derived" || level === "public-explicit") return authorities.has("public-documentation");
  if (level === "runtime-confirmed") {
    return authorities.has("authenticated-runtime-discovery") || authorities.has("controlled-runtime-exercise");
  }
  return authorities.has("controlled-runtime-exercise");
}

const parseApproval = (value: unknown, code: string): ApprovalSemantics => {
  const input = object(value, code);
  exactKeys(input, ["actionBinding", "bypassCondition", "enforcingPrincipal", "expiryBinding", "mode", "scopeBinding"], code);
  const output: ApprovalSemantics = {
    actionBinding: choose(input.actionBinding, APPROVAL_ACTION_BINDINGS, code),
    bypassCondition: choose(input.bypassCondition, APPROVAL_BYPASS, code),
    enforcingPrincipal: choose(input.enforcingPrincipal, APPROVAL_PRINCIPALS, code),
    expiryBinding: choose(input.expiryBinding, APPROVAL_EXPIRY_BINDINGS, code),
    mode: choose(input.mode, APPROVAL_MODES, code),
    scopeBinding: choose(input.scopeBinding, APPROVAL_SCOPE_BINDINGS, code),
  };
  if (output.mode === "none" && Object.values(output).some((entry) => entry !== "none")) fail(code);
  if (output.mode !== "none" && output.mode !== "unknown" && output.enforcingPrincipal === "none") fail(code);
  return output;
};

const parseCapability = (
  value: unknown,
  sourcesById: ReadonlyMap<string, CapabilitySource>,
): FinancialCapability => {
  const code = "snapshot.capability-invalid";
  const input = object(value, code);
  exactKeys(input, [
    "accountScope", "actionFamilies", "approvalSemantics", "capitalAuthority",
    "capabilityId", "credentialRelease", "dataScopes", "decisionInfluence",
    "descriptionContract", "identityEvidence", "identityKind", "mutationClass",
    "mutationScopes", "providerToolName", "requestContract", "responseContract",
    "riskEvidence", "sourceAssertionSha256", "sourceIds", "stateReadDomains",
    "stateWriteDomains", "workflowPrerequisiteCapabilityIds",
  ], code);
  const identityKind = choose(input.identityKind, IDENTITY_KINDS, code);
  const providerToolName = input.providerToolName === null ? null : text(input.providerToolName, code, 128);
  if (providerToolName !== null && !TOOL.test(providerToolName)) fail(code);
  if ((identityKind === "documented-operation") !== (providerToolName === null)) fail(code);
  const sourceIds = list(input.sourceIds, 1, 16, code).map((entry) => identifier(entry, code));
  sortedUnique(sourceIds, code);
  const sources = sourceIds.map((sourceId) => {
    const source = sourcesById.get(sourceId);
    if (source === undefined) fail(code);
    return source as CapabilitySource;
  });
  const identityEvidence = choose(input.identityEvidence, EVIDENCE, code);
  const riskEvidence = choose(input.riskEvidence, EVIDENCE, code);
  if (!evidenceSupported(identityEvidence, sources) || !evidenceSupported(riskEvidence, sources)) fail(code);
  if (identityKind === "documented-operation" && identityEvidence !== "public-derived") fail(code);
  if (identityKind === "published-tool-name" && identityEvidence !== "public-explicit") fail(code);
  if (identityKind === "runtime-tool-name" && !["runtime-confirmed", "runtime-exercised"].includes(identityEvidence)) fail(code);
  const mutationScopes = enumList(input.mutationScopes, MUTATION_SCOPES, code, { exclusive: ["none", "unknown"] });
  const credentialRelease = choose(input.credentialRelease, CREDENTIAL_RELEASE, code);
  const capitalInput = object(input.capitalAuthority, code);
  exactKeys(capitalInput, ["assetScopes", "operations"], code);
  const capitalAuthority = {
    assetScopes: enumList(capitalInput.assetScopes, ASSET_SCOPES, code, { empty: true, exclusive: ["unknown"] }),
    operations: enumList(capitalInput.operations, CAPITAL_OPERATIONS, code, { empty: true, exclusive: ["unknown"] }),
  };
  if ((capitalAuthority.assetScopes.length === 0) !== (capitalAuthority.operations.length === 0)) fail(code);
  if ((credentialRelease === "none" && mutationScopes.includes("credential-release")) ||
    (credentialRelease !== "none" && credentialRelease !== "unknown" && !mutationScopes.includes("credential-release")) ||
    (credentialRelease === "unknown" && !(mutationScopes.length === 1 && mutationScopes[0] === "unknown"))) fail(code);
  const dataScopes = enumList(input.dataScopes, DATA_SCOPES, code, { exclusive: ["unknown"] });
  if (credentialRelease === "payment-credential" && !dataScopes.includes("payment-credentials")) fail(code);
  if (capitalAuthority.operations.some((entry) => ["cancel", "replace", "spend", "submit", "transfer"].includes(entry)) &&
    !mutationScopes.some((entry) => ["capital-orders", "payments", "unknown"].includes(entry))) fail(code);
  const mutationClass = choose(input.mutationClass, MUTATION_CLASSES, code);
  if (mutationClass !== "read" && mutationScopes.length === 1 && mutationScopes[0] === "none") fail(code);
  const workflowPrerequisiteCapabilityIds = list(input.workflowPrerequisiteCapabilityIds, 0, 64, code)
    .map((entry) => identifier(entry, code));
  sortedUnique(workflowPrerequisiteCapabilityIds, code);
  return {
    accountScope: choose(input.accountScope, ACCOUNT_SCOPES, code),
    actionFamilies: enumList(input.actionFamilies, ACTION_FAMILIES, code, { exclusive: ["unknown"] }),
    approvalSemantics: parseApproval(input.approvalSemantics, code),
    capitalAuthority,
    capabilityId: identifier(input.capabilityId, code),
    credentialRelease,
    dataScopes,
    decisionInfluence: choose(input.decisionInfluence, INFLUENCE, code),
    descriptionContract: parseContract(input.descriptionContract, code),
    identityEvidence,
    identityKind,
    mutationClass,
    mutationScopes,
    providerToolName,
    requestContract: parseContract(input.requestContract, code),
    responseContract: parseContract(input.responseContract, code),
    riskEvidence,
    sourceAssertionSha256: hash(input.sourceAssertionSha256, code),
    sourceIds,
    stateReadDomains: enumList(input.stateReadDomains, STATE_DOMAINS, code, { exclusive: ["none", "unknown"] }),
    stateWriteDomains: enumList(input.stateWriteDomains, STATE_DOMAINS, code, { exclusive: ["none", "unknown"] }),
    workflowPrerequisiteCapabilityIds,
  };
};

export function parseSnapshotValue(value: unknown): CapabilitySnapshot {
  const code = "snapshot.invalid";
  const input = object(value, code);
  exactKeys(input, [
    "capabilities", "observedAtDeclared", "previousAdmittedSnapshotSha256",
    "productId", "profileVersion", "providerId", "registryRevision",
    "schemaVersion", "sourceSeriesId", "sources",
  ], code);
  exact(input.profileVersion, PROFILE, code);
  exact(input.schemaVersion, SNAPSHOT_SCHEMA, code);
  const registryRevision = integer(input.registryRevision, 1, 10_000_000, code);
  const previousAdmittedSnapshotSha256 = nullableHash(input.previousAdmittedSnapshotSha256, code);
  if ((registryRevision === 1) !== (previousAdmittedSnapshotSha256 === null)) fail(code);
  const sources = list(input.sources, 1, 64, code).map(parseSource);
  sortedUnique(sources.map((source) => source.sourceId), code);
  const sourceMap = new Map(sources.map((source) => [source.sourceId, source]));
  const capabilities = list(input.capabilities, 1, 512, code)
    .map((capability) => parseCapability(capability, sourceMap));
  sortedUnique(capabilities.map((capability) => capability.capabilityId), code);
  const capabilityIds = new Set(capabilities.map((capability) => capability.capabilityId));
  if (capabilities.some((capability) => capability.workflowPrerequisiteCapabilityIds.some(
    (required) => required === capability.capabilityId || !capabilityIds.has(required),
  ))) fail(code);
  const names = capabilities.flatMap((capability) => capability.providerToolName === null ? [] : [capability.providerToolName]);
  if (new Set(names).size !== names.length) fail(code);
  const observedAtDeclared = timestamp(input.observedAtDeclared, code);
  if (sources.some((source) => Date.parse(source.retrievedAtDeclared) > Date.parse(observedAtDeclared))) fail(code);
  const output: CapabilitySnapshot = {
    capabilities,
    observedAtDeclared,
    previousAdmittedSnapshotSha256,
    productId: identifier(input.productId, code),
    profileVersion: PROFILE,
    providerId: identifier(input.providerId, code),
    registryRevision,
    schemaVersion: SNAPSHOT_SCHEMA,
    sourceSeriesId: identifier(input.sourceSeriesId, code),
    sources,
  };
  if (new TextEncoder().encode(canonicalJcs(output)).byteLength > 4 * 1024 * 1024) fail(code);
  return output;
}

export function parseSnapshotBytes(bytes: Uint8Array): CapabilitySnapshot {
  const transported = parseJsonBytes(bytes, 4 * 1024 * 1024, "snapshot");
  const snapshot = parseSnapshotValue(transported.value);
  if (canonicalJcs(snapshot) !== transported.source) fail("snapshot.bytes-noncanonical");
  return snapshot;
}

function parsePolicyValue(value: unknown): AdmissionPolicy {
  const code = "policy.invalid";
  const input = object(value, code);
  exactKeys(input, [
    "allowedSourceAuthorities", "maximumCandidateAgeSeconds", "maximumFutureSkewSeconds",
    "maximumReviewValiditySeconds", "partialSourceOmissionDecision", "policyId",
    "productId", "profileVersion", "providerId", "requiredEvidenceSha256",
    "requireReviewForMaterialChanges", "schemaVersion", "sourceSeriesId",
    "trustedReviewerKeyIds", "unknownRiskDecision",
  ], code);
  const allowedSourceAuthorities = list(input.allowedSourceAuthorities, 1, SOURCE_AUTHORITIES.length, code)
    .map((entry) => choose(entry, SOURCE_AUTHORITIES, code));
  sortedUnique(allowedSourceAuthorities, code);
  const requiredEvidenceSha256 = list(input.requiredEvidenceSha256, 0, 16, code).map((entry) => hash(entry, code));
  sortedUnique(requiredEvidenceSha256, code);
  const trustedReviewerKeyIds = list(input.trustedReviewerKeyIds, 0, 64, code).map((entry) => {
    const output = text(entry, code, 71);
    if (!KEY_ID.test(output)) fail(code);
    return output;
  });
  sortedUnique(trustedReviewerKeyIds, code);
  return {
    allowedSourceAuthorities,
    maximumCandidateAgeSeconds: integer(input.maximumCandidateAgeSeconds, 0, 604_800, code),
    maximumFutureSkewSeconds: integer(input.maximumFutureSkewSeconds, 0, 604_800, code),
    maximumReviewValiditySeconds: integer(input.maximumReviewValiditySeconds, 1, 604_800, code),
    partialSourceOmissionDecision: exact(input.partialSourceOmissionDecision, "reject", code),
    policyId: identifier(input.policyId, code),
    productId: identifier(input.productId, code),
    profileVersion: exact(input.profileVersion, PROFILE, code),
    providerId: identifier(input.providerId, code),
    requiredEvidenceSha256,
    requireReviewForMaterialChanges: exact(input.requireReviewForMaterialChanges, true, code),
    schemaVersion: exact(input.schemaVersion, POLICY_SCHEMA, code),
    sourceSeriesId: identifier(input.sourceSeriesId, code),
    trustedReviewerKeyIds,
    unknownRiskDecision: exact(input.unknownRiskDecision, "reject", code),
  };
}

export function parsePolicyBytes(bytes: Uint8Array): AdmissionPolicy {
  const transported = parseJsonBytes(bytes, 64 * 1024, "policy");
  const policy = parsePolicyValue(transported.value);
  if (canonicalJcs(policy) !== transported.source) fail("policy.bytes-noncanonical");
  return policy;
}

function parseReviewValue(value: unknown): ReviewArtifact {
  const artifactCode = "review-artifact.invalid";
  const input = object(value, artifactCode);
  exactKeys(input, ["algorithm", "claims", "schemaVersion", "signatureBase64"], artifactCode);
  const code = "review.invalid";
  const claimsInput = object(input.claims, code);
  exactKeys(claimsInput, [
    "baselineSnapshotSha256", "blockedChangeSetSha256", "candidateSnapshotSha256",
    "decisions", "diffSha256", "expiresAt", "issuedAt", "nonceSha256", "notBefore",
    "policySha256", "purpose", "requiredEvidenceSha256", "reviewId", "reviewerKeyId",
    "schemaVersion", "sourceSetSha256",
  ], code);
  const decisions = list(claimsInput.decisions, 1, 64, code).map((value): ReviewDecision => {
    const decision = object(value, code);
    exactKeys(decision, ["changeId", "decision", "rationaleSha256"], code);
    return {
      changeId: hash(decision.changeId, code),
      decision: choose(decision.decision, ["approve", "deny"] as const, code),
      rationaleSha256: hash(decision.rationaleSha256, code),
    };
  });
  sortedUnique(decisions.map((decision) => decision.changeId), code);
  const issuedAt = timestamp(claimsInput.issuedAt, code);
  const notBefore = timestamp(claimsInput.notBefore, code);
  const expiresAt = timestamp(claimsInput.expiresAt, code);
  if (Date.parse(notBefore) < Date.parse(issuedAt) || Date.parse(expiresAt) <= Date.parse(notBefore) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > 604_800_000) fail(code);
  const evidence = list(claimsInput.requiredEvidenceSha256, 0, 16, code).map((entry) => hash(entry, code));
  sortedUnique(evidence, code);
  const reviewerKeyId = text(claimsInput.reviewerKeyId, code, 71);
  if (!KEY_ID.test(reviewerKeyId)) fail(code);
  const signatureBase64 = text(input.signatureBase64, artifactCode, 88);
  if (!/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(signatureBase64)) fail(artifactCode);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if ((alphabet.indexOf(signatureBase64[85] ?? "") & 0x0f) !== 0) fail(artifactCode);
  return {
    algorithm: exact(input.algorithm, "ed25519", artifactCode),
    claims: {
      baselineSnapshotSha256: hash(claimsInput.baselineSnapshotSha256, code),
      blockedChangeSetSha256: hash(claimsInput.blockedChangeSetSha256, code),
      candidateSnapshotSha256: hash(claimsInput.candidateSnapshotSha256, code),
      decisions,
      diffSha256: hash(claimsInput.diffSha256, code),
      expiresAt,
      issuedAt,
      nonceSha256: hash(claimsInput.nonceSha256, code),
      notBefore,
      policySha256: hash(claimsInput.policySha256, code),
      purpose: exact(claimsInput.purpose, "registry-admission-only", code),
      requiredEvidenceSha256: evidence,
      reviewId: identifier(claimsInput.reviewId, code),
      reviewerKeyId,
      schemaVersion: exact(claimsInput.schemaVersion, REVIEW_CLAIMS_SCHEMA, code),
      sourceSetSha256: hash(claimsInput.sourceSetSha256, code),
    },
    schemaVersion: exact(input.schemaVersion, REVIEW_SCHEMA, artifactCode),
    signatureBase64,
  };
}

export function parseReviewBytes(bytes: Uint8Array): ReviewArtifact {
  const transported = parseJsonBytes(bytes, 320 * 1024, "review-artifact");
  const review = parseReviewValue(transported.value);
  if (canonicalJcs(review) !== transported.source) fail("review-artifact.bytes-noncanonical");
  return review;
}
