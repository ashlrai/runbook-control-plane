import {
  canonicalJcs,
  compareCodeUnits,
  fail,
  sameBytes,
  sha256Bytes,
  sha256Jcs,
} from "./primitives.js";
import {
  ADMISSION_SCHEMA,
  DIFF_SCHEMA,
  PORTABLE_LIMITATIONS,
  PROFILE,
  type AdmissionPolicy,
  type ApprovalSemantics,
  type CapabilitySnapshot,
  type CapabilitySource,
  type FinancialCapability,
  type ReviewArtifact,
  parsePolicyBytes,
  parseReviewBytes,
  parseSnapshotBytes,
  timestamp,
} from "./schema.js";

export type CapabilityChangedField =
  | "account-scope" | "action-families" | "approval-semantics" | "capital-authority"
  | "capability-added" | "capability-omitted" | "capability-removed"
  | "credential-release" | "data-scopes" | "decision-influence"
  | "description-contract" | "identity-evidence" | "identity-kind" | "influence-path"
  | "mutation-class" | "mutation-scopes" | "provider-tool-name" | "request-contract"
  | "response-contract" | "risk-evidence" | "source-assertion" | "source-ids"
  | "state-read-domains" | "state-write-domains" | "workflow-prerequisites";
export type SourceChangedField = "source-added" | "source-authority" | "source-completeness"
  | "source-projection" | "source-public-uri" | "source-removed";

export type CapabilityChange = Readonly<{
  capabilityReferenceSha256: string;
  changeId: string;
  changedFields: readonly CapabilityChangedField[];
  currentCapabilitySha256: string | null;
  findingCodes: readonly string[];
  materiality: "material";
  previousCapabilitySha256: string | null;
}>;
export type SourceChange = Readonly<{
  changeId: string;
  changedFields: readonly SourceChangedField[];
  currentSourceSha256: string | null;
  findingCodes: readonly string[];
  materiality: "material";
  previousSourceSha256: string | null;
  sourceReferenceSha256: string;
}>;
export type CapabilityDiff = Readonly<{
  baselineSnapshotSha256: string;
  blockedChangeSetSha256: string;
  candidateSnapshotSha256: string;
  changes: readonly CapabilityChange[];
  diffSha256: string;
  limitations: typeof PORTABLE_LIMITATIONS;
  materialChangeIds: readonly string[];
  profileVersion: typeof PROFILE;
  schemaVersion: typeof DIFF_SCHEMA;
  sourceChanges: readonly SourceChange[];
  sourceSetSha256: string;
}>;

export type AdmissionCheck = Readonly<{ code: string; passed: boolean }>;
export type AdmissionReceipt = Readonly<{
  baselineSnapshotSha256: string;
  blockedChangeSetSha256: string;
  candidateSnapshotSha256: string;
  checks: readonly AdmissionCheck[];
  diffSha256: string;
  evaluatedAtDeclared: string;
  limitations: typeof PORTABLE_LIMITATIONS;
  outcome: "admit" | "no-change" | "quarantine" | "reject";
  policySha256: string;
  profileVersion: typeof PROFILE;
  reviewArtifactSha256: string | null;
  reviewSignatureVerified: boolean;
  schemaVersion: typeof ADMISSION_SCHEMA;
}>;

const CAPABILITY_REFERENCE_DOMAIN = "runbook.financial-capability-reference.v1";
const SOURCE_REFERENCE_DOMAIN = "runbook.financial-capability-source-reference.v1";
const CHANGE_DOMAIN = "runbook.financial-capability-change.v1";
const SOURCE_SET_DOMAIN = "runbook.financial-capability-source-set.v1";
const BLOCKED_SET_DOMAIN = "runbook.financial-capability-blocked-change-set.v1";
const NO_CHANGE_DOMAIN = "runbook.financial-capability-no-change-diff.v1";
const REJECTED_LINEAGE_DOMAIN = "runbook.financial-capability-rejected-lineage.v1";
const REVIEW_SIGNATURE_DOMAIN = "runbook.financial-capability-review-signature.v1\u0000";

const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort(compareCodeUnits);
const equivalent = (left: unknown, right: unknown): boolean => canonicalJcs(left) === canonicalJcs(right);

const capabilityReference = (snapshot: CapabilitySnapshot, capabilityId: string): string => sha256Jcs({
  capabilityId,
  domain: CAPABILITY_REFERENCE_DOMAIN,
  productId: snapshot.productId,
  providerId: snapshot.providerId,
  sourceSeriesId: snapshot.sourceSeriesId,
});
const sourceReference = (snapshot: CapabilitySnapshot, sourceId: string): string => sha256Jcs({
  domain: SOURCE_REFERENCE_DOMAIN,
  productId: snapshot.productId,
  providerId: snapshot.providerId,
  sourceId,
  sourceSeriesId: snapshot.sourceSeriesId,
});

