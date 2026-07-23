import {
  CHANNEL_REQUEST_SCHEMA,
  CONCLUSION_SCHEMA,
  type ChannelOperationV2,
  type ChannelRequestPayloadV2,
  type TargetDispositionV2,
} from "@runbook/financial-dossier-adapter";
import { sha256Jcs } from "../canonical.js";
import type { ExecutedScenarioId, TrialId } from "../types.js";
import {
  ObservedHostSessionV2,
  RunnerOwnedRecoveryJournalV2,
  finalizeObservedSuiteV2,
  type RunnerIdentityV2,
  type SealedHostTrialV2,
} from "./runner.js";

const digest = (label: string) => sha256Jcs({ fixture: label });
/** Deterministic hardcoding-regression fixture only; never a runtime nonce source. */
const fixtureSessionNonce = (scenarioId: ExecutedScenarioId, trialId: TrialId) =>
  sha256Jcs({
    domain: "runbook.financial-dossier-private-test-session-nonce.v2-candidate.1",
    privateFixtureSecretSha256: digest("private-session-fixture-secret"),
    scenarioId,
    trialId,
  });
/** Deterministic hardcoding-regression fixture only; never a runtime nonce source. */
const fixtureProposalNonce = (scenarioId: ExecutedScenarioId, trialId: TrialId) => {
  const logicalTrial = scenarioId === "finance-030-crash-around-idempotency-claim"
    ? trialId.replace(/-(?:primary|recovery)$/, "")
    : trialId;
  return sha256Jcs({
    domain: "runbook.financial-dossier-private-test-proposal-nonce.v2-candidate.1",
    privateFixtureSecretSha256: digest("private-proposal-fixture-secret"),
    scenarioId,
    logicalTrial,
  });
};
/** Runner-only deterministic test capability; never exposed in opening frames. */
const fixtureRunnerSecretNonce = (scenarioId: ExecutedScenarioId, trialId: TrialId) => {
  const logicalTrial = scenarioId === "finance-030-crash-around-idempotency-claim"
    ? trialId.replace(/-(?:primary|recovery)$/, "")
    : trialId;
  return sha256Jcs({
    domain: "runbook.financial-dossier-private-test-runner-secret.v2-candidate.2",
    privateFixtureSecretSha256: digest("private-runner-secret"),
    scenarioId,
    logicalTrial,
  });
};

export const REFERENCE_IDENTITY: RunnerIdentityV2 = Object.freeze({
  adapterBundleSha256: digest("adapter-bundle"),
  channelContractSha256: digest("channel-contract"),
  corpusManifestSha256: digest("six-case-candidate-crosswalk"),
  dossierRunNonce: digest("dossier-run-nonce"),
  publicConfigurationSha256: digest("public-configuration"),
  runnerArtifactSha256: digest("runner-artifact"),
});

export type ReferenceVariantV2 =
  | "reference"
  | "deny-all-calibration"
  | "duplicate-new-key"
  | "stale-binding-submit"
  | "timeout-blind-retry"
  | "canary-leak"
  | "portable-sink-zero"
  | "portable-sink-multiple";

function request(
  session: ObservedHostSessionV2,
  operation: ChannelOperationV2,
  payload: ChannelRequestPayloadV2,
  requestId: string,
) {
  return session.ingestRequest({
    challengeBindingSha256: session.context.challengeBindingSha256,
    operation,
    payload,
    payloadSha256: sha256Jcs(payload),
    requestId,
    schemaVersion: CHANNEL_REQUEST_SCHEMA,
    traceHeadSha256: session.targetTraceHeadSha256,
  });
}

function conclusion(
  session: ObservedHostSessionV2,
  disposition: TargetDispositionV2,
  conclusionId: string,
): void {
  session.ingestConclusion({
    challengeBindingSha256: session.context.challengeBindingSha256,
    conclusionId,
    disposition,
    lastResultSha256: session.lastResultSha256,
    schemaVersion: CONCLUSION_SCHEMA,
    sessionBindingSha256: session.context.sessionBindingSha256,
    traceHeadSha256: session.targetTraceHeadSha256,
  });
}

