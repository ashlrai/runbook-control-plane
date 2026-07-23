import { canonicalizeJcs, rawStringCompare, sha256Jcs } from "./canonical.js";
import {
  BENCH_PROFILE,
  BENCH_RECEIPT_SCHEMA,
  CAPABILITY_DIFF_SCHEMA,
  CAPABILITY_SNAPSHOT_SCHEMA,
  CAPITAL_CONSTITUTION_SCHEMA,
  FINANCIAL_ACTION_SCHEMA,
  SCENARIO_DEFINITION_SCHEMA,
  type BenchRunReceipt,
  type CapabilityDiff,
  type CapabilitySnapshot,
  type CapitalConstitution,
  type FindingCode,
  type NormalizedFinancialAction,
  type ScenarioDefinition,
} from "./types.js";

const HASH = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const TOOL = /^[a-z][a-z0-9_.-]{0,127}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const actionFamilies = ["account-observation","market-observation","research-state","order-review","order-submission","order-management","approval","emergency-control","reconciliation","publication"] as const;
const mutationClasses = ["read","reversible","capital-moving","emergency","unknown"] as const;
const environments = ["synthetic","paper","live"] as const;
const findings = [
  "account-out-of-scope","action-denied","capability-action-families-changed","capability-added",
  "capability-description-changed","capability-input-schema-changed","capability-mutation-changed",
  "capability-mutation-escalated","capability-output-schema-changed","capability-removed",
  "capability-undocumented","environment-out-of-scope","mutation-unclassified","policy-capability-uncovered",
  "policy-coverage-invalidated","scenario-precondition-not-met","scenario-skipped","scenario-unsupported",
  "scenarios-rerun-required",
] as const satisfies readonly FindingCode[];

export class FinancialBenchValidationError extends Error {
  readonly name = "FinancialBenchValidationError";
  constructor(readonly code: string) { super(code); }
}

function fail(code: string): never { throw new FinancialBenchValidationError(code); }

/**
 * Copies descriptor-validated plain data without invoking property accessors.
 * JavaScript does not expose a reliable general-purpose Proxy detector: Proxy
 * meta-object traps may run while their shape is inspected. Callers requiring
 * an inert trust boundary should enter through strict JSON bytes. Regardless
 * of input origin, no caller-owned object survives a successful parse.
 */
function ownPlainData(value: unknown, code: string): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  const copy = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) fail(code);
    if (current === null || typeof current === "string" || typeof current === "boolean" || typeof current === "number") return current;
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
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) fail(code);
        const length = lengthDescriptor.value as number;
        if (ownKeys.length !== length + 1) fail(code);
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) fail(code);
          output.push(copy(descriptor.value, depth + 1));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) fail(code);
      const output: Record<string, unknown> = {};
      for (const key of ownKeys as string[]) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) fail(code);
        output[key] = copy(descriptor.value, depth + 1);
      }
      return output;
    } catch (error) {
      if (error instanceof FinancialBenchValidationError) throw error;
      fail(code);
    } finally {
      active.delete(object);
    }
  };
  return copy(value, 0);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[], code: string) {
  const actual = Object.keys(value).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}
function string(value: unknown, code: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail(code);
  return value;
}
function nullableString(value: unknown, code: string, max = 256): string | null {
  return value === null ? null : string(value, code, max);
}
function hash(value: unknown, code: string): string {
  const parsed = string(value, code, 64);
  if (!HASH.test(parsed)) fail(code);
  return parsed;
}
function nullableHash(value: unknown, code: string): string | null { return value === null ? null : hash(value, code); }
function choice<T extends string>(value: unknown, choices: readonly T[], code: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(code);
  return value as T;
}
function array(value: unknown, code: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value;
}
function sortedUnique(values: readonly string[], code: string) {
  for (let index = 1; index < values.length; index += 1) {
    if (rawStringCompare(values[index - 1] ?? "", values[index] ?? "") >= 0) fail(code);
  }
}
function exactLiteral(value: unknown, expected: unknown, code: string) { if (value !== expected) fail(code); }
function bounded(value: unknown, maxBytes: number, code: string) {
  let serialized: string;
  try { serialized = canonicalizeJcs(value); } catch { fail(code); }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) fail(code);
}

function parseActionFamilies(value: unknown, code: string) {
  const parsed = array(value, code, actionFamilies.length).map((entry) => choice(entry, actionFamilies, code));
  sortedUnique(parsed, code);
  return parsed;
}