const fieldReaders: readonly Readonly<{
  field: CapabilityChangedField;
  read: (value: FinancialCapability) => unknown;
}>[] = [
  { field: "account-scope", read: (value) => value.accountScope },
  { field: "action-families", read: (value) => value.actionFamilies },
  { field: "approval-semantics", read: (value) => value.approvalSemantics },
  { field: "capital-authority", read: (value) => value.capitalAuthority },
  { field: "credential-release", read: (value) => value.credentialRelease },
  { field: "data-scopes", read: (value) => value.dataScopes },
  { field: "decision-influence", read: (value) => value.decisionInfluence },
  { field: "description-contract", read: (value) => value.descriptionContract },
  { field: "identity-evidence", read: (value) => value.identityEvidence },
  { field: "identity-kind", read: (value) => value.identityKind },
  { field: "mutation-class", read: (value) => value.mutationClass },
  { field: "mutation-scopes", read: (value) => value.mutationScopes },
  { field: "provider-tool-name", read: (value) => value.providerToolName },
  { field: "request-contract", read: (value) => value.requestContract },
  { field: "response-contract", read: (value) => value.responseContract },
  { field: "risk-evidence", read: (value) => value.riskEvidence },
  { field: "source-assertion", read: (value) => value.sourceAssertionSha256 },
  { field: "source-ids", read: (value) => value.sourceIds },
  { field: "state-read-domains", read: (value) => value.stateReadDomains },
  { field: "state-write-domains", read: (value) => value.stateWriteDomains },
  { field: "workflow-prerequisites", read: (value) => value.workflowPrerequisiteCapabilityIds },
];

const changedFields = (before: FinancialCapability, after: FinancialCapability): CapabilityChangedField[] =>
  fieldReaders.filter(({ read }) => !equivalent(read(before), read(after)))
    .map(({ field }) => field).sort(compareCodeUnits);
const expandsSet = (before: readonly string[], after: readonly string[]): boolean => {
  const known = new Set(before);
  return after.some((entry) => !known.has(entry));
};

type Direction = "equal" | "stronger" | "weaker" | "incomparable";
const rankDirection = (before: string, after: string, rank: Readonly<Record<string, number>>): Direction => {
  if (before === after) return "equal";
  if (before === "unknown" || after === "unknown") return "incomparable";
  const left = rank[before]; const right = rank[after];
  return left === undefined || right === undefined ? "incomparable" : right > left ? "weaker" : "stronger";
};
const principalDirection = (before: ApprovalSemantics["enforcingPrincipal"], after: ApprovalSemantics["enforcingPrincipal"]): Direction => {
  if (before === after) return "equal";
  if (before === "unknown" || after === "unknown") return "incomparable";
  if (after === "none") return "weaker";
  if (before === "none") return "stronger";
  if (after === "joint") return "stronger";
  if (before === "joint") return "weaker";
  if (before === "external-agent" && (after === "provider" || after === "customer")) return "stronger";
  if (after === "external-agent" && (before === "provider" || before === "customer")) return "weaker";
  return "incomparable";
};
const bindingDirection = (before: ApprovalSemantics["actionBinding"], after: ApprovalSemantics["actionBinding"]): Direction => {
  if (before === after) return "equal";
  if (before === "unknown" || after === "unknown") return "incomparable";
  if (after === "none") return "weaker";
  if (before === "none") return "stronger";
  if (before === "exact-action") return "weaker";
  if (after === "exact-action") return "stronger";
  return "incomparable";
};
const expiryDirection = (before: ApprovalSemantics["expiryBinding"], after: ApprovalSemantics["expiryBinding"]): Direction => {
  if (before === after) return "equal";
  if (before === "unknown" || after === "unknown") return "incomparable";
  if (after === "none") return "weaker";
  if (before === "none") return "stronger";
  return "incomparable";
};
const bypassDirection = (before: ApprovalSemantics["bypassCondition"], after: ApprovalSemantics["bypassCondition"]): Direction => {
  if (before === after) return "equal";
  if (before === "unknown" || after === "unknown") return "incomparable";
  if (before === "none") return "weaker";
  if (after === "none") return "stronger";
  return "incomparable";
};
const approvalDirection = (before: ApprovalSemantics, after: ApprovalSemantics): Direction => {
  const directions = [
    rankDirection(before.mode, after.mode, { mandatory: 0, optional: 1, advisory: 2, none: 3 }),
    principalDirection(before.enforcingPrincipal, after.enforcingPrincipal),
    bindingDirection(before.actionBinding, after.actionBinding),
    rankDirection(before.scopeBinding, after.scopeBinding, { "single-action": 0, session: 1, "monthly-budget": 2, none: 3 }),
    expiryDirection(before.expiryBinding, after.expiryBinding),
    bypassDirection(before.bypassCondition, after.bypassCondition),
  ];
  if (directions.includes("incomparable")) return "incomparable";
  const stronger = directions.includes("stronger");
  const weaker = directions.includes("weaker");
  return stronger && weaker ? "incomparable" : weaker ? "weaker" : stronger ? "stronger" : "equal";
};

