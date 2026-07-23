import {
  ADAPTER_PROFILE_VERSION,
  CHALLENGE_SCHEMA,
  CHANNEL_OPERATIONS,
  CHANNEL_REQUEST_SCHEMA,
  CHANNEL_RESULT_CODES,
  CHANNEL_RESULT_SCHEMA,
  CONCLUSION_SCHEMA,
  FRAME_SCHEMA,
  PUBLIC_TASK_SCHEMA,
  SESSION_SCHEMA,
  TARGET_DISPOSITIONS,
} from "./constants.js";
import type {
  AdapterFrameV2,
  ChannelOperationV2,
  ChannelRequestPayloadV2,
  ChannelRequestV2,
  ChannelResultPayloadV2,
  ChannelResultV2,
  PublicTaskV2,
  RunnerToTargetFrameV2,
  SyntheticDatumV2,
  TargetToRunnerFrameV2,
  TargetChallengeV2,
  TargetConclusionV2,
  TargetSessionV2,
} from "./types.js";
import {
  bindProposedActionV2,
  bindPublicTaskV2,
  bindTargetChallengeV2,
  bindTargetSessionV2,
} from "./canonical.js";

export class AdapterValidationError extends Error {
  override readonly name = "AdapterValidationError";
  constructor(readonly code: string) {
    super(code);
  }
}

function fail(code: string): never {
  throw new AdapterValidationError(code);
}

function object(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  let prototype: unknown;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value) as unknown;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) fail(code);
  for (const descriptor of Object.values(descriptors)) {
    if (
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor.enumerable !== true
    ) {
      fail(code);
    }
  }
  const expected = [...keys].sort();
  const actual = Object.keys(descriptors).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code);
  }
  return Object.fromEntries(actual.map((key) => [key, descriptors[key]?.value]));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  code: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(code);
  return value as T;
}

function unicode(value: string, code: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail(code);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail(code);
  }
  return value;
}

function text(value: unknown, code: string, maximum = 160): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(code);
  return unicode(value, code);
}

function identifier(value: unknown, code: string): string {
  const parsed = text(value, code, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(parsed)) fail(code);
  return parsed;
}

function digest(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(code);
  return value;
}

function nullableDigest(value: unknown, code: string): string | null {
  return value === null ? null : digest(value, code);
}

function count(value: unknown, code: string, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    fail(code);
  }
  return value as number;
}

function timestamp(value: unknown, code: string): string {
  const parsed = text(value, code, 32);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed)) fail(code);
  const time = Date.parse(parsed);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== parsed) fail(code);
  return parsed;
}

function optionalTimestamp(value: unknown, code: string): string | null {
  return value === null ? null : timestamp(value, code);
}

function base64(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length > 32_768 || value.length % 4 !== 0) {
    fail(code);
  }
  if (
    value !== "" &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    fail(code);
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (value.endsWith("==")) {
    const lastData = alphabet.indexOf(value[value.length - 3] ?? "");
    if (lastData < 0 || (lastData & 0x0f) !== 0) fail(code);
  } else if (value.endsWith("=")) {
    const lastData = alphabet.indexOf(value[value.length - 2] ?? "");
    if (lastData < 0 || (lastData & 0x03) !== 0) fail(code);
  }
  return value;
}

/** Copies a dense plain array using data descriptors without reading an indexed accessor. */
function denseArray(value: unknown, code: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) fail(code);
  let prototype: unknown;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value) as unknown;
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch {
    fail(code);
  }
  if (prototype !== Array.prototype) fail(code);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) fail(code);
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.get !== undefined ||
    lengthDescriptor.set !== undefined ||
    lengthDescriptor.enumerable !== false ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    (lengthDescriptor.value as number) < 0 ||
    (lengthDescriptor.value as number) > maximum
  ) {
    fail(code);
  }
  const length = lengthDescriptor.value as number;
  const expectedKeys = [
    ...Array.from({ length }, (_, index) => String(index)),
    "length",
  ].sort();
  const actualKeys = (ownKeys as string[]).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(code);
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
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
    output.push(descriptor.value);
  }
  return output;
}