function parseCapabilityRule(value: unknown, code: string) {
  const item = record(value, code);
  keys(item, ["actionFamilies","inputSchemaSha256","mutationClass","outputSchemaSha256","toolName"], code);
  const toolName = string(item.toolName, code, 128);
  if (!TOOL.test(toolName)) fail(code);
  parseActionFamilies(item.actionFamilies, code);
  choice(item.mutationClass, mutationClasses, code);
  nullableHash(item.inputSchemaSha256, code);
  nullableHash(item.outputSchemaSha256, code);
  return toolName;
}

export function parseCapitalConstitution(value: unknown): CapitalConstitution {
  const code = "constitution.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(input, ["allowedAccountAliases","allowedEnvironments","capabilityRules","constitutionId","profileVersion","schemaVersion","unknownMutationDecision","unlistedCapabilityDecision"], code);
  exactLiteral(input.schemaVersion, CAPITAL_CONSTITUTION_SCHEMA, code);
  const id = string(input.constitutionId, code, 128); if (!IDENTIFIER.test(id)) fail(code);
  const profile = string(input.profileVersion, code, 64); if (!IDENTIFIER.test(profile)) fail(code);
  const aliases = array(input.allowedAccountAliases, code, 64).map((entry) => string(entry, code, 256));
  sortedUnique(aliases, code);
  const envs = array(input.allowedEnvironments, code, environments.length).map((entry) => choice(entry, environments, code));
  if (envs.length === 0) fail(code); sortedUnique(envs, code);
  const rules = array(input.capabilityRules, code, 256).map((entry) => parseCapabilityRule(entry, code));
  sortedUnique(rules, code);
  exactLiteral(input.unknownMutationDecision, "deny", code);
  exactLiteral(input.unlistedCapabilityDecision, "deny", code);
  bounded(input, 262_144, code);
  return input as CapitalConstitution;
}

export function parseNormalizedFinancialAction(value: unknown): NormalizedFinancialAction {
  const code = "action.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(input, ["accountAlias","actionFamily","actionId","approvalBindingSha256","assetClass","decisionContextSha256","environment","idempotencyKeySha256","inputSchemaSha256","instrumentAlias","mutationClass","notionalDecimal","orderType","outputSchemaSha256","quantityDecimal","schemaVersion","side","timeInForce","toolName"], code);
  exactLiteral(input.schemaVersion, FINANCIAL_ACTION_SCHEMA, code);
  string(input.accountAlias, code, 256);
  choice(input.actionFamily, actionFamilies, code);
  const actionId = string(input.actionId, code, 128); if (!IDENTIFIER.test(actionId)) fail(code);
  nullableHash(input.approvalBindingSha256, code);
  if (input.assetClass !== null) choice(input.assetClass, ["equity","option","crypto","event","future","cash","other"], code);
  hash(input.decisionContextSha256, code);
  choice(input.environment, environments, code);
  nullableHash(input.idempotencyKeySha256, code);
  nullableHash(input.inputSchemaSha256, code);
  nullableString(input.instrumentAlias, code, 256);
  choice(input.mutationClass, mutationClasses, code);
  const notional = nullableString(input.notionalDecimal, code, 80);
  const quantity = nullableString(input.quantityDecimal, code, 80);
  if ((notional !== null && !DECIMAL.test(notional)) || (quantity !== null && !DECIMAL.test(quantity)) || (notional !== null && quantity !== null)) fail(code);
  choice(input.orderType, ["market","limit","stop","stop-limit","none"], code);
  nullableHash(input.outputSchemaSha256, code);
  choice(input.side, ["buy","sell","none"], code);
  choice(input.timeInForce, ["day","gtc","ioc","fok","none"], code);
  const tool = string(input.toolName, code, 128); if (!TOOL.test(tool)) fail(code);
  bounded(input, 16_384, code);
  return input as NormalizedFinancialAction;
}

function parseCapabilityTool(value: unknown, code: string) {
  const input = record(value, code);
  keys(input, ["actionFamilies","descriptionSha256","inputSchemaSha256","mutationClass","outputSchemaSha256","toolName"], code);
  parseActionFamilies(input.actionFamilies, code);
  hash(input.descriptionSha256, code);
  nullableHash(input.inputSchemaSha256, code);
  choice(input.mutationClass, mutationClasses, code);
  nullableHash(input.outputSchemaSha256, code);
  const tool = string(input.toolName, code, 128); if (!TOOL.test(tool)) fail(code);
  return tool;
}

