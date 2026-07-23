import { canonicalizeJcs, rawStringCompare, sha256Jcs } from "./canonical.js";
import {
  CAPABILITY_DIFF_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  PORTABLE_LIMITATIONS,
  type ApprovalSemanticsV1,
  type CapabilityChangedFieldV1,
  type CapabilityChangeEvidenceV1,
  type CapabilityDiffV1,
  type CapabilitySnapshotV1,
  type FinancialCapabilityV1,
  type SourceChangedFieldV1,
  type SourceChangeEvidenceV1,
} from "./types.js";
import {
  RegistryValidationError,
  parseCapabilitySnapshot,
} from "./validate.js";

const CAPABILITY_REFERENCE_DOMAIN =
  "runbook.financial-capability-reference.v1" as const;
const CHANGE_ID_DOMAIN = "runbook.financial-capability-change.v1" as const;
const SOURCE_SET_DOMAIN = "runbook.financial-capability-source-set.v1" as const;
const SOURCE_REFERENCE_DOMAIN =
  "runbook.financial-capability-source-reference.v1" as const;
const BLOCKED_CHANGE_SET_DOMAIN =
  "runbook.financial-capability-blocked-change-set.v1" as const;

const compare = (left: string, right: string): number =>
  rawStringCompare(left, right);
const uniqueSorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort(compare);
const same = (left: unknown, right: unknown): boolean =>
  canonicalizeJcs(left) === canonicalizeJcs(right);

function fail(code: string): never {
  throw new RegistryValidationError(code);
}

function assertContinuity(
  baseline: CapabilitySnapshotV1,
  candidate: CapabilitySnapshotV1,
): void {
  if (baseline.providerId !== candidate.providerId) fail("registry-provider-mismatch");
  if (baseline.productId !== candidate.productId) fail("registry-product-mismatch");
  if (baseline.profileVersion !== candidate.profileVersion) fail("registry-profile-mismatch");
  if (baseline.sourceSeriesId !== candidate.sourceSeriesId) {
    fail("registry-source-series-mismatch");
  }
  if (candidate.previousAdmittedSnapshotSha256 !== sha256Jcs(baseline)) {
    fail("registry-baseline-mismatch");
  }
  if (candidate.registryRevision !== baseline.registryRevision + 1) {
    fail("registry-revision-invalid");
  }
  if (Date.parse(candidate.observedAtDeclared) < Date.parse(baseline.observedAtDeclared)) {
    fail("snapshot-time-regressed");
  }
  const baselineSources = new Map(
    baseline.sources.map((source) => [source.sourceId, source]),
  );
  if (candidate.sources.some((source) => {
    const previous = baselineSources.get(source.sourceId);
    return previous !== undefined &&
      Date.parse(source.retrievedAtDeclared) < Date.parse(previous.retrievedAtDeclared);
  })) {
    fail("snapshot-time-regressed");
  }
}

function capabilityReferenceSha256(
  snapshot: CapabilitySnapshotV1,
  capabilityId: string,
): string {
  return sha256Jcs({
    capabilityId,
    domain: CAPABILITY_REFERENCE_DOMAIN,
    productId: snapshot.productId,
    providerId: snapshot.providerId,
    sourceSeriesId: snapshot.sourceSeriesId,
  });
}

function sourceReferenceSha256(
  snapshot: CapabilitySnapshotV1,
  sourceId: string,
): string {
  return sha256Jcs({
    domain: SOURCE_REFERENCE_DOMAIN,
    productId: snapshot.productId,
    providerId: snapshot.providerId,
    sourceId,
    sourceSeriesId: snapshot.sourceSeriesId,
  });
}

const fieldReaders: readonly Readonly<{
  field: CapabilityChangedFieldV1;
  read: (capability: FinancialCapabilityV1) => unknown;
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
  {
    field: "workflow-prerequisites",
    read: (value) => value.workflowPrerequisiteCapabilityIds,
  },
];

function changedFields(
  previous: FinancialCapabilityV1,
  current: FinancialCapabilityV1,
): CapabilityChangedFieldV1[] {
  return fieldReaders
    .filter(({ read }) => !same(read(previous), read(current)))
    .map(({ field }) => field)
    .sort(compare);
}

function isSetExpansion(
  previous: readonly string[],
  current: readonly string[],
): boolean {
  const prior = new Set(previous);
  return current.some((value) => !prior.has(value));
}

