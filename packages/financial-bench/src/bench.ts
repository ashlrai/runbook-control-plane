import { canonicalizeJcs, rawStringCompare, sha256Jcs } from "./canonical.js";
import {
  BENCH_PROFILE,
  BENCH_RECEIPT_SCHEMA,
  CAPABILITY_DIFF_SCHEMA,
  type BenchRunReceipt,
  type CapabilityChangedField,
  type CapabilityDiff,
  type CapabilityDiffFinding,
  type CapabilitySnapshot,
  type CapabilityTool,
  type CapitalConstitution,
  type FindingCode,
  type FinancialActionFamily,
  type MutationClass,
  type ScenarioDefinition,
  type ScenarioResult,
  type ScenarioStatus,
} from "./types.js";
import {
  FinancialBenchValidationError,
  parseBenchRunReceipt,
  parseCapabilitySnapshot,
  parseCapitalConstitution,
  parseScenarioDefinition,
} from "./validate.js";

const LIMITATIONS = [
  "synthetic-inputs-only",
  "receipt-does-not-prove-live-capabilities-execution-performance-safety-suitability-or-compliance",
  "capability-snapshots-are-source-reported-and-may-be-incomplete",
  "scenario-pass-means-the-modeled-control-produced-the-frozen-expected-findings",
  "receipt-is-unsigned-local-analysis",
  "analysis-complete-means-every-supplied-scenario-was-processed-not-full-corpus-coverage",
] as const;

function compareCode(left: string, right: string) { return rawStringCompare(left, right); }
function uniqueSorted<T extends string>(values: readonly T[]): T[] { return [...new Set(values)].sort(compareCode); }
function toolMap(snapshot: CapabilitySnapshot) { return new Map(snapshot.tools.map((tool) => [tool.toolName, tool])); }
function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameCodes(left: readonly FindingCode[], right: readonly FindingCode[]) { return sameArray(left, right); }
function toolEqual(left: CapabilityTool, right: CapabilityTool) { return canonicalizeJcs(left) === canonicalizeJcs(right); }
function changedFields(previous: CapabilityTool, current: CapabilityTool): CapabilityChangedField[] {
  const fields: CapabilityChangedField[] = [];
  if (!sameArray(previous.actionFamilies, current.actionFamilies)) fields.push("action-families");
  if (previous.descriptionSha256 !== current.descriptionSha256) fields.push("description");
  if (previous.inputSchemaSha256 !== current.inputSchemaSha256) fields.push("input-schema");
  if (previous.mutationClass !== current.mutationClass) fields.push("mutation-class");
  if (previous.outputSchemaSha256 !== current.outputSchemaSha256) fields.push("output-schema");
  return fields.sort(compareCode);
}
const mutationRank: Record<MutationClass, number> = { read: 0, reversible: 1, "capital-moving": 2, emergency: 3, unknown: 4 };