export function parseCapabilitySnapshot(value: unknown): CapabilitySnapshot {
  const code = "snapshot.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(input, ["captureMethod","observedAtDeclared","productLabelSha256","profileVersion","providerLabelSha256","schemaVersion","snapshotId","tools","trustClass"], code);
  exactLiteral(input.schemaVersion, CAPABILITY_SNAPSHOT_SCHEMA, code);
  choice(input.captureMethod, ["authorized-client-discovery","user-supplied-export","manual-public-documentation"], code);
  const observed = string(input.observedAtDeclared, code, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(observed) || Number.isNaN(Date.parse(observed))) fail(code);
  hash(input.productLabelSha256, code);
  const profile = string(input.profileVersion, code, 64); if (!IDENTIFIER.test(profile)) fail(code);
  hash(input.providerLabelSha256, code);
  const id = string(input.snapshotId, code, 128); if (!IDENTIFIER.test(id)) fail(code);
  const tools = array(input.tools, code, 256).map((entry) => parseCapabilityTool(entry, code));
  sortedUnique(tools, code);
  choice(input.trustClass, ["client-reported","user-asserted","public-documentation"], code);
  bounded(input, 1_048_576, code);
  return input as CapabilitySnapshot;
}

function parseExpected(value: unknown, code: string) {
  const parsed = array(value, code, 32).map((entry) => choice(entry, findings, code));
  sortedUnique(parsed, code);
}

export function parseScenarioDefinition(value: unknown): ScenarioDefinition {
  const code = "scenario.invalid";
  const input = record(ownPlainData(value, code), code);
  exactLiteral(input.schemaVersion, SCENARIO_DEFINITION_SCHEMA, code);
  choice(input.mode, ["evaluate","skip","unsupported"], code);
  parseExpected(input.expectedFindingCodes, code);
  const kind = choice(input.kind, ["wrong-account","undocumented-tool","mutation-capability-drift","incompatible-schema-drift"], code);
  if (kind === "wrong-account") {
    keys(input, ["action","constitution","expectedFindingCodes","kind","mode","scenarioId","schemaVersion"], code);
    exactLiteral(input.scenarioId, "scenario-01-wrong-account", code);
    parseNormalizedFinancialAction(input.action); parseCapitalConstitution(input.constitution);
  } else if (kind === "undocumented-tool") {
    keys(input, ["action","constitution","currentSnapshot","expectedFindingCodes","kind","mode","scenarioId","schemaVersion"], code);
    exactLiteral(input.scenarioId, "scenario-04-undocumented-tool", code);
    parseNormalizedFinancialAction(input.action); parseCapitalConstitution(input.constitution); parseCapabilitySnapshot(input.currentSnapshot);
  } else {
    keys(input, ["baselineSnapshot","constitution","currentSnapshot","expectedFindingCodes","kind","mode","scenarioId","schemaVersion","toolName"], code);
    exactLiteral(input.scenarioId, kind === "mutation-capability-drift" ? "scenario-05-mutation-capability-drift" : "scenario-06-incompatible-schema-drift", code);
    parseCapitalConstitution(input.constitution); parseCapabilitySnapshot(input.baselineSnapshot); parseCapabilitySnapshot(input.currentSnapshot);
    const tool = string(input.toolName, code, 128); if (!TOOL.test(tool)) fail(code);
  }
  bounded(input, 2_359_296, code);
  return input as unknown as ScenarioDefinition;
}

export function parseCapabilityDiff(value: unknown): CapabilityDiff {
  const code = "diff.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(input, ["addedTools","affectedActionFamilies","baselineSnapshotSha256","blockedToolNames","changedTools","currentSnapshotSha256","diffSha256","findings","removedTools","schemaVersion","unchangedTools","unknownMutationTools"], code);
  exactLiteral(input.schemaVersion, CAPABILITY_DIFF_SCHEMA, code);
  hash(input.baselineSnapshotSha256, code); hash(input.currentSnapshotSha256, code); const declaredDigest = hash(input.diffSha256, code);
  const parseToolNames = (candidate: unknown) => {
    const parsed = array(candidate, code, 256).map((entry) => {
      const name = string(entry, code, 128); if (!TOOL.test(name)) fail(code); return name;
    });
    sortedUnique(parsed, code); return parsed;
  };
  parseToolNames(input.addedTools); parseToolNames(input.blockedToolNames); parseToolNames(input.removedTools); parseToolNames(input.unchangedTools); parseToolNames(input.unknownMutationTools);
  parseActionFamilies(input.affectedActionFamilies, code);
  const changed = array(input.changedTools, code, 256).map((entry) => {
    const change = record(entry, code); keys(change, ["changedFields","current","previous","toolName"], code);
    const toolName = string(change.toolName, code, 128); if (!TOOL.test(toolName)) fail(code);
    const fields = array(change.changedFields, code, 5).map((field) => choice(field, ["action-families","description","input-schema","mutation-class","output-schema"], code));
    if (fields.length === 0) fail(code); sortedUnique(fields, code);
    if (parseCapabilityTool(change.current, code) !== toolName || parseCapabilityTool(change.previous, code) !== toolName) fail(code);
    return toolName;
  });
  sortedUnique(changed, code);
  const findingEntries = array(input.findings, code, 2_048).map((entry) => {
    const finding = record(entry, code); keys(finding, ["code","toolName"], code);
    const findingCode = choice(finding.code, findings, code);
    const toolName = string(finding.toolName, code, 128); if (!TOOL.test(toolName)) fail(code);
    return `${toolName}\u0000${findingCode}`;
  });
  sortedUnique(findingEntries, code);
  const { diffSha256: _digest, ...withoutDigest } = input;
  if (sha256Jcs(withoutDigest) !== declaredDigest) fail(code);
  bounded(input, 1_048_576, code);
  return input as unknown as CapabilityDiff;
}

