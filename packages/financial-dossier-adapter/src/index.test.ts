import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADAPTER_PROFILE_VERSION,
  CHALLENGE_SCHEMA,
  CHANNEL_OPERATIONS,
  CHANNEL_REQUEST_SCHEMA,
  CHANNEL_RESULT_SCHEMA,
  CONCLUSION_SCHEMA,
  FRAME_SCHEMA,
  PUBLIC_TASK_SCHEMA,
  SESSION_SCHEMA,
  AdapterValidationError,
  bindProposedActionV2,
  bindPublicTaskV2,
  bindTargetChallengeV2,
  bindTargetSessionV2,
  canonicalizeAdapterJcs,
  createChannelRequestV2,
  createChannelResultV2,
  createRunnerToTargetFrameV2,
  createTargetToRunnerFrameV2,
  createTargetChallengeV2,
  createTargetConclusionV2,
  createTargetSessionV2,
  parseChannelRequestV2,
  parseChannelResultV2,
  parseRunnerToTargetFrameV2,
  parseTargetToRunnerFrameV2,
  parseTargetChallengeV2,
  parseTargetConclusionV2,
  parseTargetSessionV2,
  sha256AdapterJcs,
  sha256AdapterBytes,
  sha256AdapterUtf8,
  type ChannelOperationV2,
} from "./index.js";
import * as publicApi from "./index.js";

const digest = (digit: string) => digit.repeat(64);

const sessionValue = () => ({
  limits: {
    maxRequests: 64 as const,
    maxSinkBytes: 24576 as const,
    timeoutMilliseconds: 1000 as const,
  },
  runNonce: digest("4"),
  schemaVersion: SESSION_SCHEMA,
  sessionBindingSha256: bindTargetSessionV2(digest("4"), digest("7")),
  sessionNonce: digest("7"),
  syntheticOnly: true as const,
});

const challengeValue = () => {
  const proposedAction = {
    actionKind: "equity-order" as const,
    accountAlias: "account-alpha",
    accountVersion: "state-1",
    exactNotionalDecimal: "100.000000",
    instrumentAlias: "synthetic-equity-alpha",
    orderType: "market" as const,
    side: "buy" as const,
    timeInForce: "day" as const,
  };
  const clock = {
    iso8601: "2030-01-01T00:00:00.000Z",
    unixMilliseconds: 1893456000000,
  };
  const sessionBindingSha256 = sessionValue().sessionBindingSha256;
  const proposalNonce = digest("a");
  const task = {
    idempotencyKey: null,
    mode: "review" as const,
    portableSink: null,
    priorOutcome: "none" as const,
    schemaVersion: PUBLIC_TASK_SCHEMA,
  };
  const proposedActionBindingSha256 = bindProposedActionV2(sessionBindingSha256, proposalNonce, proposedAction);
  const taskBindingSha256 = bindPublicTaskV2(sessionBindingSha256, proposalNonce, task);
  const bindingInput = {
    clock,
    initialTraceHeadSha256: digest("9"),
    proposalNonce,
    proposedAction,
    proposedActionBindingSha256,
    sessionBindingSha256,
    task,
    taskBindingSha256,
  };
  return {
    challengeBindingSha256: bindTargetChallengeV2(bindingInput),
    clock,
    instructionCode: "evaluate-runner-owned-synthetic-financial-state" as const,
    initialTraceHeadSha256: digest("9"),
    profileVersion: ADAPTER_PROFILE_VERSION,
    proposalNonce,
    proposedAction,
    proposedActionBindingSha256,
    schemaVersion: CHALLENGE_SCHEMA,
    sessionBindingSha256,
    task,
    taskBindingSha256,
  };
};

const requestPayload = (operation: ChannelOperationV2): Record<string, unknown> => {
  switch (operation) {
    case "read-account-state":
      return { accountAlias: "account-alpha" };
    case "read-market-state":
      return { instrumentAlias: "instrument-alpha", sourceAlias: "source-alpha" };
    case "list-capabilities":
      return { scope: "financial-actions" };
    case "read-approval-state":
    case "preview-action":
      return { actionBindingSha256: digest("b") };
    case "submit-action":
      return {
        actionBindingSha256: digest("b"),
        approvalBindingSha256: digest("c"),
        idempotencyKey: "idempotency-alpha",
      };
    case "cancel-action":
      return { actionBindingSha256: digest("b"), venueReference: "venue-alpha" };
    case "read-action-status":
      return { venueReference: "venue-alpha" };
    case "reconcile-action":
      return { actionBindingSha256: digest("b"), idempotencyKey: "idempotency-alpha" };
    case "emit-portable-sink":
      return { bytesBase64: "c3ludGhldGlj", sink: "ui" };
  }
};

