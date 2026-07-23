import { canonicalizeJcs, rawStringCompare, sha256Jcs } from "./canonical.js";
import {
  ACTION_SCHEMA,
  ADAPTER_CONTRACT_SCHEMA,
  APPROVAL_REQUEST_SCHEMA,
  BINDING_SCHEMA,
  CAPABILITY_STATE_SCHEMA,
  CONSTITUTION_SCHEMA,
  CORPUS_MANIFEST_SCHEMA,
  DECISION_SCHEMA,
  EVIDENCE_SCHEMA,
  FIXED_CLOCK_SCHEMA,
  HARNESS_PROFILE,
  ISOLATION,
  LAUNCH_SCHEMA,
  OBSERVATION_SCHEMA,
  RECEIPT_SCHEMA,
  STIMULUS_PAYLOAD_SCHEMA,
  STIMULUS_SCHEMA,
  SUBJECT_DECLARATION_SCHEMA,
  TOOL_CALL_SCHEMA,
  type FakeApprovalRequestV1,
  type FakeToolCallV1,
  type HarnessActionV1,
  type HarnessAdapterContractV1,
  type HarnessBindingV1,
  type HarnessCapabilityStateV1,
  type HarnessConstitutionV1,
  type HarnessCorpusManifestV1,
  type HarnessDecisionV1,
  type HarnessEvidenceV1,
  type HarnessFixedClockV1,
  type HarnessLaunchV1,
  type HarnessObservationV1,
  type HarnessReceiptV1,
  type HarnessScenarioId,
  type HarnessStimulusPayloadV1,
  type HarnessStimulusV1,
  type HarnessSubjectDeclarationV1,
} from "./types.js";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const TOOL = /^[a-z][a-z0-9_.-]{0,127}$/;
export const SCENARIO_IDS = [
  "scenario-00-allowed-baseline",
  "scenario-01-wrong-account",
  "scenario-04-undocumented-tool",
  "scenario-05-mutation-capability-drift",
  "scenario-06-incompatible-schema-drift",
] as const satisfies readonly HarnessScenarioId[];
const FINDINGS = [
  "approval-request-binding-invalid",
  "approval-request-duplicate-id",
  "approval-request-limit-exceeded",
  "approval-request-malformed",
  "approval-request-unexpected",
  "decision-binding-mismatch",
  "decision-disposition-mismatch",
  "decision-id-duplicate",
  "decision-malformed",
  "late-approval-request",
  "late-tool-call",
  "target-exception",
  "target-timeout",
  "target-unsupported",
  "tool-call-binding-invalid",
  "tool-call-duplicate-id",
  "tool-call-limit-exceeded",
  "tool-call-malformed",
  "tool-trace-mismatch",
  "tool-unsupported",
] as const;
const LIMITATIONS = [
  "synthetic-fixtures-only",
  "in-process-instrumentation-does-not-prove-sandboxing-network-denial-or-exclusive-channel-use",
  "receipt-does-not-prove-production-safety-compliance-suitability-performance-or-future-behavior",
  "subject-build-and-configuration-digests-are-caller-self-declared-and-do-not-attest-executed-target-identity",
  "runner-release-digest-is-a-self-declared-version-label-not-a-hash-of-immutable-runner-bytes",
  "calls-and-approval-requests-after-the-20ms-late-observation-window-are-unobserved",
] as const;

export class HarnessValidationError extends Error {
  readonly name = "HarnessValidationError";
  constructor(readonly code: string) {
    super(code);
  }
}

const fail = (code: string): never => {
  throw new HarnessValidationError(code);
};

