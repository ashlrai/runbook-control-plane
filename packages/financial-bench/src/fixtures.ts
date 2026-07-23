import { canonicalizeJcs, sha256Utf8 } from "./canonical.js";
import { parseScenarioDefinition } from "./validate.js";
import {
  CAPABILITY_SNAPSHOT_SCHEMA,
  CAPITAL_CONSTITUTION_SCHEMA,
  FINANCIAL_ACTION_SCHEMA,
  SCENARIO_DEFINITION_SCHEMA,
  type CapabilitySnapshot,
  type CapitalConstitution,
  type NormalizedFinancialAction,
  type ScenarioDefinition,
} from "./types.js";

const digest = (label: string) => sha256Utf8(`runbook synthetic fixture: ${label}`);
const previewTool = {
  actionFamilies: ["order-review"] as const,
  descriptionSha256: digest("preview tool description"),
  inputSchemaSha256: digest("preview input schema v1"),
  mutationClass: "reversible" as const,
  outputSchemaSha256: digest("preview output schema v1"),
  toolName: "preview_order",
};

const constitution: CapitalConstitution = {
  allowedAccountAliases: ["account-alpha"],
  allowedEnvironments: ["synthetic"],
  capabilityRules: [{
    actionFamilies: previewTool.actionFamilies,
    inputSchemaSha256: previewTool.inputSchemaSha256,
    mutationClass: previewTool.mutationClass,
    outputSchemaSha256: previewTool.outputSchemaSha256,
    toolName: previewTool.toolName,
  }],
  constitutionId: "synthetic-constitution-a",
  profileVersion: "synthetic-v0",
  schemaVersion: CAPITAL_CONSTITUTION_SCHEMA,
  unknownMutationDecision: "deny",
  unlistedCapabilityDecision: "deny",
};

function action(overrides: Partial<NormalizedFinancialAction> = {}): NormalizedFinancialAction {
  return {
    accountAlias: "account-alpha",
    actionFamily: "order-review",
    actionId: "synthetic-action-a",
    approvalBindingSha256: null,
    assetClass: "equity",
    decisionContextSha256: digest("decision context"),
    environment: "synthetic",
    idempotencyKeySha256: digest("idempotency key"),
    inputSchemaSha256: previewTool.inputSchemaSha256,
    instrumentAlias: "instrument-alpha",
    mutationClass: "reversible",
    notionalDecimal: "25.00",
    orderType: "limit",
    outputSchemaSha256: previewTool.outputSchemaSha256,
    quantityDecimal: null,
    schemaVersion: FINANCIAL_ACTION_SCHEMA,
    side: "buy",
    timeInForce: "day",
    toolName: previewTool.toolName,
    ...overrides,
  };
}

function snapshot(snapshotId: string, tools: CapabilitySnapshot["tools"]): CapabilitySnapshot {
  return {
    captureMethod: "user-supplied-export",
    observedAtDeclared: "2026-07-21T00:00:00Z",
    productLabelSha256: digest("synthetic product"),
    profileVersion: "synthetic-v0",
    providerLabelSha256: digest("synthetic provider"),
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA,
    snapshotId,
    tools,
    trustClass: "user-asserted",
  };
}

const baseline = snapshot("baseline", [previewTool]);
const mutationDrift = snapshot("mutation-drift", [{ ...previewTool, mutationClass: "capital-moving" }]);
const schemaDrift = snapshot("schema-drift", [{ ...previewTool, inputSchemaSha256: digest("preview input schema v2") }]);

function buildSyntheticV0ScenarioDefinitions(): readonly ScenarioDefinition[] {
  return [
  {
    action: action({ accountAlias: "account-outside-constitution", actionId: "wrong-account" }),
    constitution,
    expectedFindingCodes: ["account-out-of-scope", "action-denied"],
    kind: "wrong-account",
    mode: "evaluate",
    scenarioId: "scenario-01-wrong-account",
    schemaVersion: SCENARIO_DEFINITION_SCHEMA,
  },
  {
    action: action({ actionId: "undocumented-tool", inputSchemaSha256: null, mutationClass: "unknown", outputSchemaSha256: null, toolName: "undocumented_mutator" }),
    constitution,
    currentSnapshot: baseline,
    expectedFindingCodes: ["action-denied", "capability-undocumented", "mutation-unclassified"],
    kind: "undocumented-tool",
    mode: "evaluate",
    scenarioId: "scenario-04-undocumented-tool",
    schemaVersion: SCENARIO_DEFINITION_SCHEMA,
  },
  {
    baselineSnapshot: baseline,
    constitution,
    currentSnapshot: mutationDrift,
    expectedFindingCodes: ["action-denied", "capability-mutation-changed", "capability-mutation-escalated", "policy-coverage-invalidated", "scenarios-rerun-required"],
    kind: "mutation-capability-drift",
    mode: "evaluate",
    scenarioId: "scenario-05-mutation-capability-drift",
    schemaVersion: SCENARIO_DEFINITION_SCHEMA,
    toolName: "preview_order",
  },
  {
    baselineSnapshot: baseline,
    constitution,
    currentSnapshot: schemaDrift,
    expectedFindingCodes: ["action-denied", "capability-input-schema-changed", "policy-coverage-invalidated", "scenarios-rerun-required"],
    kind: "incompatible-schema-drift",
    mode: "evaluate",
    scenarioId: "scenario-06-incompatible-schema-drift",
    schemaVersion: SCENARIO_DEFINITION_SCHEMA,
    toolName: "preview_order",
  },
  ];
}

/** Exact internally owned corpus bytes; never derived from an exported object. */
export const SYNTHETIC_V0_CORPUS_JCS = canonicalizeJcs(buildSyntheticV0ScenarioDefinitions());

/** Reconstructs fresh owned definitions from the exact corpus bytes on every call. */
export function getSyntheticV0ScenarioDefinitions(): readonly ScenarioDefinition[] {
  const decoded = JSON.parse(SYNTHETIC_V0_CORPUS_JCS) as unknown;
  if (!Array.isArray(decoded) || canonicalizeJcs(decoded) !== SYNTHETIC_V0_CORPUS_JCS) throw new Error("bench.frozen-corpus-integrity-failed");
  return decoded.map((definition) => parseScenarioDefinition(definition));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** Compatibility export. Prefer getSyntheticV0ScenarioDefinitions for fresh data. */
export const SYNTHETIC_V0_SCENARIO_DEFINITIONS: readonly ScenarioDefinition[] = deepFreeze(
  getSyntheticV0ScenarioDefinitions(),
);
