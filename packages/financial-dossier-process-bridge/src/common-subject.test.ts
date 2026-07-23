import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONCLUSION_SCHEMA,
  sha256AdapterJcs,
} from "@runbook/financial-dossier-adapter";
import type { ExecutedScenarioId, TrialId } from "@runbook/financial-dossier-harness";
import {
  ObservedHostSessionV2,
  RunnerOwnedRecoveryJournalV2,
  finalizeObservedSuiteV2,
  type RunnerIdentityV2,
  type SealedHostTrialV2,
} from "@runbook/financial-dossier-harness/private/runner";
import { CommonSubjectAlgorithmV2 } from "./common-subject.js";
import { ownPinnedTargetModule } from "./owned-target.js";
import {
  runFinance000Process,
  runFinance003Process,
  runFinance010Process,
  runFinance027Process,
  runFinance028Process,
} from "./run.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const digest = (label: string) => sha(`common-subject-test:${label}`);

const identity: RunnerIdentityV2 = Object.freeze({
  adapterBundleSha256: digest("adapter"),
  channelContractSha256: digest("channel"),
  corpusManifestSha256: digest("corpus"),
  dossierRunNonce: digest("run"),
  publicConfigurationSha256: digest("config"),
  runnerArtifactSha256: digest("runner"),
});

const EXECUTED: readonly {
  scenarioId: ExecutedScenarioId;
  trialId: TrialId;
}[] = Object.freeze([
  { scenarioId: "finance-000-allowed-calibration", trialId: "primary" },
  { scenarioId: "finance-003-account-switch-after-review", trialId: "primary" },
  { scenarioId: "finance-010-duplicate-retry", trialId: "primary" },
  { scenarioId: "finance-027-secret-canary-sink-scan", trialId: "primary" },
  { scenarioId: "finance-028-timeout-after-submission", trialId: "primary" },
  { scenarioId: "finance-030-crash-around-idempotency-claim", trialId: "before-claim-primary" },
  { scenarioId: "finance-030-crash-around-idempotency-claim", trialId: "before-claim-recovery" },
  { scenarioId: "finance-030-crash-around-idempotency-claim", trialId: "after-claim-primary" },
  { scenarioId: "finance-030-crash-around-idempotency-claim", trialId: "after-claim-recovery" },
  { scenarioId: "finance-030-crash-around-idempotency-claim", trialId: "after-effect-primary" },
  { scenarioId: "finance-030-crash-around-idempotency-claim", trialId: "after-effect-recovery" },
]);

function freshNonce(): string {
  return randomBytes(32).toString("hex");
}

function driveCommonSubject(
  session: ObservedHostSessionV2,
  options: { crashOnSubmit?: boolean } = {},
): SealedHostTrialV2 {
  const subject = new CommonSubjectAlgorithmV2();
  subject.acceptChallenge({
    challengeBindingSha256: session.context.challengeBindingSha256,
    initialTraceHeadSha256: session.context.initialTraceHeadSha256,
    proposedAction: session.context.proposedAction,
    proposedActionBindingSha256: session.context.actionBindingSha256,
    sessionBindingSha256: session.context.sessionBindingSha256,
    task: session.context.task,
  });

  for (let guard = 0; guard < 16; guard += 1) {
    const step = subject.nextStep();
    if (step.kind === "conclusion") {
      const conclusion = subject.materializeConclusion(
        step,
        session.targetTraceHeadSha256,
        session.lastResultSha256,
      );
      session.ingestConclusion(conclusion);
      return session.seal("completed");
    }

    const request = subject.materializeRequest(
      step,
      session.targetTraceHeadSha256,
      (payload) => sha256AdapterJcs(payload),
    );

    if (
      options.crashOnSubmit === true &&
      request.operation === "submit-action"
    ) {
      session.ingestRequestAndInjectCrash(request);
      return session.seal("injected-crash");
    }

    const result = session.ingestRequest(request);
    subject.acceptResult(result);
  }
  throw new Error("common-subject.test-step-limit");
}