function isAccountScopeExpansion(
  previous: FinancialCapabilityV1["accountScope"],
  current: FinancialCapabilityV1["accountScope"],
): boolean {
  if (previous === current || current === "none") return false;
  if (previous === "none") return true;
  if (
    current === "all-linked-accounts" ||
    current === "provider-defined" ||
    current === "unknown"
  ) {
    return true;
  }
  return previous !== "all-linked-accounts" && previous !== current;
}

function isCredentialExpansion(
  previous: FinancialCapabilityV1["credentialRelease"],
  current: FinancialCapabilityV1["credentialRelease"],
): boolean {
  if (previous === current || current === "none") return false;
  return previous === "none" || current === "unknown" || previous !== "unknown";
}

type Direction = "equal" | "stronger" | "weaker" | "incomparable";

function rankedDirection(
  previous: string,
  current: string,
  rank: Readonly<Record<string, number>>,
): Direction {
  if (previous === current) return "equal";
  if (previous === "unknown" || current === "unknown") return "incomparable";
  const before = rank[previous];
  const after = rank[current];
  if (before === undefined || after === undefined) return "incomparable";
  return after > before ? "weaker" : "stronger";
}

function enforcingPrincipalDirection(
  previous: ApprovalSemanticsV1["enforcingPrincipal"],
  current: ApprovalSemanticsV1["enforcingPrincipal"],
): Direction {
  if (previous === current) return "equal";
  if (previous === "unknown" || current === "unknown") return "incomparable";
  if (current === "none") return "weaker";
  if (previous === "none") return "stronger";
  if (current === "joint") return "stronger";
  if (previous === "joint") return "weaker";
  if (previous === "provider" && current === "external-agent") return "weaker";
  if (previous === "customer" && current === "external-agent") return "weaker";
  if (current === "provider" && previous === "external-agent") return "stronger";
  if (current === "customer" && previous === "external-agent") return "stronger";
  return "incomparable";
}

function actionBindingDirection(
  previous: ApprovalSemanticsV1["actionBinding"],
  current: ApprovalSemanticsV1["actionBinding"],
): Direction {
  if (previous === current) return "equal";
  if (previous === "unknown" || current === "unknown") return "incomparable";
  if (current === "none") return "weaker";
  if (previous === "none") return "stronger";
  if (previous === "exact-action") return "weaker";
  if (current === "exact-action") return "stronger";
  return "incomparable";
}

function expiryDirection(
  previous: ApprovalSemanticsV1["expiryBinding"],
  current: ApprovalSemanticsV1["expiryBinding"],
): Direction {
  if (previous === current) return "equal";
  if (previous === "unknown" || current === "unknown") return "incomparable";
  if (current === "none") return "weaker";
  if (previous === "none") return "stronger";
  return "incomparable";
}

function bypassDirection(
  previous: ApprovalSemanticsV1["bypassCondition"],
  current: ApprovalSemanticsV1["bypassCondition"],
): Direction {
  if (previous === current) return "equal";
  if (previous === "unknown" || current === "unknown") return "incomparable";
  if (previous === "none") return "weaker";
  if (current === "none") return "stronger";
  return "incomparable";
}

function approvalDirection(
  previous: ApprovalSemanticsV1,
  current: ApprovalSemanticsV1,
): Direction {
  const directions: Direction[] = [
    rankedDirection(previous.mode, current.mode, {
      advisory: 2,
      mandatory: 0,
      none: 3,
      optional: 1,
    }),
    enforcingPrincipalDirection(previous.enforcingPrincipal, current.enforcingPrincipal),
    actionBindingDirection(previous.actionBinding, current.actionBinding),
    rankedDirection(previous.scopeBinding, current.scopeBinding, {
      "monthly-budget": 2,
      none: 3,
      session: 1,
      "single-action": 0,
    }),
    expiryDirection(previous.expiryBinding, current.expiryBinding),
    bypassDirection(previous.bypassCondition, current.bypassCondition),
  ];
  if (directions.includes("incomparable")) return "incomparable";
  const stronger = directions.includes("stronger");
  const weaker = directions.includes("weaker");
  if (stronger && weaker) return "incomparable";
  if (weaker) return "weaker";
  if (stronger) return "stronger";
  return "equal";
}