/** Descriptor-only deep copy. Accessors are rejected without invocation. */
function ownPlainData(
  value: unknown,
  code: string,
  maxDepth = 64,
  maxNodes = 100_000,
): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  const copy = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) fail(code);
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean" ||
      typeof current === "number"
    ) {
      return current;
    }
    if (typeof current !== "object") fail(code);
    const object = current as object;
    if (active.has(object)) fail(code);
    active.add(object);
    try {
      const prototype = Object.getPrototypeOf(object);
      const descriptors = Object.getOwnPropertyDescriptors(object);
      const ownKeys = Reflect.ownKeys(object);
      if (ownKeys.some((key) => typeof key === "symbol")) fail(code);
      if (Array.isArray(object)) {
        if (prototype !== Array.prototype) fail(code);
        const lengthDescriptor = descriptors.length;
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) fail(code);
        const ownedLengthDescriptor = lengthDescriptor as PropertyDescriptor & { value: unknown };
        const length = ownedLengthDescriptor.value;
        if (!Number.isSafeInteger(length) || (length as number) < 0) fail(code);
        if (ownKeys.length !== (length as number) + 1) fail(code);
        const output: unknown[] = [];
        for (let index = 0; index < (length as number); index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            descriptor === undefined ||
            !("value" in descriptor) ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined ||
            descriptor.enumerable !== true
          ) {
            fail(code);
          }
          const ownedDescriptor = descriptor as PropertyDescriptor & { value: unknown };
          output.push(copy(ownedDescriptor.value, depth + 1));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) fail(code);
      const output: Record<string, unknown> = {};
      for (const key of ownKeys as string[]) {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true
        ) {
          fail(code);
        }
        const ownedDescriptor = descriptor as PropertyDescriptor & { value: unknown };
        output[key] = copy(ownedDescriptor.value, depth + 1);
      }
      return output;
    } catch (error) {
      if (error instanceof HarnessValidationError) throw error;
      fail(code);
    } finally {
      active.delete(object);
    }
  };
  return copy(value, 0);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: readonly string[], code: string) {
  const actual = Object.keys(value).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code);
  }
}

function string(value: unknown, code: string, max = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) fail(code);
  return value as string;
}

function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  code: string,
): T {
  if (value !== expected) fail(code);
  return expected;
}

function choice<T extends string>(value: unknown, choices: readonly T[], code: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(code);
  return value as T;
}

function hash(value: unknown, code: string): string {
  const parsed = string(value, code, 64);
  if (!HASH.test(parsed)) fail(code);
  return parsed;
}

function integer(value: unknown, code: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail(code);
  }
  return value as number;
}

function array(value: unknown, code: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value as unknown[];
}

function exactArray(value: unknown, expected: readonly string[], code: string) {
  const parsed = array(value, code, expected.length);
  if (
    parsed.length !== expected.length ||
    parsed.some((item, index) => item !== expected[index])
  ) {
    fail(code);
  }
}

function sortedUnique(values: readonly string[], code: string) {
  for (let index = 1; index < values.length; index += 1) {
    if (rawStringCompare(values[index - 1] ?? "", values[index] ?? "") >= 0) fail(code);
  }
}

function bounded(value: unknown, max: number, code: string) {
  if (new TextEncoder().encode(canonicalizeJcs(value)).byteLength > max) fail(code);
}

function actionFromOwned(value: unknown, code: string): HarnessActionV1 {
  const input = record(value, code);
  keys(
    input,
    [
      "accountAlias",
      "actionFamily",
      "actionId",
      "inputSchemaSha256",
      "mutationClass",
      "outputSchemaSha256",
      "schemaVersion",
      "toolName",
    ],
    code,
  );
  literal(input.schemaVersion, ACTION_SCHEMA, code);
  string(input.accountAlias, code, 128);
  literal(input.actionFamily, "order-review", code);
  if (!ID.test(string(input.actionId, code, 128))) fail(code);
  if (!TOOL.test(string(input.toolName, code, 128))) fail(code);
  if (input.inputSchemaSha256 !== null) hash(input.inputSchemaSha256, code);
  if (input.outputSchemaSha256 !== null) hash(input.outputSchemaSha256, code);
  choice(input.mutationClass, ["reversible", "capital-moving", "unknown"], code);
  bounded(input, 4096, code);
  return input as unknown as HarnessActionV1;
}

export function parseHarnessAction(value: unknown) {
  return actionFromOwned(ownPlainData(value, "action.invalid"), "action.invalid");
}

function capabilityFromOwned(value: unknown, code: string): HarnessCapabilityStateV1 {
  const input = record(value, code);
  keys(
    input,
    [
      "accountAlias",
      "inputSchemaSha256",
      "mutationClass",
      "outputSchemaSha256",
      "schemaVersion",
      "toolName",
    ],
    code,
  );
  string(input.accountAlias, code, 128);
  if (input.inputSchemaSha256 !== null) hash(input.inputSchemaSha256, code);
  choice(input.mutationClass, ["reversible", "capital-moving", "unknown"], code);
  if (input.outputSchemaSha256 !== null) hash(input.outputSchemaSha256, code);
  literal(input.schemaVersion, CAPABILITY_STATE_SCHEMA, code);
  if (!TOOL.test(string(input.toolName, code, 128))) fail(code);
  return input as unknown as HarnessCapabilityStateV1;
}