export function buildCapabilityDiff(baselineValue: unknown, currentValue: unknown): CapabilityDiff {
  const baseline = parseCapabilitySnapshot(baselineValue);
  const current = parseCapabilitySnapshot(currentValue);
  if (baseline.profileVersion !== current.profileVersion) throw new FinancialBenchValidationError("diff.profile-mismatch");
  const previous = toolMap(baseline);
  const next = toolMap(current);
  const addedTools = [...next.keys()].filter((name) => !previous.has(name)).sort(compareCode);
  const removedTools = [...previous.keys()].filter((name) => !next.has(name)).sort(compareCode);
  const unchangedTools: string[] = [];
  const changedTools: CapabilityDiff["changedTools"][number][] = [];
  for (const name of [...previous.keys()].filter((toolName) => next.has(toolName)).sort(compareCode)) {
    const before = previous.get(name)!;
    const after = next.get(name)!;
    if (toolEqual(before, after)) unchangedTools.push(name);
    else changedTools.push({ changedFields: changedFields(before, after), current: after, previous: before, toolName: name });
  }
  const findings: CapabilityDiffFinding[] = [];
  for (const name of addedTools) findings.push({ code: "capability-added", toolName: name });
  for (const name of removedTools) findings.push({ code: "capability-removed", toolName: name });
  for (const change of changedTools) {
    for (const field of change.changedFields) {
      const code: FindingCode = field === "action-families" ? "capability-action-families-changed"
        : field === "description" ? "capability-description-changed"
        : field === "input-schema" ? "capability-input-schema-changed"
        : field === "mutation-class" ? "capability-mutation-changed"
        : "capability-output-schema-changed";
      findings.push({ code, toolName: change.toolName });
    }
    if (mutationRank[change.current.mutationClass] > mutationRank[change.previous.mutationClass]) {
      findings.push({ code: "capability-mutation-escalated", toolName: change.toolName });
    }
  }
  const unknownMutationTools = current.tools.filter((tool) => tool.mutationClass === "unknown").map((tool) => tool.toolName).sort(compareCode);
  for (const name of unknownMutationTools) findings.push({ code: "mutation-unclassified", toolName: name });
  const changedRisk = changedTools.filter((change) => change.changedFields.some((field) => field === "action-families" || field === "mutation-class" || field === "input-schema" || field === "output-schema")).map((change) => change.toolName);
  const blockedToolNames = uniqueSorted([...addedTools, ...changedRisk, ...unknownMutationTools]);
  const affectedFamilies = new Set<FinancialActionFamily>();
  for (const name of [...addedTools, ...removedTools]) {
    const tool = next.get(name) ?? previous.get(name);
    for (const family of tool?.actionFamilies ?? []) affectedFamilies.add(family);
  }
  for (const change of changedTools) for (const family of [...change.previous.actionFamilies, ...change.current.actionFamilies]) affectedFamilies.add(family);
  findings.sort((left, right) => compareCode(left.toolName, right.toolName) || compareCode(left.code, right.code));
  const withoutDigest = {
    addedTools,
    affectedActionFamilies: [...affectedFamilies].sort(compareCode),
    baselineSnapshotSha256: sha256Jcs(baseline),
    blockedToolNames,
    changedTools,
    currentSnapshotSha256: sha256Jcs(current),
    findings,
    removedTools,
    schemaVersion: CAPABILITY_DIFF_SCHEMA,
    unchangedTools,
    unknownMutationTools,
  } as const;
  return { ...withoutDigest, diffSha256: sha256Jcs(withoutDigest) };
}

function policyCoversTool(constitution: CapitalConstitution, tool: CapabilityTool) {
  const rule = constitution.capabilityRules.find((candidate) => candidate.toolName === tool.toolName);
  return rule !== undefined
    && rule.mutationClass === tool.mutationClass
    && rule.inputSchemaSha256 === tool.inputSchemaSha256
    && rule.outputSchemaSha256 === tool.outputSchemaSha256
    && sameArray(rule.actionFamilies, tool.actionFamilies);
}

type Evaluation = { codes: FindingCode[]; evaluable: boolean };
function evaluateDefinition(definition: ScenarioDefinition): Evaluation {
  if (definition.kind === "wrong-account") {
    if (definition.constitution.allowedAccountAliases.includes(definition.action.accountAlias)) {
      return { codes: ["scenario-precondition-not-met"], evaluable: false };
    }
    return { codes: ["account-out-of-scope", "action-denied"], evaluable: true };
  }
  if (definition.kind === "undocumented-tool") {
    if (definition.currentSnapshot.tools.some((tool) => tool.toolName === definition.action.toolName)) {
      return { codes: ["scenario-precondition-not-met"], evaluable: false };
    }
    const codes: FindingCode[] = ["action-denied", "capability-undocumented"];
    if (definition.action.mutationClass === "unknown") codes.push("mutation-unclassified");
    return { codes: codes.sort(compareCode), evaluable: true };
  }
  const previous = definition.baselineSnapshot.tools.find((tool) => tool.toolName === definition.toolName);
  const current = definition.currentSnapshot.tools.find((tool) => tool.toolName === definition.toolName);
  if (previous === undefined || current === undefined || !policyCoversTool(definition.constitution, previous)) {
    return { codes: ["scenario-precondition-not-met"], evaluable: false };
  }
  if (definition.kind === "mutation-capability-drift") {
    if (previous.mutationClass === current.mutationClass) return { codes: ["scenario-precondition-not-met"], evaluable: false };
    const codes: FindingCode[] = ["action-denied", "capability-mutation-changed", "policy-coverage-invalidated", "scenarios-rerun-required"];
    if (mutationRank[current.mutationClass] > mutationRank[previous.mutationClass]) codes.push("capability-mutation-escalated");
    if (current.mutationClass === "unknown") codes.push("mutation-unclassified");
    return { codes: codes.sort(compareCode), evaluable: true };
  }
  const inputChanged = previous.inputSchemaSha256 !== current.inputSchemaSha256;
  const outputChanged = previous.outputSchemaSha256 !== current.outputSchemaSha256;
  if (!inputChanged && !outputChanged) return { codes: ["scenario-precondition-not-met"], evaluable: false };
  const codes: FindingCode[] = ["action-denied", "policy-coverage-invalidated", "scenarios-rerun-required"];
  if (inputChanged) codes.push("capability-input-schema-changed");
  if (outputChanged) codes.push("capability-output-schema-changed");
  return { codes: codes.sort(compareCode), evaluable: true };
}