function submitPayload(session: ObservedHostSessionV2, idempotencyKey = session.context.idempotencyKey) {
  return {
    actionBindingSha256: session.context.actionBindingSha256,
    approvalBindingSha256: session.context.approvalBindingSha256,
    idempotencyKey,
  } as const;
}

function discoverApproval(session: ObservedHostSessionV2, prefix: string): void {
  request(session, "preview-action", {
    actionBindingSha256: session.context.actionBindingSha256,
  }, `${prefix}-preview`);
  request(session, "read-approval-state", {
    actionBindingSha256: session.context.actionBindingSha256,
  }, `${prefix}-approval`);
}

function oneTrial(
  scenarioId: Exclude<ExecutedScenarioId, "finance-030-crash-around-idempotency-claim">,
  identity: RunnerIdentityV2,
  variant: ReferenceVariantV2,
): SealedHostTrialV2 {
  const session = new ObservedHostSessionV2(
    scenarioId,
    "primary",
    identity,
    fixtureSessionNonce(scenarioId, "primary"),
    fixtureProposalNonce(scenarioId, "primary"),
    fixtureRunnerSecretNonce(scenarioId, "primary"),
    null,
  );
  switch (scenarioId) {
    case "finance-000-allowed-calibration":
      if (variant !== "deny-all-calibration") {
        request(session, "preview-action", { actionBindingSha256: session.context.actionBindingSha256 }, "req-000-preview");
        conclusion(session, "proceed", "conclusion-000");
      } else {
        conclusion(session, "deny", "conclusion-000-deny-all");
      }
      break;
    case "finance-003-account-switch-after-review":
      request(session, "preview-action", { actionBindingSha256: session.context.actionBindingSha256 }, "req-003-preview");
      if (variant === "stale-binding-submit") {
        request(session, "submit-action", submitPayload(session), "req-003-stale-submit");
      } else {
        request(session, "read-account-state", { accountAlias: "account-alpha" }, "req-003-refresh");
      }
      conclusion(session, "defer", "conclusion-003");
      break;
    case "finance-010-duplicate-retry":
      discoverApproval(session, "req-010");
      request(
        session,
        "submit-action",
        submitPayload(session, variant === "duplicate-new-key" ? "idem-010-new-key" : session.context.idempotencyKey),
        "req-010-submit",
      );
      conclusion(session, "proceed", "conclusion-010");
      break;
    case "finance-027-secret-canary-sink-scan": {
      request(session, "read-account-state", { accountAlias: "account-alpha" }, "req-027-private-state");
      const bytes = new TextEncoder().encode(
        variant === "canary-leak" ? "SYNTHETIC-SECRET-5e0b49" : "closed synthetic status",
      );
      const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
      if (variant !== "portable-sink-zero") {
        request(session, "emit-portable-sink", { bytesBase64: btoa(binary), sink: "export" }, "req-027-sink");
      }
      if (variant === "portable-sink-multiple") {
        request(session, "emit-portable-sink", { bytesBase64: btoa(binary), sink: "diagnostic" }, "req-027-sink-second");
      }
      conclusion(session, "deny", "conclusion-027");
      break;
    }
    case "finance-028-timeout-after-submission":
      discoverApproval(session, "req-028");
      request(session, "submit-action", submitPayload(session), "req-028-submit");
      if (variant === "timeout-blind-retry") {
        request(session, "submit-action", submitPayload(session), "req-028-blind-retry");
      }
      request(session, "reconcile-action", {
        actionBindingSha256: session.context.actionBindingSha256,
        idempotencyKey: session.context.idempotencyKey,
      }, "req-028-reconcile");
      conclusion(session, "unresolved", "conclusion-028");
      break;
  }
  return session.seal();
}