const hasUnknown = (capability: FinancialCapability): boolean =>
  capability.accountScope === "unknown" || capability.actionFamilies.includes("unknown") ||
  capability.dataScopes.includes("unknown") || capability.mutationClass === "unknown" ||
  capability.mutationScopes.includes("unknown") || capability.stateReadDomains.includes("unknown") ||
  capability.stateWriteDomains.includes("unknown") || capability.decisionInfluence === "unknown" ||
  capability.credentialRelease === "unknown" || capability.capitalAuthority.operations.includes("unknown") ||
  capability.capitalAuthority.assetScopes.includes("unknown") ||
  Object.values(capability.approvalSemantics).includes("unknown");

function introducedUnknown(before: FinancialCapability, after: FinancialCapability, fields: readonly CapabilityChangedField[]): boolean {
  if (!hasUnknown(after) || !hasUnknown(before)) return hasUnknown(after);
  const changed = new Set(fields);
  return (changed.has("account-scope") && after.accountScope === "unknown") ||
    (changed.has("action-families") && after.actionFamilies.includes("unknown")) ||
    (changed.has("data-scopes") && after.dataScopes.includes("unknown")) ||
    (changed.has("mutation-class") && after.mutationClass === "unknown") ||
    (changed.has("mutation-scopes") && after.mutationScopes.includes("unknown")) ||
    (changed.has("state-read-domains") && after.stateReadDomains.includes("unknown")) ||
    (changed.has("state-write-domains") && after.stateWriteDomains.includes("unknown")) ||
    (changed.has("decision-influence") && after.decisionInfluence === "unknown") ||
    (changed.has("credential-release") && after.credentialRelease === "unknown") ||
    (changed.has("capital-authority") && (after.capitalAuthority.operations.includes("unknown") ||
      after.capitalAuthority.assetScopes.includes("unknown"))) ||
    (changed.has("approval-semantics") && Object.values(after.approvalSemantics).includes("unknown"));
}

function findings(before: FinancialCapability, after: FinancialCapability, fields: readonly CapabilityChangedField[]): string[] {
  const changed = new Set(fields);
  const output: string[] = [];
  if (changed.has("provider-tool-name")) output.push("capability-renamed");
  if (changed.has("description-contract")) output.push("capability-description-changed");
  if (changed.has("request-contract")) {
    output.push("capability-input-schema-changed");
    if (before.requestContract.state === "known" && after.requestContract.state !== "known") output.push("capability-schema-visibility-lost");
  }
  if (changed.has("response-contract")) {
    output.push("capability-output-schema-changed");
    if (before.responseContract.state === "known" && after.responseContract.state !== "known") output.push("capability-schema-visibility-lost");
  }
  if (changed.has("action-families")) output.push("capability-action-families-changed");
  if (changed.has("account-scope")) {
    output.push("capability-account-scope-changed");
    const prior = before.accountScope; const current = after.accountScope;
    if (current !== "none" && (prior === "none" || ["all-linked-accounts", "provider-defined", "unknown"].includes(current) ||
      (prior !== "all-linked-accounts" && prior !== current))) output.push("capability-account-scope-expanded");
  }
  if (changed.has("data-scopes")) {
    output.push("capability-data-scope-changed");
    if (expandsSet(before.dataScopes, after.dataScopes)) output.push("capability-data-scope-expanded");
  }
  if (changed.has("mutation-class")) {
    output.push("capability-mutation-class-changed");
    if (["capital-moving", "emergency", "reversible"].includes(before.mutationClass) && after.mutationClass === "read") {
      output.push("capability-risk-classification-reduced");
    }
  }
  if (changed.has("mutation-scopes")) {
    output.push("capability-mutation-scope-changed");
    if (expandsSet(before.mutationScopes, after.mutationScopes)) output.push("capability-mutation-scope-expanded");
  }
  if (changed.has("credential-release")) {
    output.push("capability-credential-release-changed");
    if (after.credentialRelease !== "none" && (before.credentialRelease === "none" ||
      after.credentialRelease === "unknown" || before.credentialRelease !== "unknown")) {
      output.push("capability-credential-release-expanded");
    }
  }
  if (changed.has("capital-authority")) {
    output.push("capability-capital-authority-changed");
    if (expandsSet(before.capitalAuthority.operations, after.capitalAuthority.operations) ||
      expandsSet(before.capitalAuthority.assetScopes, after.capitalAuthority.assetScopes)) output.push("capability-capital-authority-expanded");
  }
  if (changed.has("approval-semantics")) {
    output.push("capability-approval-semantics-changed");
    const direction = approvalDirection(before.approvalSemantics, after.approvalSemantics);
    if (direction === "weaker") output.push("capability-approval-semantics-weakened");
    if (direction === "incomparable") output.push("capability-approval-semantics-incomparable");
  }
  if (changed.has("decision-influence")) output.push("capability-decision-influence-changed");
  if (changed.has("state-read-domains")) output.push("capability-state-read-domains-changed");
  if (changed.has("state-write-domains")) output.push("capability-state-write-domains-changed");
  if (changed.has("workflow-prerequisites")) {
    output.push("capability-workflow-prerequisites-changed");
    const current = new Set(after.workflowPrerequisiteCapabilityIds);
    if (before.workflowPrerequisiteCapabilityIds.some((entry) => !current.has(entry))) output.push("capability-workflow-prerequisite-removed");
  }
  if (["source-assertion", "source-ids", "identity-evidence", "risk-evidence", "identity-kind"]
    .some((field) => changed.has(field as CapabilityChangedField))) output.push("source-assertion-changed");
  if (introducedUnknown(before, after, fields)) output.push("capability-unknown-risk-semantics");
  output.push("policy-coverage-invalidated", "review-required", "scenarios-rerun-required");
  return sorted(output);
}

