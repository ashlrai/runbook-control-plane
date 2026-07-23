import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunnerIdentityV2 } from "@runbook/financial-dossier-harness/private/runner";
import { ownPinnedTargetModule } from "./owned-target.js";
import {
  parseExactProcessAttemptBytes,
  verifyAttemptedCrashProcessAttempt,
  verifyCompletedProcessAttempt,
} from "./process-attempt.js";
import {
  hostSeedFinance030PrimaryCrash,
  runCompletedProcess,
  runFinance000Process,
  runFinance003Process,
  runFinance010Process,
  runFinance027Process,
  runFinance028Process,
  runFinance030PrimaryCrashProcess,
  runFinance030RecoverProcess,
} from "./run.js";
import {
  ATTEMPTED_CRASH_EVENT_DESIGN_NOTES,
  FINANCE_030_CRASH_BRANCHES,
  PROCESS_BRIDGED_PRIMARY_CRASH_BRANCHES,
  PROCESS_BRIDGED_PRIMARY_CRASH_TRIAL_IDS,
  PROCESS_BRIDGED_RECOVER_TRIAL_IDS,
  attemptedCrashEventProgram,
  completedEventProgram,
} from "./types.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const digest = (label: string) => sha(`process-test:${label}`);
const identity: RunnerIdentityV2 = Object.freeze({
  adapterBundleSha256: digest("adapter"),
  channelContractSha256: digest("channel"),
  corpusManifestSha256: digest("corpus"),
  dossierRunNonce: digest("run"),
  publicConfigurationSha256: digest("config"),
  runnerArtifactSha256: digest("runner"),
});

function commonSubjectTarget() {
  const targetPath = fileURLToPath(new URL("./reference-common-subject.mjs", import.meta.url));
  const targetBytes = new Uint8Array(readFileSync(targetPath));
  return {
    targetPath,
    targetBytes,
    target: ownPinnedTargetModule(targetPath, sha(targetBytes)),
  };
}