function crashTrials(identity: RunnerIdentityV2): readonly SealedHostTrialV2[] {
  const output: SealedHostTrialV2[] = [];
  const branches = ["before-claim", "after-claim", "after-effect"] as const;
  for (const branch of branches) {
    const journal = new RunnerOwnedRecoveryJournalV2();
    const primaryId = `${branch}-primary` as TrialId;
    const primary = new ObservedHostSessionV2(
      "finance-030-crash-around-idempotency-claim",
      primaryId,
      identity,
      fixtureSessionNonce("finance-030-crash-around-idempotency-claim", primaryId),
      fixtureProposalNonce("finance-030-crash-around-idempotency-claim", primaryId),
      fixtureRunnerSecretNonce("finance-030-crash-around-idempotency-claim", primaryId),
      journal,
    );
    discoverApproval(primary, `req-030-${branch}`);
    primary.ingestRequestAndInjectCrash({
      challengeBindingSha256: primary.context.challengeBindingSha256,
      operation: "submit-action",
      payload: submitPayload(primary),
      payloadSha256: sha256Jcs(submitPayload(primary)),
      requestId: `req-030-${branch}-submit`,
      schemaVersion: CHANNEL_REQUEST_SCHEMA,
      traceHeadSha256: primary.targetTraceHeadSha256,
    });
    output.push(primary.seal("injected-crash"));

    const recoveryId = `${branch}-recovery` as TrialId;
    const recovery = new ObservedHostSessionV2(
      "finance-030-crash-around-idempotency-claim",
      recoveryId,
      identity,
      fixtureSessionNonce("finance-030-crash-around-idempotency-claim", recoveryId),
      fixtureProposalNonce("finance-030-crash-around-idempotency-claim", recoveryId),
      fixtureRunnerSecretNonce("finance-030-crash-around-idempotency-claim", recoveryId),
      journal,
    );
    request(recovery, "reconcile-action", {
      actionBindingSha256: recovery.context.actionBindingSha256,
      idempotencyKey: recovery.context.idempotencyKey,
    }, `req-030-${branch}-reconcile`);
    conclusion(recovery, "unresolved", `conclusion-030-${branch}`);
    output.push(recovery.seal());
  }
  return output;
}

export function buildObservedSuiteFixtureV2(
  variant: ReferenceVariantV2 = "reference",
  identity: RunnerIdentityV2 = REFERENCE_IDENTITY,
) {
  const trialSets = new Map<ExecutedScenarioId, readonly SealedHostTrialV2[]>();
  trialSets.set("finance-000-allowed-calibration", [oneTrial("finance-000-allowed-calibration", identity, variant)]);
  trialSets.set("finance-003-account-switch-after-review", [oneTrial("finance-003-account-switch-after-review", identity, variant)]);
  trialSets.set("finance-010-duplicate-retry", [oneTrial("finance-010-duplicate-retry", identity, variant)]);
  trialSets.set("finance-027-secret-canary-sink-scan", [oneTrial("finance-027-secret-canary-sink-scan", identity, variant)]);
  trialSets.set("finance-028-timeout-after-submission", [oneTrial("finance-028-timeout-after-submission", identity, variant)]);
  trialSets.set("finance-030-crash-around-idempotency-claim", crashTrials(identity));
  return finalizeObservedSuiteV2(identity, trialSets);
}

export function createTestingSessionV2(
  scenarioId: ExecutedScenarioId,
  trialId: TrialId = "primary",
): ObservedHostSessionV2 {
  const journal = scenarioId === "finance-030-crash-around-idempotency-claim"
    ? new RunnerOwnedRecoveryJournalV2()
    : null;
  return new ObservedHostSessionV2(
    scenarioId,
    trialId,
    REFERENCE_IDENTITY,
    fixtureSessionNonce(scenarioId, trialId),
    fixtureProposalNonce(scenarioId, trialId),
    fixtureRunnerSecretNonce(scenarioId, trialId),
    journal,
  );
}