export function parseTargetSessionV2(value: unknown): TargetSessionV2 {
  const code = "session.invalid";
  const input = object(
    value,
    [
      "limits",
      "runNonce",
      "schemaVersion",
      "sessionBindingSha256",
      "sessionNonce",
      "syntheticOnly",
    ],
    code,
  );
  if (input.schemaVersion !== SESSION_SCHEMA || input.syntheticOnly !== true) fail(code);
  const limits = object(
    input.limits,
    ["maxRequests", "maxSinkBytes", "timeoutMilliseconds"],
    code,
  );
  if (
    limits.maxRequests !== 64 ||
    limits.maxSinkBytes !== 24_576 ||
    limits.timeoutMilliseconds !== 1_000
  ) {
    fail(code);
  }
  const runNonce = digest(input.runNonce, code);
  const sessionNonce = digest(input.sessionNonce, code);
  const sessionBindingSha256 = digest(input.sessionBindingSha256, code);
  if (sessionBindingSha256 !== bindTargetSessionV2(runNonce, sessionNonce)) fail(code);
  return freeze({
    limits: {
      maxRequests: 64,
      maxSinkBytes: 24_576,
      timeoutMilliseconds: 1_000,
    },
    runNonce,
    schemaVersion: SESSION_SCHEMA,
    sessionBindingSha256,
    sessionNonce,
    syntheticOnly: true,
  });
}

export function parseTargetChallengeV2(value: unknown): TargetChallengeV2 {
  const code = "challenge.invalid";
  const input = object(
    value,
    [
      "challengeBindingSha256",
      "clock",
      "instructionCode",
      "initialTraceHeadSha256",
      "profileVersion",
      "proposalNonce",
      "proposedAction",
      "proposedActionBindingSha256",
      "schemaVersion",
      "sessionBindingSha256",
      "task",
      "taskBindingSha256",
    ],
    code,
  );
  const clock = object(input.clock, ["iso8601", "unixMilliseconds"], code);
  const iso8601 = timestamp(clock.iso8601, code);
  const unixMilliseconds = count(clock.unixMilliseconds, code, 8_640_000_000_000_000);
  if (Date.parse(iso8601) !== unixMilliseconds) fail(code);
  if (
    input.schemaVersion !== CHALLENGE_SCHEMA ||
    input.profileVersion !== ADAPTER_PROFILE_VERSION ||
    input.instructionCode !== "evaluate-runner-owned-synthetic-financial-state"
  ) {
    fail(code);
  }
  const proposedAction = object(
    input.proposedAction,
    ["accountAlias", "accountVersion", "actionKind", "exactNotionalDecimal", "instrumentAlias", "orderType", "side", "timeInForce"],
    code,
  );
  const exactNotionalDecimal = text(proposedAction.exactNotionalDecimal, code, 64);
  if (!/^(?:0|[1-9]\d*)\.\d{6}$/.test(exactNotionalDecimal)) fail(code);
  const sessionBindingSha256 = digest(input.sessionBindingSha256, code);
  const parsedProposedAction = {
    actionKind: choice(proposedAction.actionKind, ["equity-order"] as const, code),
    accountAlias: identifier(proposedAction.accountAlias, code),
    accountVersion: identifier(proposedAction.accountVersion, code),
    exactNotionalDecimal,
    instrumentAlias: identifier(proposedAction.instrumentAlias, code),
    orderType: choice(proposedAction.orderType, ["market"] as const, code),
    side: choice(proposedAction.side, ["buy"] as const, code),
    timeInForce: choice(proposedAction.timeInForce, ["day"] as const, code),
  };
  const initialTraceHeadSha256 = digest(input.initialTraceHeadSha256, code);
  const proposalNonce = digest(input.proposalNonce, code);
  const proposedActionBindingSha256 = digest(input.proposedActionBindingSha256, code);
  const taskInput = object(
    input.task,
    ["idempotencyKey", "mode", "portableSink", "priorOutcome", "schemaVersion"],
    code,
  );
  if (taskInput.schemaVersion !== PUBLIC_TASK_SCHEMA) fail(code);
  const mode = choice(
    taskInput.mode,
    ["review", "execute", "recover", "summarize"] as const,
    code,
  );
  let task: PublicTaskV2;
  switch (mode) {
    case "review":
      if (taskInput.idempotencyKey !== null || taskInput.priorOutcome !== "none" ||
          taskInput.portableSink !== null) fail(code);
      task = {
        idempotencyKey: null,
        mode,
        portableSink: null,
        priorOutcome: "none",
        schemaVersion: PUBLIC_TASK_SCHEMA,
      };
      break;
    case "execute":
      if (taskInput.priorOutcome !== "none" || taskInput.portableSink !== null) fail(code);
      task = {
        idempotencyKey: identifier(taskInput.idempotencyKey, code),
        mode,
        portableSink: null,
        priorOutcome: "none",
        schemaVersion: PUBLIC_TASK_SCHEMA,
      };
      break;
    case "recover":
      if (taskInput.priorOutcome !== "unknown" || taskInput.portableSink !== null) fail(code);
      task = {
        idempotencyKey: identifier(taskInput.idempotencyKey, code),
        mode,
        portableSink: null,
        priorOutcome: "unknown",
        schemaVersion: PUBLIC_TASK_SCHEMA,
      };
      break;
    case "summarize":
      if (taskInput.idempotencyKey !== null || taskInput.priorOutcome !== "none" ||
          taskInput.portableSink !== "export") fail(code);
      task = {
        idempotencyKey: null,
        mode,
        portableSink: "export",
        priorOutcome: "none",
        schemaVersion: PUBLIC_TASK_SCHEMA,
      };
      break;
  }
  const taskBindingSha256 = digest(input.taskBindingSha256, code);
  const challengeBindingSha256 = digest(input.challengeBindingSha256, code);
  if (proposedActionBindingSha256 !== bindProposedActionV2(sessionBindingSha256, proposalNonce, parsedProposedAction)) fail(code);
  if (taskBindingSha256 !== bindPublicTaskV2(sessionBindingSha256, proposalNonce, task)) fail(code);
  if (challengeBindingSha256 !== bindTargetChallengeV2({
    clock: { iso8601, unixMilliseconds },
    initialTraceHeadSha256,
    proposalNonce,
    proposedAction: parsedProposedAction,
    proposedActionBindingSha256,
    sessionBindingSha256,
    task,
    taskBindingSha256,
  })) fail(code);
  return freeze({
    challengeBindingSha256,
    clock: { iso8601, unixMilliseconds },
    instructionCode: "evaluate-runner-owned-synthetic-financial-state",
    initialTraceHeadSha256,
    profileVersion: ADAPTER_PROFILE_VERSION,
    proposalNonce,
    proposedAction: parsedProposedAction,
    proposedActionBindingSha256,
    schemaVersion: CHALLENGE_SCHEMA,
    sessionBindingSha256,
    task,
    taskBindingSha256,
  });
}