export function parseBenchRunReceipt(value: unknown): BenchRunReceipt {
  const code = "receipt.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(input, ["analysisComplete","counts","coverage","limitations","profileVersion","resultSetSha256","results","runFingerprintSha256","schemaVersion"], code);
  exactLiteral(input.schemaVersion, BENCH_RECEIPT_SCHEMA, code); exactLiteral(input.profileVersion, BENCH_PROFILE, code); exactLiteral(input.analysisComplete, true, code);
  const resultSetDigest = hash(input.resultSetSha256, code); const runDigest = hash(input.runFingerprintSha256, code);
  const results = array(input.results, code, 64);
  const statuses = ["fail","not-evaluable","pass","skipped","unsupported"] as const;
  const scenarioIds = ["scenario-01-wrong-account","scenario-04-undocumented-tool","scenario-05-mutation-capability-drift","scenario-06-incompatible-schema-drift"] as const;
  const parsedResults = results.map((entry) => {
    const result = record(entry, code);
    keys(result, ["actionSha256","baselineSnapshotSha256","constitutionSha256","currentSnapshotSha256","findingCodes","scenarioDefinitionSha256","scenarioId","status"], code);
    nullableHash(result.actionSha256, code); nullableHash(result.baselineSnapshotSha256, code); hash(result.constitutionSha256, code); nullableHash(result.currentSnapshotSha256, code); hash(result.scenarioDefinitionSha256, code);
    parseExpected(result.findingCodes, code);
    const scenarioId = choice(result.scenarioId, scenarioIds, code);
    const status = choice(result.status, statuses, code);
    return { scenarioId, status };
  });
  sortedUnique(parsedResults.map((result) => result.scenarioId), code);
  if (sha256Jcs(results) !== resultSetDigest || sha256Jcs(results.map((entry) => (entry as Record<string, unknown>).scenarioDefinitionSha256)) !== runDigest) fail(code);
  const counts = record(input.counts, code); keys(counts, ["fail","not-evaluable","pass","skipped","unsupported"], code);
  for (const status of statuses) {
    const count = counts[status]; if (!Number.isSafeInteger(count) || (count as number) < 0) fail(code);
    if (count !== parsedResults.filter((result) => result.status === status).length) fail(code);
  }
  if (Object.values(counts).reduce<number>((total, count) => total + (count as number), 0) !== results.length) fail(code);
  const coverage = record(input.coverage, code);
  keys(coverage, ["class","corpusManifestSha256","requiredScenarioIds"], code);
  const coverageClass = choice(coverage.class, ["caller-selected","frozen-synthetic-v0-complete"], code);
  const corpusManifestSha256 = coverage.corpusManifestSha256 === null ? null : hash(coverage.corpusManifestSha256, code);
  const requiredScenarioIds = array(coverage.requiredScenarioIds, code, scenarioIds.length).map((entry) => choice(entry, scenarioIds, code));
  sortedUnique(requiredScenarioIds, code);
  if ((coverageClass === "caller-selected" && (corpusManifestSha256 !== null || requiredScenarioIds.length !== 0))
    || (coverageClass === "frozen-synthetic-v0-complete" && (corpusManifestSha256 === null || requiredScenarioIds.length !== scenarioIds.length))) fail(code);
  const limitations = array(input.limitations, code, 6);
  const expectedLimitations = ["synthetic-inputs-only","receipt-does-not-prove-live-capabilities-execution-performance-safety-suitability-or-compliance","capability-snapshots-are-source-reported-and-may-be-incomplete","scenario-pass-means-the-modeled-control-produced-the-frozen-expected-findings","receipt-is-unsigned-local-analysis","analysis-complete-means-every-supplied-scenario-was-processed-not-full-corpus-coverage"];
  if (limitations.length !== expectedLimitations.length || limitations.some((entry, index) => entry !== expectedLimitations[index])) fail(code);
  bounded(input, 65_536, code);
  return input as unknown as BenchRunReceipt;
}
