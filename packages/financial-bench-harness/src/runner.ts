import { canonicalizeJcs, sha256Jcs } from "./canonical.js";
import {
  FINANCIAL_BENCH_ADAPTER_CONTRACT_SHA256,
  FINANCIAL_BENCH_ADAPTER_CONTRACT_V1,
  FINANCIAL_BENCH_HARNESS_V1_CORPUS_MANIFEST,
  FINANCIAL_BENCH_HARNESS_V1_CORPUS_MANIFEST_SHA256,
  FINANCIAL_BENCH_HARNESS_V1_ORACLE_SHA256,
  RUNNER_RELEASE_DECLARATION_SHA256,
  internalHarnessScenarios,
} from "./corpus.js";
import {
  APPROVAL_RESULT_SCHEMA,
  BINDING_SCHEMA,
  EVIDENCE_SCHEMA,
  HARNESS_PROFILE,
  ISOLATION,
  LAUNCH_SCHEMA,
  OBSERVATION_SCHEMA,
  STIMULUS_SCHEMA,
  SUBJECT_DECLARATION_SCHEMA,
  TOOL_RESULT_SCHEMA,
  type FakeApprovalResultV1,
  type FakeToolResultV1,
  type FinancialBenchTargetFactoryV1,
  type FinancialBenchTargetV1,
  type HarnessBindingV1,
  type HarnessDecisionV1,
  type HarnessEvidenceV1,
  type HarnessLaunchV1,
  type HarnessObservationV1,
  type HarnessRunOutput,
  type HarnessScenarioEvidenceV1,
  type HarnessStimulusV1,
  type HarnessSubjectDeclarationV1,
  type PreparedFinancialBenchTargetV1,
  type RunnerOwnedInstrumentedChannelsV1,
} from "./types.js";
import {
  HarnessValidationError,
  parseFakeApprovalRequest,
  parseFakeToolCall,
  parseHarnessDecision,
  parseHarnessEvidence,
  parseHarnessLaunch,
  parseHarnessStimulus,
  parseHarnessSubjectDeclaration,
} from "./validate.js";
import { serializeHarnessEvidence, verifyHarnessEvidenceBytes } from "./verify.js";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const same = (left: unknown, right: unknown) =>
  canonicalizeJcs(left) === canonicalizeJcs(right);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function createSelfDeclaredHarnessSubject(input: {
  selfDeclaredBuildSha256: string;
  selfDeclaredPublicConfigurationSha256: string;
}): HarnessSubjectDeclarationV1 {
  return parseHarnessSubjectDeclaration({
    adapterContractSha256: FINANCIAL_BENCH_ADAPTER_CONTRACT_SHA256,
    schemaVersion: SUBJECT_DECLARATION_SCHEMA,
    selfDeclaredBuildSha256: input.selfDeclaredBuildSha256,
    selfDeclaredPublicConfigurationSha256: input.selfDeclaredPublicConfigurationSha256,
  });
}

/** Binding helper exposes no oracle or expected result. */
export function createBoundDecision(
  stimulus: HarnessStimulusV1,
  disposition: HarnessDecisionV1["disposition"],
  decisionId: string,
): HarnessDecisionV1 {
  return parseHarnessDecision({
    binding: stimulus.binding,
    decisionId,
    disposition,
    schemaVersion: "runbook.financial-agent-decision.v1",
  });
}

export function createBoundToolCall(stimulus: HarnessStimulusV1, callId: string) {
  return {
    binding: stimulus.binding,
    callId,
    proposedAction: stimulus.payload.proposedAction,
    schemaVersion: "runbook.financial-agent-fake-tool-call.v1",
  } as const;
}

export function createBoundApprovalRequest(
  stimulus: HarnessStimulusV1,
  approvalRequestId: string,
) {
  return {
    approvalRequestId,
    binding: stimulus.binding,
    proposedAction: stimulus.payload.proposedAction,
    schemaVersion: "runbook.financial-agent-fake-approval-request.v1",
  } as const;
}

function launchFor(subjectDeclaration: HarnessSubjectDeclarationV1): HarnessLaunchV1 {
  return parseHarnessLaunch({
    adapterContractSha256: FINANCIAL_BENCH_ADAPTER_CONTRACT_SHA256,
    corpusManifestSha256: FINANCIAL_BENCH_HARNESS_V1_CORPUS_MANIFEST_SHA256,
    isolation: ISOLATION,
    lateCallWindowMs: 20,
    maxApprovalRequests: 4,
    maxCallBytes: 8192,
    maxCallDepth: 16,
    maxToolCalls: 4,
    oracleSha256: FINANCIAL_BENCH_HARNESS_V1_ORACLE_SHA256,
    runnerReleaseDeclarationSha256: RUNNER_RELEASE_DECLARATION_SHA256,
    schemaVersion: LAUNCH_SCHEMA,
    subjectDeclarationSha256: sha256Jcs(subjectDeclaration),
    timeoutMs: 100,
  });
}

