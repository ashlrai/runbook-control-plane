import type { MutationClass } from "@runbook/financial-bench";

export const FINANCIAL_CAPABILITY_REGISTRY_PROFILE =
  "runbook.financial-capability-registry.v1" as const;
export const CAPABILITY_SNAPSHOT_SCHEMA =
  "runbook.financial-capability-snapshot.v1" as const;
export const SNAPSHOT_VERIFICATION_SCHEMA =
  "runbook.financial-capability-snapshot-verification.v1" as const;
export const CAPABILITY_DIFF_SCHEMA =
  "runbook.financial-capability-diff.v1" as const;
export const ADMISSION_POLICY_SCHEMA =
  "runbook.financial-capability-admission-policy.v1" as const;
export const REVIEW_CLAIMS_SCHEMA =
  "runbook.financial-capability-review-claims.v1" as const;
export const REVIEW_ARTIFACT_SCHEMA =
  "runbook.financial-capability-review-artifact.v1" as const;
export const ADMISSION_RECEIPT_SCHEMA =
  "runbook.financial-capability-admission-receipt.v1" as const;

export const SOURCE_AUTHORITIES = [
  "authenticated-runtime-discovery",
  "controlled-runtime-exercise",
  "public-documentation",
  "user-supplied-export",
] as const;
export const SOURCE_COMPLETENESS = [
  "capabilities-only",
  "complete-enumeration",
  "partial-enumeration",
  "unknown",
] as const;
export const EVIDENCE_LEVELS = [
  "public-derived",
  "public-explicit",
  "runtime-confirmed",
  "runtime-exercised",
] as const;
export const CONTRACT_STATES = [
  "known",
  "not-authorized",
  "not-captured",
  "not-published",
] as const;
export const IDENTITY_KINDS = [
  "documented-operation",
  "published-tool-name",
  "runtime-tool-name",
] as const;

export const ACTION_FAMILIES = [
  "account-observation",
  "credential-release",
  "emergency-control",
  "market-observation",
  "order-management",
  "order-review",
  "order-submission",
  "policy-management",
  "policy-observation",
  "purchase-execution",
  "purchase-observation",
  "reconciliation",
  "research-observation",
  "research-state-management",
  "unknown",
] as const;
export const DATA_SCOPES = [
  "account-balances",
  "account-identifiers",
  "account-positions",
  "account-transactions",
  "card-policies",
  "card-transactions",
  "company-data",
  "market-data",
  "order-data",
  "order-history",
  "payment-credentials",
  "scans",
  "unknown",
  "watchlists",
] as const;
export const ACCOUNT_SCOPES = [
  "all-linked-accounts",
  "authorized-card",
  "dedicated-account",
  "none",
  "provider-defined",
  "unknown",
] as const;
export const MUTATION_SCOPES = [
  "capital-orders",
  "control-plane",
  "credential-release",
  "emergency-state",
  "none",
  "payments",
  "research-state",
  "unknown",
] as const;
export const STATE_DOMAINS = [
  "account-state",
  "card-policy-state",
  "card-transaction-state",
  "control-plane",
  "market-state",
  "none",
  "order-state",
  "payment-credential-state",
  "portfolio-state",
  "research-state",
  "unknown",
] as const;
export const DECISION_INFLUENCE_CLASSES = [
  "direct",
  "indirect",
  "none",
  "unknown",
] as const;
export const CREDENTIAL_RELEASE_CLASSES = [
  "account-identifier",
  "api-credential",
  "none",
  "opaque-session",
  "payment-credential",
  "private-key",
  "unknown",
] as const;
export const CAPITAL_OPERATIONS = [
  "cancel",
  "preview",
  "replace",
  "spend",
  "submit",
  "transfer",
  "unknown",
] as const;
export const ASSET_SCOPES = [
  "card-purchase",
  "cash",
  "crypto",
  "equity",
  "event-contract",
  "future",
  "option",
  "other",
  "unknown",
] as const;

export const APPROVAL_MODES = [
  "advisory",
  "mandatory",
  "none",
  "optional",
  "unknown",
] as const;
export const APPROVAL_ENFORCING_PRINCIPALS = [
  "customer",
  "external-agent",
  "joint",
  "none",
  "provider",
  "unknown",
] as const;
export const APPROVAL_ACTION_BINDINGS = [
  "action-class",
  "exact-action",
  "none",
  "unknown",
] as const;
export const APPROVAL_SCOPE_BINDINGS = [
  "monthly-budget",
  "none",
  "session",
  "single-action",
  "unknown",
] as const;
export const APPROVAL_EXPIRY_BINDINGS = [
  "fixed",
  "none",
  "provider-managed",
  "unknown",
] as const;
export const APPROVAL_BYPASS_CONDITIONS = [
  "none",
  "policy-configurable",
  "unknown",
  "user-instruction",
] as const;

