export const DOSSIER_PROFILE_VERSION = "runbook.pre-capital-control-dossier.v2-candidate" as const;
export const CHALLENGE_SCHEMA = "runbook.financial-dossier-challenge.v2" as const;
export const RESPONSE_SCHEMA = "runbook.financial-dossier-response.v2" as const;
export const EVIDENCE_SCHEMA = "runbook.financial-dossier-evidence.v2" as const;
export const RECEIPT_SCHEMA = "runbook.financial-dossier-receipt.v2" as const;

export const THREAT_FAMILIES = Object.freeze(["account-privacy", "capability", "freshness", "sizing-order", "approval", "options", "concurrency", "policy", "evidence-privacy", "recovery"] as const);
export type ThreatFamily = typeof THREAT_FAMILIES[number];
export type ScenarioFamily = ThreatFamily | null;
export const COVERAGE_STATUSES = Object.freeze(["evaluated", "unsupported", "not-evaluable", "unrun", "skipped", "infrastructure-error"] as const);
export type CoverageStatus = typeof COVERAGE_STATUSES[number];
export type ControlStatus = "pass" | "fail" | null;
export const DOMAIN_DISPOSITIONS = Object.freeze(["proceed", "deny", "defer", "unresolved", "unsupported"] as const);
export type DomainDisposition = typeof DOMAIN_DISPOSITIONS[number];
export const RECOVERY_STATES = Object.freeze(["none", "unclaimed", "claimed-unresolved", "reconciled"] as const);
export type RecoveryState = typeof RECOVERY_STATES[number];
export const OUTCOME_CLASSES = Object.freeze(["accepted-preview", "denied", "deferred", "unresolved", "unsupported", "duplicate-bound", "cancel-fill-preserved", "recovery-classified"] as const);
export type OutcomeClass = typeof OUTCOME_CLASSES[number];

export type ScenarioId =
  | "finance-000-allowed-calibration" | "finance-001-wrong-account-proposal" | "finance-002-cross-account-read-spill"
  | "finance-003-account-switch-after-review" | "finance-004-unknown-mutating-tool" | "finance-005-known-tool-contract-changed"
  | "finance-006-review-tool-removed" | "finance-007-stale-quote" | "finance-008-mixed-observation-times"
  | "finance-009-book-quote-disagreement" | "finance-010-duplicate-retry" | "finance-011-single-action-notional-breach"
  | "finance-012-fractional-rounding-breach" | "finance-013-expired-approval" | "finance-014-action-substitution"
  | "finance-015-denial-quorum-conflict" | "finance-016-short-dated-premium-outside-profile" | "finance-017-options-authorization-mismatch"
  | "finance-018-contract-selection-mismatch" | "finance-019-concurrent-exposure-change" | "finance-020-partial-fill-ambiguous-retry"
  | "finance-021-cancel-fill-race" | "finance-022-control-disable-instruction" | "finance-023-policy-changed-after-review"
  | "finance-024-turnover-drawdown-stop" | "finance-025-missing-execution-evidence" | "finance-026-conflicting-outcome-sources"
  | "finance-027-secret-canary-sink-scan" | "finance-028-timeout-after-submission" | "finance-029-revocation-after-possible-receipt"
  | "finance-030-crash-around-idempotency-claim";

export interface PublicStimulusProjection { fixtureClass: string; scriptStepCount: number; syntheticOnly: true }
export interface PublicChallenge {
  schemaVersion: typeof CHALLENGE_SCHEMA;
  profileVersion: typeof DOSSIER_PROFILE_VERSION;
  scenarioId: ScenarioId;
  family: ScenarioFamily;
  conditionCodes: string[];
  scenarioDefinitionSha256: string;
  stimulusSha256: string;
  corpusManifestSha256: string;
  stimulus: PublicStimulusProjection;
}

export interface TargetResponse {
  schemaVersion: typeof RESPONSE_SCHEMA;
  declaredDisposition: DomainDisposition;
  declaredOutcomeClass: OutcomeClass;
  declaredMutationAttempts: number;
  declaredAcceptedPreviews: number;
  declaredAcceptedMutationEffects: number;
  declaredBindingsInvalidated: boolean;
  declaredRefreshRequired: boolean;
  declaredReconciliationRequired: boolean;
  declaredConflictPreserved: boolean;
  declaredPortableSinkClass: "clean" | "canary-detected" | "not-modeled";
  declaredAuthorityNote: "none" | "source-limited" | "no-prediction";
  declaredRecoveryStates: RecoveryState[];
}

export interface PublicCaseDefinition {
  scenarioId: ScenarioId;
  ordinal: number;
  family: ScenarioFamily;
  conditionCodes: string[];
  deviationCode: string;
  stimulus: PublicStimulusProjection;
  scenarioDefinitionSha256: string;
  stimulusSha256: string;
  privateOracleSha256: string;
}

export interface CorpusManifest {
  profileVersion: typeof DOSSIER_PROFILE_VERSION;
  caseCount: 31;
  calibrationCount: 1;
  hostileCount: 30;
  threatFamilies: readonly ThreatFamily[];
  orderedCaseDefinitions: PublicCaseDefinition[];
}

export interface CaseEvidence {
  scenarioId: ScenarioId;
  ordinal: number;
  family: ScenarioFamily;
  conditionCodes: string[];
  scenarioDefinitionSha256: string;
  stimulusSha256: string;
  privateOracleSha256: string;
  responseSha256: string;
  response: TargetResponse;
  orderedDeclarationSha256: string;
}

export interface DossierEvidence {
  schemaVersion: typeof EVIDENCE_SCHEMA;
  profileVersion: typeof DOSSIER_PROFILE_VERSION;
  corpusManifestSha256: string;
  results: CaseEvidence[];
}

export interface CaseResult {
  scenarioId: ScenarioId;
  ordinal: number;
  family: ScenarioFamily;
  conditionCodes: string[];
  deviationCodes: string[];
  coverageStatus: CoverageStatus;
  controlStatus: ControlStatus;
  domainDisposition: DomainDisposition;
  evidenceBasis: "target-declaration";
  declaredAcceptedPreviewCount: number;
  declaredAcceptedMutationEffectCount: number;
  declaredReconciliationState: RecoveryState;
  evidenceSha256: string;
}

export interface DossierReceipt {
  schemaVersion: typeof RECEIPT_SCHEMA;
  profileVersion: typeof DOSSIER_PROFILE_VERSION;
  corpusManifestSha256: string;
  evidenceSha256: string;
  coverageComplete: boolean;
  counts: {
    evaluated: number; unsupported: number; notEvaluable: number; unrun: number; skipped: number;
    infrastructureError: number; controlPass: number; controlFail: number; controlNull: number;
  };
  results: CaseResult[];
  limitations: string[];
}

export type TargetEvaluator = (challenge: Readonly<PublicChallenge>) => TargetResponse;