function hasUnknownSemantics(capability: FinancialCapabilityV1): boolean {
  return (
    capability.accountScope === "unknown" ||
    capability.actionFamilies.includes("unknown") ||
    capability.dataScopes.includes("unknown") ||
    capability.mutationClass === "unknown" ||
    capability.mutationScopes.includes("unknown") ||
    capability.stateReadDomains.includes("unknown") ||
    capability.stateWriteDomains.includes("unknown") ||
    capability.decisionInfluence === "unknown" ||
    capability.credentialRelease === "unknown" ||
    capability.capitalAuthority.operations.includes("unknown") ||
    capability.capitalAuthority.assetScopes.includes("unknown") ||
    Object.values(capability.approvalSemantics).includes("unknown")
  );
}

function introducesUnknownSemantics(
  previous: FinancialCapabilityV1,
  current: FinancialCapabilityV1,
  fields: readonly CapabilityChangedFieldV1[],
): boolean {
  if (!hasUnknownSemantics(current) || !hasUnknownSemantics(previous)) return hasUnknownSemantics(current);
  const changed = new Set(fields);
  return (
    (changed.has("account-scope") && current.accountScope === "unknown") ||
    (changed.has("action-families") && current.actionFamilies.includes("unknown")) ||
    (changed.has("data-scopes") && current.dataScopes.includes("unknown")) ||
    (changed.has("mutation-class") && current.mutationClass === "unknown") ||
    (changed.has("mutation-scopes") && current.mutationScopes.includes("unknown")) ||
    (changed.has("state-read-domains") && current.stateReadDomains.includes("unknown")) ||
    (changed.has("state-write-domains") && current.stateWriteDomains.includes("unknown")) ||
    (changed.has("decision-influence") && current.decisionInfluence === "unknown") ||
    (changed.has("credential-release") && current.credentialRelease === "unknown") ||
    (changed.has("capital-authority") &&
      (current.capitalAuthority.operations.includes("unknown") ||
        current.capitalAuthority.assetScopes.includes("unknown"))) ||
    (changed.has("approval-semantics") &&
      Object.values(current.approvalSemantics).includes("unknown"))
  );
}

function riskClassificationReduced(
  previous: FinancialCapabilityV1,
  current: FinancialCapabilityV1,
): boolean {
  if (previous.mutationClass === current.mutationClass) return false;
  return (
    (previous.mutationClass === "capital-moving" ||
      previous.mutationClass === "emergency" ||
      previous.mutationClass === "reversible") &&
    current.mutationClass === "read"
  );
}

