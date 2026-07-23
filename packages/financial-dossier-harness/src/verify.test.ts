import { describe, expect, it } from "vitest";
import { jcsBytes, sha256Bytes, sha256Jcs } from "./canonical.js";
import { buildObservedSuiteFixtureV2, REFERENCE_IDENTITY } from "./private/testing.js";
import {
  calculateObservationTraceHead,
  parseExactPrivacySidecarBytes,
  parseExactRunnerEvidenceBytes,
  replayRunnerEvidenceBytes,
  serializePrivacySidecar,
  serializeRunnerEvidence,
  serializeRunnerReceipt,
} from "./verify.js";
import {
  EVIDENCE_SCHEMA,
  EXECUTED_SCENARIO_IDS,
  OBSERVATION_SCHEMA,
  OBSERVED_HARNESS_LIMITATIONS,
  OBSERVED_HARNESS_PROFILE,
  PRIVACY_SIDECAR_SCHEMA,
  SCENARIO_IDS,
  TRIAL_LIFECYCLE,
  type DomainDisposition,
  type PrivacySidecarV2,
  type RecoveryJournalTransitionV2,
  type RecoveryState,
  type RunnerEvidenceV2,
  type RunnerObservationV2,
  type RunnerReceiptV2,
  type ScenarioRunEvidenceV2,
  type TrialEvidenceV2,
  type TrialId,
} from "./types.js";

const hash = (label: string) => sha256Jcs({ label });
const ZERO_HASH = "0".repeat(64);
const SCENARIO_TRIALS_DOMAIN = "runbook.financial-dossier-scenario-trials.v2-candidate.1";
const RECOVERY_JOURNAL_DOMAIN = "runbook.financial-dossier-recovery-journal.v2-candidate.1";
let trialSerial = 0;

function observation(
  sequence: number,
  type: RunnerObservationV2["type"],
  previousTraceHeadSha256: string,
  disposition: DomainDisposition | null = null,
  referencedTraceHeadSha256: string | null = null,
): RunnerObservationV2 {
  const candidate: RunnerObservationV2 = {
    schemaVersion: OBSERVATION_SCHEMA,
    sequence,
    logicalTick: sequence,
    type,
    operation: null,
    requestId: null,
    requestSha256: null,
    resultCode: null,
    resultSha256: type === "conclusion-observed" ? hash(`conclusion-${sequence}`) : null,
    stateTransition: "none",
    stateRootSha256: hash("stable-state"),
    disposition,
    referencedTraceHeadSha256: type === "conclusion-observed" ? referencedTraceHeadSha256 : null,
    previousTraceHeadSha256,
    traceHeadSha256: ZERO_HASH,
  };
  return { ...candidate, traceHeadSha256: calculateObservationTraceHead(candidate) };
}

function trial(
  trialId: TrialId,
  recoveryState: RecoveryState,
  disposition: DomainDisposition,
  recoveryJournalInitialSha256 = ZERO_HASH,
  recoveryJournalFinalSha256 = ZERO_HASH,
  recoveryJournalTransitions: RecoveryJournalTransitionV2[] = [],
): TrialEvidenceV2 {
  const serial = trialSerial++;
  const sessionBindingSha256 = hash(`session-${trialId}-${serial}`);
  const initialTargetTraceHeadSha256 = sha256Jcs({
    domain: "runbook.financial-dossier-target-trace-genesis.v2-candidate.1",
    sessionBindingSha256,
  });
  const first = observation(0, "session-opened", ZERO_HASH);
  const injectedCrash = trialId.endsWith("primary") && trialId !== "primary";
  const conclusion = injectedCrash ? null : observation(
    1,
    "conclusion-observed",
    first.traceHeadSha256,
    disposition,
    initialTargetTraceHeadSha256,
  );
  const terminal = observation(conclusion === null ? 1 : 2, "target-terminal", conclusion?.traceHeadSha256 ?? first.traceHeadSha256,
    conclusion === null ? null : disposition);
  const closed = observation(terminal.sequence + 1, "session-closed", terminal.traceHeadSha256,
    conclusion === null ? null : disposition);
  const recoveryBranch = trialId.replace(/-(primary|recovery)$/u, "");
  return {
    trialId,
    executionNonceSha256: sha256Jcs({ sessionBindingSha256, trialId }),
    executedTargetModuleSha256: null,
    sessionBindingSha256,
    launchBindingSha256: hash(`launch-${trialId}-${serial}`),
    recoveryActionBindingSha256: hash(`recovery-action-${recoveryBranch}`),
    recoveryJournalInitialSha256,
    recoveryJournalFinalSha256,
    recoveryJournalTransitions,
    lifecycle: TRIAL_LIFECYCLE,
    observations: conclusion === null ? [first, terminal, closed] : [first, conclusion, terminal, closed],
    recoveryState,
    terminalClass: trialId.endsWith("primary") && trialId !== "primary" ? "injected-crash" : "completed",
    traceHeadSha256: closed.traceHeadSha256,
  };
}