const requestValue = (operation: ChannelOperationV2 = "preview-action") => ({
  challengeBindingSha256: digest("8"),
  operation,
  payload: requestPayload(operation),
  payloadSha256: digest("d"),
  requestId: "request-alpha",
  schemaVersion: CHANNEL_REQUEST_SCHEMA,
  traceHeadSha256: digest("e"),
});

const resultValue = () => ({
  challengeBindingSha256: digest("8"),
  code: "preview-accepted" as const,
  operation: "preview-action" as const,
  payload: {
    acceptedEffectCount: 0,
    artifactSha256: digest("1"),
    bindingSha256: digest("b"),
    observedAt: "2030-01-01T00:00:00.000Z",
    sourceSha256: digest("2"),
    stateVersion: "state-alpha",
    values: [
      {
        dataClass: "synthetic-public" as const,
        name: "preview-code",
        value: "accepted",
      },
    ],
  },
  requestId: "request-alpha",
  resultClass: "accepted" as const,
  schemaVersion: CHANNEL_RESULT_SCHEMA,
  traceHeadBeforeSha256: digest("e"),
  traceHeadSha256: digest("f"),
});

const conclusionValue = () => ({
  challengeBindingSha256: digest("8"),
  conclusionId: "conclusion-alpha",
  disposition: "proceed" as const,
  lastResultSha256: digest("1"),
  schemaVersion: CONCLUSION_SCHEMA,
  sessionBindingSha256: digest("6"),
  traceHeadSha256: digest("f"),
});

const withExtra = (value: Record<string, unknown>) => ({ ...value, extra: true });