function findingsForChange(
  previous: FinancialCapabilityV1,
  current: FinancialCapabilityV1,
  fields: readonly CapabilityChangedFieldV1[],
): string[] {
  const findings: string[] = [];
  const changed = new Set(fields);
  if (changed.has("provider-tool-name")) findings.push("capability-renamed");
  if (changed.has("description-contract")) {
    findings.push("capability-description-changed");
  }
  if (changed.has("request-contract")) {
    findings.push("capability-input-schema-changed");
    if (previous.requestContract.state === "known" && current.requestContract.state !== "known") {
      findings.push("capability-schema-visibility-lost");
    }
  }
  if (changed.has("response-contract")) {
    findings.push("capability-output-schema-changed");
    if (previous.responseContract.state === "known" && current.responseContract.state !== "known") {
      findings.push("capability-schema-visibility-lost");
    }
  }
  if (changed.has("action-families")) {
    findings.push("capability-action-families-changed");
  }
  if (changed.has("account-scope")) {
    findings.push("capability-account-scope-changed");
    if (isAccountScopeExpansion(previous.accountScope, current.accountScope)) {
      findings.push("capability-account-scope-expanded");
    }
  }
  if (changed.has("data-scopes")) {
    findings.push("capability-data-scope-changed");
    if (isSetExpansion(previous.dataScopes, current.dataScopes)) {
      findings.push("capability-data-scope-expanded");
    }
  }
  if (changed.has("mutation-class")) {
    findings.push("capability-mutation-class-changed");
    if (riskClassificationReduced(previous, current)) {
      findings.push("capability-risk-classification-reduced");
    }
  }
  if (changed.has("mutation-scopes")) {
    findings.push("capability-mutation-scope-changed");
    if (isSetExpansion(previous.mutationScopes, current.mutationScopes)) {
      findings.push("capability-mutation-scope-expanded");
    }
  }
  if (changed.has("credential-release")) {
    findings.push("capability-credential-release-changed");
    if (isCredentialExpansion(previous.credentialRelease, current.credentialRelease)) {
      findings.push("capability-credential-release-expanded");
    }
  }
  if (changed.has("capital-authority")) {
    findings.push("capability-capital-authority-changed");
    if (
      isSetExpansion(
        previous.capitalAuthority.operations,
        current.capitalAuthority.operations,
      ) ||
      isSetExpansion(
        previous.capitalAuthority.assetScopes,
        current.capitalAuthority.assetScopes,
      )
    ) {
      findings.push("capability-capital-authority-expanded");
    }
  }
  if (changed.has("approval-semantics")) {
    findings.push("capability-approval-semantics-changed");
    const direction = approvalDirection(
      previous.approvalSemantics,
      current.approvalSemantics,
    );
    if (direction === "weaker") {
      findings.push("capability-approval-semantics-weakened");
    } else if (direction === "incomparable") {
      findings.push("capability-approval-semantics-incomparable");
    }
  }
  if (changed.has("decision-influence")) {
    findings.push("capability-decision-influence-changed");
  }
  if (changed.has("state-read-domains")) {
    findings.push("capability-state-read-domains-changed");
  }
  if (changed.has("state-write-domains")) {
    findings.push("capability-state-write-domains-changed");
  }
  if (changed.has("workflow-prerequisites")) {
    findings.push("capability-workflow-prerequisites-changed");
    const currentPrerequisites = new Set(current.workflowPrerequisiteCapabilityIds);
    if (previous.workflowPrerequisiteCapabilityIds.some((required) =>
      !currentPrerequisites.has(required))) {
      findings.push("capability-workflow-prerequisite-removed");
    }
  }
  if (
    changed.has("source-assertion") ||
    changed.has("source-ids") ||
    changed.has("identity-evidence") ||
    changed.has("risk-evidence") ||
    changed.has("identity-kind")
  ) {
    findings.push("source-assertion-changed");
  }
  if (introducesUnknownSemantics(previous, current, fields)) {
    findings.push("capability-unknown-risk-semantics");
  }
  findings.push(
    "policy-coverage-invalidated",
    "review-required",
    "scenarios-rerun-required",
  );
  return uniqueSorted(findings);
}

function changeId(change: Readonly<Record<string, unknown>>): string {
  return sha256Jcs({ domain: CHANGE_ID_DOMAIN, ...change });
}

function createChange(
  snapshot: CapabilitySnapshotV1,
  previous: FinancialCapabilityV1 | null,
  current: FinancialCapabilityV1 | null,
  fields: readonly CapabilityChangedFieldV1[],
  findingCodes: readonly string[],
): CapabilityChangeEvidenceV1 {
  const capabilityId = previous?.capabilityId ?? current?.capabilityId;
  if (capabilityId === undefined) fail("diff.internal-invalid");
  const withoutId = {
    capabilityReferenceSha256: capabilityReferenceSha256(snapshot, capabilityId),
    changedFields: [...fields].sort(compare),
    currentCapabilitySha256: current === null ? null : sha256Jcs(current),
    findingCodes: uniqueSorted(findingCodes),
    materiality: "material" as const,
    previousCapabilitySha256: previous === null ? null : sha256Jcs(previous),
  };
  return { ...withoutId, changeId: changeId(withoutId) };
}

function createSourceChange(
  snapshot: CapabilitySnapshotV1,
  sourceId: string,
  previous: CapabilitySnapshotV1["sources"][number] | null,
  current: CapabilitySnapshotV1["sources"][number] | null,
  fields: readonly SourceChangedFieldV1[],
  findings: readonly string[],
): SourceChangeEvidenceV1 {
  const withoutId = {
    changedFields: [...fields].sort(compare),
    currentSourceSha256: current === null ? null : sha256Jcs(current),
    findingCodes: uniqueSorted(findings),
    materiality: "material" as const,
    previousSourceSha256: previous === null ? null : sha256Jcs(previous),
    sourceReferenceSha256: sourceReferenceSha256(snapshot, sourceId),
  };
  return { ...withoutId, changeId: changeId(withoutId) };
}

function removalIsEstablished(
  previous: FinancialCapabilityV1,
  candidate: CapabilitySnapshotV1,
): boolean {
  const candidateSource = new Map(candidate.sources.map((source) => [source.sourceId, source]));
  return previous.sourceIds.every(
    (sourceId) =>
      candidateSource.get(sourceId)?.completeness === "complete-enumeration",
  );
}