function syntheticOnly(definition: ScenarioDefinition) {
  if (!sameArray(definition.constitution.allowedEnvironments, ["synthetic"])) throw new FinancialBenchValidationError("scenario.live-environment-forbidden");
  if ("action" in definition && definition.action.environment !== "synthetic") throw new FinancialBenchValidationError("scenario.live-environment-forbidden");
}

function scenarioResult(definitionValue: unknown): ScenarioResult {
  const definition = parseScenarioDefinition(definitionValue);
  syntheticOnly(definition);
  const scenarioDefinitionSha256 = sha256Jcs(definition);
  const constitutionSha256 = sha256Jcs(definition.constitution);
  const actionSha256 = "action" in definition ? sha256Jcs(definition.action) : null;
  const baselineSnapshotSha256 = "baselineSnapshot" in definition ? sha256Jcs(definition.baselineSnapshot) : null;
  const currentSnapshotSha256 = "currentSnapshot" in definition ? sha256Jcs(definition.currentSnapshot) : null;
  if (definition.mode === "skip") return { actionSha256, baselineSnapshotSha256, constitutionSha256, currentSnapshotSha256, findingCodes: ["scenario-skipped"], scenarioDefinitionSha256, scenarioId: definition.scenarioId, status: "skipped" };
  if (definition.mode === "unsupported") return { actionSha256, baselineSnapshotSha256, constitutionSha256, currentSnapshotSha256, findingCodes: ["scenario-unsupported"], scenarioDefinitionSha256, scenarioId: definition.scenarioId, status: "unsupported" };
  const evaluated = evaluateDefinition(definition);
  const findingCodes = uniqueSorted(evaluated.codes);
  const status: ScenarioStatus = evaluated.evaluable ? (sameCodes(findingCodes, definition.expectedFindingCodes) ? "pass" : "fail") : "not-evaluable";
  return { actionSha256, baselineSnapshotSha256, constitutionSha256, currentSnapshotSha256, findingCodes, scenarioDefinitionSha256, scenarioId: definition.scenarioId, status };
}

export function runFinancialBench(definitionValues: readonly unknown[]): BenchRunReceipt {
  if (definitionValues.length === 0 || definitionValues.length > 64) throw new FinancialBenchValidationError("bench.scenario-count-invalid");
  const results = definitionValues.map(scenarioResult).sort((left, right) => compareCode(left.scenarioId, right.scenarioId));
  if (new Set(results.map((result) => result.scenarioId)).size !== results.length) throw new FinancialBenchValidationError("bench.duplicate-scenario");
  const counts: Record<ScenarioStatus, number> = { fail: 0, "not-evaluable": 0, pass: 0, skipped: 0, unsupported: 0 };
  for (const result of results) counts[result.status] += 1;
  const receipt: BenchRunReceipt = {
    analysisComplete: true,
    counts,
    coverage: { class: "caller-selected", corpusManifestSha256: null, requiredScenarioIds: [] },
    limitations: LIMITATIONS,
    profileVersion: BENCH_PROFILE,
    resultSetSha256: sha256Jcs(results),
    results,
    runFingerprintSha256: sha256Jcs(results.map((result) => result.scenarioDefinitionSha256)),
    schemaVersion: BENCH_RECEIPT_SCHEMA,
  };
  parseBenchRunReceipt(receipt);
  return receipt;
}

export function serializeBenchRunReceipt(value: unknown): string {
  return canonicalizeJcs(parseBenchRunReceipt(value));
}