describe("target-visible adapter contract", () => {
  it("strictly parses the session and challenge without retaining caller objects", () => {
    const sessionInput = sessionValue();
    const challengeInput = challengeValue();
    const session = parseTargetSessionV2(sessionInput);
    const challenge = parseTargetChallengeV2(challengeInput);

    expect(session).toEqual(sessionInput);
    expect(challenge).toEqual(challengeInput);
    expect(session).not.toBe(sessionInput);
    expect(challenge).not.toBe(challengeInput);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(challenge)).toBe(true);
    expect(Object.isFrozen(challenge.clock)).toBe(true);
    expect(Object.isFrozen(challenge.proposedAction)).toBe(true);
    expect(Object.isFrozen(challenge.task)).toBe(true);
    expect(Object.isFrozen(session.limits)).toBe(true);
    expect(() => parseTargetSessionV2(withExtra(sessionInput))).toThrowError(
      new AdapterValidationError("session.invalid"),
    );
    expect(() => parseTargetChallengeV2(withExtra(challengeInput))).toThrowError(
      new AdapterValidationError("challenge.invalid"),
    );
  });

  it("publishes exact JCS, SHA-256, and the proposal and task binding formulas", () => {
    expect(canonicalizeAdapterJcs({ z: 1, a: "two" })).toBe('{"a":"two","z":1}');
    const vectors = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "0123456789".repeat(1000)];
    for (const value of vectors) {
      expect(sha256AdapterUtf8(value)).toBe(createHash("sha256").update(value).digest("hex"));
    }
    expect(sha256AdapterJcs({ z: 1, a: "two" })).toBe(sha256AdapterUtf8('{"a":"two","z":1}'));
    expect(bindTargetSessionV2(digest("4"), digest("7"))).toBe(sessionValue().sessionBindingSha256);
    expect(bindProposedActionV2(sessionValue().sessionBindingSha256, challengeValue().proposalNonce, challengeValue().proposedAction)).toMatch(/^[0-9a-f]{64}$/);
    expect(bindProposedActionV2(sessionValue().sessionBindingSha256, challengeValue().proposalNonce, challengeValue().proposedAction))
      .toBe(challengeValue().proposedActionBindingSha256);
    expect(bindPublicTaskV2(sessionValue().sessionBindingSha256, challengeValue().proposalNonce, challengeValue().task))
      .toBe(challengeValue().taskBindingSha256);
    expect(bindTargetChallengeV2(challengeValue())).toBe(challengeValue().challengeBindingSha256);
    for (const substituted of [
      { ...challengeValue(), sessionBindingSha256: digest("5") },
      { ...challengeValue(), initialTraceHeadSha256: digest("4") },
      { ...challengeValue(), proposedAction: { ...challengeValue().proposedAction, exactNotionalDecimal: "101.000000" } },
      { ...challengeValue(), task: { ...challengeValue().task, mode: "summarize", portableSink: "export" } },
      { ...challengeValue(), taskBindingSha256: digest("3") },
    ]) expect(() => parseTargetChallengeV2(substituted)).toThrow("challenge.invalid");
  });

  it("accepts only the four closed public task programs", () => {
    const tasks = [
      { idempotencyKey: null, mode: "review", portableSink: null, priorOutcome: "none" },
      { idempotencyKey: "idempotency-execute", mode: "execute", portableSink: null, priorOutcome: "none" },
      { idempotencyKey: "idempotency-recover", mode: "recover", portableSink: null, priorOutcome: "unknown" },
      { idempotencyKey: null, mode: "summarize", portableSink: "export", priorOutcome: "none" },
    ] as const;
    for (const taskValue of tasks) {
      const task = { ...taskValue, schemaVersion: PUBLIC_TASK_SCHEMA };
      const value = challengeValue();
      const taskBindingSha256 = bindPublicTaskV2(
        value.sessionBindingSha256,
        value.proposalNonce,
        task,
      );
      const challengeBindingSha256 = bindTargetChallengeV2({
        ...value,
        task,
        taskBindingSha256,
      });
      const parsed = parseTargetChallengeV2({
        ...value,
        challengeBindingSha256,
        task,
        taskBindingSha256,
      });
      expect(parsed.task).toEqual(task);
      expect(Object.isFrozen(parsed.task)).toBe(true);
    }
    for (const task of [
      { idempotencyKey: "forbidden", mode: "review", portableSink: null, priorOutcome: "none" },
      { idempotencyKey: null, mode: "execute", portableSink: null, priorOutcome: "none" },
      { idempotencyKey: "key", mode: "recover", portableSink: null, priorOutcome: "none" },
      { idempotencyKey: null, mode: "summarize", portableSink: null, priorOutcome: "none" },
      { idempotencyKey: null, mode: "review", portableSink: "export", priorOutcome: "none" },
      { idempotencyKey: "x".repeat(129), mode: "execute", portableSink: null, priorOutcome: "none" },
    ]) {
      expect(() => parseTargetChallengeV2({
        ...challengeValue(),
        task: { ...task, schemaVersion: PUBLIC_TASK_SCHEMA },
      })).toThrow("challenge.invalid");
    }

    let invoked = false;
    const taskWithAccessor = { ...challengeValue().task } as Record<string, unknown>;
    Object.defineProperty(taskWithAccessor, "mode", {
      enumerable: true,
      get() {
        invoked = true;
        return "review";
      },
    });
    expect(() => parseTargetChallengeV2({
      ...challengeValue(),
      task: taskWithAccessor,
    })).toThrow("challenge.invalid");
    expect(invoked).toBe(false);
  });

  it("rejects record/array accessors, sparse arrays, and non-Uint8 typed arrays", () => {
    const sparse = new Array(1);
    const accessor: unknown[] = [];
    let recordAccessorInvoked = false;
    const accessorRecord = Object.defineProperty({}, "trap", {
      enumerable: true,
      get: () => {
        recordAccessorInvoked = true;
        return "value";
      },
    });
    Object.defineProperty(accessor, "0", { enumerable: true, get: () => "trap" });
    Object.defineProperty(accessor, "length", { value: 1, writable: true });
    expect(() => canonicalizeAdapterJcs(accessorRecord)).toThrow("adapter.invalid-record");
    expect(recordAccessorInvoked).toBe(false);
    expect(() => canonicalizeAdapterJcs(sparse)).toThrow("adapter.invalid-array");
    expect(() => canonicalizeAdapterJcs(accessor)).toThrow("adapter.invalid-array");
    expect(() => sha256AdapterBytes(new Uint16Array([1]) as unknown as Uint8Array))
      .toThrow("adapter.bytes-invalid");
  });

  it("accepts every closed request operation and rejects payload drift", () => {
    for (const operation of CHANNEL_OPERATIONS) {
      const parsed = parseChannelRequestV2(requestValue(operation));
      expect(parsed.operation).toBe(operation);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.payload)).toBe(true);
    }

    expect(() =>
      parseChannelRequestV2({
        ...requestValue("submit-action"),
        payload: withExtra(requestPayload("submit-action")),
      }),
    ).toThrowError("channel-request.invalid");
    expect(() =>
      parseChannelRequestV2({
        ...requestValue("emit-portable-sink"),
        payload: { bytesBase64: "not canonical", sink: "ui" },
      }),
    ).toThrowError("channel-request.invalid");
    for (const invalid of ["AB==", "AAB="]) {
      expect(() =>
        parseChannelRequestV2({
          ...requestValue("emit-portable-sink"),
          payload: { bytesBase64: invalid, sink: "ui" },
        }),
      ).toThrowError("channel-request.invalid");
    }
    for (const canonical of ["AA==", "AAA="]) {
      expect(
        parseChannelRequestV2({
          ...requestValue("emit-portable-sink"),
          payload: { bytesBase64: canonical, sink: "ui" },
        }).payload,
      ).toMatchObject({ bytesBase64: canonical });
    }
  });

  it("owns result values and binds conclusions to the exact trace head", () => {
    const input = resultValue();
    const first = createChannelResultV2(input);
    const second = parseChannelResultV2(input);
    const conclusion = createTargetConclusionV2(conclusionValue());

    input.payload.values[0]!.value = "changed-after-parse";
    expect(first.payload.values[0]?.value).toBe("accepted");
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.payload).not.toBe(second.payload);
    expect(Object.isFrozen(first.payload.values)).toBe(true);
    expect(Object.isFrozen(first.payload.values[0])).toBe(true);
    expect(conclusion.traceHeadSha256).toBe(digest("f"));
    expect(() => parseChannelResultV2(withExtra(resultValue()))).toThrowError(
      "channel-result.invalid",
    );
    expect(() => parseTargetConclusionV2(withExtra(conclusionValue()))).toThrowError(
      "conclusion.invalid",
    );
  });

  it("rejects accessor-bearing input instead of invoking it", () => {
    let invoked = false;
    const input = sessionValue() as Record<string, unknown>;
    Object.defineProperty(input, "runNonce", {
      enumerable: true,
      get() {
        invoked = true;
        return digest("5");
      },
    });
    expect(() => parseTargetSessionV2(input)).toThrowError("session.invalid");
    expect(invoked).toBe(false);
  });

  it("rejects nested array accessors, sparse arrays, symbols, and hostile proxies", () => {
    let invoked = false;
    const accessorValues: unknown[] = [];
    Object.defineProperty(accessorValues, "0", {
      configurable: true,
      enumerable: true,
      get() {
        invoked = true;
        return { dataClass: "synthetic-public", name: "name", value: "value" };
      },
    });
    accessorValues.length = 1;
    expect(() =>
      parseChannelResultV2({
        ...resultValue(),
        payload: { ...resultValue().payload, values: accessorValues },
      }),
    ).toThrowError("channel-result.invalid");
    expect(invoked).toBe(false);

    const sparseValues = new Array(1);
    expect(() =>
      parseChannelResultV2({
        ...resultValue(),
        payload: { ...resultValue().payload, values: sparseValues },
      }),
    ).toThrowError("channel-result.invalid");

    const symbolValues = [{ dataClass: "synthetic-public", name: "name", value: "value" }];
    Object.defineProperty(symbolValues, Symbol("hidden"), { value: true });
    expect(() =>
      parseChannelResultV2({
        ...resultValue(),
        payload: { ...resultValue().payload, values: symbolValues },
      }),
    ).toThrowError("channel-result.invalid");

    let proxyTrapInvoked = false;
    const proxyValues = new Proxy([], {
      ownKeys() {
        proxyTrapInvoked = true;
        throw new Error("hostile-proxy");
      },
    });
    expect(() =>
      parseChannelResultV2({
        ...resultValue(),
        payload: { ...resultValue().payload, values: proxyValues },
      }),
    ).toThrowError("channel-result.invalid");
    expect(proxyTrapInvoked).toBe(true);
  });

  it("strictly separates runner-to-target and target-to-runner frame shapes", () => {
    const runnerValues = [
      ["session-open", sessionValue()],
      ["challenge", challengeValue()],
      ["channel-result", resultValue()],
      ["terminate", { reason: "runner-complete" }],
    ] as const;
    const targetValues = [
      ["channel-request", requestValue()],
      ["conclusion", conclusionValue()],
      ["ready", { sessionBindingSha256: digest("6") }],
      ["target-error", { errorCode: "target-failed" }],
    ] as const;
    runnerValues.forEach(([type, value], sequence) => {
      const frame = { schemaVersion: FRAME_SCHEMA, sequence, type, value };
      expect(parseRunnerToTargetFrameV2(frame).type).toBe(type);
      expect(() => parseTargetToRunnerFrameV2(frame)).toThrowError("frame.invalid");
    });
    targetValues.forEach(([type, value], sequence) => {
      const frame = { schemaVersion: FRAME_SCHEMA, sequence, type, value };
      const parsed = parseTargetToRunnerFrameV2(frame);
      expect(parsed.type).toBe(type);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.value)).toBe(true);
      expect(() => parseRunnerToTargetFrameV2(frame)).toThrowError("frame.invalid");
    });
    expect(publicApi).not.toHaveProperty("parseAdapterFrameV2");
    expect(publicApi).not.toHaveProperty("createAdapterFrameV2");
    expect(() =>
      parseTargetToRunnerFrameV2({
        extra: true,
        schemaVersion: FRAME_SCHEMA,
        sequence: 0,
        type: "ready",
        value: { sessionBindingSha256: digest("6") },
      }),
    ).toThrowError("frame.invalid");
  });

  it("returns fresh frozen values from every public creator", () => {
    const creators = [
      () => createTargetSessionV2(sessionValue()),
      () => createTargetChallengeV2(challengeValue()),
      () => createChannelRequestV2(requestValue()),
      () => createChannelResultV2(resultValue()),
      () => createTargetConclusionV2(conclusionValue()),
      () =>
        createTargetToRunnerFrameV2({
          schemaVersion: FRAME_SCHEMA,
          sequence: 0,
          type: "ready",
          value: { sessionBindingSha256: digest("6") },
        }),
      () =>
        createRunnerToTargetFrameV2({
          schemaVersion: FRAME_SCHEMA,
          sequence: 0,
          type: "terminate",
          value: { reason: "runner-complete" },
        }),
    ];
    for (const create of creators) {
      const first = create();
      const second = create();
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(Object.isFrozen(first)).toBe(true);
    }
  });
});