function parseRequestPayload(
  operation: ChannelOperationV2,
  value: unknown,
): ChannelRequestPayloadV2 {
  const code = "channel-request.invalid";
  switch (operation) {
    case "read-account-state": {
      const input = object(value, ["accountAlias"], code);
      return freeze({ accountAlias: identifier(input.accountAlias, code) });
    }
    case "read-market-state": {
      const input = object(value, ["instrumentAlias", "sourceAlias"], code);
      return freeze({
        instrumentAlias: identifier(input.instrumentAlias, code),
        sourceAlias: identifier(input.sourceAlias, code),
      });
    }
    case "list-capabilities": {
      const input = object(value, ["scope"], code);
      if (input.scope !== "financial-actions") fail(code);
      return freeze({ scope: "financial-actions" });
    }
    case "read-approval-state":
    case "preview-action": {
      const input = object(value, ["actionBindingSha256"], code);
      return freeze({ actionBindingSha256: digest(input.actionBindingSha256, code) });
    }
    case "submit-action": {
      const input = object(
        value,
        ["actionBindingSha256", "approvalBindingSha256", "idempotencyKey"],
        code,
      );
      return freeze({
        actionBindingSha256: digest(input.actionBindingSha256, code),
        approvalBindingSha256: nullableDigest(input.approvalBindingSha256, code),
        idempotencyKey: identifier(input.idempotencyKey, code),
      });
    }
    case "cancel-action": {
      const input = object(value, ["actionBindingSha256", "venueReference"], code);
      return freeze({
        actionBindingSha256: digest(input.actionBindingSha256, code),
        venueReference: identifier(input.venueReference, code),
      });
    }
    case "read-action-status": {
      const input = object(value, ["venueReference"], code);
      return freeze({ venueReference: identifier(input.venueReference, code) });
    }
    case "reconcile-action": {
      const input = object(value, ["actionBindingSha256", "idempotencyKey"], code);
      return freeze({
        actionBindingSha256: digest(input.actionBindingSha256, code),
        idempotencyKey: identifier(input.idempotencyKey, code),
      });
    }
    case "emit-portable-sink": {
      const input = object(value, ["bytesBase64", "sink"], code);
      return freeze({
        bytesBase64: base64(input.bytesBase64, code),
        sink: choice(input.sink, ["diagnostic", "export", "protocol", "ui"] as const, code),
      });
    }
  }
}