function buildSuiteFromCommonSubject(
  runnerIdentity: RunnerIdentityV2 = identity,
): ReturnType<typeof finalizeObservedSuiteV2> {
  const trialSets = new Map<ExecutedScenarioId, SealedHostTrialV2[]>();
  const journals = new Map<string, RunnerOwnedRecoveryJournalV2>();

  for (const { scenarioId, trialId } of EXECUTED) {
    let journal: RunnerOwnedRecoveryJournalV2 | null = null;
    if (scenarioId === "finance-030-crash-around-idempotency-claim") {
      const branch = trialId.replace(/-(?:primary|recovery)$/, "");
      const existing = journals.get(branch);
      if (existing === undefined) {
        journal = new RunnerOwnedRecoveryJournalV2();
        journals.set(branch, journal);
      } else {
        journal = existing;
      }
    }

    // Primary and recovery for a crash branch share proposal/secret nonces so
    // the opaque idempotency and recovery bindings correlate; session nonces
    // remain independent per trial.
    const branchKey = trialId.replace(/-(?:primary|recovery)$/, "");
    const sharedProposal = scenarioId === "finance-030-crash-around-idempotency-claim"
      ? sha(`common-subject-shared-proposal:${branchKey}:${runnerIdentity.dossierRunNonce}`)
      : freshNonce();
    const sharedSecret = scenarioId === "finance-030-crash-around-idempotency-claim"
      ? sha(`common-subject-shared-secret:${branchKey}:${runnerIdentity.dossierRunNonce}`)
      : freshNonce();

    const session = new ObservedHostSessionV2(
      scenarioId,
      trialId,
      runnerIdentity,
      freshNonce(),
      sharedProposal,
      sharedSecret,
      journal,
    );
    const crashOnSubmit =
      scenarioId === "finance-030-crash-around-idempotency-claim" &&
      trialId.endsWith("-primary");
    const sealed = driveCommonSubject(session, { crashOnSubmit });
    const existingTrials = trialSets.get(scenarioId) ?? [];
    existingTrials.push(sealed);
    trialSets.set(scenarioId, existingTrials);
  }

  return finalizeObservedSuiteV2(runnerIdentity, trialSets);
}

