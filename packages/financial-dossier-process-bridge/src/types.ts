export const PROCESS_ATTEMPT_SCHEMA =
  "runbook.financial-dossier-process-attempt.v2-candidate.4" as const;
export const PROCESS_BRIDGE_PROFILE =
  "runbook.financial-dossier-process-bridge.completed-lifecycle.v2-candidate.5" as const;
/** Attempted-crash (injected-crash) process-bridge profile for primary crash trials. */
export const PROCESS_BRIDGE_ATTEMPTED_CRASH_PROFILE =
  "runbook.financial-dossier-process-bridge.attempted-crash.v2-candidate.1" as const;

/** Process-bridged completed lifecycles committed by this package revision. */
export const PROCESS_BRIDGED_SCENARIO_IDS = Object.freeze([
  "finance-000-allowed-calibration",
  "finance-003-account-switch-after-review",
  "finance-010-duplicate-retry",
  "finance-027-secret-canary-sink-scan",
  "finance-028-timeout-after-submission",
] as const);
export type ProcessBridgedScenarioId = typeof PROCESS_BRIDGED_SCENARIO_IDS[number];

/**
 * finance-030 recovery trial IDs that may be process-bridged under the completed
 * multi-request grammar when the host seeds the recovery journal first (or after
 * a process-bridged before-claim primary that advances the same journal).
 */
export const PROCESS_BRIDGED_RECOVER_TRIAL_IDS = Object.freeze([
  "before-claim-recovery",
  "after-claim-recovery",
  "after-effect-recovery",
] as const);
export type ProcessBridgedRecoverTrialId = typeof PROCESS_BRIDGED_RECOVER_TRIAL_IDS[number];

/**
 * finance-030 primary crash trial IDs process-bridged under the attempted-crash
 * grammar. Only before-claim-primary is shipped in this revision.
 */
export const PROCESS_BRIDGED_PRIMARY_CRASH_TRIAL_IDS = Object.freeze([
  "before-claim-primary",
] as const);
export type ProcessBridgedPrimaryCrashTrialId =
  typeof PROCESS_BRIDGED_PRIMARY_CRASH_TRIAL_IDS[number];

export const FINANCE_030_CRASH_BRANCHES = Object.freeze([
  "before-claim",
  "after-claim",
  "after-effect",
] as const);
export type Finance030CrashBranch = typeof FINANCE_030_CRASH_BRANCHES[number];

/** Branches with process-bridged primary crash evidence (kill + incomplete transcript). */
export const PROCESS_BRIDGED_PRIMARY_CRASH_BRANCHES = Object.freeze([
  "before-claim",
] as const satisfies readonly Finance030CrashBranch[]);
export type ProcessBridgedPrimaryCrashBranch =
  typeof PROCESS_BRIDGED_PRIMARY_CRASH_BRANCHES[number];

export const PROCESS_ATTEMPT_LIMITATIONS = Object.freeze([
  "five-case-completed-process-plus-host-seeded-recover-mode-and-before-claim-primary-crash-slice-only",
  "same-project-process-record-verifier-not-independent",
  "digest-binding-is-unauthenticated-and-not-runtime-attestation",
  "reviewed-hash-pinned-target-is-not-hostile-code-isolation",
  "runner-declared-adapter-contract-digest-is-distinct-from-executed-target-module-digest",
  "no-container-network-filesystem-credential-or-descendant-isolation-claim",
  "target-stdout-and-stderr-are-untrusted-digest-only-diagnostics",
  "no-broker-credential-account-order-card-capital-or-live-endpoint-used",
  "finance-030-after-claim-and-after-effect-primary-crash-remain-host-only",
  "finance-030-recover-process-evidence-requires-host-or-process-seeded-recovery-journal",
  "attempted-crash-kill-is-best-effort-process-group-not-descendant-isolation",
] as const);

export type TargetFaultClass = "completed" | "injected-crash";

export type ProcessEventCode =
  | "target-owned"
  | "spawned"
  | "target-bytes-written"
  | "session-open-written"
  | "ready-received"
  | "challenge-written"
  | "request-received"
  | "result-written"
  | "conclusion-staged"
  | "terminate-written"
  | "runner-write-closed"
  | "target-channel-eof"
  | "kill-attempted"
  | "child-exit"
  | "child-reaped"
  | "conclusion-committed"
  | "trial-sealed";

/** Fixed prefix of every completed multi-request process event program. */
export const COMPLETED_EVENT_PREFIX = Object.freeze([
  "target-owned",
  "spawned",
  "target-bytes-written",
  "session-open-written",
  "ready-received",
  "challenge-written",
] as const satisfies readonly ProcessEventCode[]);

/** Fixed suffix of every completed multi-request process event program. */
export const COMPLETED_EVENT_SUFFIX = Object.freeze([
  "conclusion-staged",
  "terminate-written",
  "runner-write-closed",
  "target-channel-eof",
  "child-exit",
  "child-reaped",
  "conclusion-committed",
  "trial-sealed",
] as const satisfies readonly ProcessEventCode[]);

/** Fixed close-out of the attempted-crash event program after the crash request. */
export const ATTEMPTED_CRASH_EVENT_SUFFIX = Object.freeze([
  "kill-attempted",
  "child-exit",
  "child-reaped",
  "trial-sealed",
] as const satisfies readonly ProcessEventCode[]);

