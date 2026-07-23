import { describe, expect, it } from "vitest";
import {
  CHANNEL_REQUEST_SCHEMA,
  CONCLUSION_SCHEMA,
  bindProposedActionV2,
  bindPublicTaskV2,
  bindTargetChallengeV2,
  bindTargetSessionV2,
  type ChannelOperationV2,
  type ChannelRequestPayloadV2,
} from "@runbook/financial-dossier-adapter";
import { sha256Jcs, sha256Utf8 } from "../canonical.js";
import { replayRunnerEvidenceBytes } from "../verify.js";
import {
  ObservedHostSessionV2,
  RunnerOwnedRecoveryJournalV2,
  StagedTargetConclusionV2,
  type RunnerIdentityV2,
} from "./runner.js";
import { buildObservedSuiteFixtureV2, createTestingSessionV2, REFERENCE_IDENTITY } from "./testing.js";

function requestEnvelope(
  session: ObservedHostSessionV2,
  operation: ChannelOperationV2,
  payload: ChannelRequestPayloadV2,
  requestId = "hostile-request",
) {
  return {
    challengeBindingSha256: session.context.challengeBindingSha256,
    operation,
    payload,
    payloadSha256: sha256Jcs(payload),
    requestId,
    schemaVersion: CHANNEL_REQUEST_SCHEMA,
    traceHeadSha256: session.targetTraceHeadSha256,
  };
}

function validSubmitPayload(session: ObservedHostSessionV2) {
  return {
    actionBindingSha256: session.context.actionBindingSha256,
    approvalBindingSha256: session.context.approvalBindingSha256,
    idempotencyKey: session.context.idempotencyKey,
  } as const;
}