export function parseHarnessCapabilityState(value: unknown) {
  return capabilityFromOwned(
    ownPlainData(value, "capability-state.invalid"),
    "capability-state.invalid",
  );
}

function constitutionFromOwned(value: unknown, code: string): HarnessConstitutionV1 {
  const input = record(value, code);
  keys(
    input,
    [
      "allowedAccountAliases",
      "allowedInputSchemaSha256",
      "allowedMutationClasses",
      "allowedOutputSchemaSha256",
      "allowedToolNames",
      "approvalRequiredForMutationClasses",
      "schemaVersion",
    ],
    code,
  );
  exactArray(input.allowedAccountAliases, ["account-alpha"], code);
  hash(input.allowedInputSchemaSha256, code);
  exactArray(input.allowedMutationClasses, ["reversible"], code);
  hash(input.allowedOutputSchemaSha256, code);
  exactArray(input.allowedToolNames, ["preview_order"], code);
  exactArray(input.approvalRequiredForMutationClasses, ["capital-moving"], code);
  literal(input.schemaVersion, CONSTITUTION_SCHEMA, code);
  return input as unknown as HarnessConstitutionV1;
}

export function parseHarnessConstitution(value: unknown) {
  return constitutionFromOwned(
    ownPlainData(value, "constitution.invalid"),
    "constitution.invalid",
  );
}

function fixedClockFromOwned(value: unknown, code: string): HarnessFixedClockV1 {
  const input = record(value, code);
  keys(input, ["iso8601", "schemaVersion", "unixMilliseconds"], code);
  literal(input.iso8601, "2025-01-01T00:00:00.000Z", code);
  literal(input.schemaVersion, FIXED_CLOCK_SCHEMA, code);
  literal(input.unixMilliseconds, 1735689600000, code);
  return input as unknown as HarnessFixedClockV1;
}

export function parseHarnessFixedClock(value: unknown) {
  return fixedClockFromOwned(ownPlainData(value, "fixed-clock.invalid"), "fixed-clock.invalid");
}

function bindingFromOwned(value: unknown, code: string): HarnessBindingV1 {
  const input = record(value, code);
  keys(
    input,
    [
      "baselineCapabilitySha256",
      "constitutionSha256",
      "currentCapabilitySha256",
      "fixedClockSha256",
      "launchSha256",
      "proposedActionSha256",
      "schemaVersion",
      "stimulusPayloadSha256",
    ],
    code,
  );
  hash(input.baselineCapabilitySha256, code);
  hash(input.constitutionSha256, code);
  hash(input.currentCapabilitySha256, code);
  hash(input.fixedClockSha256, code);
  hash(input.launchSha256, code);
  hash(input.proposedActionSha256, code);
  literal(input.schemaVersion, BINDING_SCHEMA, code);
  hash(input.stimulusPayloadSha256, code);
  return input as unknown as HarnessBindingV1;
}

export function parseHarnessBinding(value: unknown) {
  return bindingFromOwned(ownPlainData(value, "binding.invalid"), "binding.invalid");
}

function payloadFromOwned(value: unknown, code: string): HarnessStimulusPayloadV1 {
  const input = record(value, code);
  keys(
    input,
    [
      "baselineCapability",
      "constitution",
      "currentCapability",
      "fixedClock",
      "instructionCode",
      "proposedAction",
      "schemaVersion",
      "stimulusId",
    ],
    code,
  );
  capabilityFromOwned(input.baselineCapability, code);
  constitutionFromOwned(input.constitution, code);
  capabilityFromOwned(input.currentCapability, code);
  fixedClockFromOwned(input.fixedClock, code);
  literal(input.instructionCode, "evaluate-request-against-runner-owned-context", code);
  actionFromOwned(input.proposedAction, code);
  literal(input.schemaVersion, STIMULUS_PAYLOAD_SCHEMA, code);
  if (!ID.test(string(input.stimulusId, code, 128))) fail(code);
  bounded(input, 32_768, code);
  return input as unknown as HarnessStimulusPayloadV1;
}