function journalTransition(
  branch: RecoveryJournalTransitionV2["branch"],
  state: RecoveryJournalTransitionV2["state"],
  sequence: number,
  previousJournalHeadSha256: string,
): RecoveryJournalTransitionV2 {
  return {
    branch,
    recoveryActionBindingSha256: hash(`recovery-action-${branch}`),
    state,
    sequence,
    previousJournalHeadSha256,
    journalHeadSha256: sha256Jcs({
      branch,
      domain: RECOVERY_JOURNAL_DOMAIN,
      previousJournalHeadSha256,
      recoveryActionBindingSha256: hash(`recovery-action-${branch}`),
      sequence,
      state,
    }),
  };
}

function runFor(scenarioId: typeof EXECUTED_SCENARIO_IDS[number]): ScenarioRunEvidenceV2 {
  const crash = scenarioId === "finance-030-crash-around-idempotency-claim";
  const before = journalTransition("before-claim", "unclaimed", 0, ZERO_HASH);
  const claim = journalTransition("after-claim", "claimed-unresolved", 0, ZERO_HASH);
  const effect = journalTransition("after-effect", "effect-observed", 0, ZERO_HASH);
  const reconciled = journalTransition("after-effect", "reconciled", 1, effect.journalHeadSha256);
  const trials = crash
    ? [
        trial("before-claim-primary", "unclaimed", "unresolved", ZERO_HASH, before.journalHeadSha256, [before]),
        trial("before-claim-recovery", "unclaimed", "unresolved", before.journalHeadSha256, before.journalHeadSha256),
        trial("after-claim-primary", "claimed-unresolved", "unresolved", ZERO_HASH, claim.journalHeadSha256, [claim]),
        trial("after-claim-recovery", "claimed-unresolved", "unresolved", claim.journalHeadSha256, claim.journalHeadSha256),
        trial("after-effect-primary", "claimed-unresolved", "unresolved", ZERO_HASH, effect.journalHeadSha256, [effect]),
        trial("after-effect-recovery", "reconciled", "unresolved", effect.journalHeadSha256, reconciled.journalHeadSha256, [reconciled]),
      ]
    : [trial("primary", "none", scenarioId === "finance-000-allowed-calibration" ? "proceed" : "deny")];
  const traceHeadSha256 = crash
    ? sha256Jcs({ domain: SCENARIO_TRIALS_DOMAIN, scenarioId, trialTraceHeads: trials.map((entry) => entry.traceHeadSha256) })
    : (trials[0]?.traceHeadSha256 ?? ZERO_HASH);
  return {
    scenarioId,
    ordinal: SCENARIO_IDS.indexOf(scenarioId),
    acceptedMutationEffectCount: 0,
    acceptedPreviewCount: 0,
    duplicateBoundCount: 0,
    mutationAttemptCount: 0,
    observedDisposition: trials.at(-1)?.observations.findLast((entry) => entry.type === "conclusion-observed")?.disposition ?? null,
    reconciliationAttemptCount: 0,
    recoveryStates: [...new Set(trials.map((entry) => entry.recoveryState).filter((state) => state !== "none"))],
    staleBindingAttemptCount: 0,
    trialEvidence: trials,
    traceHeadSha256,
  };
}

