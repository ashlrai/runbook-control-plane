import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  BENCH_RECEIPT_SCHEMA,
  CAPABILITY_DIFF_SCHEMA,
  SYNTHETIC_V0_CORPUS_JCS,
  SYNTHETIC_V0_CORPUS_MANIFEST,
  SYNTHETIC_V0_CORPUS_MANIFEST_SHA256,
  SYNTHETIC_V0_SCENARIO_DEFINITIONS,
  FinancialBenchValidationError,
  buildCapabilityDiff,
  canonicalizeJcs,
  parseBenchRunReceipt,
  parseCapabilityDiff,
  parseCapabilitySnapshot,
  parseCapitalConstitution,
  parseNormalizedFinancialAction,
  parseScenarioDefinition,
  parseFrozenSyntheticV0BenchReceipt,
  runFinancialBench,
  runFrozenSyntheticV0Bench,
  serializeBenchRunReceipt,
  sha256Bytes,
  sha256Jcs,
  sha256Utf8,
  type BenchRunReceipt,
  type CapabilitySnapshot,
  type ScenarioDefinition,
} from "./index.js";

const fixtureUrl = new URL("../fixtures/expected-synthetic-v0-receipt.oracle.json", import.meta.url);
const clone = <T>(value: T): T => structuredClone(value);
const nodeSha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const nodeSha256Bytes = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

function expectCode(run: () => unknown, code: string) {
  expect(run).toThrowError(expect.objectContaining({ name: "FinancialBenchValidationError", code }));
}

function driftInputs() {
  const mutation = SYNTHETIC_V0_SCENARIO_DEFINITIONS[2];
  if (mutation?.kind !== "mutation-capability-drift") throw new Error("fixture.kind-invalid");
  return {
    baseline: clone(mutation.baselineSnapshot),
    constitution: clone(mutation.constitution),
    current: clone(mutation.currentSnapshot),
  };
}