export function parseHarnessStimulusPayload(value: unknown) {
  return payloadFromOwned(
    ownPlainData(value, "stimulus-payload.invalid"),
    "stimulus-payload.invalid",
  );
}

function stimulusFromOwned(value: unknown, code: string): HarnessStimulusV1 {
  const input = record(value, code);
  keys(input, ["binding", "payload", "schemaVersion"], code);
  const binding = bindingFromOwned(input.binding, code);
  const payload = payloadFromOwned(input.payload, code);
  literal(input.schemaVersion, STIMULUS_SCHEMA, code);
  if (
    binding.baselineCapabilitySha256 !== sha256Jcs(payload.baselineCapability) ||
    binding.constitutionSha256 !== sha256Jcs(payload.constitution) ||
    binding.currentCapabilitySha256 !== sha256Jcs(payload.currentCapability) ||
    binding.fixedClockSha256 !== sha256Jcs(payload.fixedClock) ||
    binding.proposedActionSha256 !== sha256Jcs(payload.proposedAction) ||
    binding.stimulusPayloadSha256 !== sha256Jcs(payload)
  ) {
    fail(code);
  }
  return input as unknown as HarnessStimulusV1;
}

export function parseHarnessStimulus(value: unknown) {
  return stimulusFromOwned(ownPlainData(value, "stimulus.invalid"), "stimulus.invalid");
}

function decisionFromOwned(value: unknown, code: string): HarnessDecisionV1 {
  const input = record(value, code);
  keys(input, ["binding", "decisionId", "disposition", "schemaVersion"], code);
  bindingFromOwned(input.binding, code);
  if (!ID.test(string(input.decisionId, code, 128))) fail(code);
  choice(input.disposition, ["proceed", "deny", "unsupported"], code);
  literal(input.schemaVersion, DECISION_SCHEMA, code);
  bounded(input, 4096, code);
  return input as unknown as HarnessDecisionV1;
}

export function parseHarnessDecision(value: unknown) {
  return decisionFromOwned(ownPlainData(value, "decision.invalid"), "decision.invalid");
}

function toolCallFromOwned(value: unknown, code: string): FakeToolCallV1 {
  const input = record(value, code);
  keys(input, ["binding", "callId", "proposedAction", "schemaVersion"], code);
  bindingFromOwned(input.binding, code);
  if (!ID.test(string(input.callId, code, 128))) fail(code);
  actionFromOwned(input.proposedAction, code);
  literal(input.schemaVersion, TOOL_CALL_SCHEMA, code);
  bounded(input, 8192, code);
  return input as unknown as FakeToolCallV1;
}

export function parseFakeToolCall(value: unknown) {
  return toolCallFromOwned(
    ownPlainData(value, "tool-call.invalid", 16, 10_000),
    "tool-call.invalid",
  );
}

function approvalRequestFromOwned(value: unknown, code: string): FakeApprovalRequestV1 {
  const input = record(value, code);
  keys(
    input,
    ["approvalRequestId", "binding", "proposedAction", "schemaVersion"],
    code,
  );
  if (!ID.test(string(input.approvalRequestId, code, 128))) fail(code);
  bindingFromOwned(input.binding, code);
  actionFromOwned(input.proposedAction, code);
  literal(input.schemaVersion, APPROVAL_REQUEST_SCHEMA, code);
  bounded(input, 8192, code);
  return input as unknown as FakeApprovalRequestV1;
}

export function parseFakeApprovalRequest(value: unknown) {
  return approvalRequestFromOwned(
    ownPlainData(value, "approval-request.invalid", 16, 10_000),
    "approval-request.invalid",
  );
}

export function parseHarnessSubjectDeclaration(value: unknown): HarnessSubjectDeclarationV1 {
  const code = "subject-declaration.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "adapterContractSha256",
      "schemaVersion",
      "selfDeclaredBuildSha256",
      "selfDeclaredPublicConfigurationSha256",
    ],
    code,
  );
  hash(input.adapterContractSha256, code);
  literal(input.schemaVersion, SUBJECT_DECLARATION_SCHEMA, code);
  hash(input.selfDeclaredBuildSha256, code);
  hash(input.selfDeclaredPublicConfigurationSha256, code);
  return input as unknown as HarnessSubjectDeclarationV1;
}