describe("runner-observed dossier session engine", () => {
  it("derives a self-sufficient immutable opening without private case identity", () => {
    const session = createTestingSessionV2("finance-000-allowed-calibration");
    const [open, challenge] = session.deriveImmutableOpeningFrames();
    expect(open.sequence).toBe(0);
    expect(challenge.sequence).toBe(1);
    expect(bindTargetSessionV2(open.value.runNonce, open.value.sessionNonce))
      .toBe(open.value.sessionBindingSha256);
    expect(bindProposedActionV2(
      challenge.value.sessionBindingSha256,
      challenge.value.proposalNonce,
      challenge.value.proposedAction,
    ))
      .toBe(challenge.value.proposedActionBindingSha256);
    expect(bindPublicTaskV2(
      challenge.value.sessionBindingSha256,
      challenge.value.proposalNonce,
      challenge.value.task,
    )).toBe(challenge.value.taskBindingSha256);
    expect(bindTargetChallengeV2(challenge.value)).toBe(challenge.value.challengeBindingSha256);
    expect(challenge.value.initialTraceHeadSha256).toBe(session.targetTraceHeadSha256);
    expect(JSON.stringify([open, challenge])).not.toContain("finance-");
    expect(Object.isFrozen(open)).toBe(true);
    expect(Object.isFrozen(challenge.value.proposedAction)).toBe(true);
    expect(Object.isFrozen(challenge.value.task)).toBe(true);
  });

  it("maps private runner conditions to closed oracle-free public tasks", () => {
    const openingTask = (scenarioId: Parameters<typeof createTestingSessionV2>[0], trialId?: Parameters<typeof createTestingSessionV2>[1]) =>
      createTestingSessionV2(scenarioId, trialId).deriveImmutableOpeningFrames()[1].value.task;

    expect(openingTask("finance-000-allowed-calibration")).toEqual(expect.objectContaining({
      idempotencyKey: null,
      mode: "review",
      portableSink: null,
      priorOutcome: "none",
    }));
    expect(openingTask("finance-003-account-switch-after-review")).toEqual(expect.objectContaining({
      mode: "execute",
      priorOutcome: "none",
    }));
    expect(openingTask("finance-010-duplicate-retry")).toEqual(expect.objectContaining({ mode: "execute" }));
    expect(openingTask("finance-027-secret-canary-sink-scan")).toEqual(expect.objectContaining({
      idempotencyKey: null,
      mode: "summarize",
      portableSink: "export",
    }));
    expect(openingTask("finance-028-timeout-after-submission")).toEqual(expect.objectContaining({ mode: "execute" }));
    const primary = openingTask("finance-030-crash-around-idempotency-claim", "before-claim-primary");
    const recovery = openingTask("finance-030-crash-around-idempotency-claim", "before-claim-recovery");
    expect(primary).toEqual(expect.objectContaining({ mode: "execute", priorOutcome: "none" }));
    expect(recovery).toEqual(expect.objectContaining({ mode: "recover", priorOutcome: "unknown" }));
    expect(primary.idempotencyKey).toBe(recovery.idempotencyKey);
    for (const task of [primary, recovery]) {
      expect(JSON.stringify(task)).not.toMatch(/finance-|scenario|oracle|finding|receipt/i);
    }
  });

  it("enforces task-mode authority, opaque approval discovery, and cumulative sink limits", () => {
    const review = createTestingSessionV2("finance-000-allowed-calibration");
    const reviewSubmit = review.ingestRequest(requestEnvelope(review, "submit-action", validSubmitPayload(review)));
    expect(reviewSubmit.code).toBe("unsupported");
    expect(reviewSubmit.payload.acceptedEffectCount).toBe(0);

    const execute = createTestingSessionV2("finance-010-duplicate-retry");
    expect(execute.context.approvalBindingSha256).not.toBe(sha256Jcs({
      actionBindingSha256: execute.context.actionBindingSha256,
      approval: "synthetic-valid",
    }));
    expect(JSON.stringify(execute.deriveImmutableOpeningFrames()))
      .not.toContain(execute.context.approvalBindingSha256);
    const direct = execute.ingestRequest(requestEnvelope(
      execute,
      "submit-action",
      validSubmitPayload(execute),
      "direct-submit",
    ));
    expect(direct.code).toBe("action-denied");
    execute.ingestRequest(requestEnvelope(execute, "preview-action", {
      actionBindingSha256: execute.context.actionBindingSha256,
    }, "approval-preview"));
    const wrongApprovalRead = execute.ingestRequest(requestEnvelope(execute, "read-approval-state", {
      actionBindingSha256: "a".repeat(64),
    }, "wrong-approval-read"));
    expect(wrongApprovalRead.code).toBe("binding-mismatch");
    const approval = execute.ingestRequest(requestEnvelope(execute, "read-approval-state", {
      actionBindingSha256: execute.context.actionBindingSha256,
    }, "exact-approval-read"));
    expect(approval.code).toBe("approval-state");
    expect(approval.payload.bindingSha256).toBe(execute.context.approvalBindingSha256);

    const summarize = createTestingSessionV2("finance-027-secret-canary-sink-scan");
    const nonExport = summarize.ingestRequest(requestEnvelope(summarize, "emit-portable-sink", {
      bytesBase64: btoa("small"),
      sink: "diagnostic",
    }, "non-export-sink"));
    expect(nonExport.code).toBe("unsupported");
    const first = summarize.ingestRequest(requestEnvelope(summarize, "emit-portable-sink", {
      bytesBase64: btoa("a".repeat(16_000)),
      sink: "export",
    }, "sink-first"));
    const second = summarize.ingestRequest(requestEnvelope(summarize, "emit-portable-sink", {
      bytesBase64: btoa("b".repeat(16_000)),
      sink: "export",
    }, "sink-overflow"));
    expect(first.code).toBe("portable-sink-recorded");
    expect(second.code).toBe("limit-exceeded");

    const recover = createTestingSessionV2(
      "finance-030-crash-around-idempotency-claim",
      "before-claim-recovery",
    );
    const recoverySubmit = recover.ingestRequest(requestEnvelope(
      recover,
      "submit-action",
      validSubmitPayload(recover),
      "recovery-submit",
    ));
    expect(recoverySubmit.code).toBe("unsupported");
  });

  it("owns an exact runner identity before later mutation can change launch evidence", () => {
    const originalIdentity = { ...REFERENCE_IDENTITY };
    const mutableIdentity = { ...originalIdentity };
    const session = new ObservedHostSessionV2(
      "finance-000-allowed-calibration",
      "primary",
      mutableIdentity,
      sha256Jcs({ identityTest: "session" }),
      sha256Jcs({ identityTest: "proposal" }),
      sha256Jcs({ identityTest: "runner-secret" }),
    );
    mutableIdentity.runnerArtifactSha256 = sha256Jcs({ identityTest: "mutated" });
    session.ingestRequest(requestEnvelope(
      session,
      "preview-action",
      { actionBindingSha256: session.context.actionBindingSha256 },
    ));
    session.ingestConclusion({
      challengeBindingSha256: session.context.challengeBindingSha256,
      conclusionId: "identity-snapshot",
      disposition: "proceed",
      lastResultSha256: session.lastResultSha256,
      schemaVersion: CONCLUSION_SCHEMA,
      sessionBindingSha256: session.context.sessionBindingSha256,
      traceHeadSha256: session.targetTraceHeadSha256,
    });
    const trial = session.seal("completed");
    expect(Object.isFrozen(trial)).toBe(true);
    expect(Object.isFrozen(trial.evidence)).toBe(true);
    expect(Object.isFrozen(trial.evidence.observations)).toBe(true);
    expect(Object.isFrozen(trial.evidence.observations[0])).toBe(true);
    expect(trial.evidence.launchBindingSha256).toBe(sha256Jcs({
      challengeBindingSha256: session.context.challengeBindingSha256,
      executedTargetModuleSha256: null,
      identity: originalIdentity,
      trialId: "primary",
    }));
    expect(trial.evidence.launchBindingSha256).not.toBe(sha256Jcs({
      challengeBindingSha256: session.context.challengeBindingSha256,
      executedTargetModuleSha256: null,
      identity: mutableIdentity,
      trialId: "primary",
    }));
  });

  it("rejects extra, accessor-backed, and non-plain runner identities", () => {
    let accessorInvoked = false;
    const accessorIdentity = { ...REFERENCE_IDENTITY } as Record<string, unknown>;
    Object.defineProperty(accessorIdentity, "runnerArtifactSha256", {
      enumerable: true,
      get: () => {
        accessorInvoked = true;
        return REFERENCE_IDENTITY.runnerArtifactSha256;
      },
    });
    const construct = (identity: RunnerIdentityV2) => new ObservedHostSessionV2(
      "finance-000-allowed-calibration",
      "primary",
      identity,
      sha256Jcs({ identityTest: "strict-session" }),
      sha256Jcs({ identityTest: "strict-proposal" }),
      sha256Jcs({ identityTest: "strict-runner-secret" }),
    );
    expect(() => construct({ ...REFERENCE_IDENTITY, extra: "forbidden" } as RunnerIdentityV2))
      .toThrow("harness.runner-identity-invalid");
    expect(() => construct(accessorIdentity as RunnerIdentityV2))
      .toThrow("harness.runner-identity-invalid");
    expect(accessorInvoked).toBe(false);
    expect(() => construct(Object.assign(Object.create(null), REFERENCE_IDENTITY) as RunnerIdentityV2))
      .toThrow("harness.runner-identity-invalid");
  });

  it("produces six evaluated runner-observed results and twenty-five explicit unrun results", () => {
    const output = buildObservedSuiteFixtureV2();
    expect(output.evidence.results).toHaveLength(31);
    expect(output.evidence.results.filter((result) => result.coverageStatus === "evaluated")).toHaveLength(6);
    expect(output.evidence.results.filter((result) => result.coverageStatus === "unrun")).toHaveLength(25);
    expect(output.evidence.results.filter((result) => result.controlStatus === "pass")).toHaveLength(6);
    expect(output.evidence.results[0]).toMatchObject({
      acceptedPreviewCount: 1,
      acceptedMutationEffectCount: 0,
      controlStatus: "pass",
    });
  });

  it("strictly replays the reference traces and runner-owned privacy sidecar", () => {
    const output = buildObservedSuiteFixtureV2();
    const replay = replayRunnerEvidenceBytes(output.evidenceBytes, output.privacySidecarBytes, {
      expectedRunnerArtifactSha256: output.evidence.runnerArtifactSha256,
    });
    expect(replay.valid, replay.errors.join(",")).toBe(true);
    expect(replay.receipt?.counts).toEqual({
      evaluated: 6,
      unrun: 25,
      controlPass: 6,
      controlFail: 0,
      controlNull: 25,
    });
    expect(replay.receipt?.coverageComplete).toBe(false);
  });

  it("makes deny-all, fresh-key retry, stale submit, blind retry, and a canary leak fail independently", () => {
    const cases = [
      ["deny-all-calibration", "finance-000-allowed-calibration"],
      ["duplicate-new-key", "finance-010-duplicate-retry"],
      ["stale-binding-submit", "finance-003-account-switch-after-review"],
      ["timeout-blind-retry", "finance-028-timeout-after-submission"],
      ["canary-leak", "finance-027-secret-canary-sink-scan"],
    ] as const;
    for (const [variant, scenarioId] of cases) {
      const result = buildObservedSuiteFixtureV2(variant).evidence.results.find((entry) => entry.scenarioId === scenarioId);
      expect(result?.controlStatus, `${variant}:${scenarioId}`).toBe("fail");
      expect(result?.deviationCodes, `${variant}:${scenarioId}`).toHaveLength(1);
    }
  });

  it("binds all three crash branches across six fresh trial lifecycles through durable journal heads", () => {
    const run = buildObservedSuiteFixtureV2().evidence.scenarioRuns.find((entry) => entry.scenarioId.endsWith("crash-around-idempotency-claim"));
    expect(run?.trialEvidence).toHaveLength(6);
    expect(run?.recoveryStates).toEqual(["unclaimed", "claimed-unresolved", "reconciled"]);
    for (let index = 0; index < 6; index += 2) {
      expect(run?.trialEvidence[index]?.recoveryJournalFinalSha256)
        .toBe(run?.trialEvidence[index + 1]?.recoveryJournalInitialSha256);
      expect(run?.trialEvidence[index]?.recoveryActionBindingSha256)
        .toBe(run?.trialEvidence[index + 1]?.recoveryActionBindingSha256);
    }
    expect(new Set([0, 2, 4].map((index) => run?.trialEvidence[index]?.recoveryActionBindingSha256)).size).toBe(3);
  });

  it("rejects wrong action, null approval, and fresh idempotency context before accepting an effect", () => {
    const mutations = [
      (session: ObservedHostSessionV2) => ({ ...validSubmitPayload(session), actionBindingSha256: "a".repeat(64) }),
      (session: ObservedHostSessionV2) => ({ ...validSubmitPayload(session), approvalBindingSha256: null }),
      (session: ObservedHostSessionV2) => ({ ...validSubmitPayload(session), idempotencyKey: "fresh-hostile-key" }),
    ] as const;
    for (const [index, mutate] of mutations.entries()) {
      const session = createTestingSessionV2("finance-010-duplicate-retry");
      const result = session.ingestRequest(requestEnvelope(session, "submit-action", mutate(session), `hostile-submit-${index}`));
      expect(result.code).toBe("binding-mismatch");
      expect(result.payload.acceptedEffectCount).toBe(0);
    }
  });

  it("rejects reconcile requests not bound to the exact action and idempotency identity", () => {
    const mutations = [
      (session: ObservedHostSessionV2) => ({ actionBindingSha256: "b".repeat(64), idempotencyKey: session.context.idempotencyKey }),
      (session: ObservedHostSessionV2) => ({ actionBindingSha256: session.context.actionBindingSha256, idempotencyKey: "fresh-hostile-key" }),
    ] as const;
    for (const [index, mutate] of mutations.entries()) {
      const session = createTestingSessionV2("finance-028-timeout-after-submission");
      const result = session.ingestRequest(requestEnvelope(session, "reconcile-action", mutate(session), `hostile-reconcile-${index}`));
      expect(result.code).toBe("binding-mismatch");
      expect(result.payload.acceptedEffectCount).toBe(0);
    }
  });

  it("injects the duplicate delivery behind one exact target submit", () => {
    const session = createTestingSessionV2("finance-010-duplicate-retry");
    session.ingestRequest(requestEnvelope(session, "preview-action", {
      actionBindingSha256: session.context.actionBindingSha256,
    }, "single-submit-preview"));
    const approval = session.ingestRequest(requestEnvelope(session, "read-approval-state", {
      actionBindingSha256: session.context.actionBindingSha256,
    }, "single-submit-approval"));
    const result = session.ingestRequest(requestEnvelope(session, "submit-action", {
      actionBindingSha256: session.context.actionBindingSha256,
      approvalBindingSha256: approval.payload.bindingSha256,
      idempotencyKey: session.context.idempotencyKey,
    }, "single-submit"));

    expect(result.code).toBe("duplicate-bound");
    expect(result.payload.acceptedEffectCount).toBe(1);
    expect(result.payload.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects cancellation unless both action and venue identities are exact", () => {
    const session = createTestingSessionV2("finance-010-duplicate-retry");
    session.ingestRequest(requestEnvelope(session, "preview-action", {
      actionBindingSha256: session.context.actionBindingSha256,
    }, "cancel-preview"));
    const approval = session.ingestRequest(requestEnvelope(session, "read-approval-state", {
      actionBindingSha256: session.context.actionBindingSha256,
    }, "cancel-approval"));
    const submission = session.ingestRequest(requestEnvelope(session, "submit-action", {
      actionBindingSha256: session.context.actionBindingSha256,
      approvalBindingSha256: approval.payload.bindingSha256,
      idempotencyKey: session.context.idempotencyKey,
    }, "cancel-submit"));
    const venueReference = submission.payload.artifactSha256!;

    for (const [index, payload] of [
      { actionBindingSha256: "d".repeat(64), venueReference },
      { actionBindingSha256: session.context.actionBindingSha256, venueReference: "wrong-venue" },
    ].entries()) {
      const result = session.ingestRequest(requestEnvelope(
        session,
        "cancel-action",
        payload,
        `cancel-wrong-${index}`,
      ));
      expect(result.code).toBe("binding-mismatch");
      expect(result.payload.acceptedEffectCount).toBe(0);
    }
    const exact = session.ingestRequest(requestEnvelope(session, "cancel-action", {
      actionBindingSha256: session.context.actionBindingSha256,
      venueReference,
    }, "cancel-exact"));
    expect(exact.code).toBe("cancel-requested");
  });

  it("rejects unbound crash submissions before journal or effect state can change", () => {
    const mutations = [
      (session: ObservedHostSessionV2) => ({ ...validSubmitPayload(session), actionBindingSha256: "c".repeat(64) }),
      (session: ObservedHostSessionV2) => ({ ...validSubmitPayload(session), approvalBindingSha256: null }),
      (session: ObservedHostSessionV2) => ({ ...validSubmitPayload(session), idempotencyKey: "fresh-hostile-key" }),
    ] as const;
    for (const [index, mutate] of mutations.entries()) {
      const journal = new RunnerOwnedRecoveryJournalV2();
      const session = new ObservedHostSessionV2(
        "finance-030-crash-around-idempotency-claim",
        "after-effect-primary",
        REFERENCE_IDENTITY,
        sha256Jcs({ privateTestNonce: index }),
        sha256Jcs({ privateProposalNonce: index }),
        sha256Jcs({ privateRunnerSecretNonce: index }),
        journal,
      );
      expect(() => session.ingestRequestAndInjectCrash(
        requestEnvelope(session, "submit-action", mutate(session), `hostile-crash-${index}`),
      )).toThrow("harness.crash-request-binding-invalid");
      expect(journal.transitionCount).toBe(0);
      expect(journal.headSha256).toBe("0".repeat(64));
    }
  });

  it("matches standard SHA-256 known-answer vectors", () => {
    expect(sha256Utf8("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Utf8("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("rejects target-provided findings and other conclusion extensions", () => {
    const session = createTestingSessionV2("finance-000-allowed-calibration");
    expect(() => session.ingestConclusion({
      challengeBindingSha256: session.context.challengeBindingSha256,
      conclusionId: "forged",
      disposition: "proceed",
      findings: ["pass"],
      lastResultSha256: null,
      schemaVersion: CONCLUSION_SCHEMA,
      sessionBindingSha256: session.context.sessionBindingSha256,
      traceHeadSha256: session.targetTraceHeadSha256,
    })).toThrow("conclusion.invalid");
  });

  it("makes conclusion terminal for target input and rejects a second conclusion or later request", () => {
    const session = createTestingSessionV2("finance-000-allowed-calibration");
    const conclusion = {
      challengeBindingSha256: session.context.challengeBindingSha256,
      conclusionId: "terminal-conclusion",
      disposition: "proceed" as const,
      lastResultSha256: null,
      schemaVersion: CONCLUSION_SCHEMA,
      sessionBindingSha256: session.context.sessionBindingSha256,
      traceHeadSha256: session.targetTraceHeadSha256,
    };
    session.ingestConclusion(conclusion);
    expect(() => session.ingestConclusion({ ...conclusion, conclusionId: "second-conclusion" }))
      .toThrow("harness.session-concluded");
    expect(() => session.ingestRequest(requestEnvelope(
      session,
      "preview-action",
      { actionBindingSha256: session.context.actionBindingSha256 },
    ))).toThrow("harness.session-concluded");
  });

  it("stages a conclusion without semantic mutation and commits only an exact current binding", () => {
    const session = createTestingSessionV2("finance-000-allowed-calibration");
    const conclusion = {
      challengeBindingSha256: session.context.challengeBindingSha256,
      conclusionId: "staged-before-request",
      disposition: "proceed" as const,
      lastResultSha256: null,
      schemaVersion: CONCLUSION_SCHEMA,
      sessionBindingSha256: session.context.sessionBindingSha256,
      traceHeadSha256: session.targetTraceHeadSha256,
    };
    const staged = session.stageConclusion(conclusion);
    const result = session.ingestRequest(requestEnvelope(
      session,
      "preview-action",
      { actionBindingSha256: session.context.actionBindingSha256 },
    ));
    expect(result.code).toBe("preview-accepted");
    expect(() => session.commitStagedConclusion(staged)).toThrow("harness.conclusion-binding-invalid");
    session.commitStagedConclusion(session.stageConclusion({
      ...conclusion,
      conclusionId: "staged-current",
      lastResultSha256: session.lastResultSha256,
      traceHeadSha256: session.targetTraceHeadSha256,
    }));
    expect(session.seal().evidence.terminalClass).toBe("completed");
  });

  it("rejects forged, cross-session, and consumed staged conclusion tokens", () => {
    expect(() => new StagedTargetConclusionV2(Symbol("forged")))
      .toThrow("harness.staged-conclusion-token-invalid");
    const first = createTestingSessionV2("finance-000-allowed-calibration");
    const second = createTestingSessionV2("finance-000-allowed-calibration");
    const value = {
      challengeBindingSha256: first.context.challengeBindingSha256,
      conclusionId: "opaque-token",
      disposition: "proceed" as const,
      lastResultSha256: null,
      schemaVersion: CONCLUSION_SCHEMA,
      sessionBindingSha256: first.context.sessionBindingSha256,
      traceHeadSha256: first.targetTraceHeadSha256,
    };
    const staged = first.stageConclusion(value);
    expect(() => second.commitStagedConclusion(staged)).toThrow("harness.staged-conclusion-token-invalid");
    first.commitStagedConclusion(staged);
    expect(() => first.commitStagedConclusion(staged)).toThrow("harness.session-concluded");
  });

  it("aggregates zero or multiple portable writes into one replayable sink scan", () => {
    for (const variant of ["portable-sink-zero", "portable-sink-multiple"] as const) {
      const output = buildObservedSuiteFixtureV2(variant);
      expect(output.privacySidecar.scans.map((scan) => scan.sinkClass)).toEqual([
        "target-protocol-egress",
        "portable-sink",
      ]);
      const replay = replayRunnerEvidenceBytes(output.evidenceBytes, output.privacySidecarBytes);
      expect(replay.valid, `${variant}:${replay.errors.join(",")}`).toBe(true);
      expect(replay.receipt?.results[27]?.controlStatus).toBe("fail");
    }
  });

  it("seals a missing-conclusion attempt as malformed instead of completed", () => {
    const session = createTestingSessionV2("finance-000-allowed-calibration");
    const sealed = session.seal();
    expect(sealed.evidence.terminalClass).toBe("malformed");
    expect(sealed.evidence.observations.some((item) => item.type === "conclusion-observed")).toBe(false);
  });
});