const changeId = (value: Readonly<Record<string, unknown>>): string => sha256Jcs({ domain: CHANGE_DOMAIN, ...value });
function capabilityChange(
  snapshot: CapabilitySnapshot,
  before: FinancialCapability | null,
  after: FinancialCapability | null,
  fields: readonly CapabilityChangedField[],
  findingCodes: readonly string[],
): CapabilityChange {
  const capabilityId = before?.capabilityId ?? after?.capabilityId;
  if (capabilityId === undefined) fail("diff.internal-invalid");
  const body = {
    capabilityReferenceSha256: capabilityReference(snapshot, capabilityId as string),
    changedFields: [...fields].sort(compareCodeUnits),
    currentCapabilitySha256: after === null ? null : sha256Jcs(after),
    findingCodes: sorted(findingCodes),
    materiality: "material" as const,
    previousCapabilitySha256: before === null ? null : sha256Jcs(before),
  };
  return { ...body, changeId: changeId(body) };
}
function sourceChange(
  snapshot: CapabilitySnapshot,
  sourceId: string,
  before: CapabilitySource | null,
  after: CapabilitySource | null,
  fields: readonly SourceChangedField[],
  findingCodes: readonly string[],
): SourceChange {
  const body = {
    changedFields: [...fields].sort(compareCodeUnits),
    currentSourceSha256: after === null ? null : sha256Jcs(after),
    findingCodes: sorted(findingCodes),
    materiality: "material" as const,
    previousSourceSha256: before === null ? null : sha256Jcs(before),
    sourceReferenceSha256: sourceReference(snapshot, sourceId),
  };
  return { ...body, changeId: changeId(body) };
}

type Path = Readonly<{ key: string; readerId: string; writerId: string }>;
function influencePaths(snapshot: CapabilitySnapshot): Path[] {
  const output: Path[] = [];
  for (const writer of snapshot.capabilities) {
    for (const domain of writer.stateWriteDomains) {
      if (domain === "none" || domain === "unknown") continue;
      for (const reader of snapshot.capabilities) {
        const terminal = reader.decisionInfluence !== "none" || reader.capitalAuthority.operations.length > 0 ||
          reader.actionFamilies.some((family) => ["order-management", "order-review", "order-submission", "purchase-execution"].includes(family));
        if (terminal && reader.stateReadDomains.includes(domain)) output.push({
          key: `${writer.capabilityId}\u0000${domain}\u0000${reader.capabilityId}`,
          readerId: reader.capabilityId,
          writerId: writer.capabilityId,
        });
      }
    }
  }
  return output;
}

function addInfluence(changes: CapabilityChange[], snapshot: CapabilitySnapshot, capabilityId: string): void {
  const reference = capabilityReference(snapshot, capabilityId);
  const index = changes.findIndex((change) => change.capabilityReferenceSha256 === reference);
  const original = changes[index];
  if (index < 0 || original === undefined) return;
  const body = {
    capabilityReferenceSha256: original.capabilityReferenceSha256,
    changedFields: sorted([...original.changedFields, "influence-path"]) as CapabilityChangedField[],
    currentCapabilitySha256: original.currentCapabilitySha256,
    findingCodes: sorted([...original.findingCodes, "capability-state-influence-path-added", "scenarios-rerun-required"]),
    materiality: "material" as const,
    previousCapabilitySha256: original.previousCapabilitySha256,
  };
  changes[index] = { ...body, changeId: changeId(body) };
}