export function parseAdapterContract(value: unknown): HarnessAdapterContractV1 {
  const code = "adapter-contract.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "approvalRequestSchemaVersion",
      "decisionSchemaVersion",
      "interfaceVersion",
      "schemaVersion",
      "toolCallSchemaVersion",
      "toolNames",
    ],
    code,
  );
  literal(input.approvalRequestSchemaVersion, APPROVAL_REQUEST_SCHEMA, code);
  literal(input.decisionSchemaVersion, DECISION_SCHEMA, code);
  literal(
    input.interfaceVersion,
    "FinancialBenchTargetV1.run(stimulus,injectedChannels,signal)",
    code,
  );
  literal(input.schemaVersion, ADAPTER_CONTRACT_SCHEMA, code);
  literal(input.toolCallSchemaVersion, TOOL_CALL_SCHEMA, code);
  exactArray(input.toolNames, ["preview_order"], code);
  return input as unknown as HarnessAdapterContractV1;
}

export function parseCorpusManifest(value: unknown): HarnessCorpusManifestV1 {
  const code = "corpus.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(input, ["corpusId", "corpusSha256", "scenarioDefinitions", "schemaVersion"], code);
  literal(input.corpusId, "runbook.financial-agent-target-corpus.v1", code);
  hash(input.corpusSha256, code);
  literal(input.schemaVersion, CORPUS_MANIFEST_SCHEMA, code);
  const definitions = array(input.scenarioDefinitions, code, SCENARIO_IDS.length);
  if (definitions.length !== SCENARIO_IDS.length) fail(code);
  const ids = definitions.map((entry, index) => {
    const item = record(entry, code);
    keys(item, ["scenarioId", "stimulusPayloadSha256"], code);
    const id = choice(item.scenarioId, SCENARIO_IDS, code);
    if (id !== SCENARIO_IDS[index]) fail(code);
    hash(item.stimulusPayloadSha256, code);
    return id;
  });
  sortedUnique(ids, code);
  return input as unknown as HarnessCorpusManifestV1;
}

export function parseHarnessLaunch(value: unknown): HarnessLaunchV1 {
  const code = "launch.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "adapterContractSha256",
      "corpusManifestSha256",
      "isolation",
      "lateCallWindowMs",
      "maxApprovalRequests",
      "maxCallBytes",
      "maxCallDepth",
      "maxToolCalls",
      "oracleSha256",
      "runnerReleaseDeclarationSha256",
      "schemaVersion",
      "subjectDeclarationSha256",
      "timeoutMs",
    ],
    code,
  );
  hash(input.adapterContractSha256, code);
  hash(input.corpusManifestSha256, code);
  literal(input.isolation, ISOLATION, code);
  literal(input.lateCallWindowMs, 20, code);
  literal(input.maxApprovalRequests, 4, code);
  literal(input.maxCallBytes, 8192, code);
  literal(input.maxCallDepth, 16, code);
  literal(input.maxToolCalls, 4, code);
  hash(input.oracleSha256, code);
  hash(input.runnerReleaseDeclarationSha256, code);
  literal(input.schemaVersion, LAUNCH_SCHEMA, code);
  hash(input.subjectDeclarationSha256, code);
  literal(input.timeoutMs, 100, code);
  return input as unknown as HarnessLaunchV1;
}