async function runScenario(
  target: FinancialBenchTargetV1,
  payload: ReturnType<typeof internalHarnessScenarios>[number]["stimulusPayload"],
  scenarioId: ReturnType<typeof internalHarnessScenarios>[number]["scenarioId"],
  launch: HarnessLaunchV1,
): Promise<HarnessScenarioEvidenceV1> {
  const binding: HarnessBindingV1 = {
    baselineCapabilitySha256: sha256Jcs(payload.baselineCapability),
    constitutionSha256: sha256Jcs(payload.constitution),
    currentCapabilitySha256: sha256Jcs(payload.currentCapability),
    fixedClockSha256: sha256Jcs(payload.fixedClock),
    launchSha256: sha256Jcs(launch),
    proposedActionSha256: sha256Jcs(payload.proposedAction),
    schemaVersion: BINDING_SCHEMA,
    stimulusPayloadSha256: sha256Jcs(payload),
  };
  const stimulus = deepFreeze(
    parseHarnessStimulus({ binding, payload, schemaVersion: STIMULUS_SCHEMA }),
  );
  const observations: HarnessObservationV1[] = [];
  let sequence = 0;
  let targetTerminal = false;
  let accepting = true;
  let toolInvocationCount = 0;
  let approvalInvocationCount = 0;
  let toolRecordedInvocationCount = 0;
  let approvalRecordedInvocationCount = 0;
  let toolLimitObservationRecorded = false;
  let approvalLimitObservationRecorded = false;
  const callIds = new Set<string>();
  const approvalRequestIds = new Set<string>();

  type ObservationInput = HarnessObservationV1 extends infer Observation
    ? Observation extends HarnessObservationV1
      ? Omit<Observation, "schemaVersion" | "sequence" | "tick">
      : never
    : never;
  const record = (observation: ObservationInput) => {
    observations.push({
      schemaVersion: OBSERVATION_SCHEMA,
      sequence,
      tick: sequence,
      ...observation,
    } as HarnessObservationV1);
    sequence += 1;
  };

  record({ type: "run-started" });
  record({
    approvalRequestsSupported: true,
    toolNames: ["preview_order"],
    type: "channels-presented",
  });

  const toolResult = (
    callId: string | null,
    code: FakeToolResultV1["code"],
    status: FakeToolResultV1["status"],
  ): FakeToolResultV1 => ({
    callId,
    code,
    schemaVersion: TOOL_RESULT_SCHEMA,
    status,
  });
  const approvalResult = (
    approvalRequestId: string | null,
    code: FakeApprovalResultV1["code"],
    status: FakeApprovalResultV1["status"],
  ): FakeApprovalResultV1 => ({
    approvalRequestId,
    code,
    schemaVersion: APPROVAL_RESULT_SCHEMA,
    status,
  });

  const channels: RunnerOwnedInstrumentedChannelsV1 = Object.freeze({
    approvalRequestsSupported: true as const,
    toolNames: Object.freeze(["preview_order"] as const),
    async call(input: unknown) {
      toolInvocationCount += 1;
      if (!accepting) return toolResult(null, "late-call", "rejected");
      const phase = targetTerminal ? "after-target-terminal" : "active";
      if (toolInvocationCount > launch.maxToolCalls) {
        const output = toolResult(null, "call-limit-exceeded", "rejected");
        if (!toolLimitObservationRecorded) {
          toolLimitObservationRecorded = true;
          toolRecordedInvocationCount += 1;
          record({
            callId: null,
            callSha256: null,
            phase,
            type: "tool-call-attempt",
          });
          record({
            callId: null,
            code: output.code,
            status: output.status,
            type: "tool-call-result",
          });
        }
        return output;
      }
      let parsed: ReturnType<typeof parseFakeToolCall> | null = null;
      try {
        parsed = parseFakeToolCall(input);
      } catch {
        parsed = null;
      }
      const callId = parsed?.callId ?? null;
      toolRecordedInvocationCount += 1;
      record({
        callId,
        callSha256: parsed === null ? null : sha256Jcs(parsed),
        phase,
        type: "tool-call-attempt",
      });
      let output: FakeToolResultV1;
      if (phase === "after-target-terminal") {
        output = toolResult(callId, "late-call", "rejected");
      } else if (parsed === null) {
        output = toolResult(null, "call-malformed", "rejected");
      } else {
        if (callIds.has(parsed.callId)) {
          output = toolResult(callId, "call-id-duplicate", "rejected");
        } else if (
          !same(parsed.binding, binding) ||
          !same(parsed.proposedAction, payload.proposedAction)
        ) {
          output = toolResult(callId, "binding-mismatch", "rejected");
        } else if (parsed.proposedAction.toolName !== "preview_order") {
          output = toolResult(callId, "tool-unsupported", "rejected");
        } else {
          output = toolResult(callId, "accepted", "accepted");
        }
        callIds.add(parsed.callId);
      }
      record({
        callId: output.callId,
        code: output.code,
        status: output.status,
        type: "tool-call-result",
      });
      return output;
    },
    async requestApproval(input: unknown) {
      approvalInvocationCount += 1;
      if (!accepting) {
        return approvalResult(null, "late-approval-request", "rejected");
      }
      const phase = targetTerminal ? "after-target-terminal" : "active";
      if (approvalInvocationCount > launch.maxApprovalRequests) {
        const output = approvalResult(
          null,
          "approval-request-limit-exceeded",
          "rejected",
        );
        if (!approvalLimitObservationRecorded) {
          approvalLimitObservationRecorded = true;
          approvalRecordedInvocationCount += 1;
          record({
            approvalRequestId: null,
            approvalRequestSha256: null,
            phase,
            type: "approval-request-attempt",
          });
          record({
            approvalRequestId: null,
            code: output.code,
            status: output.status,
            type: "approval-request-result",
          });
        }
        return output;
      }
      let parsed: ReturnType<typeof parseFakeApprovalRequest> | null = null;
      try {
        parsed = parseFakeApprovalRequest(input);
      } catch {
        parsed = null;
      }
      const approvalRequestId = parsed?.approvalRequestId ?? null;
      approvalRecordedInvocationCount += 1;
      record({
        approvalRequestId,
        approvalRequestSha256: parsed === null ? null : sha256Jcs(parsed),
        phase,
        type: "approval-request-attempt",
      });
      let output: FakeApprovalResultV1;
      if (phase === "after-target-terminal") {
        output = approvalResult(approvalRequestId, "late-approval-request", "rejected");
      } else if (parsed === null) {
        output = approvalResult(null, "approval-request-malformed", "rejected");
      } else {
        if (approvalRequestIds.has(parsed.approvalRequestId)) {
          output = approvalResult(
            approvalRequestId,
            "approval-request-duplicate-id",
            "rejected",
          );
        } else if (
          !same(parsed.binding, binding) ||
          !same(parsed.proposedAction, payload.proposedAction)
        ) {
          output = approvalResult(
            approvalRequestId,
            "approval-request-binding-mismatch",
            "rejected",
          );
        } else {
          output = approvalResult(approvalRequestId, "synthetic-denial", "denied");
        }
        approvalRequestIds.add(parsed.approvalRequestId);
      }
      record({
        approvalRequestId: output.approvalRequestId,
        code: output.code,
        status: output.status,
        type: "approval-request-result",
      });
      return output;
    },
  });

  const controller = new AbortController();
  type Outcome =
    | { kind: "returned"; value: unknown }
    | { kind: "rejected" }
    | { kind: "timeout" };
  const targetPromise: Promise<Outcome> = Promise.resolve()
    .then(() => target.run(stimulus, channels, controller.signal))
    .then(
      (value) => ({ kind: "returned" as const, value }),
      () => ({ kind: "rejected" as const }),
    );
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<Outcome>((resolve) => {
    timeoutId = setTimeout(() => resolve({ kind: "timeout" }), launch.timeoutMs);
  });
  const outcome = await Promise.race([targetPromise, timeoutPromise]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  targetTerminal = true;
  controller.abort(outcome.kind === "timeout" ? "runner-timeout" : "runner-terminal");

  if (outcome.kind === "timeout") {
    record({ type: "target-timeout" });
  } else if (outcome.kind === "rejected") {
    record({ code: "target-exception", type: "target-failed" });
  } else {
    try {
      record({ decision: parseHarnessDecision(outcome.value), type: "target-completed" });
    } catch {
      record({ code: "decision-malformed", type: "target-failed" });
    }
  }

  await delay(launch.lateCallWindowMs);
  accepting = false;
  record({
    approvalInvocationsRecorded: approvalRecordedInvocationCount,
    approvalInvocationsSuppressed:
      approvalInvocationCount - approvalRecordedInvocationCount,
    approvalInvocationsTotal: approvalInvocationCount,
    toolInvocationsRecorded: toolRecordedInvocationCount,
    toolInvocationsSuppressed: toolInvocationCount - toolRecordedInvocationCount,
    toolInvocationsTotal: toolInvocationCount,
    type: "channel-invocation-summary",
  });
  record({ type: "run-closed" });
  return {
    binding,
    observations,
    scenarioId,
    schemaVersion: "runbook.financial-agent-harness-scenario-evidence.v1",
    stimulus,
  };
}

function assertValidTarget(target: unknown): asserts target is FinancialBenchTargetV1 {
  if (
    target === null ||
    typeof target !== "object" ||
    typeof (target as { run?: unknown }).run !== "function"
  ) {
    throw new HarnessValidationError("target.invalid");
  }
}

function parseSubjectAndLaunch(subjectDeclarationValue: unknown) {
  const subjectDeclaration = parseHarnessSubjectDeclaration(subjectDeclarationValue);
  if (subjectDeclaration.adapterContractSha256 !== FINANCIAL_BENCH_ADAPTER_CONTRACT_SHA256) {
    throw new HarnessValidationError("subject-declaration.adapter-contract-mismatch");
  }
  return { launch: launchFor(subjectDeclaration), subjectDeclaration };
}

function assertPreparedTarget(
  prepared: unknown,
): asserts prepared is PreparedFinancialBenchTargetV1 {
  if (
    prepared === null ||
    typeof prepared !== "object" ||
    typeof (prepared as { cleanup?: unknown }).cleanup !== "function"
  ) {
    throw new HarnessValidationError("target-factory.result-invalid");
  }
}

function finalizeRun(
  subjectDeclaration: HarnessSubjectDeclarationV1,
  launch: HarnessLaunchV1,
  scenarioEvidence: HarnessScenarioEvidenceV1[],
): HarnessRunOutput {
  const evidence: HarnessEvidenceV1 = parseHarnessEvidence({
    adapterContract: FINANCIAL_BENCH_ADAPTER_CONTRACT_V1,
    corpusManifest: FINANCIAL_BENCH_HARNESS_V1_CORPUS_MANIFEST,
    isolation: ISOLATION,
    launch,
    profileVersion: HARNESS_PROFILE,
    scenarioEvidence,
    schemaVersion: EVIDENCE_SCHEMA,
    subjectDeclaration,
  });
  const evidenceBytes = serializeHarnessEvidence(evidence);
  const verified = verifyHarnessEvidenceBytes(evidenceBytes);
  if (!verified.valid || verified.receipt === null || verified.receiptBytes === null) {
    throw new HarnessValidationError(
      verified.errors[0] ?? "evidence.self-verification-failed",
    );
  }
  return {
    evidence,
    evidenceBytes: new Uint8Array(evidenceBytes),
    receipt: verified.receipt,
    receiptBytes: new Uint8Array(verified.receiptBytes),
  };
}

export async function runFinancialBenchHarnessV1(
  target: FinancialBenchTargetV1,
  subjectDeclarationValue: unknown,
): Promise<HarnessRunOutput> {
  assertValidTarget(target);
  const { launch, subjectDeclaration } = parseSubjectAndLaunch(subjectDeclarationValue);
  const scenarioEvidence: HarnessScenarioEvidenceV1[] = [];
  for (const item of internalHarnessScenarios()) {
    scenarioEvidence.push(
      await runScenario(target, item.stimulusPayload, item.scenarioId, launch),
    );
  }
  return finalizeRun(subjectDeclaration, launch, scenarioEvidence);
}

export async function runFinancialBenchHarnessWithTargetFactoryV1(
  factory: FinancialBenchTargetFactoryV1,
  subjectDeclarationValue: unknown,
): Promise<HarnessRunOutput> {
  if (typeof factory !== "function") {
    throw new HarnessValidationError("target-factory.invalid");
  }
  const { launch, subjectDeclaration } = parseSubjectAndLaunch(subjectDeclarationValue);
  const scenarioEvidence: HarnessScenarioEvidenceV1[] = [];
  const scenarios = internalHarnessScenarios();
  for (let scenarioOrdinal = 0; scenarioOrdinal < scenarios.length; scenarioOrdinal += 1) {
    const item = scenarios[scenarioOrdinal]!;
    const prepared = await factory(scenarioOrdinal);
    assertPreparedTarget(prepared);
    try {
      assertValidTarget(prepared.target);
      scenarioEvidence.push(
        await runScenario(
          prepared.target,
          item.stimulusPayload,
          item.scenarioId,
          launch,
        ),
      );
    } finally {
      await prepared.cleanup();
    }
  }
  return finalizeRun(subjectDeclaration, launch, scenarioEvidence);
}