export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];
export type SourceCompleteness = (typeof SOURCE_COMPLETENESS)[number];
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type ContractState = (typeof CONTRACT_STATES)[number];
export type IdentityKind = (typeof IDENTITY_KINDS)[number];
export type ActionFamily = (typeof ACTION_FAMILIES)[number];
export type DataScope = (typeof DATA_SCOPES)[number];
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];
export type MutationScope = (typeof MUTATION_SCOPES)[number];
export type StateDomain = (typeof STATE_DOMAINS)[number];
export type DecisionInfluenceClass = (typeof DECISION_INFLUENCE_CLASSES)[number];
export type CredentialReleaseClass = (typeof CREDENTIAL_RELEASE_CLASSES)[number];
export type CapitalOperation = (typeof CAPITAL_OPERATIONS)[number];
export type AssetScope = (typeof ASSET_SCOPES)[number];
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export type ApprovalEnforcingPrincipal =
  (typeof APPROVAL_ENFORCING_PRINCIPALS)[number];
export type ApprovalActionBinding = (typeof APPROVAL_ACTION_BINDINGS)[number];
export type ApprovalScopeBinding = (typeof APPROVAL_SCOPE_BINDINGS)[number];
export type ApprovalExpiryBinding = (typeof APPROVAL_EXPIRY_BINDINGS)[number];
export type ApprovalBypassCondition =
  (typeof APPROVAL_BYPASS_CONDITIONS)[number];
export type RegistryMutationClass = MutationClass;

export type CapabilitySourceV1 = Readonly<{
  authority: SourceAuthority;
  completeness: SourceCompleteness;
  publicUri: string | null;
  retrievedAtDeclared: string;
  sourceId: string;
  sourceProjectionSha256: string;
}>;

export type ContractDigestV1 = Readonly<{
  sha256: string | null;
  state: ContractState;
}>;

export type CapitalAuthorityV1 = Readonly<{
  assetScopes: readonly AssetScope[];
  operations: readonly CapitalOperation[];
}>;

export type ApprovalSemanticsV1 = Readonly<{
  actionBinding: ApprovalActionBinding;
  bypassCondition: ApprovalBypassCondition;
  enforcingPrincipal: ApprovalEnforcingPrincipal;
  expiryBinding: ApprovalExpiryBinding;
  mode: ApprovalMode;
  scopeBinding: ApprovalScopeBinding;
}>;

export type FinancialCapabilityV1 = Readonly<{
  accountScope: AccountScope;
  actionFamilies: readonly ActionFamily[];
  approvalSemantics: ApprovalSemanticsV1;
  capitalAuthority: CapitalAuthorityV1;
  capabilityId: string;
  credentialRelease: CredentialReleaseClass;
  dataScopes: readonly DataScope[];
  decisionInfluence: DecisionInfluenceClass;
  descriptionContract: ContractDigestV1;
  identityEvidence: EvidenceLevel;
  identityKind: IdentityKind;
  mutationClass: RegistryMutationClass;
  mutationScopes: readonly MutationScope[];
  providerToolName: string | null;
  requestContract: ContractDigestV1;
  responseContract: ContractDigestV1;
  riskEvidence: EvidenceLevel;
  sourceAssertionSha256: string;
  sourceIds: readonly string[];
  stateReadDomains: readonly StateDomain[];
  stateWriteDomains: readonly StateDomain[];
  workflowPrerequisiteCapabilityIds: readonly string[];
}>;

export type CapabilitySnapshotV1 = Readonly<{
  capabilities: readonly FinancialCapabilityV1[];
  observedAtDeclared: string;
  previousAdmittedSnapshotSha256: string | null;
  productId: string;
  profileVersion: typeof FINANCIAL_CAPABILITY_REGISTRY_PROFILE;
  providerId: string;
  registryRevision: number;
  schemaVersion: typeof CAPABILITY_SNAPSHOT_SCHEMA;
  sourceSeriesId: string;
  sources: readonly CapabilitySourceV1[];
}>;

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

export type RegistryIssueV1 = Readonly<{
  code: string;
  pathSha256: string | null;
}>;

export type SnapshotVerificationReceiptV1 = Readonly<{
  errors: readonly RegistryIssueV1[];
  inputSha256: string;
  limitations: typeof PORTABLE_LIMITATIONS;
  profileVersion: typeof FINANCIAL_CAPABILITY_REGISTRY_PROFILE;
  schemaVersion: typeof SNAPSHOT_VERIFICATION_SCHEMA;
  snapshotSha256: string | null;
  valid: boolean;
}>;