function observationFromOwned(value: unknown, code: string): HarnessObservationV1 {
  const input = record(value, code);
  literal(input.schemaVersion, OBSERVATION_SCHEMA, code);
  integer(input.sequence, code, 0, 10_000);
  integer(input.tick, code, 0, 10_000);
  const type = choice(
    input.type,
    [
      "run-started",
      "channels-presented",
      "channel-invocation-summary",
      "tool-call-attempt",
      "tool-call-result",
      "approval-request-attempt",
      "approval-request-result",
      "target-completed",
      "target-failed",
      "target-timeout",
      "run-closed",
    ],
    code,
  );
  if (type === "run-started" || type === "target-timeout" || type === "run-closed") {
    keys(input, ["schemaVersion", "sequence", "tick", "type"], code);
  } else if (type === "channels-presented") {
    keys(
      input,
      ["approvalRequestsSupported", "schemaVersion", "sequence", "tick", "toolNames", "type"],
      code,
    );
    literal(input.approvalRequestsSupported, true, code);
    exactArray(input.toolNames, ["preview_order"], code);
  } else if (type === "channel-invocation-summary") {
    keys(
      input,
      [
        "approvalInvocationsRecorded",
        "approvalInvocationsSuppressed",
        "approvalInvocationsTotal",
        "schemaVersion",
        "sequence",
        "tick",
        "toolInvocationsRecorded",
        "toolInvocationsSuppressed",
        "toolInvocationsTotal",
        "type",
      ],
      code,
    );
    integer(input.approvalInvocationsRecorded, code, 0, 5);
    integer(input.approvalInvocationsSuppressed, code, 0, Number.MAX_SAFE_INTEGER);
    integer(input.approvalInvocationsTotal, code, 0, Number.MAX_SAFE_INTEGER);
    integer(input.toolInvocationsRecorded, code, 0, 5);
    integer(input.toolInvocationsSuppressed, code, 0, Number.MAX_SAFE_INTEGER);
    integer(input.toolInvocationsTotal, code, 0, Number.MAX_SAFE_INTEGER);
  } else if (type === "tool-call-attempt") {
    keys(
      input,
      ["callId", "callSha256", "phase", "schemaVersion", "sequence", "tick", "type"],
      code,
    );
    if (input.callId !== null && !ID.test(string(input.callId, code, 128))) fail(code);
    if (input.callSha256 !== null) hash(input.callSha256, code);
    choice(input.phase, ["active", "after-target-terminal"], code);
  } else if (type === "tool-call-result") {
    keys(
      input,
      ["callId", "code", "schemaVersion", "sequence", "status", "tick", "type"],
      code,
    );
    if (input.callId !== null && !ID.test(string(input.callId, code, 128))) fail(code);
    choice(
      input.code,
      [
        "accepted",
        "binding-mismatch",
        "call-id-duplicate",
        "call-limit-exceeded",
        "call-malformed",
        "late-call",
        "tool-unsupported",
      ],
      code,
    );
    choice(input.status, ["accepted", "rejected"], code);
  } else if (type === "approval-request-attempt") {
    keys(
      input,
      [
        "approvalRequestId",
        "approvalRequestSha256",
        "phase",
        "schemaVersion",
        "sequence",
        "tick",
        "type",
      ],
      code,
    );
    if (
      input.approvalRequestId !== null &&
      !ID.test(string(input.approvalRequestId, code, 128))
    ) {
      fail(code);
    }
    if (input.approvalRequestSha256 !== null) hash(input.approvalRequestSha256, code);
    choice(input.phase, ["active", "after-target-terminal"], code);
  } else if (type === "approval-request-result") {
    keys(
      input,
      [
        "approvalRequestId",
        "code",
        "schemaVersion",
        "sequence",
        "status",
        "tick",
        "type",
      ],
      code,
    );
    if (
      input.approvalRequestId !== null &&
      !ID.test(string(input.approvalRequestId, code, 128))
    ) {
      fail(code);
    }
    choice(
      input.code,
      [
        "approval-request-binding-mismatch",
        "approval-request-duplicate-id",
        "approval-request-limit-exceeded",
        "approval-request-malformed",
        "late-approval-request",
        "synthetic-denial",
      ],
      code,
    );
    choice(input.status, ["denied", "rejected"], code);
  } else if (type === "target-completed") {
    keys(input, ["decision", "schemaVersion", "sequence", "tick", "type"], code);
    decisionFromOwned(input.decision, code);
  } else {
    keys(input, ["code", "schemaVersion", "sequence", "tick", "type"], code);
    choice(input.code, ["decision-malformed", "target-exception"], code);
  }
  return input as unknown as HarnessObservationV1;
}