type InfluencePath = Readonly<{ key: string; readerId: string; writerId: string }>;

function influencePaths(snapshot: CapabilitySnapshotV1): InfluencePath[] {
  const paths: InfluencePath[] = [];
  for (const writer of snapshot.capabilities) {
    for (const domain of writer.stateWriteDomains) {
      if (domain === "none" || domain === "unknown") continue;
      for (const reader of snapshot.capabilities) {
        const isTerminal =
          reader.decisionInfluence !== "none" ||
          reader.capitalAuthority.operations.length > 0 ||
          reader.actionFamilies.some((family) =>
            ["order-management", "order-review", "order-submission", "purchase-execution"]
              .includes(family));
        if (!isTerminal || !reader.stateReadDomains.includes(domain)) continue;
        paths.push({
          key: `${writer.capabilityId}\u0000${domain}\u0000${reader.capabilityId}`,
          readerId: reader.capabilityId,
          writerId: writer.capabilityId,
        });
      }
    }
  }
  return paths;
}

function addInfluencePathFinding(
  changes: CapabilityChangeEvidenceV1[],
  snapshot: CapabilitySnapshotV1,
  capabilityId: string,
): void {
  const reference = capabilityReferenceSha256(snapshot, capabilityId);
  const index = changes.findIndex((change) =>
    change.capabilityReferenceSha256 === reference);
  if (index < 0) return;
  const current = changes[index];
  if (current === undefined) return;
  const withoutId = {
    capabilityReferenceSha256: current.capabilityReferenceSha256,
    changedFields: [...new Set<CapabilityChangedFieldV1>([
      ...current.changedFields,
      "influence-path",
    ])].sort(compare),
    currentCapabilitySha256: current.currentCapabilitySha256,
    findingCodes: uniqueSorted([
      ...current.findingCodes,
      "capability-state-influence-path-added",
      "scenarios-rerun-required",
    ]),
    materiality: current.materiality,
    previousCapabilitySha256: current.previousCapabilitySha256,
  } satisfies Omit<CapabilityChangeEvidenceV1, "changeId">;
  changes[index] = { ...withoutId, changeId: changeId(withoutId) };
}

/**
 * Deterministically compares two already versioned snapshots after owning and
 * validating fresh copies. It never accepts a caller-supplied diff.
 */