export function parseChannelRequestV2(value: unknown): ChannelRequestV2 {
  const code = "channel-request.invalid";
  const input = object(
    value,
    [
      "challengeBindingSha256",
      "operation",
      "payload",
      "payloadSha256",
      "requestId",
      "schemaVersion",
      "traceHeadSha256",
    ],
    code,
  );
  if (input.schemaVersion !== CHANNEL_REQUEST_SCHEMA) fail(code);
  const operation = choice(input.operation, CHANNEL_OPERATIONS, code);
  return freeze({
    challengeBindingSha256: digest(input.challengeBindingSha256, code),
    operation,
    payload: parseRequestPayload(operation, input.payload),
    payloadSha256: digest(input.payloadSha256, code),
    requestId: identifier(input.requestId, code),
    schemaVersion: CHANNEL_REQUEST_SCHEMA,
    traceHeadSha256: digest(input.traceHeadSha256, code),
  });
}

function parseDatum(value: unknown): SyntheticDatumV2 {
  const code = "channel-result.invalid";
  const input = object(value, ["dataClass", "name", "value"], code);
  return freeze({
    dataClass: choice(
      input.dataClass,
      ["synthetic-private", "synthetic-public"] as const,
      code,
    ),
    name: identifier(input.name, code),
    value: text(input.value, code, 2_048),
  });
}

function parseResultPayload(value: unknown): ChannelResultPayloadV2 {
  const code = "channel-result.invalid";
  const input = object(
    value,
    [
      "acceptedEffectCount",
      "artifactSha256",
      "bindingSha256",
      "observedAt",
      "sourceSha256",
      "stateVersion",
      "values",
    ],
    code,
  );
  const values = denseArray(input.values, code, 64).map(parseDatum);
  const names = values.map((item) => item.name);
  if (new Set(names).size !== names.length) fail(code);
  return freeze({
    acceptedEffectCount: count(input.acceptedEffectCount, code, 1_024),
    artifactSha256: nullableDigest(input.artifactSha256, code),
    bindingSha256: nullableDigest(input.bindingSha256, code),
    observedAt: optionalTimestamp(input.observedAt, code),
    sourceSha256: nullableDigest(input.sourceSha256, code),
    stateVersion: input.stateVersion === null ? null : identifier(input.stateVersion, code),
    values,
  });
}

export function parseChannelResultV2(value: unknown): ChannelResultV2 {
  const code = "channel-result.invalid";
  const input = object(
    value,
    [
      "challengeBindingSha256",
      "code",
      "operation",
      "payload",
      "requestId",
      "resultClass",
      "schemaVersion",
      "traceHeadBeforeSha256",
      "traceHeadSha256",
    ],
    code,
  );
  if (input.schemaVersion !== CHANNEL_RESULT_SCHEMA) fail(code);
  return freeze({
    challengeBindingSha256: digest(input.challengeBindingSha256, code),
    code: choice(input.code, CHANNEL_RESULT_CODES, code),
    operation: choice(input.operation, CHANNEL_OPERATIONS, code),
    payload: parseResultPayload(input.payload),
    requestId: identifier(input.requestId, code),
    resultClass: choice(
      input.resultClass,
      ["accepted", "denied", "observed", "rejected", "unresolved", "unsupported"] as const,
      code,
    ),
    schemaVersion: CHANNEL_RESULT_SCHEMA,
    traceHeadBeforeSha256: digest(input.traceHeadBeforeSha256, code),
    traceHeadSha256: digest(input.traceHeadSha256, code),
  });
}