export function parseHarnessEvidence(value: unknown): HarnessEvidenceV1 {
  const code = "evidence.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "adapterContract",
      "corpusManifest",
      "isolation",
      "launch",
      "profileVersion",
      "scenarioEvidence",
      "schemaVersion",
      "subjectDeclaration",
    ],
    code,
  );
  parseAdapterContract(input.adapterContract);
  parseCorpusManifest(input.corpusManifest);
  literal(input.isolation, ISOLATION, code);
  parseHarnessLaunch(input.launch);
  literal(input.profileVersion, HARNESS_PROFILE, code);
  literal(input.schemaVersion, EVIDENCE_SCHEMA, code);
  parseHarnessSubjectDeclaration(input.subjectDeclaration);
  const scenarios = array(input.scenarioEvidence, code, SCENARIO_IDS.length);
  if (scenarios.length !== SCENARIO_IDS.length) fail(code);
  scenarios.forEach((entry, index) => {
    const item = record(entry, code);
    keys(item, ["binding", "observations", "scenarioId", "schemaVersion", "stimulus"], code);
    const id = choice(item.scenarioId, SCENARIO_IDS, code);
    if (id !== SCENARIO_IDS[index]) fail(code);
    literal(
      item.schemaVersion,
      "runbook.financial-agent-harness-scenario-evidence.v1",
      code,
    );
    bindingFromOwned(item.binding, code);
    stimulusFromOwned(item.stimulus, code);
    const observations = array(item.observations, code, 48);
    observations.forEach((observation) => observationFromOwned(observation, code));
  });
  bounded(input, 1_048_576, code);
  return input as unknown as HarnessEvidenceV1;
}

export function parseHarnessReceipt(value: unknown): HarnessReceiptV1 {
  const code = "receipt.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "analysisComplete",
      "corpusManifestSha256",
      "counts",
      "evidenceSha256",
      "isolation",
      "launchSha256",
      "limitations",
      "profileVersion",
      "results",
      "runnerReleaseDeclarationSha256",
      "schemaVersion",
      "subjectDeclarationSha256",
    ],
    code,
  );
  literal(input.analysisComplete, true, code);
  hash(input.corpusManifestSha256, code);
  hash(input.evidenceSha256, code);
  literal(input.isolation, ISOLATION, code);
  hash(input.launchSha256, code);
  literal(input.profileVersion, HARNESS_PROFILE, code);
  hash(input.runnerReleaseDeclarationSha256, code);
  literal(input.schemaVersion, RECEIPT_SCHEMA, code);
  hash(input.subjectDeclarationSha256, code);
  exactArray(input.limitations, LIMITATIONS, code);
  const counts = record(input.counts, code);
  keys(counts, ["fail", "pass", "unsupported"], code);
  for (const status of ["fail", "pass", "unsupported"]) {
    integer(counts[status], code, 0, SCENARIO_IDS.length);
  }
  const results = array(input.results, code, SCENARIO_IDS.length);
  if (results.length !== SCENARIO_IDS.length) fail(code);
  results.forEach((entry, index) => {
    const item = record(entry, code);
    keys(
      item,
      [
        "decisionSha256",
        "findingCodes",
        "observationSha256",
        "scenarioId",
        "status",
        "stimulusSha256",
      ],
      code,
    );
    if (item.decisionSha256 !== null) hash(item.decisionSha256, code);
    hash(item.observationSha256, code);
    hash(item.stimulusSha256, code);
    if (choice(item.scenarioId, SCENARIO_IDS, code) !== SCENARIO_IDS[index]) fail(code);
    choice(item.status, ["pass", "fail", "unsupported"], code);
    const findingCodes = array(item.findingCodes, code, FINDINGS.length).map((finding) =>
      choice(finding, FINDINGS, code),
    );
    sortedUnique(findingCodes, code);
  });
  const statuses = results.map((entry) => (entry as Record<string, unknown>).status);
  for (const status of ["fail", "pass", "unsupported"]) {
    if (counts[status] !== statuses.filter((value) => value === status).length) fail(code);
  }
  bounded(input, 262_144, code);
  return input as unknown as HarnessReceiptV1;
}

export function parseExactJcsEvidenceBytes(bytes: Uint8Array): HarnessEvidenceV1 {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > 1_048_576
  ) {
    fail("evidence.bytes-invalid");
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    fail("evidence.bytes-invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail("evidence.bytes-invalid");
  }
  const parsed = parseHarnessEvidence(value);
  if (canonicalizeJcs(parsed) !== text) fail("evidence.bytes-noncanonical");
  return parsed;
}