export function buildCapabilityDiff(
  baselineValue: unknown,
  candidateValue: unknown,
): CapabilityDiffV1 {
  const baseline = parseCapabilitySnapshot(baselineValue);
  const candidate = parseCapabilitySnapshot(candidateValue);
  assertContinuity(baseline, candidate);

  const before = new Map(
    baseline.capabilities.map((capability) => [capability.capabilityId, capability]),
  );
  const after = new Map(
    candidate.capabilities.map((capability) => [capability.capabilityId, capability]),
  );
  const changes: CapabilityChangeEvidenceV1[] = [];
  const changedCapabilitySourceIds = new Set<string>();
  const changedCapabilityIds = new Set<string>();

  for (const capabilityId of uniqueSorted([...before.keys(), ...after.keys()])) {
    const previous = before.get(capabilityId) ?? null;
    const current = after.get(capabilityId) ?? null;
    if (previous === null && current !== null) {
      changedCapabilityIds.add(capabilityId);
      current.sourceIds.forEach((sourceId) => changedCapabilitySourceIds.add(sourceId));
      const findings = [
        "capability-added",
        "policy-coverage-invalidated",
        "review-required",
        "scenarios-rerun-required",
      ];
      if (hasUnknownSemantics(current)) {
        findings.push("capability-unknown-risk-semantics");
      }
      changes.push(
        createChange(candidate, null, current, ["capability-added"], findings),
      );
      continue;
    }
    if (previous !== null && current === null) {
      changedCapabilityIds.add(capabilityId);
      previous.sourceIds.forEach((sourceId) => changedCapabilitySourceIds.add(sourceId));
      if (!removalIsEstablished(previous, candidate)) {
        changes.push(
          createChange(candidate, previous, null, ["capability-omitted"], [
            "source-completeness-insufficient",
          ]),
        );
      } else {
        changes.push(
          createChange(candidate, previous, null, ["capability-removed"], [
            "capability-removed",
            "policy-coverage-invalidated",
            "review-required",
            "scenarios-rerun-required",
          ]),
        );
      }
      continue;
    }
    if (previous === null || current === null) fail("diff.internal-invalid");
    const fields = changedFields(previous, current);
    if (fields.length === 0) continue;
    changedCapabilityIds.add(capabilityId);
    previous.sourceIds.forEach((sourceId) => changedCapabilitySourceIds.add(sourceId));
    current.sourceIds.forEach((sourceId) => changedCapabilitySourceIds.add(sourceId));
    changes.push(
      createChange(
        candidate,
        previous,
        current,
        fields,
        findingsForChange(previous, current, fields),
      ),
    );
  }

  const baselineInfluencePaths = new Set(
    influencePaths(baseline).map((path) => path.key),
  );
  for (const path of influencePaths(candidate)) {
    if (baselineInfluencePaths.has(path.key)) continue;
    if (changedCapabilityIds.has(path.writerId)) {
      addInfluencePathFinding(changes, candidate, path.writerId);
    }
    if (changedCapabilityIds.has(path.readerId)) {
      addInfluencePathFinding(changes, candidate, path.readerId);
    }
  }

  changes.sort((left, right) => compare(left.changeId, right.changeId));
  const baselineSources = new Map(
    baseline.sources.map((source) => [source.sourceId, source]),
  );
  const candidateSources = new Map(
    candidate.sources.map((source) => [source.sourceId, source]),
  );
  const sourceChanges: SourceChangeEvidenceV1[] = [];
  for (const sourceId of uniqueSorted([
    ...baselineSources.keys(),
    ...candidateSources.keys(),
  ])) {
    const previous = baselineSources.get(sourceId) ?? null;
    const current = candidateSources.get(sourceId) ?? null;
    if (previous === null && current !== null) {
      sourceChanges.push(createSourceChange(candidate, sourceId, null, current,
        ["source-added"], ["review-required", "source-added", "source-set-changed"]));
      continue;
    }
    if (previous !== null && current === null) {
      sourceChanges.push(createSourceChange(candidate, sourceId, previous, null,
        ["source-removed"], ["review-required", "source-removed", "source-set-changed"]));
      continue;
    }
    if (previous === null || current === null) fail("diff.internal-invalid");
    const fields: SourceChangedFieldV1[] = [];
    if (previous.authority !== current.authority) fields.push("source-authority");
    if (previous.completeness !== current.completeness) fields.push("source-completeness");
    if (previous.publicUri !== current.publicUri) fields.push("source-public-uri");
    if (
      previous.sourceProjectionSha256 !== current.sourceProjectionSha256 &&
      !changedCapabilitySourceIds.has(sourceId)
    ) {
      fields.push("source-projection");
    }
    if (fields.length > 0) {
      sourceChanges.push(createSourceChange(candidate, sourceId, previous, current, fields,
        ["review-required", "source-record-changed", "source-set-changed"]));
    }
  }
  sourceChanges.sort((left, right) => compare(left.changeId, right.changeId));
  const materialChangeIds = uniqueSorted([
    ...changes.map((change) => change.changeId),
    ...sourceChanges.map((change) => change.changeId),
  ]);
  const baselineSnapshotSha256 = sha256Jcs(baseline);
  const candidateSnapshotSha256 = sha256Jcs(candidate);
  const sourceSetSha256 = sha256Jcs({
    baselineSourcesSha256: sha256Jcs(baseline.sources),
    candidateSourcesSha256: sha256Jcs(candidate.sources),
    domain: SOURCE_SET_DOMAIN,
  });
  const blockedChangeSetSha256 = sha256Jcs({
    domain: BLOCKED_CHANGE_SET_DOMAIN,
    materialChangeIds,
  });
  const withoutDigest = {
    baselineSnapshotSha256,
    blockedChangeSetSha256,
    candidateSnapshotSha256,
    changes,
    limitations: PORTABLE_LIMITATIONS,
    materialChangeIds,
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    schemaVersion: CAPABILITY_DIFF_SCHEMA,
    sourceChanges,
    sourceSetSha256,
  } satisfies Omit<CapabilityDiffV1, "diffSha256">;
  return { ...withoutDigest, diffSha256: sha256Jcs(withoutDigest) };
}

export function serializeCapabilityDiff(value: CapabilityDiffV1): string {
  return canonicalizeJcs(value);
}