describe("frozen synthetic financial-agent safety bench", () => {
  it("passes all four frozen scenarios and exposes no composite score", () => {
    const receipt = runFrozenSyntheticV0Bench();
    expect(receipt.schemaVersion).toBe(BENCH_RECEIPT_SCHEMA);
    expect(receipt.counts).toEqual({ fail: 0, "not-evaluable": 0, pass: 4, skipped: 0, unsupported: 0 });
    expect(receipt.results.map(({ scenarioId, status }) => ({ scenarioId, status }))).toEqual([
      { scenarioId: "scenario-01-wrong-account", status: "pass" },
      { scenarioId: "scenario-04-undocumented-tool", status: "pass" },
      { scenarioId: "scenario-05-mutation-capability-drift", status: "pass" },
      { scenarioId: "scenario-06-incompatible-schema-drift", status: "pass" },
    ]);
    expect(Object.keys(receipt).sort()).toEqual([
      "analysisComplete", "counts", "coverage", "limitations", "profileVersion", "resultSetSha256",
      "results", "runFingerprintSha256", "schemaVersion",
    ]);
    expect(receipt.coverage).toEqual({
      class: "frozen-synthetic-v0-complete",
      corpusManifestSha256: SYNTHETIC_V0_CORPUS_MANIFEST_SHA256,
      requiredScenarioIds: [
        "scenario-01-wrong-account", "scenario-04-undocumented-tool",
        "scenario-05-mutation-capability-drift", "scenario-06-incompatible-schema-drift",
      ],
    });
    expect(serializeBenchRunReceipt(receipt)).not.toMatch(/score|grade|rank|percentile/i);
  });

  it("exact-byte matches and independently hashes the frozen JCS receipt", async () => {
    const oracle = JSON.parse(await readFile(fixtureUrl, "utf8")) as { jcs: string; sha256: string };
    expect(Object.keys(oracle).sort()).toEqual(["jcs", "sha256"]);
    const expected = oracle.jcs;
    const actual = serializeBenchRunReceipt(runFrozenSyntheticV0Bench());
    expect(expected).toBe(actual);
    expect(expected.endsWith("\n")).toBe(false);
    expect(oracle.sha256).toBe("a0588492aefea0213dcc322ef164cced829422b3692da29d7de62879e1647b96");
    expect(nodeSha256(expected)).toBe(oracle.sha256);
    expect(serializeBenchRunReceipt(JSON.parse(expected) as unknown)).toBe(actual);
    expect(parseFrozenSyntheticV0BenchReceipt(JSON.parse(expected) as unknown)).toEqual(runFrozenSyntheticV0Bench());
  });

  it("independently hashes the pinned canonical corpus and its manifest", () => {
    expect(nodeSha256(SYNTHETIC_V0_CORPUS_JCS)).toBe(SYNTHETIC_V0_CORPUS_MANIFEST.corpusSha256);
    expect(nodeSha256(canonicalizeJcs(SYNTHETIC_V0_CORPUS_MANIFEST))).toBe(SYNTHETIC_V0_CORPUS_MANIFEST_SHA256);
    expect(SYNTHETIC_V0_CORPUS_MANIFEST.scenarioDefinitions.map((entry) => entry.scenarioId)).toEqual(
      runFrozenSyntheticV0Bench().results.map((result) => result.scenarioId),
    );
  });

  it("is deterministic across input order and fresh object identities", () => {
    const forward = serializeBenchRunReceipt(runFinancialBench(clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS)));
    const reverse = serializeBenchRunReceipt(runFinancialBench(clone([...SYNTHETIC_V0_SCENARIO_DEFINITIONS].reverse())));
    expect(reverse).toBe(forward);
    expect(runFinancialBench(clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS))).toEqual(
      runFinancialBench(clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS)),
    );
  });

  it("rejects live or live-capable scenario definitions before evaluation", () => {
    const liveAction = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
    if (liveAction.kind !== "wrong-account") throw new Error("fixture.kind-invalid");
    (liveAction.action as { environment: string }).environment = "live";
    expectCode(() => runFinancialBench([liveAction]), "scenario.live-environment-forbidden");

    const liveConstitution = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[2]!);
    (liveConstitution.constitution as { allowedEnvironments: string[] }).allowedEnvironments = ["live", "synthetic"];
    expectCode(() => runFinancialBench([liveConstitution]), "scenario.live-environment-forbidden");
  });

  it("fails closed for a newly invented mutation class and denies known unknown mutation", () => {
    const undocumented = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[1]!);
    if (undocumented.kind !== "undocumented-tool") throw new Error("fixture.kind-invalid");
    (undocumented.action as { mutationClass: string }).mutationClass = "autonomous-capital-transfer";
    expectCode(() => runFinancialBench([undocumented]), "action.invalid");

    const knownUnknown = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[1]!);
    const receipt = runFinancialBench([knownUnknown]);
    expect(receipt.results[0]).toMatchObject({
      findingCodes: ["action-denied", "capability-undocumented", "mutation-unclassified"],
      status: "pass",
    });
  });

  it("blocks added and unknown capabilities in a drift diff", () => {
    const { baseline, current } = driftInputs();
    const newTool = {
      ...clone(current.tools[0]!),
      mutationClass: "unknown" as const,
      toolName: "new_autonomous_mutator",
    };
    const withUnknown: CapabilitySnapshot = {
      ...current,
      snapshotId: "current-with-unknown",
      tools: [current.tools[0]!, newTool].sort((left, right) => left.toolName.localeCompare(right.toolName)),
    };
    const diff = buildCapabilityDiff(baseline, withUnknown);
    expect(diff.blockedToolNames).toEqual(["new_autonomous_mutator", "preview_order"]);
    expect(diff.unknownMutationTools).toEqual(["new_autonomous_mutator"]);
    expect(diff.findings).toEqual(expect.arrayContaining([
      { code: "capability-added", toolName: "new_autonomous_mutator" },
      { code: "mutation-unclassified", toolName: "new_autonomous_mutator" },
    ]));
    const parsed = parseCapabilityDiff(diff);
    expect(parsed).toEqual(diff);
    expect(parsed).not.toBe(diff);
    expect(diff.schemaVersion).toBe(CAPABILITY_DIFF_SCHEMA);
  });

  it("blocks action-family drift even when mutation and schema bindings are unchanged", () => {
    const { baseline, current } = driftInputs();
    const actionFamilyDrift: CapabilitySnapshot = {
      ...current,
      tools: baseline.tools.map((tool) => ({
        ...clone(tool),
        actionFamilies: tool.toolName === "preview_order" ? ["order-submission"] : tool.actionFamilies,
      })),
    };

    const diff = buildCapabilityDiff(baseline, actionFamilyDrift);
    expect(diff.changedTools).toEqual([
      expect.objectContaining({
        changedFields: ["action-families"],
        toolName: "preview_order",
      }),
    ]);
    expect(diff.findings).toContainEqual({
      code: "capability-action-families-changed",
      toolName: "preview_order",
    });
    expect(diff.affectedActionFamilies).toEqual(["order-review", "order-submission"]);
    expect(diff.blockedToolNames).toEqual(["preview_order"]);
  });

  it("does not let fixture-declared expectations self-certify a pass", () => {
    const hostile = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
    (hostile as { expectedFindingCodes: string[] }).expectedFindingCodes = ["scenario-precondition-not-met"];
    const receipt = runFinancialBench([hostile]);
    expect(receipt.results[0]).toMatchObject({
      findingCodes: ["account-out-of-scope", "action-denied"],
      status: "fail",
    });
  });

  it("emits digests and fixed findings without account, instrument, notional, tool, or secret metadata", () => {
    const canary = "secret-canary-7c94f7d2-account";
    const hostile = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
    if (hostile.kind !== "wrong-account") throw new Error("fixture.kind-invalid");
    (hostile.action as { accountAlias: string }).accountAlias = canary;
    (hostile.action as { instrumentAlias: string }).instrumentAlias = "private-instrument-canary";
    (hostile.action as { notionalDecimal: string }).notionalDecimal = "987654.321";
    const serialized = serializeBenchRunReceipt(runFinancialBench([hostile]));
    for (const forbidden of [canary, "private-instrument-canary", "987654.321", "preview_order", "account-alpha"])
      expect(serialized).not.toContain(forbidden);
  });
});