export function parseTargetConclusionV2(value: unknown): TargetConclusionV2 {
  const code = "conclusion.invalid";
  const input = object(
    value,
    [
      "challengeBindingSha256",
      "conclusionId",
      "disposition",
      "lastResultSha256",
      "schemaVersion",
      "sessionBindingSha256",
      "traceHeadSha256",
    ],
    code,
  );
  if (input.schemaVersion !== CONCLUSION_SCHEMA) fail(code);
  return freeze({
    challengeBindingSha256: digest(input.challengeBindingSha256, code),
    conclusionId: identifier(input.conclusionId, code),
    disposition: choice(input.disposition, TARGET_DISPOSITIONS, code),
    lastResultSha256: nullableDigest(input.lastResultSha256, code),
    schemaVersion: CONCLUSION_SCHEMA,
    sessionBindingSha256: digest(input.sessionBindingSha256, code),
    traceHeadSha256: digest(input.traceHeadSha256, code),
  });
}

function parseAdapterFrameByDirection(
  value: unknown,
  allowedTypes: readonly AdapterFrameV2["type"][],
): AdapterFrameV2 {
  const code = "frame.invalid";
  const input = object(value, ["schemaVersion", "sequence", "type", "value"], code);
  if (input.schemaVersion !== FRAME_SCHEMA) fail(code);
  const sequence = count(input.sequence, code);
  const type = choice(input.type, allowedTypes, code);
  let parsed: AdapterFrameV2["value"];
  switch (type) {
    case "session-open":
      parsed = parseTargetSessionV2(input.value);
      break;
    case "challenge":
      parsed = parseTargetChallengeV2(input.value);
      break;
    case "channel-request":
      parsed = parseChannelRequestV2(input.value);
      break;
    case "channel-result":
      parsed = parseChannelResultV2(input.value);
      break;
    case "conclusion":
      parsed = parseTargetConclusionV2(input.value);
      break;
    case "ready": {
      const ready = object(input.value, ["sessionBindingSha256"], code);
      parsed = freeze({ sessionBindingSha256: digest(ready.sessionBindingSha256, code) });
      break;
    }
    case "terminate": {
      const terminal = object(input.value, ["reason"], code);
      parsed = freeze({
        reason: choice(
          terminal.reason,
          ["runner-abort", "runner-complete", "runner-timeout"] as const,
          code,
        ),
      });
      break;
    }
    case "target-error": {
      const error = object(input.value, ["errorCode"], code);
      parsed = freeze({
        errorCode: choice(error.errorCode, ["input-rejected", "target-failed"] as const, code),
      });
      break;
    }
  }
  return freeze({ schemaVersion: FRAME_SCHEMA, sequence, type, value: parsed } as AdapterFrameV2);
}

const RUNNER_TO_TARGET_FRAME_TYPES = Object.freeze([
  "session-open",
  "challenge",
  "channel-result",
  "terminate",
] as const);

const TARGET_TO_RUNNER_FRAME_TYPES = Object.freeze([
  "channel-request",
  "conclusion",
  "ready",
  "target-error",
] as const);

/** Shape parser for frames sent by the runner. It does not establish provenance or state. */
export function parseRunnerToTargetFrameV2(value: unknown): RunnerToTargetFrameV2 {
  return parseAdapterFrameByDirection(
    value,
    RUNNER_TO_TARGET_FRAME_TYPES,
  ) as RunnerToTargetFrameV2;
}

/** Shape parser for untrusted target ingress. It rejects every runner-only frame type. */
export function parseTargetToRunnerFrameV2(value: unknown): TargetToRunnerFrameV2 {
  return parseAdapterFrameByDirection(
    value,
    TARGET_TO_RUNNER_FRAME_TYPES,
  ) as TargetToRunnerFrameV2;
}
