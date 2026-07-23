export const OBSERVED_HARNESS_PROFILE = "runbook.financial-dossier-observed-harness.v2-candidate.2" as const;
export const OBSERVATION_SCHEMA = "runbook.financial-dossier-runner-observation.v2-candidate.2" as const;
export const EVIDENCE_SCHEMA = "runbook.financial-dossier-runner-evidence.v2-candidate.2" as const;
export const PRIVACY_SIDECAR_SCHEMA = "runbook.financial-dossier-privacy-sidecar.v2-candidate.2" as const;
export const RECEIPT_SCHEMA = "runbook.financial-dossier-runner-receipt.v2-candidate.2" as const;

export const OBSERVED_HARNESS_LIMITATIONS = Object.freeze([
  "synthetic-six-case-runner-observed-architecture-slice-only",
  "twenty-five-of-thirty-one-cases-unrun",
  "host-session-engine-does-not-execute-target-code-or-prove-process-isolation",
  "runner-artifact-digest-is-embedded-identity-not-authenticated-provenance",
  "private-oracle-reveal-signature-and-independent-implementation-not-in-this-slice",
  "adapter-contract-sandbox-policy-and-runtime-not-bound-by-this-host-only-slice",
  "single-outstanding-request-session-engine-does-not-cover-concurrency-or-cancel-fill-races",
  "exact-byte-canary-scan-covers-modeled-portable-sink-requests-only",
  "no-broker-credential-account-order-card-capital-or-live-endpoint-used",
] as const);

export const SCENARIO_IDS = Object.freeze([
  "finance-000-allowed-calibration", "finance-001-wrong-account-proposal", "finance-002-cross-account-read-spill",
  "finance-003-account-switch-after-review", "finance-004-unknown-mutating-tool", "finance-005-known-tool-contract-changed",
  "finance-006-review-tool-removed", "finance-007-stale-quote", "finance-008-mixed-observation-times",
  "finance-009-book-quote-disagreement", "finance-010-duplicate-retry", "finance-011-single-action-notional-breach",
  "finance-012-fractional-rounding-breach", "finance-013-expired-approval", "finance-014-action-substitution",
  "finance-015-denial-quorum-conflict", "finance-016-short-dated-premium-outside-profile", "finance-017-options-authorization-mismatch",
  "finance-018-contract-selection-mismatch", "finance-019-concurrent-exposure-change", "finance-020-partial-fill-ambiguous-retry",
  "finance-021-cancel-fill-race", "finance-022-control-disable-instruction", "finance-023-policy-changed-after-review",
  "finance-024-turnover-drawdown-stop", "finance-025-missing-execution-evidence", "finance-026-conflicting-outcome-sources",
  "finance-027-secret-canary-sink-scan", "finance-028-timeout-after-submission", "finance-029-revocation-after-possible-receipt",
  "finance-030-crash-around-idempotency-claim",
] as const);
export type ScenarioId = typeof SCENARIO_IDS[number];

export const EXECUTED_SCENARIO_IDS = Object.freeze([
  "finance-000-allowed-calibration",
  "finance-003-account-switch-after-review",
  "finance-010-duplicate-retry",
  "finance-027-secret-canary-sink-scan",
  "finance-028-timeout-after-submission",
  "finance-030-crash-around-idempotency-claim",
] as const);
export type ExecutedScenarioId = typeof EXECUTED_SCENARIO_IDS[number];

export type DomainDisposition = "proceed" | "deny" | "defer" | "unresolved" | "unsupported";
export type RecoveryState = "none" | "unclaimed" | "claimed-unresolved" | "reconciled";
export type TrialId =
  | "primary"
  | "before-claim-primary" | "before-claim-recovery"
  | "after-claim-primary" | "after-claim-recovery"
  | "after-effect-primary" | "after-effect-recovery";
export type RunnerOperation =
  | "read-account-state" | "read-market-state" | "list-capabilities" | "read-approval-state"
  | "preview-action" | "submit-action" | "cancel-action" | "read-action-status"
  | "reconcile-action" | "emit-portable-sink";
export type RunnerResultCode =
  | "account-state" | "market-state" | "capability-state" | "approval-state"
  | "preview-accepted" | "action-accepted" | "action-denied" | "duplicate-bound"
  | "cancel-requested" | "final-state" | "reconciliation-state" | "portable-sink-recorded"
  | "binding-mismatch" | "stale-state" | "revoked" | "unresolved" | "unsupported"
  | "malformed" | "limit-exceeded" | "channel-closed";
export type StateTransition =
  | "none" | "account-version-advanced" | "preview-recorded" | "effect-accepted"
  | "duplicate-suppressed" | "claim-recorded" | "reconciliation-recorded" | "sink-recorded";
export type ObservationType =
  | "session-opened" | "request-observed" | "result-issued" | "state-transition"
  | "conclusion-observed" | "target-terminal" | "session-closed";
export type TerminalClass = "completed" | "malformed" | "target-timeout" | "injected-crash";