describe("closed schemas and hostile inputs", () => {
  it("rejects unknown keys at every externally parsed top-level schema", () => {
    const definition = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
    if (definition.kind !== "wrong-account") throw new Error("fixture.kind-invalid");
    const receipt = runFinancialBench(SYNTHETIC_V0_SCENARIO_DEFINITIONS);
    const { baseline, current, constitution } = driftInputs();
    const diff = buildCapabilityDiff(baseline, current);

    expectCode(() => parseCapitalConstitution({ ...constitution, extra: true }), "constitution.invalid");
    expectCode(() => parseNormalizedFinancialAction({ ...definition.action, privateNote: "secret" }), "action.invalid");
    expectCode(() => parseCapabilitySnapshot({ ...baseline, transportToken: "secret" }), "snapshot.invalid");
    expectCode(() => parseScenarioDefinition({ ...definition, extra: true }), "scenario.invalid");
    expectCode(() => parseCapabilityDiff({ ...diff, score: 100 }), "diff.invalid");
    expectCode(() => parseBenchRunReceipt({ ...receipt, score: 100 }), "receipt.invalid");
  });

  it("rejects non-plain prototypes, pollution keys, duplicates, and malformed digests", () => {
    class Malicious { schemaVersion = "runbook.capital-constitution.v0"; }
    expectCode(() => parseCapitalConstitution(new Malicious()), "constitution.invalid");

    const polluted = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    expectCode(() => parseCapitalConstitution(polluted), "constitution.invalid");

    expectCode(
      () => runFinancialBench([SYNTHETIC_V0_SCENARIO_DEFINITIONS[0], clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0])]),
      "bench.duplicate-scenario",
    );
    const receipt = clone(runFinancialBench(SYNTHETIC_V0_SCENARIO_DEFINITIONS));
    (receipt as { resultSetSha256: string }).resultSetSha256 = "0".repeat(64);
    expectCode(() => parseBenchRunReceipt(receipt), "receipt.invalid");
  });

  it("rejects nested accessors without invocation and never returns caller-owned objects", () => {
    const hostile = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
    if (hostile.kind !== "wrong-account") throw new Error("fixture.kind-invalid");
    let reads = 0;
    Object.defineProperty(hostile.action, "accountAlias", {
      enumerable: true,
      get() { reads += 1; return "account-outside-constitution"; },
    });
    expectCode(() => parseScenarioDefinition(hostile), "scenario.invalid");
    expect(reads).toBe(0);

    const source = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
    const parsed = parseScenarioDefinition(source);
    expect(parsed).not.toBe(source);
    if (parsed.kind !== "wrong-account" || source.kind !== "wrong-account") throw new Error("fixture.kind-invalid");
    expect(parsed.action).not.toBe(source.action);
    (source.action as { accountAlias: string }).accountAlias = "account-alpha";
    expect(parsed.action.accountAlias).toBe("account-outside-constitution");
  });

  it("owns the frozen corpus and rejects incomplete or caller-selected receipts as frozen proof", () => {
    expect(Object.isFrozen(SYNTHETIC_V0_SCENARIO_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0])).toBe(true);
    expect(Object.isFrozen((SYNTHETIC_V0_SCENARIO_DEFINITIONS[0] as { action: object }).action)).toBe(true);

    const before = serializeBenchRunReceipt(runFrozenSyntheticV0Bench());
    const mutable = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
    if (mutable.kind !== "wrong-account") throw new Error("fixture.kind-invalid");
    (mutable.action as { accountAlias: string }).accountAlias = "account-alpha";
    expect(serializeBenchRunReceipt(runFrozenSyntheticV0Bench())).toBe(before);

    for (const mode of ["evaluate", "skip", "unsupported"] as const) {
      const single = clone(SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!);
      single.mode = mode;
      const generic = runFinancialBench([single]);
      expect(generic.coverage).toEqual({ class: "caller-selected", corpusManifestSha256: null, requiredScenarioIds: [] });
      expectCode(() => parseFrozenSyntheticV0BenchReceipt(generic), "receipt.frozen-profile-mismatch");
    }
  });

  it("does not accept a fabricated self-consistent generic receipt as frozen-profile proof", () => {
    const fabricated = clone(runFinancialBench([SYNTHETIC_V0_SCENARIO_DEFINITIONS[0]!])) as BenchRunReceipt;
    const result = fabricated.results[0] as unknown as { findingCodes: string[]; status: string };
    result.findingCodes = [];
    result.status = "pass";
    (fabricated as { resultSetSha256: string }).resultSetSha256 = sha256Jcs(fabricated.results);
    expect(parseBenchRunReceipt(fabricated)).toEqual(fabricated);
    expectCode(() => parseFrozenSyntheticV0BenchReceipt(fabricated), "receipt.frozen-profile-mismatch");
  });

  it("enforces scenario, tool, byte, depth, and node resource bounds", () => {
    expectCode(() => runFinancialBench([]), "bench.scenario-count-invalid");
    expectCode(
      () => runFinancialBench(Array.from({ length: 65 }, () => SYNTHETIC_V0_SCENARIO_DEFINITIONS[0])),
      "bench.scenario-count-invalid",
    );

    const { baseline } = driftInputs();
    const tooManyTools = Array.from({ length: 257 }, (_, index) => ({
      ...clone(baseline.tools[0]!),
      toolName: `tool_${String(index).padStart(3, "0")}`,
    }));
    expectCode(() => parseCapabilitySnapshot({ ...baseline, tools: tooManyTools }), "snapshot.invalid");

    let deep: unknown = null;
    for (let index = 0; index < 66; index += 1) deep = [deep];
    expect(() => canonicalizeJcs(deep)).toThrow("bench.input-too-complex");
    expect(() => canonicalizeJcs(Array.from({ length: 100_001 }, () => null))).toThrow("bench.input-too-complex");
  });
});