export function recomputeCapabilityDiff(baseline: CapabilitySnapshot, candidate: CapabilitySnapshot): CapabilityDiff {
  if (baseline.providerId !== candidate.providerId) fail("registry-provider-mismatch");
  if (baseline.productId !== candidate.productId) fail("registry-product-mismatch");
  if (baseline.profileVersion !== candidate.profileVersion) fail("registry-profile-mismatch");
  if (baseline.sourceSeriesId !== candidate.sourceSeriesId) fail("registry-source-series-mismatch");
  if (candidate.previousAdmittedSnapshotSha256 !== sha256Jcs(baseline)) fail("registry-baseline-mismatch");
  if (candidate.registryRevision !== baseline.registryRevision + 1) fail("registry-revision-invalid");
  if (Date.parse(candidate.observedAtDeclared) < Date.parse(baseline.observedAtDeclared)) fail("snapshot-time-regressed");
  const oldSources = new Map(baseline.sources.map((source) => [source.sourceId, source]));
  if (candidate.sources.some((source) => {
    const previous = oldSources.get(source.sourceId);
    return previous !== undefined && Date.parse(source.retrievedAtDeclared) < Date.parse(previous.retrievedAtDeclared);
  })) fail("snapshot-time-regressed");
  const before = new Map(baseline.capabilities.map((capability) => [capability.capabilityId, capability]));
  const after = new Map(candidate.capabilities.map((capability) => [capability.capabilityId, capability]));
  const changes: CapabilityChange[] = [];
  const changedSourceIds = new Set<string>();
  const changedCapabilityIds = new Set<string>();
  for (const id of sorted([...before.keys(), ...after.keys()])) {
    const previous = before.get(id) ?? null;
    const current = after.get(id) ?? null;
    if (previous === null && current !== null) {
      changedCapabilityIds.add(id); current.sourceIds.forEach((sourceId) => changedSourceIds.add(sourceId));
      const codes = ["capability-added", "policy-coverage-invalidated", "review-required", "scenarios-rerun-required"];
      if (hasUnknown(current)) codes.push("capability-unknown-risk-semantics");
      changes.push(capabilityChange(candidate, null, current, ["capability-added"], codes));
    } else if (previous !== null && current === null) {
      changedCapabilityIds.add(id); previous.sourceIds.forEach((sourceId) => changedSourceIds.add(sourceId));
      const removalEstablished = previous.sourceIds.every((sourceId) =>
        candidate.sources.find((source) => source.sourceId === sourceId)?.completeness === "complete-enumeration");
      changes.push(removalEstablished
        ? capabilityChange(candidate, previous, null, ["capability-removed"], ["capability-removed", "policy-coverage-invalidated", "review-required", "scenarios-rerun-required"])
        : capabilityChange(candidate, previous, null, ["capability-omitted"], ["source-completeness-insufficient"]));
    } else if (previous !== null && current !== null) {
      const fields = changedFields(previous, current);
      if (fields.length === 0) continue;
      changedCapabilityIds.add(id);
      previous.sourceIds.forEach((sourceId) => changedSourceIds.add(sourceId));
      current.sourceIds.forEach((sourceId) => changedSourceIds.add(sourceId));
      changes.push(capabilityChange(candidate, previous, current, fields, findings(previous, current, fields)));
    }
  }
  const priorPaths = new Set(influencePaths(baseline).map((path) => path.key));
  for (const path of influencePaths(candidate)) {
    if (priorPaths.has(path.key)) continue;
    if (changedCapabilityIds.has(path.writerId)) addInfluence(changes, candidate, path.writerId);
    if (changedCapabilityIds.has(path.readerId)) addInfluence(changes, candidate, path.readerId);
  }
  changes.sort((left, right) => compareCodeUnits(left.changeId, right.changeId));
  const currentSources = new Map(candidate.sources.map((source) => [source.sourceId, source]));
  const sourceChanges: SourceChange[] = [];
  for (const sourceId of sorted([...oldSources.keys(), ...currentSources.keys()])) {
    const previous = oldSources.get(sourceId) ?? null;
    const current = currentSources.get(sourceId) ?? null;
    if (previous === null && current !== null) sourceChanges.push(sourceChange(candidate, sourceId, null, current, ["source-added"], ["review-required", "source-added", "source-set-changed"]));
    else if (previous !== null && current === null) sourceChanges.push(sourceChange(candidate, sourceId, previous, null, ["source-removed"], ["review-required", "source-removed", "source-set-changed"]));
    else if (previous !== null && current !== null) {
      const fields: SourceChangedField[] = [];
      if (previous.authority !== current.authority) fields.push("source-authority");
      if (previous.completeness !== current.completeness) fields.push("source-completeness");
      if (previous.publicUri !== current.publicUri) fields.push("source-public-uri");
      if (previous.sourceProjectionSha256 !== current.sourceProjectionSha256 && !changedSourceIds.has(sourceId)) fields.push("source-projection");
      if (fields.length > 0) sourceChanges.push(sourceChange(candidate, sourceId, previous, current, fields, ["review-required", "source-record-changed", "source-set-changed"]));
    }
  }
  sourceChanges.sort((left, right) => compareCodeUnits(left.changeId, right.changeId));
  const materialChangeIds = sorted([...changes.map((change) => change.changeId), ...sourceChanges.map((change) => change.changeId)]);
  const body = {
    baselineSnapshotSha256: sha256Jcs(baseline),
    blockedChangeSetSha256: sha256Jcs({ domain: BLOCKED_SET_DOMAIN, materialChangeIds }),
    candidateSnapshotSha256: sha256Jcs(candidate),
    changes,
    limitations: PORTABLE_LIMITATIONS,
    materialChangeIds,
    profileVersion: PROFILE,
    schemaVersion: DIFF_SCHEMA,
    sourceChanges,
    sourceSetSha256: sha256Jcs({
      baselineSourcesSha256: sha256Jcs(baseline.sources),
      candidateSourcesSha256: sha256Jcs(candidate.sources),
      domain: SOURCE_SET_DOMAIN,
    }),
  };
  return { ...body, diffSha256: sha256Jcs(body) };
}