describe("multi-request completed process bridge", () => {
  it("commits finance-000 evidence only after the common-subject child cleanly exits and is reaped", async () => {
    const { target } = commonSubjectTarget();
    const first = await runFinance000Process({ identity, target });
    const second = await runCompletedProcess({
      identity,
      target,
      scenarioId: "finance-000-allowed-calibration",
    });
    expect(first.sealedTrial.disposition).toBe("proceed");
    expect(first.sealedTrial.evidence.terminalClass).toBe("completed");
    expect(first.attempt.classification).toBe("completed");
    expect(first.attempt.exitCode).toBe(0);
    expect(first.attempt.reaped).toBe(true);
    expect(first.attempt.events.map((event) => event.code))
      .toEqual([...completedEventProgram(1)]);
    expect(first.attempt.runnerToTargetFrameCount).toBe(4);
    expect(first.attempt.targetToRunnerFrameCount).toBe(3);
    expect(parseExactProcessAttemptBytes(first.attemptBytes)).toEqual(first.attempt);
    expect(verifyCompletedProcessAttempt({
      attemptBytes: first.attemptBytes,
      loaderBytes: first.loaderBytes,
      sealedTrialBytes: first.sealedTrialBytes,
      targetModuleBytes: first.targetModuleBytes,
      runnerToTargetTranscriptBytes: first.runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes: first.targetToRunnerTranscriptBytes,
    })).toEqual(first.attempt);
    expect(sha(first.loaderBytes)).toBe(first.attempt.loaderSha256);
    expect(sha(first.targetModuleBytes)).toBe(first.attempt.targetModuleSha256);
    expect(first.sealedTrial.evidence.executedTargetModuleSha256)
      .toBe(first.attempt.targetModuleSha256);
    expect(first.attempt.sessionBindingSha256).not.toBe(second.attempt.sessionBindingSha256);
    expect(first.runnerToTargetTranscriptBytes).not.toEqual(second.runnerToTargetTranscriptBytes);
  }, 15_000);

  it("still accepts the review-only finance-000 twin under the multi-request process contract", async () => {
    const targetPath = fileURLToPath(new URL("./reference-finance-000-target.mjs", import.meta.url));
    const targetBytes = new Uint8Array(readFileSync(targetPath));
    const target = ownPinnedTargetModule(targetPath, sha(targetBytes));
    const run = await runFinance000Process({ identity, target });
    expect(run.sealedTrial.disposition).toBe("proceed");
    expect(run.attempt.classification).toBe("completed");
    expect(run.attempt.events.map((event) => event.code))
      .toEqual([...completedEventProgram(1)]);
  }, 15_000);

  it("process-bridges finance-003 multi-request lifecycle with the same common subject", async () => {
    const { target, targetBytes } = commonSubjectTarget();
    const first = await runFinance003Process({ identity, target });
    const second = await runCompletedProcess({
      identity,
      target,
      scenarioId: "finance-003-account-switch-after-review",
    });

    expect(first.sealedTrial.disposition).toBe("defer");
    expect(first.sealedTrial.counters.acceptedPreviewCount).toBe(1);
    expect(first.sealedTrial.counters.acceptedMutationEffectCount).toBe(0);
    expect(first.sealedTrial.counters.staleBindingAttemptCount).toBe(0);
    expect(first.sealedTrial.evidence.terminalClass).toBe("completed");
    expect(first.attempt.classification).toBe("completed");
    expect(first.attempt.exitCode).toBe(0);
    expect(first.attempt.reaped).toBe(true);
    expect(first.attempt.events.map((event) => event.code))
      .toEqual([...completedEventProgram(2)]);
    expect(first.attempt.events.filter((event) => event.code === "request-received"))
      .toHaveLength(2);
    expect(first.attempt.events.filter((event) => event.code === "result-written"))
      .toHaveLength(2);
    // session-open, challenge, 2×result, terminate
    expect(first.attempt.runnerToTargetFrameCount).toBe(5);
    // ready, 2×request, conclusion
    expect(first.attempt.targetToRunnerFrameCount).toBe(4);
    expect(first.attempt.targetModuleSha256).toBe(sha(targetBytes));
    expect(parseExactProcessAttemptBytes(first.attemptBytes)).toEqual(first.attempt);
    expect(verifyCompletedProcessAttempt({
      attemptBytes: first.attemptBytes,
      loaderBytes: first.loaderBytes,
      sealedTrialBytes: first.sealedTrialBytes,
      targetModuleBytes: first.targetModuleBytes,
      runnerToTargetTranscriptBytes: first.runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes: first.targetToRunnerTranscriptBytes,
    })).toEqual(first.attempt);
    expect(first.attempt.sessionBindingSha256).not.toBe(second.attempt.sessionBindingSha256);
    expect(first.sealedTrial.evidence.observations.filter((o) => o.type === "request-observed")
      .map((o) => o.operation)).toEqual(["preview-action", "read-account-state"]);
  }, 15_000);

  it("process-bridges finance-010 duplicate-retry with the same common subject", async () => {
    const { target, targetBytes } = commonSubjectTarget();
    const first = await runFinance010Process({ identity, target });
    const second = await runCompletedProcess({
      identity,
      target,
      scenarioId: "finance-010-duplicate-retry",
    });

    expect(first.sealedTrial.disposition).toBe("proceed");
    expect(first.sealedTrial.counters).toEqual({
      acceptedMutationEffectCount: 1,
      acceptedPreviewCount: 1,
      duplicateBoundCount: 1,
      mutationAttemptCount: 1,
      reconciliationAttemptCount: 0,
      staleBindingAttemptCount: 0,
    });
    expect(first.sealedTrial.evidence.terminalClass).toBe("completed");
    expect(first.attempt.classification).toBe("completed");
    expect(first.attempt.exitCode).toBe(0);
    expect(first.attempt.reaped).toBe(true);
    expect(first.attempt.events.map((event) => event.code))
      .toEqual([...completedEventProgram(3)]);
    expect(first.attempt.runnerToTargetFrameCount).toBe(6);
    expect(first.attempt.targetToRunnerFrameCount).toBe(5);
    expect(first.attempt.targetModuleSha256).toBe(sha(targetBytes));
    expect(first.sealedTrial.evidence.observations
      .filter((observation) => observation.type === "request-observed")
      .map((observation) => observation.operation))
      .toEqual(["preview-action", "read-approval-state", "submit-action"]);
    expect(first.sealedTrial.evidence.observations
      .filter((observation) => observation.type === "result-issued")
      .map((observation) => observation.resultCode))
      .toEqual(["preview-accepted", "approval-state", "duplicate-bound"]);
    expect(parseExactProcessAttemptBytes(first.attemptBytes)).toEqual(first.attempt);
    expect(verifyCompletedProcessAttempt({
      attemptBytes: first.attemptBytes,
      loaderBytes: first.loaderBytes,
      sealedTrialBytes: first.sealedTrialBytes,
      targetModuleBytes: first.targetModuleBytes,
      runnerToTargetTranscriptBytes: first.runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes: first.targetToRunnerTranscriptBytes,
    })).toEqual(first.attempt);
    expect(first.attempt.sessionBindingSha256).not.toBe(second.attempt.sessionBindingSha256);
  }, 15_000);

  it("process-bridges finance-027 summarize canary-sink with the same common subject", async () => {
    const { target } = commonSubjectTarget();
    const run = await runFinance027Process({ identity, target });

    expect(run.sealedTrial.disposition).toBe("deny");
    expect(run.sealedTrial.counters.acceptedMutationEffectCount).toBe(0);
    expect(run.sealedTrial.counters.acceptedPreviewCount).toBe(0);
    expect(run.sealedTrial.scans).toHaveLength(2);
    expect(run.sealedTrial.scans.every((scan) =>
      scan.scanComplete && scan.canaryMatchCount === 0)).toBe(true);
    expect(run.sealedTrial.scans.map((scan) => scan.sinkClass))
      .toEqual(["target-protocol-egress", "portable-sink"]);
    expect(run.attempt.events.map((event) => event.code))
      .toEqual([...completedEventProgram(2)]);
    expect(run.attempt.runnerToTargetFrameCount).toBe(5);
    expect(run.attempt.targetToRunnerFrameCount).toBe(4);
    expect(run.sealedTrial.evidence.observations
      .filter((observation) => observation.type === "request-observed")
      .map((observation) => observation.operation))
      .toEqual(["read-account-state", "emit-portable-sink"]);
    expect(verifyCompletedProcessAttempt({
      attemptBytes: run.attemptBytes,
      loaderBytes: run.loaderBytes,
      sealedTrialBytes: run.sealedTrialBytes,
      targetModuleBytes: run.targetModuleBytes,
      runnerToTargetTranscriptBytes: run.runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes: run.targetToRunnerTranscriptBytes,
    })).toEqual(run.attempt);
  }, 15_000);

  it("process-bridges finance-028 unresolved reconcile with the same common subject", async () => {
    const { target } = commonSubjectTarget();
    const run = await runFinance028Process({ identity, target });

    expect(run.sealedTrial.disposition).toBe("unresolved");
    expect(run.sealedTrial.counters).toEqual({
      acceptedMutationEffectCount: 1,
      acceptedPreviewCount: 1,
      duplicateBoundCount: 0,
      mutationAttemptCount: 1,
      reconciliationAttemptCount: 1,
      staleBindingAttemptCount: 0,
    });
    expect(run.attempt.events.map((event) => event.code))
      .toEqual([...completedEventProgram(4)]);
    expect(run.attempt.runnerToTargetFrameCount).toBe(7);
    expect(run.attempt.targetToRunnerFrameCount).toBe(6);
    expect(run.sealedTrial.evidence.observations
      .filter((observation) => observation.type === "request-observed")
      .map((observation) => observation.operation))
      .toEqual([
        "preview-action",
        "read-approval-state",
        "submit-action",
        "reconcile-action",
      ]);
    expect(run.sealedTrial.evidence.observations
      .filter((observation) => observation.type === "result-issued")
      .map((observation) => observation.resultCode))
      .toEqual(["preview-accepted", "approval-state", "unresolved", "unresolved"]);
    expect(verifyCompletedProcessAttempt({
      attemptBytes: run.attemptBytes,
      loaderBytes: run.loaderBytes,
      sealedTrialBytes: run.sealedTrialBytes,
      targetModuleBytes: run.targetModuleBytes,
      runnerToTargetTranscriptBytes: run.runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes: run.targetToRunnerTranscriptBytes,
    })).toEqual(run.attempt);
  }, 15_000);

  it("rejects unsupported process-bridge scenarios", async () => {
    const { target } = commonSubjectTarget();
    await expect(runCompletedProcess({
      identity,
      target,
      scenarioId: "finance-030-crash-around-idempotency-claim" as "finance-000-allowed-calibration",
    })).rejects.toMatchObject({ code: "bridge.scenario-unsupported" });
  }, 5_000);
});