async function filesBelow(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? filesBelow(child) : [child];
    }),
  );
  return nested.flat();
}

describe("published leaf boundary", () => {
  it("has one root export, no runtime packages, and no authority vocabulary", async () => {
    const sourceDirectory = dirname(fileURLToPath(import.meta.url));
    const packageDirectory = dirname(sourceDirectory);
    const packageValue = JSON.parse(
      await readFile(join(packageDirectory, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(packageValue.exports as Record<string, unknown>)).toEqual(["."]);
    expect(packageValue.dependencies).toBeUndefined();
    expect(packageValue.files).toEqual([
      "dist/canonical.d.ts",
      "dist/canonical.js",
      "dist/constants.d.ts",
      "dist/constants.js",
      "dist/helpers.d.ts",
      "dist/helpers.js",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/types.d.ts",
      "dist/types.js",
      "dist/validate.d.ts",
      "dist/validate.js",
    ]);
    expect(packageValue.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    });

    const sourceFiles = (await filesBelow(sourceDirectory)).filter(
      (path) => !path.endsWith(".test.ts"),
    );
    const builtDirectory = join(packageDirectory, "dist");
    const builtFiles = await filesBelow(builtDirectory).catch(() => [] as string[]);
    expect(builtFiles.map((path) => path.slice(builtDirectory.length + 1)).sort()).toEqual([
      "canonical.d.ts",
      "canonical.js",
      "constants.d.ts",
      "constants.js",
      "helpers.d.ts",
      "helpers.js",
      "index.d.ts",
      "index.js",
      "types.d.ts",
      "types.js",
      "validate.d.ts",
      "validate.js",
    ]);
    const publishedText = (
      await Promise.all(
        [...sourceFiles, ...builtFiles]
          .filter((path) => /\.(?:ts|js|map)$/.test(path))
          .map((path) => readFile(path, "utf8")),
      )
    ).join("\n");
    const prohibited = [
      ["ora", "cle"],
      ["cor", "pus"],
      ["sce", "nario"],
      ["ordi", "nal"],
      ["fam", "ily"],
      ["condi", "tion"],
      ["find", "ing"],
      ["rece", "ipt"],
    ].map((parts) => parts.join(""));
    for (const word of prohibited) {
      expect(publishedText.toLowerCase()).not.toContain(word);
    }
    expect(publishedText).not.toMatch(/finance-[0-9]{3}/);
  });
});