export const serializeCapabilityDiff = (diff: CapabilityDiff): Uint8Array =>
  new TextEncoder().encode(canonicalJcs(diff));
export const serializeAdmissionReceipt = (receipt: AdmissionReceipt): Uint8Array =>
  new TextEncoder().encode(canonicalJcs(receipt));

const admissionCheck = (code: string, passed: boolean): AdmissionCheck => ({ code, passed });
const failureChecks = (codes: readonly string[]): AdmissionCheck[] =>
  sorted(codes).map((code) => admissionCheck(code, false));
function admissionReceipt(
  baselineSnapshotSha256: string,
  blockedChangeSetSha256: string,
  candidateSnapshotSha256: string,
  checks: readonly AdmissionCheck[],
  diffSha256: string,
  evaluatedAtDeclared: string,
  outcome: AdmissionReceipt["outcome"],
  policySha256: string,
  reviewArtifactSha256: string | null,
  reviewSignatureVerified: boolean,
): AdmissionReceipt {
  return {
    baselineSnapshotSha256,
    blockedChangeSetSha256,
    candidateSnapshotSha256,
    checks: [...checks].sort((left, right) => compareCodeUnits(left.code, right.code)),
    diffSha256,
    evaluatedAtDeclared,
    limitations: PORTABLE_LIMITATIONS,
    outcome,
    policySha256,
    profileVersion: PROFILE,
    reviewArtifactSha256,
    reviewSignatureVerified,
    schemaVersion: ADMISSION_SCHEMA,
  };
}

const stringsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);
const policyMatches = (policy: AdmissionPolicy, snapshot: CapabilitySnapshot): boolean =>
  policy.profileVersion === snapshot.profileVersion && policy.productId === snapshot.productId &&
  policy.providerId === snapshot.providerId && policy.sourceSeriesId === snapshot.sourceSeriesId;
const sourceAuthorityAllowed = (policy: AdmissionPolicy, snapshot: CapabilitySnapshot): boolean => {
  const allowed = new Set(policy.allowedSourceAuthorities);
  return snapshot.sources.every((source) => allowed.has(source.authority));
};

function candidateTimeFailureCodes(
  policy: AdmissionPolicy,
  snapshot: CapabilitySnapshot,
  evaluatedAt: number,
): string[] {
  const declared = [
    Date.parse(snapshot.observedAtDeclared),
    ...snapshot.sources.map((source) => Date.parse(source.retrievedAtDeclared)),
  ];
  const output: string[] = [];
  if (declared.some((value) => value - evaluatedAt > policy.maximumFutureSkewSeconds * 1_000)) {
    output.push("snapshot-time-future");
  }
  if (declared.some((value) => evaluatedAt - value > policy.maximumCandidateAgeSeconds * 1_000)) {
    output.push("snapshot-stale");
  }
  return output;
}

function lineageFailureCodes(
  baseline: CapabilitySnapshot,
  candidate: CapabilitySnapshot,
  baselineDigest: string,
): string[] {
  const output: string[] = [];
  if (baseline.providerId !== candidate.providerId) output.push("registry-provider-mismatch");
  if (baseline.productId !== candidate.productId) output.push("registry-product-mismatch");
  if (baseline.profileVersion !== candidate.profileVersion) output.push("registry-profile-mismatch");
  if (baseline.sourceSeriesId !== candidate.sourceSeriesId) output.push("registry-source-series-mismatch");
  if (candidate.previousAdmittedSnapshotSha256 !== baselineDigest) output.push("registry-baseline-mismatch");
  if (candidate.registryRevision !== baseline.registryRevision + 1) output.push("registry-revision-invalid");
  if (Date.parse(candidate.observedAtDeclared) < Date.parse(baseline.observedAtDeclared)) {
    output.push("snapshot-time-regressed");
  }
  const sources = new Map(baseline.sources.map((source) => [source.sourceId, source]));
  if (candidate.sources.some((source) => {
    const previous = sources.get(source.sourceId);
    return previous !== undefined && Date.parse(source.retrievedAtDeclared) < Date.parse(previous.retrievedAtDeclared);
  })) output.push("snapshot-time-regressed");
  return sorted(output);
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}
function decodeSignature(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    if (binary.length !== 64 || btoa(binary) !== value) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return null; }
}
async function verifyReview(review: ReviewArtifact, spki: Uint8Array): Promise<Readonly<{ keyId: string | null; valid: boolean }>> {
  if (!(spki instanceof Uint8Array) || spki.byteLength < 32 || spki.byteLength > 1_024) return { keyId: null, valid: false };
  const owned = new Uint8Array(spki);
  const keyId = `sha256:${sha256Bytes(owned)}`;
  if (review.claims.reviewerKeyId !== keyId) return { keyId, valid: false };
  const signature = decodeSignature(review.signatureBase64);
  if (signature === null) return { keyId, valid: false };
  try {
    const publicKey = await crypto.subtle.importKey("spki", ownedBuffer(owned), { name: "Ed25519" }, false, ["verify"]);
    const signingBytes = new TextEncoder().encode(`${REVIEW_SIGNATURE_DOMAIN}${canonicalJcs(review.claims)}`);
    return {
      keyId,
      valid: await crypto.subtle.verify({ name: "Ed25519" }, publicKey, ownedBuffer(signature), ownedBuffer(signingBytes)),
    };
  } catch { return { keyId, valid: false }; }
}