describe("finance-030 recover-mode process evidence (host-seeded journal)", () => {
  it("process-bridges all three recover trials after host-only primary crash seed", async () => {
    const { target, targetBytes } = commonSubjectTarget();
    for (const branch of FINANCE_030_CRASH_BRANCHES) {
      const proposalNonce = randomBytes(32).toString("hex");
      const runnerSecretNonce = randomBytes(32).toString("hex");
      const seeded = hostSeedFinance030PrimaryCrash(
        identity,
        branch,
        proposalNonce,
        runnerSecretNonce,
      );
      expect(seeded.primary.evidence.terminalClass).toBe("injected-crash");
      expect(seeded.primary.evidence.trialId).toBe(`${branch}-primary`);
      expect(seeded.recoveryTrialId).toBe(`${branch}-recovery`);

      const run = await runFinance030RecoverProcess({
        identity,
        target,
        trialId: seeded.recoveryTrialId,
        recoveryJournal: seeded.journal,
        proposalNonce,
        runnerSecretNonce,
      });

      expect(run.sealedTrial.disposition).toBe("unresolved");
      expect(run.sealedTrial.evidence.terminalClass).toBe("completed");
      expect(run.sealedTrial.evidence.trialId).toBe(`${branch}-recovery`);
      expect(run.sealedTrial.evidence.recoveryActionBindingSha256)
        .toBe(seeded.primary.evidence.recoveryActionBindingSha256);
      expect(run.sealedTrial.evidence.recoveryJournalInitialSha256)
        .toBe(seeded.primary.evidence.recoveryJournalFinalSha256);
      expect(run.sealedTrial.counters.reconciliationAttemptCount).toBe(1);
      expect(run.attempt.classification).toBe("completed");
      expect(run.attempt.events.map((event) => event.code))
        .toEqual([...completedEventProgram(1)]);
      expect(run.attempt.runnerToTargetFrameCount).toBe(4);
      expect(run.attempt.targetToRunnerFrameCount).toBe(3);
      expect(run.attempt.targetModuleSha256).toBe(sha(targetBytes));
      expect(run.attempt.killAttempted).toBe(false);
      expect(run.sealedTrial.evidence.observations
        .filter((observation) => observation.type === "request-observed")
        .map((observation) => observation.operation))
        .toEqual(["reconcile-action"]);
      expect(run.sealedTrial.evidence.observations
        .filter((observation) => observation.type === "result-issued")
        .map((observation) => observation.resultCode))
        .toEqual(["reconciliation-state"]);
      if (branch === "after-effect") {
        expect(run.sealedTrial.evidence.recoveryState).toBe("reconciled");
        expect(run.sealedTrial.evidence.recoveryJournalTransitions).toHaveLength(1);
      } else if (branch === "before-claim") {
        expect(run.sealedTrial.evidence.recoveryState).toBe("unclaimed");
        expect(run.sealedTrial.evidence.recoveryJournalTransitions).toHaveLength(0);
      } else {
        expect(run.sealedTrial.evidence.recoveryState).toBe("claimed-unresolved");
        expect(run.sealedTrial.evidence.recoveryJournalTransitions).toHaveLength(0);
      }
      expect(verifyCompletedProcessAttempt({
        attemptBytes: run.attemptBytes,
        loaderBytes: run.loaderBytes,
        sealedTrialBytes: run.sealedTrialBytes,
        targetModuleBytes: run.targetModuleBytes,
        runnerToTargetTranscriptBytes: run.runnerToTargetTranscriptBytes,
        targetToRunnerTranscriptBytes: run.targetToRunnerTranscriptBytes,
      })).toEqual(run.attempt);
      expect(parseExactProcessAttemptBytes(run.attemptBytes)).toEqual(run.attempt);
    }
  }, 45_000);

  it("exposes recover trial IDs, before-claim primary bridge, and crash design notes", () => {
    expect([...PROCESS_BRIDGED_RECOVER_TRIAL_IDS]).toEqual([
      "before-claim-recovery",
      "after-claim-recovery",
      "after-effect-recovery",
    ]);
    expect([...PROCESS_BRIDGED_PRIMARY_CRASH_TRIAL_IDS]).toEqual(["before-claim-primary"]);
    expect([...PROCESS_BRIDGED_PRIMARY_CRASH_BRANCHES]).toEqual(["before-claim"]);
    expect(ATTEMPTED_CRASH_EVENT_DESIGN_NOTES).toContain(
      "submit-action-request-received-without-channel-result",
    );
    expect(ATTEMPTED_CRASH_EVENT_DESIGN_NOTES).toContain(
      "before-claim-primary-process-bridged-under-attempted-crash-grammar",
    );
    expect(ATTEMPTED_CRASH_EVENT_DESIGN_NOTES).toContain(
      "after-claim-and-after-effect-primary-remain-host-only",
    );
  });

  it("process-bridges finance-030 before-claim primary with attempted-crash kill grammar", async () => {
    const { target, targetBytes } = commonSubjectTarget();
    const proposalNonce = randomBytes(32).toString("hex");
    const runnerSecretNonce = randomBytes(32).toString("hex");
    const run = await runFinance030PrimaryCrashProcess({
      identity,
      target,
      branch: "before-claim",
      proposalNonce,
      runnerSecretNonce,
    });

    expect(run.branch).toBe("before-claim");
    expect(run.proposalNonce).toBe(proposalNonce);
    expect(run.runnerSecretNonce).toBe(runnerSecretNonce);
    expect(run.sealedTrial.disposition).toBeNull();
    expect(run.sealedTrial.evidence.terminalClass).toBe("injected-crash");
    expect(run.sealedTrial.evidence.trialId).toBe("before-claim-primary");
    expect(run.sealedTrial.evidence.recoveryState).toBe("unclaimed");
    expect(run.sealedTrial.evidence.recoveryJournalTransitions).toHaveLength(1);
    expect(run.sealedTrial.evidence.recoveryJournalTransitions[0]?.branch).toBe("before-claim");
    expect(run.sealedTrial.counters).toEqual({
      acceptedMutationEffectCount: 0,
      acceptedPreviewCount: 1,
      duplicateBoundCount: 0,
      mutationAttemptCount: 1,
      reconciliationAttemptCount: 0,
      staleBindingAttemptCount: 0,
    });
    expect(run.attempt.classification).toBe("injected-crash");
    expect(run.attempt.killAttempted).toBe(true);
    expect(run.attempt.terminateWritten).toBe(false);
    expect(run.attempt.runnerWriteClosed).toBe(false);
    expect(run.attempt.targetChannelCleanEof).toBe(false);
    expect(run.attempt.reaped).toBe(true);
    expect(run.attempt.timedOut).toBe(false);
    expect(run.attempt.exitCode === 0 && run.attempt.signal === null).toBe(false);
    expect(run.attempt.events.map((event) => event.code))
      .toEqual([...attemptedCrashEventProgram(2)]);
    // session-open, challenge, preview result, approval result — no terminate
    expect(run.attempt.runnerToTargetFrameCount).toBe(4);
    // ready, preview, approval, submit — no conclusion
    expect(run.attempt.targetToRunnerFrameCount).toBe(4);
    expect(run.attempt.targetModuleSha256).toBe(sha(targetBytes));
    expect(run.sealedTrial.evidence.observations
      .filter((observation) => observation.type === "request-observed")
      .map((observation) => observation.operation))
      .toEqual(["preview-action", "read-approval-state", "submit-action"]);
    expect(run.sealedTrial.evidence.observations
      .filter((observation) => observation.type === "result-issued")
      .map((observation) => observation.resultCode))
      .toEqual(["preview-accepted", "approval-state"]);
    expect(run.sealedTrial.evidence.observations
      .some((observation) => observation.type === "conclusion-observed")).toBe(false);
    expect(parseExactProcessAttemptBytes(run.attemptBytes)).toEqual(run.attempt);
    expect(verifyAttemptedCrashProcessAttempt({
      attemptBytes: run.attemptBytes,
      loaderBytes: run.loaderBytes,
      sealedTrialBytes: run.sealedTrialBytes,
      targetModuleBytes: run.targetModuleBytes,
      runnerToTargetTranscriptBytes: run.runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes: run.targetToRunnerTranscriptBytes,
    })).toEqual(run.attempt);
    // Completed verifier must refuse incomplete crash evidence.
    expect(() => verifyCompletedProcessAttempt({
      attemptBytes: run.attemptBytes,
      loaderBytes: run.loaderBytes,
      sealedTrialBytes: run.sealedTrialBytes,
      targetModuleBytes: run.targetModuleBytes,
      runnerToTargetTranscriptBytes: run.runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes: run.targetToRunnerTranscriptBytes,
    })).toThrowError("process-attempt.completed-classification-required");

    // Pairing: process-bridged primary journal continues into recover-mode process.
    const recovery = await runFinance030RecoverProcess({
      identity,
      target,
      trialId: "before-claim-recovery",
      recoveryJournal: run.recoveryJournal,
      proposalNonce,
      runnerSecretNonce,
    });
    expect(recovery.sealedTrial.evidence.terminalClass).toBe("completed");
    expect(recovery.sealedTrial.evidence.recoveryState).toBe("unclaimed");
    expect(recovery.sealedTrial.evidence.recoveryJournalInitialSha256)
      .toBe(run.sealedTrial.evidence.recoveryJournalFinalSha256);
    expect(recovery.sealedTrial.evidence.recoveryActionBindingSha256)
      .toBe(run.sealedTrial.evidence.recoveryActionBindingSha256);
  }, 30_000);

  it("rejects unshipped primary crash branches for process bridge", async () => {
    const { target } = commonSubjectTarget();
    await expect(runFinance030PrimaryCrashProcess({
      identity,
      target,
      branch: "after-claim" as "before-claim",
    })).rejects.toMatchObject({ code: "bridge.primary-crash-branch-unsupported" });
    await expect(runFinance030PrimaryCrashProcess({
      identity,
      target,
      branch: "after-effect" as "before-claim",
    })).rejects.toMatchObject({ code: "bridge.primary-crash-branch-unsupported" });
  }, 5_000);
});