export type CapabilityChangedFieldV1 =
  | "account-scope"
  | "action-families"
  | "approval-semantics"
  | "capital-authority"
  | "capability-added"
  | "capability-omitted"
  | "capability-removed"
  | "credential-release"
  | "data-scopes"
  | "decision-influence"
  | "description-contract"
  | "identity-evidence"
  | "identity-kind"
  | "influence-path"
  | "mutation-class"
  | "mutation-scopes"
  | "provider-tool-name"
  | "request-contract"
  | "response-contract"
  | "risk-evidence"
  | "source-assertion"
  | "source-ids"
  | "state-read-domains"
  | "state-write-domains"
  | "workflow-prerequisites";

export type CapabilityChangeEvidenceV1 = Readonly<{
  capabilityReferenceSha256: string;
  changeId: string;
  changedFields: readonly CapabilityChangedFieldV1[];
  currentCapabilitySha256: string | null;
  findingCodes: readonly string[];
  materiality: "material" | "non-material";
  previousCapabilitySha256: string | null;
}>;

export type SourceChangedFieldV1 =
  | "source-added"
  | "source-authority"
  | "source-completeness"
  | "source-projection"
  | "source-public-uri"
  | "source-removed";

export type SourceChangeEvidenceV1 = Readonly<{
  changeId: string;
  changedFields: readonly SourceChangedFieldV1[];
  currentSourceSha256: string | null;
  findingCodes: readonly string[];
  materiality: "material";
  previousSourceSha256: string | null;
  sourceReferenceSha256: string;
}>;

export type CapabilityDiffV1 = Readonly<{
  baselineSnapshotSha256: string;
  blockedChangeSetSha256: string;
  candidateSnapshotSha256: string;
  changes: readonly CapabilityChangeEvidenceV1[];
  diffSha256: string;
  limitations: typeof PORTABLE_LIMITATIONS;
  materialChangeIds: readonly string[];
  profileVersion: typeof FINANCIAL_CAPABILITY_REGISTRY_PROFILE;
  schemaVersion: typeof CAPABILITY_DIFF_SCHEMA;
  sourceChanges: readonly SourceChangeEvidenceV1[];
  sourceSetSha256: string;
}>;

export type AdmissionPolicyV1 = Readonly<{
  allowedSourceAuthorities: readonly SourceAuthority[];
  maximumCandidateAgeSeconds: number;
  maximumFutureSkewSeconds: number;
  maximumReviewValiditySeconds: number;
  partialSourceOmissionDecision: "reject";
  policyId: string;
  productId: string;
  profileVersion: typeof FINANCIAL_CAPABILITY_REGISTRY_PROFILE;
  providerId: string;
  requiredEvidenceSha256: readonly string[];
  requireReviewForMaterialChanges: true;
  schemaVersion: typeof ADMISSION_POLICY_SCHEMA;
  sourceSeriesId: string;
  trustedReviewerKeyIds: readonly string[];
  unknownRiskDecision: "reject";
}>;

export type ReviewChangeDecisionV1 = Readonly<{
  changeId: string;
  decision: "approve" | "deny";
  rationaleSha256: string;
}>;

export type ReviewClaimsV1 = Readonly<{
  baselineSnapshotSha256: string;
  blockedChangeSetSha256: string;
  candidateSnapshotSha256: string;
  decisions: readonly ReviewChangeDecisionV1[];
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

export type ReviewArtifactV1 = Readonly<{
  algorithm: "ed25519";
  claims: ReviewClaimsV1;
  schemaVersion: typeof REVIEW_ARTIFACT_SCHEMA;
  signatureBase64: string;
}>;

export type AdmissionCheckV1 = Readonly<{
  code: string;
  passed: boolean;
}>;

export type AdmissionReceiptV1 = Readonly<{
  baselineSnapshotSha256: string;
  blockedChangeSetSha256: string;
  candidateSnapshotSha256: string;
  checks: readonly AdmissionCheckV1[];
  diffSha256: string;
  evaluatedAtDeclared: string;
  limitations: typeof PORTABLE_LIMITATIONS;
  outcome: "admit" | "no-change" | "quarantine" | "reject";
  policySha256: string;
  profileVersion: typeof FINANCIAL_CAPABILITY_REGISTRY_PROFILE;
  reviewArtifactSha256: string | null;
  reviewSignatureVerified: boolean;
  schemaVersion: typeof ADMISSION_RECEIPT_SCHEMA;
}>;