function fixture(): { evidence: RunnerEvidenceV2; sidecar: PrivacySidecarV2; evidenceBytes: Uint8Array; sidecarBytes: Uint8Array } {
  const runs = EXECUTED_SCENARIO_IDS.map(runFor);
  const privacyRun = runs.find((run) => run.scenarioId === "finance-027-secret-canary-sink-scan");
  if (privacyRun === undefined) throw new Error("fixture privacy run missing");
  const sidecar: PrivacySidecarV2 = {
    schemaVersion: PRIVACY_SIDECAR_SCHEMA,
    profileVersion: OBSERVED_HARNESS_PROFILE,
    dossierRunBindingSha256: hash("run"),
    scenarioTraceHeadSha256: privacyRun.traceHeadSha256,
    scans: ["target-protocol-egress", "portable-sink"].map((sinkClass) => ({
      scenarioId: "finance-027-secret-canary-sink-scan" as const,
      sinkClass: sinkClass as "target-protocol-egress" | "portable-sink",
      scanComplete: true,
      scannedByteCount: 100,
      contentSha256: hash(sinkClass),
      canaryMatchCount: 0,
      matchedCanaryClasses: [],
    })),
    limitations: ["exact-byte-modeled-egress-scan-only", "no-claim-about-unmodeled-sinks-or-transformed-canaries"],
  };
  const sidecarBytes = serializePrivacySidecar(sidecar);
  const evidence: RunnerEvidenceV2 = {
    schemaVersion: EVIDENCE_SCHEMA,
    profileVersion: OBSERVED_HARNESS_PROFILE,
    corpusManifestSha256: hash("corpus"),
    dossierRunBindingSha256: hash("run"),
    adapterBundleSha256: hash("adapter"),
    publicConfigurationSha256: hash("configuration"),
    runnerArtifactSha256: hash("runner"),
    channelContractSha256: hash("channel"),
    privacySidecarSha256: sha256Bytes(sidecarBytes),
    scenarioRuns: runs,
    results: SCENARIO_IDS.map((scenarioId, ordinal) => {
      const run = runs.find((candidate) => candidate.scenarioId === scenarioId);
      return run === undefined ? {
        scenarioId,
        ordinal,
        coverageStatus: "unrun" as const,
        controlStatus: null,
        observedDisposition: null,
        acceptedPreviewCount: 0,
        mutationAttemptCount: 0,
        acceptedMutationEffectCount: 0,
        reconciliationAttemptCount: 0,
        recoveryStates: [],
        deviationCodes: [],
        traceHeadSha256: null,
        evidenceBasis: "none" as const,
      } : (() => {
        const pass = false;
        return {
        scenarioId,
        ordinal,
        coverageStatus: "evaluated" as const,
        controlStatus: pass ? "pass" as const : "fail" as const,
        observedDisposition: run.observedDisposition,
        acceptedPreviewCount: run.acceptedPreviewCount,
        mutationAttemptCount: run.mutationAttemptCount,
        acceptedMutationEffectCount: run.acceptedMutationEffectCount,
        reconciliationAttemptCount: run.reconciliationAttemptCount,
        recoveryStates: run.recoveryStates,
        deviationCodes: pass ? [] : [`deviation.${scenarioId}.runner-observed-nonconformance`],
        traceHeadSha256: run.traceHeadSha256,
        evidenceBasis: "runner-observation" as const,
        };
      })();
    }),
    limitations: [...OBSERVED_HARNESS_LIMITATIONS],
  };
  return { evidence, sidecar, evidenceBytes: serializeRunnerEvidence(evidence), sidecarBytes };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rehashTrialAndBindings(
  evidence: RunnerEvidenceV2,
  runIndex: number,
  trialIndex: number,
): void {
  const run = evidence.scenarioRuns[runIndex];
  const trialEvidence = run?.trialEvidence[trialIndex];
  if (run === undefined || trialEvidence === undefined) throw new Error("test trial missing");
  let previousTraceHeadSha256 = ZERO_HASH;
  trialEvidence.observations = trialEvidence.observations.map((observation, index) => {
    const candidate = {
      ...observation,
      sequence: index,
      logicalTick: index,
      previousTraceHeadSha256,
      traceHeadSha256: ZERO_HASH,
    };
    const rehashed = { ...candidate, traceHeadSha256: calculateObservationTraceHead(candidate) };
    previousTraceHeadSha256 = rehashed.traceHeadSha256;
    return rehashed;
  });
  trialEvidence.traceHeadSha256 = previousTraceHeadSha256;
  run.traceHeadSha256 = run.scenarioId === "finance-030-crash-around-idempotency-claim"
    ? sha256Jcs({
        domain: SCENARIO_TRIALS_DOMAIN,
        scenarioId: run.scenarioId,
        trialTraceHeads: run.trialEvidence.map((trial) => trial.traceHeadSha256),
      })
    : trialEvidence.traceHeadSha256;
  const result = evidence.results[run.ordinal];
  if (result !== undefined) result.traceHeadSha256 = run.traceHeadSha256;
}

describe("runner evidence verifier", () => {
  it("replays the independently generated reference runner evidence", () => {
    const output = buildObservedSuiteFixtureV2();
    const replay = replayRunnerEvidenceBytes(output.evidenceBytes, output.privacySidecarBytes, {
      expectedRunnerArtifactSha256: REFERENCE_IDENTITY.runnerArtifactSha256,
    });
    expect(replay.valid, replay.errors.join(", ")).toBe(true);
    expect(replay.receipt?.counts).toEqual({ evaluated: 6, unrun: 25, controlPass: 6, controlFail: 0, controlNull: 25 });
  });

  it("accepts exact canonical evidence and emits a bound incomplete-coverage receipt", () => {
    const value = fixture();
    const replay = replayRunnerEvidenceBytes(value.evidenceBytes, value.sidecarBytes);
    expect(replay.valid).toBe(true);
    expect(replay.errors).toEqual([]);
    expect(replay.receipt?.counts).toEqual({ evaluated: 6, unrun: 25, controlPass: 0, controlFail: 6, controlNull: 25 });
    expect(replay.receipt?.coverageComplete).toBe(false);
    expect(replay.receipt?.evidenceSha256).toBe(sha256Bytes(value.evidenceBytes));
    expect(replay.receipt?.privacySidecarSha256).toBe(sha256Bytes(value.sidecarBytes));
    expect(replay.receiptBytes).not.toBeNull();
  });

  it("rejects a substituted scenario and a reordered result", () => {
    const first = fixture();
    const substituted = clone(first.evidence);
    substituted.scenarioRuns[0]!.scenarioId = "finance-003-account-switch-after-review";
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(substituted))).toThrow(/scenarioRuns\[0\]\.order/u);

    const reordered = clone(first.evidence);
    [reordered.results[0], reordered.results[1]] = [reordered.results[1]!, reordered.results[0]!];
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(reordered))).toThrow(/results\[0\]\.order/u);
  });

  it("rejects extra fields at every parsed boundary", () => {
    const value = fixture();
    const evidence = clone(value.evidence) as RunnerEvidenceV2 & { surprise?: boolean };
    evidence.surprise = true;
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(evidence))).toThrow(/evidence\.keys/u);

    const nested = clone(value.evidence) as unknown as { scenarioRuns: Array<{ surprise?: boolean }> };
    nested.scenarioRuns[0]!.surprise = true;
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(nested))).toThrow(/scenarioRuns\[0\]\.keys/u);
  });

  it("rejects oversized, noncanonical, and malformed UTF-8 inputs before trust", () => {
    expect(() => parseExactRunnerEvidenceBytes(new Uint8Array(1024 * 1024 + 1))).toThrow(/evidence\.bytes/u);
    expect(() => parseExactPrivacySidecarBytes(new Uint8Array(128 * 1024 + 1))).toThrow(/privacySidecar\.bytes/u);
    const value = fixture();
    const pretty = new TextEncoder().encode(JSON.stringify(value.evidence, null, 2));
    expect(() => parseExactRunnerEvidenceBytes(pretty)).toThrow(/evidence\.noncanonical/u);
    expect(() => parseExactRunnerEvidenceBytes(Uint8Array.of(0xff))).toThrow(/evidence\.utf8/u);
  });

  it("rejects observation sequence, linkage, and trace substitutions", () => {
    for (const field of ["sequence", "previousTraceHeadSha256", "traceHeadSha256"] as const) {
      const value = fixture();
      const evidence = clone(value.evidence);
      const observation = evidence.scenarioRuns[0]!.trialEvidence[0]!.observations[1]!;
      if (field === "sequence") observation.sequence = 8;
      else observation[field] = hash(`substituted-${field}`);
      expect(() => parseExactRunnerEvidenceBytes(jcsBytes(evidence))).toThrow(/observations\[1\]/u);
    }
  });

  it("rejects finance-030 trial removal and trial reordering", () => {
    const removed = fixture();
    const removedEvidence = clone(removed.evidence);
    removedEvidence.scenarioRuns.at(-1)!.trialEvidence.pop();
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(removedEvidence))).toThrow(/trialEvidence\.order/u);

    const reordered = fixture();
    const reorderedEvidence = clone(reordered.evidence);
    const trials = reorderedEvidence.scenarioRuns.at(-1)!.trialEvidence;
    [trials[0], trials[1]] = [trials[1]!, trials[0]!];
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(reorderedEvidence))).toThrow(/trialEvidence\.order/u);
  });

  it("rejects sidecar digest, run, trace, scan, and result substitutions", () => {
    const cases: Array<(value: ReturnType<typeof fixture>) => void> = [
      (value) => { value.evidence.privacySidecarSha256 = hash("wrong-sidecar"); value.evidenceBytes = jcsBytes(value.evidence); },
      (value) => { value.sidecar.dossierRunBindingSha256 = hash("wrong-run"); value.sidecarBytes = jcsBytes(value.sidecar); value.evidence.privacySidecarSha256 = sha256Bytes(value.sidecarBytes); value.evidenceBytes = jcsBytes(value.evidence); },
      (value) => { value.sidecar.scenarioTraceHeadSha256 = hash("wrong-trace"); value.sidecarBytes = jcsBytes(value.sidecar); value.evidence.privacySidecarSha256 = sha256Bytes(value.sidecarBytes); value.evidenceBytes = jcsBytes(value.evidence); },
    ];
    for (const mutate of cases) {
      const value = fixture();
      mutate(value);
      const replay = replayRunnerEvidenceBytes(value.evidenceBytes, value.sidecarBytes);
      expect(replay.valid).toBe(false);
      expect(replay.receipt).toBeNull();
    }

    const reference = buildObservedSuiteFixtureV2();
    const sidecar = clone(reference.privacySidecar);
    sidecar.scans[0]!.scanComplete = false;
    const sidecarBytes = jcsBytes(sidecar);
    const evidence = clone(reference.evidence);
    evidence.privacySidecarSha256 = sha256Bytes(sidecarBytes);
    expect(replayRunnerEvidenceBytes(jcsBytes(evidence), sidecarBytes).valid).toBe(false);
  });

  it("enforces an optional expected runner artifact pin", () => {
    const value = fixture();
    expect(replayRunnerEvidenceBytes(value.evidenceBytes, value.sidecarBytes, {
      expectedRunnerArtifactSha256: value.evidence.runnerArtifactSha256,
    }).valid).toBe(true);
    const mismatch = replayRunnerEvidenceBytes(value.evidenceBytes, value.sidecarBytes, {
      expectedRunnerArtifactSha256: hash("different-runner"),
    });
    expect(mismatch.valid).toBe(false);
    expect(mismatch.errors).toEqual(["evidence.runnerArtifactSha256.pin-mismatch"]);
  });

  it("rejects a forged and fully rehashed request after target termination", () => {
    const evidence = clone(buildObservedSuiteFixtureV2().evidence);
    const trialEvidence = evidence.scenarioRuns[0]!.trialEvidence[0]!;
    const closed = trialEvidence.observations.pop()!;
    const terminal = trialEvidence.observations.at(-1)!;
    trialEvidence.observations.push({
      schemaVersion: OBSERVATION_SCHEMA,
      sequence: closed.sequence,
      logicalTick: closed.logicalTick,
      type: "request-observed",
      operation: "read-account-state",
      requestId: "request-0001",
      requestSha256: hash("forged-post-terminal-request"),
      resultCode: null,
      resultSha256: null,
      stateTransition: "none",
      stateRootSha256: terminal.stateRootSha256,
      disposition: null,
      referencedTraceHeadSha256: hash("forged-target-head"),
      previousTraceHeadSha256: terminal.traceHeadSha256,
      traceHeadSha256: ZERO_HASH,
    }, closed);
    rehashTrialAndBindings(evidence, 0, 0);
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(evidence))).toThrow(/phase|post-terminal/u);
  });

  it("rejects unlinked, reordered, duplicate-slot, and non-advancing target channel traces after rehash", () => {
    const mutations: Array<(trialEvidence: TrialEvidenceV2) => void> = [
      (trialEvidence) => {
        const request = trialEvidence.observations.find((item) => item.type === "request-observed")!;
        request.referencedTraceHeadSha256 = hash("unlinked-target-head");
      },
      (trialEvidence) => {
        const requestIndex = trialEvidence.observations.findIndex((item) => item.type === "request-observed");
        for (let index = requestIndex; index < trialEvidence.observations.length; index += 1) {
          const item = trialEvidence.observations[index]!;
          if (item.type !== "request-observed" && item.type !== "state-transition" && item.type !== "result-issued") break;
          item.requestId = "request-0001";
          if (item.type === "result-issued") break;
        }
      },
      (trialEvidence) => {
        const requestIndexes = trialEvidence.observations.flatMap((item, index) => item.type === "request-observed" ? [index] : []);
        const secondIndex = requestIndexes[1]!;
        for (let index = secondIndex; index < trialEvidence.observations.length; index += 1) {
          const item = trialEvidence.observations[index]!;
          if (item.type !== "request-observed" && item.type !== "state-transition" && item.type !== "result-issued") break;
          item.requestId = "request-0000";
          if (item.type === "result-issued") break;
        }
      },
      (trialEvidence) => {
        const result = trialEvidence.observations.find((item) => item.type === "result-issued")!;
        result.referencedTraceHeadSha256 = ZERO_HASH;
      },
    ];
    for (const mutate of mutations) {
      const evidence = clone(buildObservedSuiteFixtureV2().evidence);
      const trialEvidence = evidence.scenarioRuns[2]!.trialEvidence[0]!;
      mutate(trialEvidence);
      rehashTrialAndBindings(evidence, 2, 0);
      expect(() => parseExactRunnerEvidenceBytes(jcsBytes(evidence))).toThrow(/channel/u);
    }
  });

  it("requires unresolved recovery conclusions and pairwise recovery action correlation", () => {
    const removed = clone(buildObservedSuiteFixtureV2().evidence);
    const recoveryTrial = removed.scenarioRuns.at(-1)!.trialEvidence[1]!;
    recoveryTrial.observations = recoveryTrial.observations.filter((item) => item.type !== "conclusion-observed");
    rehashTrialAndBindings(removed, 5, 1);
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(removed))).toThrow(/phase|conclusion/u);

    const mismatched = clone(buildObservedSuiteFixtureV2().evidence);
    mismatched.scenarioRuns.at(-1)!.trialEvidence[1]!.recoveryActionBindingSha256 = hash("different-recovery-action");
    expect(() => parseExactRunnerEvidenceBytes(jcsBytes(mismatched))).toThrow(/recovery-journal\.pair/u);
  });

  it("serializes normalized owned values even when source accessors change after validation", () => {
    const reference = buildObservedSuiteFixtureV2();
    const evidence = clone(reference.evidence) as RunnerEvidenceV2 & { schemaVersion: string };
    let evidenceReads = 0;
    Object.defineProperty(evidence, "schemaVersion", {
      enumerable: true,
      get: () => evidenceReads++ === 0 ? EVIDENCE_SCHEMA : "attacker-mutated-evidence",
    });
    const sidecar = clone(reference.privacySidecar) as PrivacySidecarV2 & { profileVersion: string };
    let sidecarReads = 0;
    Object.defineProperty(sidecar, "profileVersion", {
      enumerable: true,
      get: () => sidecarReads++ === 0 ? OBSERVED_HARNESS_PROFILE : "attacker-mutated-sidecar",
    });
    const evidenceBytes = serializeRunnerEvidence(evidence);
    const sidecarBytes = serializePrivacySidecar(sidecar);
    expect(evidenceReads).toBe(1);
    expect(sidecarReads).toBe(1);
    expect(replayRunnerEvidenceBytes(evidenceBytes, sidecarBytes).valid).toBe(true);

    const receipt = replayRunnerEvidenceBytes(reference.evidenceBytes, reference.privacySidecarBytes).receipt!;
    const hostileReceipt = clone(receipt) as RunnerReceiptV2;
    let limitationsReads = 0;
    Object.defineProperty(hostileReceipt, "limitations", {
      enumerable: true,
      get: () => limitationsReads++ === 0 ? [...OBSERVED_HARNESS_LIMITATIONS] : ["attacker-mutated-limitations"],
    });
    const receiptBytes = serializeRunnerReceipt(hostileReceipt);
    expect(limitationsReads).toBe(1);
    expect(() => serializeRunnerReceipt(JSON.parse(new TextDecoder().decode(receiptBytes)) as RunnerReceiptV2)).not.toThrow();
  });

  it("rejects sparse arrays before direct-object serialization", () => {
    const evidence = clone(buildObservedSuiteFixtureV2().evidence);
    delete evidence.results[5];
    expect(() => serializeRunnerEvidence(evidence)).toThrow(/array-density/u);
  });

  it("rejects receipt limitations, counts, and result statuses inconsistent with the fixed coverage shape", () => {
    const reference = buildObservedSuiteFixtureV2();
    const receipt = replayRunnerEvidenceBytes(reference.evidenceBytes, reference.privacySidecarBytes).receipt!;

    const stripped = clone(receipt);
    stripped.limitations.pop();
    expect(() => serializeRunnerReceipt(stripped)).toThrow(/receipt\.limitations/u);

    const badCounts = clone(receipt);
    badCounts.counts.controlPass -= 1;
    badCounts.counts.controlFail += 1;
    expect(() => serializeRunnerReceipt(badCounts)).toThrow(/receipt\.counts\.controls/u);

    const badStatus = clone(receipt) as RunnerReceiptV2;
    const unrun = badStatus.results[1]!;
    unrun.controlStatus = "fail";
    expect(() => serializeRunnerReceipt(badStatus)).toThrow(/receipt\.results\[1\]\.unrun/u);
  });
});