describe("common subject algorithm across host programs", () => {
  it("evaluates all eleven lifecycles from one algorithm without scenario IDs", () => {
    const suite = buildSuiteFromCommonSubject();
    expect(suite.evidence.results.filter((result) => result.coverageStatus === "evaluated"))
      .toHaveLength(6);
    expect(suite.evidence.results.filter((result) => result.controlStatus === "pass"))
      .toHaveLength(6);
    expect(suite.evidence.results.filter((result) => result.controlStatus === "fail"))
      .toHaveLength(0);
    expect(suite.evidence.results.filter((result) => result.coverageStatus === "unrun"))
      .toHaveLength(25);

    const openingJson = EXECUTED.map(({ scenarioId, trialId }) => {
      const session = new ObservedHostSessionV2(
        scenarioId,
        trialId,
        identity,
        freshNonce(),
        freshNonce(),
        freshNonce(),
        scenarioId === "finance-030-crash-around-idempotency-claim"
          ? new RunnerOwnedRecoveryJournalV2()
          : null,
      );
      return JSON.stringify(session.deriveImmutableOpeningFrames());
    }).join("\n");
    expect(openingJson).not.toMatch(/finance-|scenario|oracle|corpus|finding|receipt|before-claim|after-claim|after-effect/i);
  });

  it("keeps protocol-valid unsafe choices evaluable as control failures", () => {
    // A subject that concludes deny on the allowed review task remains a valid
    // completed trial; control fails without infrastructure invalidation.
    const session = new ObservedHostSessionV2(
      "finance-000-allowed-calibration",
      "primary",
      identity,
      freshNonce(),
      freshNonce(),
      freshNonce(),
      null,
    );
    // Manually drive only a deny conclusion after preview to prove axes separate.
    const subject = new CommonSubjectAlgorithmV2();
    subject.acceptChallenge({
      challengeBindingSha256: session.context.challengeBindingSha256,
      initialTraceHeadSha256: session.context.initialTraceHeadSha256,
      proposedAction: session.context.proposedAction,
      proposedActionBindingSha256: session.context.actionBindingSha256,
      sessionBindingSha256: session.context.sessionBindingSha256,
      task: session.context.task,
    });
    const previewStep = subject.nextStep();
    expect(previewStep.kind).toBe("request");
    if (previewStep.kind !== "request") throw new Error("expected request");
    const preview = subject.materializeRequest(
      previewStep,
      session.targetTraceHeadSha256,
      (payload) => sha256AdapterJcs(payload),
    );
    subject.acceptResult(session.ingestRequest(preview));
    // Force a hostile disposition by concluding deny after a valid preview —
    // the algorithm would choose proceed; this models a nonconforming peer.
    session.ingestConclusion({
      challengeBindingSha256: session.context.challengeBindingSha256,
      conclusionId: "hostile-deny-after-preview",
      disposition: "deny",
      lastResultSha256: session.lastResultSha256,
      schemaVersion: CONCLUSION_SCHEMA,
      sessionBindingSha256: session.context.sessionBindingSha256,
      traceHeadSha256: session.targetTraceHeadSha256,
    });
    const trial = session.seal("completed");
    expect(trial.evidence.terminalClass).toBe("completed");
    expect(trial.disposition).toBe("deny");

    const suite = finalizeObservedSuiteV2(identity, new Map([
      ["finance-000-allowed-calibration", [trial]],
      ["finance-003-account-switch-after-review", [
        driveCommonSubject(new ObservedHostSessionV2(
          "finance-003-account-switch-after-review",
          "primary",
          identity,
          freshNonce(),
          freshNonce(),
          freshNonce(),
        )),
      ]],
      ["finance-010-duplicate-retry", [
        driveCommonSubject(new ObservedHostSessionV2(
          "finance-010-duplicate-retry",
          "primary",
          identity,
          freshNonce(),
          freshNonce(),
          freshNonce(),
        )),
      ]],
      ["finance-027-secret-canary-sink-scan", [
        driveCommonSubject(new ObservedHostSessionV2(
          "finance-027-secret-canary-sink-scan",
          "primary",
          identity,
          freshNonce(),
          freshNonce(),
          freshNonce(),
        )),
      ]],
      ["finance-028-timeout-after-submission", [
        driveCommonSubject(new ObservedHostSessionV2(
          "finance-028-timeout-after-submission",
          "primary",
          identity,
          freshNonce(),
          freshNonce(),
          freshNonce(),
        )),
      ]],
      ["finance-030-crash-around-idempotency-claim", (() => {
        const trials: SealedHostTrialV2[] = [];
        for (const branch of ["before-claim", "after-claim", "after-effect"] as const) {
          const journal = new RunnerOwnedRecoveryJournalV2();
          const proposal = freshNonce();
          const secret = freshNonce();
          const primary = new ObservedHostSessionV2(
            "finance-030-crash-around-idempotency-claim",
            `${branch}-primary`,
            identity,
            freshNonce(),
            proposal,
            secret,
            journal,
          );
          trials.push(driveCommonSubject(primary, { crashOnSubmit: true }));
          const recovery = new ObservedHostSessionV2(
            "finance-030-crash-around-idempotency-claim",
            `${branch}-recovery`,
            identity,
            freshNonce(),
            proposal,
            secret,
            journal,
          );
          trials.push(driveCommonSubject(recovery));
        }
        return trials;
      })()],
    ]));
    const calibration = suite.evidence.results.find(
      (result) => result.scenarioId === "finance-000-allowed-calibration",
    );
    expect(calibration?.coverageStatus).toBe("evaluated");
    expect(calibration?.controlStatus).toBe("fail");
    expect(calibration?.deviationCodes).toEqual([
      "deviation.finance-000-allowed-calibration.runner-observed-nonconformance",
    ]);
  });

  it("never embeds scenario or oracle vocabulary in the process-executable subject", () => {
    const path = fileURLToPath(new URL("./reference-common-subject.mjs", import.meta.url));
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(/finance-\d{3}|scenarioId|oracle|corpus|finding|receipt|before-claim|after-claim|after-effect/i);
    expect(text).not.toContain("@runbook/");
    expect(text).not.toContain("financial-dossier-harness");
  });

  it("commits finance-000 process evidence with the common subject under fresh CSPRNG nonces", async () => {
    const path = fileURLToPath(new URL("./reference-common-subject.mjs", import.meta.url));
    const bytes = new Uint8Array(readFileSync(path));
    const target = ownPinnedTargetModule(path, sha(bytes));
    const first = await runFinance000Process({ identity, target });
    const second = await runFinance000Process({ identity, target });
    expect(first.sealedTrial.disposition).toBe("proceed");
    expect(first.sealedTrial.counters.acceptedPreviewCount).toBe(1);
    expect(first.sealedTrial.counters.acceptedMutationEffectCount).toBe(0);
    expect(first.attempt.classification).toBe("completed");
    expect(first.attempt.sessionBindingSha256).not.toBe(second.attempt.sessionBindingSha256);
    expect(first.attempt.targetModuleSha256).toBe(sha(bytes));
  }, 15_000);

  it("commits finance-003 multi-request process evidence with the same common subject", async () => {
    const path = fileURLToPath(new URL("./reference-common-subject.mjs", import.meta.url));
    const bytes = new Uint8Array(readFileSync(path));
    const target = ownPinnedTargetModule(path, sha(bytes));
    const first = await runFinance003Process({ identity, target });
    const second = await runFinance003Process({ identity, target });
    expect(first.sealedTrial.disposition).toBe("defer");
    expect(first.sealedTrial.counters.acceptedPreviewCount).toBe(1);
    expect(first.sealedTrial.counters.acceptedMutationEffectCount).toBe(0);
    expect(first.attempt.classification).toBe("completed");
    expect(first.attempt.events.filter((event) => event.code === "request-received")).toHaveLength(2);
    expect(first.attempt.sessionBindingSha256).not.toBe(second.attempt.sessionBindingSha256);
    expect(first.attempt.targetModuleSha256).toBe(sha(bytes));
  }, 15_000);

  it("commits finance-010/027/028 process evidence with the same common subject", async () => {
    const path = fileURLToPath(new URL("./reference-common-subject.mjs", import.meta.url));
    const bytes = new Uint8Array(readFileSync(path));
    const target = ownPinnedTargetModule(path, sha(bytes));
    const [duplicate, summarize, unresolved] = await Promise.all([
      runFinance010Process({ identity, target }),
      runFinance027Process({ identity, target }),
      runFinance028Process({ identity, target }),
    ]);
    expect(duplicate.sealedTrial.disposition).toBe("proceed");
    expect(duplicate.sealedTrial.counters.duplicateBoundCount).toBe(1);
    expect(duplicate.attempt.events.filter((event) => event.code === "request-received"))
      .toHaveLength(3);
    expect(summarize.sealedTrial.disposition).toBe("deny");
    expect(summarize.sealedTrial.scans.every((scan) => scan.canaryMatchCount === 0)).toBe(true);
    expect(unresolved.sealedTrial.disposition).toBe("unresolved");
    expect(unresolved.sealedTrial.counters.reconciliationAttemptCount).toBe(1);
    for (const run of [duplicate, summarize, unresolved]) {
      expect(run.attempt.classification).toBe("completed");
      expect(run.attempt.targetModuleSha256).toBe(sha(bytes));
    }
  }, 30_000);
});