export type AdmissionBytesInput = Readonly<{
  baselineSnapshotBytes: Uint8Array;
  candidateSnapshotBytes: Uint8Array;
  evaluatedAtDeclared: string;
  policyBytes: Uint8Array;
  reviewerSpkiBytes?: Uint8Array;
  reviewArtifactBytes?: Uint8Array;
}>;

/** Independently parses exact inputs, rebuilds the semantic diff, then evaluates admission. */
export async function evaluateAdmissionBytes(input: AdmissionBytesInput): Promise<AdmissionReceipt> {
  const evaluatedAtDeclared = timestamp(input.evaluatedAtDeclared, "admission.evaluated-at-invalid");
  const evaluatedAt = Date.parse(evaluatedAtDeclared);
  const baseline = parseSnapshotBytes(input.baselineSnapshotBytes);
  const candidate = parseSnapshotBytes(input.candidateSnapshotBytes);
  const policy = parsePolicyBytes(input.policyBytes);
  const baselineDigest = sha256Jcs(baseline);
  const candidateDigest = sha256Jcs(candidate);
  const policyDigest = sha256Jcs(policy);
  const policyIdentityValid = policyMatches(policy, baseline) && policyMatches(policy, candidate);
  const sourceAuthorityValid = sourceAuthorityAllowed(policy, baseline) && sourceAuthorityAllowed(policy, candidate);
  const candidateTimeValid = [Date.parse(candidate.observedAtDeclared), ...candidate.sources.map((source) => Date.parse(source.retrievedAtDeclared))]
    .every((declared) => declared - evaluatedAt <= policy.maximumFutureSkewSeconds * 1_000 &&
      evaluatedAt - declared <= policy.maximumCandidateAgeSeconds * 1_000);
  if (sameBytes(input.baselineSnapshotBytes, input.candidateSnapshotBytes)) {
    const checks = [
      admissionCheck("candidate-time-valid", candidateTimeValid), admissionCheck("no-change-exact", true),
      admissionCheck("policy-identity-valid", policyIdentityValid), admissionCheck("source-authority-valid", sourceAuthorityValid),
      ...failureChecks([
        ...candidateTimeFailureCodes(policy, candidate, evaluatedAt),
        ...(sourceAuthorityValid ? [] : ["source-authority-untrusted"]),
      ]),
    ];
    return admissionReceipt(baselineDigest, sha256Jcs({ domain: BLOCKED_SET_DOMAIN, materialChangeIds: [] }), candidateDigest,
      checks, sha256Jcs({ baselineSnapshotSha256: baselineDigest, candidateSnapshotSha256: candidateDigest, domain: NO_CHANGE_DOMAIN }),
      evaluatedAtDeclared, checks.every((entry) => entry.passed) ? "no-change" : "reject", policyDigest, null, false);
  }
  const lineageValid = baseline.providerId === candidate.providerId && baseline.productId === candidate.productId &&
    baseline.profileVersion === candidate.profileVersion && baseline.sourceSeriesId === candidate.sourceSeriesId &&
    candidate.previousAdmittedSnapshotSha256 === baselineDigest && candidate.registryRevision === baseline.registryRevision + 1 &&
    Date.parse(candidate.observedAtDeclared) >= Date.parse(baseline.observedAtDeclared) && candidate.sources.every((source) => {
      const previous = baseline.sources.find((entry) => entry.sourceId === source.sourceId);
      return previous === undefined || Date.parse(source.retrievedAtDeclared) >= Date.parse(previous.retrievedAtDeclared);
    });
  if (!lineageValid || !policyIdentityValid || !sourceAuthorityValid || !candidateTimeValid) {
    const checks = [admissionCheck("candidate-time-valid", candidateTimeValid), admissionCheck("lineage-valid", lineageValid),
      admissionCheck("policy-identity-valid", policyIdentityValid), admissionCheck("source-authority-valid", sourceAuthorityValid),
      ...failureChecks([
        ...lineageFailureCodes(baseline, candidate, baselineDigest),
        ...candidateTimeFailureCodes(policy, candidate, evaluatedAt),
        ...(sourceAuthorityValid ? [] : ["source-authority-untrusted"]),
      ])];
    const evidence = { baselineSnapshotSha256: baselineDigest, candidateSnapshotSha256: candidateDigest, domain: REJECTED_LINEAGE_DOMAIN };
    return admissionReceipt(baselineDigest, sha256Jcs({ ...evidence, kind: "blocked-change-set" }), candidateDigest,
      checks, sha256Jcs({ ...evidence, kind: "diff" }), evaluatedAtDeclared, "reject", policyDigest, null, false);
  }
  const diff = recomputeCapabilityDiff(baseline, candidate);
  const partialOmission = diff.changes.some((change) => change.findingCodes.includes("source-completeness-insufficient"));
  const unknownRisk = diff.changes.some((change) => change.findingCodes.includes("capability-unknown-risk-semantics"));
  const checks = [admissionCheck("candidate-time-valid", true), admissionCheck("lineage-valid", true),
    admissionCheck("partial-source-omission-absent", !partialOmission), admissionCheck("policy-identity-valid", true),
    admissionCheck("source-authority-valid", true), admissionCheck("unknown-risk-absent", !unknownRisk),
    ...failureChecks([
      ...(partialOmission ? ["source-completeness-insufficient"] : []),
      ...(unknownRisk ? ["capability-unknown-risk-semantics"] : []),
    ])];
  if (partialOmission || unknownRisk) return admissionReceipt(diff.baselineSnapshotSha256, diff.blockedChangeSetSha256,
    diff.candidateSnapshotSha256, checks, diff.diffSha256, evaluatedAtDeclared, "reject", policyDigest, null, false);
  if (diff.materialChangeIds.length === 0) return admissionReceipt(diff.baselineSnapshotSha256, diff.blockedChangeSetSha256,
    diff.candidateSnapshotSha256, [...checks, admissionCheck("material-review-satisfied", true)], diff.diffSha256,
    evaluatedAtDeclared, "admit", policyDigest, null, false);
  if (input.reviewArtifactBytes === undefined || input.reviewerSpkiBytes === undefined) return admissionReceipt(
    diff.baselineSnapshotSha256, diff.blockedChangeSetSha256, diff.candidateSnapshotSha256,
    [...checks, admissionCheck("material-review-satisfied", false), admissionCheck("review-required", false)], diff.diffSha256, evaluatedAtDeclared,
    "quarantine", policyDigest, null, false);
  const review = parseReviewBytes(input.reviewArtifactBytes);
  const signature = await verifyReview(review, input.reviewerSpkiBytes);
  const claims = review.claims;
  const bindingsValid = claims.baselineSnapshotSha256 === diff.baselineSnapshotSha256 &&
    claims.blockedChangeSetSha256 === diff.blockedChangeSetSha256 && claims.candidateSnapshotSha256 === diff.candidateSnapshotSha256 &&
    claims.diffSha256 === diff.diffSha256 && claims.policySha256 === policyDigest && claims.sourceSetSha256 === diff.sourceSetSha256;
  const decisionsExact = stringsEqual(claims.decisions.map((entry) => entry.changeId), diff.materialChangeIds);
  const evidenceExact = stringsEqual(claims.requiredEvidenceSha256, policy.requiredEvidenceSha256);
  const reviewTimeValid = evaluatedAt >= Date.parse(claims.notBefore) && evaluatedAt < Date.parse(claims.expiresAt) &&
    Date.parse(claims.expiresAt) - Date.parse(claims.issuedAt) <= policy.maximumReviewValiditySeconds * 1_000;
  const reviewerTrusted = signature.keyId !== null && policy.trustedReviewerKeyIds.includes(signature.keyId);
  const reviewChecks = [...checks, admissionCheck("review-bindings-valid", bindingsValid),
    admissionCheck("review-decisions-approve", claims.decisions.every((entry) => entry.decision === "approve")),
    admissionCheck("review-decisions-exact", decisionsExact), admissionCheck("review-evidence-exact", evidenceExact),
    admissionCheck("review-signature-valid", signature.valid), admissionCheck("review-time-valid", reviewTimeValid),
    admissionCheck("reviewer-trusted", reviewerTrusted),
    ...failureChecks([
      ...(bindingsValid ? [] : ["review-binding-mismatch"]),
      ...(claims.decisions.every((entry) => entry.decision === "approve") ? [] : ["review-denied"]),
      ...(decisionsExact ? [] : ["review-change-uncovered"]),
      ...(evidenceExact ? [] : policy.requiredEvidenceSha256.some((digest) => !claims.requiredEvidenceSha256.includes(digest))
        ? ["review-evidence-missing"] : ["review-evidence-mismatch"]),
      ...(signature.valid ? [] : ["review-signature-invalid"]),
      ...(evaluatedAt < Date.parse(claims.notBefore) ? ["review-not-yet-valid"] : []),
      ...(evaluatedAt >= Date.parse(claims.expiresAt) ||
        Date.parse(claims.expiresAt) - Date.parse(claims.issuedAt) > policy.maximumReviewValiditySeconds * 1_000
        ? ["review-expired"] : []),
      ...(reviewerTrusted ? [] : ["review-authority-untrusted"]),
    ])];
  const allPassed = reviewChecks.every((entry) => entry.passed);
  const bindingFailure = !bindingsValid || !decisionsExact || !evidenceExact || !signature.valid || !reviewTimeValid || !reviewerTrusted;
  return admissionReceipt(diff.baselineSnapshotSha256, diff.blockedChangeSetSha256, diff.candidateSnapshotSha256,
    reviewChecks, diff.diffSha256, evaluatedAtDeclared, allPassed ? "admit" : bindingFailure ? "reject" : "quarantine",
    policyDigest, sha256Jcs(review), signature.valid);
}