describe("JCS and SHA-256 primitives", () => {
  it("matches representative RFC 8785 canonicalization vectors", () => {
    expect(canonicalizeJcs({ literals: [null, true, false], numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27] }))
      .toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}');
    expect(canonicalizeJcs({ "\u20ac": "Euro", "\r": "CR", "1": "One", "\u0080": "Control", "\u00f6": "o", "\ud83d\ude00": "grin" }))
      .toBe('{"\\r":"CR","1":"One","\u0080":"Control","\u00f6":"o","\u20ac":"Euro","\ud83d\ude00":"grin"}');
    expect(canonicalizeJcs(-0)).toBe("0");
    expect(() => canonicalizeJcs("\ud800")).toThrow("bench.invalid-unicode");
    expect(() => canonicalizeJcs(Number.NaN)).toThrow("bench.invalid-number");
  });

  it("matches Node crypto SHA-256 over UTF-8 and canonical bytes", () => {
    for (const value of ["", "abc", "Runbook \ud83e\uddea financial bench", "\u0000\u0080\u20ac"])
      expect(sha256Utf8(value)).toBe(nodeSha256(value));
    const binary = Uint8Array.from([0x00, 0x80, 0xff, 0x0a]);
    expect(sha256Bytes(binary)).toBe(nodeSha256Bytes(binary));
    let getterCalls = 0;
    const hostile = new Proxy(binary, {
      get(target, property, receiver) {
        getterCalls += 1;
        if (property === Symbol.iterator) throw new Error("caller iterator trap");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => sha256Bytes(hostile)).toThrow("bench.invalid-bytes");
    expect(getterCalls).toBe(0);
    const foreignBytes = runInNewContext(
      "Uint8Array.from([0, 128, 255, 10])",
    ) as Uint8Array;
    expect(sha256Bytes(foreignBytes)).toBe(nodeSha256Bytes(binary));
    const value = { z: [3, 2, 1], a: "\ud83e\uddea", nested: { allowed: false, value: null } };
    expect(sha256Jcs(value)).toBe(nodeSha256(canonicalizeJcs(value)));
  });
});