/**
 * Live attempted-crash grammar notes. before-claim-primary is process-bridged;
 * after-claim and after-effect primaries remain host-only until their sealed-trial
 * branch semantics are wired under the same kill path.
 */
export const ATTEMPTED_CRASH_EVENT_DESIGN_NOTES = Object.freeze([
  "opening-matches-completed-prefix-through-challenge-written",
  "preview-and-approval-use-request-received-result-written-pairs",
  "submit-action-request-received-without-channel-result",
  "host-ingestRequestAndInjectCrash-then-kill-process-group",
  "killAttempted-true-classification-injected-crash",
  "no-conclusion-staged-terminate-or-conclusion-committed",
  "child-exit-and-child-reaped-then-trial-sealed",
  "before-claim-primary-process-bridged-under-attempted-crash-grammar",
  "after-claim-and-after-effect-primary-remain-host-only",
  "recovery-trials-remain-completed-grammar-with-seeded-journal",
] as const);

export const MAX_COMPLETED_REQUEST_COUNT = 32;

/**
 * Completed-run event program: fixed opening, then N request/result pairs, then
 * fixed close-out. N is the number of channel-request frames from the target.
 */
export function completedEventProgram(requestCount: number): readonly ProcessEventCode[] {
  if (!Number.isSafeInteger(requestCount) ||
      requestCount < 1 ||
      requestCount > MAX_COMPLETED_REQUEST_COUNT) {
    throw new RangeError("process-attempt.request-count-invalid");
  }
  const events: ProcessEventCode[] = [...COMPLETED_EVENT_PREFIX];
  for (let index = 0; index < requestCount; index += 1) {
    events.push("request-received", "result-written");
  }
  events.push(...COMPLETED_EVENT_SUFFIX);
  return Object.freeze(events);
}

/**
 * Attempted-crash event program: completed opening, then `completedPairs`
 * request/result pairs, then a crash `request-received` without result, then
 * kill/reap/seal close-out. Total channel requests = completedPairs + 1.
 */
export function attemptedCrashEventProgram(
  completedRequestResultPairs: number,
): readonly ProcessEventCode[] {
  if (!Number.isSafeInteger(completedRequestResultPairs) ||
      completedRequestResultPairs < 1 ||
      completedRequestResultPairs > MAX_COMPLETED_REQUEST_COUNT - 1) {
    throw new RangeError("process-attempt.crash-request-count-invalid");
  }
  const events: ProcessEventCode[] = [...COMPLETED_EVENT_PREFIX];
  for (let index = 0; index < completedRequestResultPairs; index += 1) {
    events.push("request-received", "result-written");
  }
  events.push("request-received");
  events.push(...ATTEMPTED_CRASH_EVENT_SUFFIX);
  return Object.freeze(events);
}

export type ProcessAttemptProfileVersion =
  | typeof PROCESS_BRIDGE_PROFILE
  | typeof PROCESS_BRIDGE_ATTEMPTED_CRASH_PROFILE;

export interface ProcessAttemptV2 {
  schemaVersion: typeof PROCESS_ATTEMPT_SCHEMA;
  profileVersion: ProcessAttemptProfileVersion;
  classification: TargetFaultClass;
  sessionBindingSha256: string;
  sealedTrialSha256: string;
  targetModuleSha256: string;
  targetModuleByteCount: number;
  loaderSha256: string;
  runnerToTargetTranscriptSha256: string;
  runnerToTargetByteCount: number;
  runnerToTargetFrameCount: number;
  targetToRunnerTranscriptSha256: string;
  targetToRunnerByteCount: number;
  targetToRunnerFrameCount: number;
  openingTranscriptSha256: string;
  openingByteCount: number;
  stdoutSha256: string;
  stdoutByteCount: number;
  stderrSha256: string;
  stderrByteCount: number;
  terminateWritten: boolean;
  runnerWriteClosed: boolean;
  targetChannelCleanEof: boolean;
  exitCode: number | null;
  signal: string | null;
  reaped: boolean;
  timedOut: boolean;
  killAttempted: boolean;
  events: ReadonlyArray<Readonly<{ code: ProcessEventCode; sequence: number }>>;
  limitations: readonly string[];
  attemptBindingSha256: string;
}

export interface CompletedProcessRunV2 {
  attempt: ProcessAttemptV2;
  attemptBytes: Uint8Array;
  loaderBytes: Uint8Array;
  sealedTrial: import("@runbook/financial-dossier-harness/private/runner").SealedHostTrialV2;
  sealedTrialBytes: Uint8Array;
  targetModuleBytes: Uint8Array;
  runnerToTargetTranscriptBytes: Uint8Array;
  targetToRunnerTranscriptBytes: Uint8Array;
}

/**
 * Attempted-crash process run: same six portable artifacts as a completed run,
 * plus the live recovery journal advanced by the primary crash and the nonces
 * needed to process-bridge the matching recovery trial.
 */
export interface AttemptedCrashProcessRunV2 extends CompletedProcessRunV2 {
  branch: ProcessBridgedPrimaryCrashBranch;
  recoveryJournal: import("@runbook/financial-dossier-harness/private/runner").RunnerOwnedRecoveryJournalV2;
  proposalNonce: string;
  runnerSecretNonce: string;
}

/** @deprecated Prefer CompletedProcessRunV2; retained for call-site stability. */
export type CompletedFinance000ProcessRunV2 = CompletedProcessRunV2;