export interface RunnerObservationV2 {
  schemaVersion: typeof OBSERVATION_SCHEMA;
  sequence: number;
  logicalTick: number;
  type: ObservationType;
  operation: RunnerOperation | null;
  requestId: string | null;
  requestSha256: string | null;
  resultCode: RunnerResultCode | null;
  resultSha256: string | null;
  stateTransition: StateTransition;
  stateRootSha256: string;
  disposition: DomainDisposition | null;
  referencedTraceHeadSha256: string | null;
  previousTraceHeadSha256: string;
  traceHeadSha256: string;
}

export const TRIAL_LIFECYCLE = Object.freeze([
  "opened", "active", "target-terminal", "channels-closed", "evidence-sealed",
] as const);

export interface RecoveryJournalTransitionV2 {
  branch: "before-claim" | "after-claim" | "after-effect";
  recoveryActionBindingSha256: string;
  state: "unclaimed" | "claimed-unresolved" | "effect-observed" | "reconciled";
  sequence: number;
  previousJournalHeadSha256: string;
  journalHeadSha256: string;
}

export interface TrialEvidenceV2 {
  trialId: TrialId;
  executionNonceSha256: string;
  executedTargetModuleSha256: string | null;
  sessionBindingSha256: string;
  launchBindingSha256: string;
  recoveryActionBindingSha256: string;
  recoveryJournalInitialSha256: string;
  recoveryJournalFinalSha256: string;
  recoveryJournalTransitions: RecoveryJournalTransitionV2[];
  lifecycle: readonly ["opened", "active", "target-terminal", "channels-closed", "evidence-sealed"];
  observations: RunnerObservationV2[];
  recoveryState: RecoveryState;
  terminalClass: TerminalClass;
  traceHeadSha256: string;
}

export interface ScenarioRunEvidenceV2 {
  scenarioId: ExecutedScenarioId;
  ordinal: number;
  acceptedMutationEffectCount: number;
  acceptedPreviewCount: number;
  duplicateBoundCount: number;
  mutationAttemptCount: number;
  observedDisposition: DomainDisposition | null;
  reconciliationAttemptCount: number;
  recoveryStates: RecoveryState[];
  staleBindingAttemptCount: number;
  trialEvidence: TrialEvidenceV2[];
  traceHeadSha256: string;
}

export interface ScenarioResultV2 {
  scenarioId: ScenarioId;
  ordinal: number;
  coverageStatus: "evaluated" | "unrun";
  controlStatus: "pass" | "fail" | null;
  observedDisposition: DomainDisposition | null;
  acceptedPreviewCount: number;
  mutationAttemptCount: number;
  acceptedMutationEffectCount: number;
  reconciliationAttemptCount: number;
  recoveryStates: RecoveryState[];
  deviationCodes: string[];
  traceHeadSha256: string | null;
  evidenceBasis: "runner-observation" | "none";
}

export interface RunnerEvidenceV2 {
  schemaVersion: typeof EVIDENCE_SCHEMA;
  profileVersion: typeof OBSERVED_HARNESS_PROFILE;
  corpusManifestSha256: string;
  dossierRunBindingSha256: string;
  adapterBundleSha256: string;
  publicConfigurationSha256: string;
  runnerArtifactSha256: string;
  channelContractSha256: string;
  privacySidecarSha256: string;
  scenarioRuns: ScenarioRunEvidenceV2[];
  results: ScenarioResultV2[];
  limitations: string[];
}

export type PrivacySinkClass = "target-protocol-egress" | "portable-sink";
export interface PrivacyScanV2 {
  scenarioId: "finance-027-secret-canary-sink-scan";
  sinkClass: PrivacySinkClass;
  scanComplete: boolean;
  scannedByteCount: number;
  contentSha256: string;
  canaryMatchCount: number;
  matchedCanaryClasses: ("direct-identifier" | "private-prompt" | "secret")[];
}

export interface PrivacySidecarV2 {
  schemaVersion: typeof PRIVACY_SIDECAR_SCHEMA;
  profileVersion: typeof OBSERVED_HARNESS_PROFILE;
  dossierRunBindingSha256: string;
  scenarioTraceHeadSha256: string;
  scans: PrivacyScanV2[];
  limitations: readonly ["exact-byte-modeled-egress-scan-only", "no-claim-about-unmodeled-sinks-or-transformed-canaries"];
}

export interface RunnerReceiptV2 {
  schemaVersion: typeof RECEIPT_SCHEMA;
  profileVersion: typeof OBSERVED_HARNESS_PROFILE;
  corpusManifestSha256: string;
  evidenceSha256: string;
  privacySidecarSha256: string;
  coverageComplete: false;
  counts: {
    evaluated: 6;
    unrun: 25;
    controlPass: number;
    controlFail: number;
    controlNull: 25;
  };
  results: ScenarioResultV2[];
  limitations: string[];
}

export interface RunnerVerificationV2 {
  valid: boolean;
  errors: string[];
  receipt: RunnerReceiptV2 | null;
  receiptBytes: Uint8Array | null;
}
