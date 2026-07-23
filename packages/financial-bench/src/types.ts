export const CAPITAL_CONSTITUTION_SCHEMA = "runbook.capital-constitution.v0" as const;
export const FINANCIAL_ACTION_SCHEMA = "runbook.normalized-financial-action.v0" as const;
export const CAPABILITY_SNAPSHOT_SCHEMA = "runbook.capability-snapshot.v0" as const;
export const CAPABILITY_DIFF_SCHEMA = "runbook.capability-diff.v0" as const;
export const SCENARIO_DEFINITION_SCHEMA = "runbook.financial-bench-scenario.v0" as const;
export const BENCH_RECEIPT_SCHEMA = "runbook.financial-bench-receipt.v0" as const;
export const BENCH_PROFILE = "runbook.synthetic-financial-agent-safety.v0" as const;
export const BENCH_CORPUS_MANIFEST_SCHEMA = "runbook.financial-bench-corpus-manifest.v0" as const;

export type MutationClass = "read" | "reversible" | "capital-moving" | "emergency" | "unknown";
export type FinancialEnvironment = "synthetic" | "paper" | "live";
export type FinancialActionFamily =
  | "account-observation"
  | "market-observation"
  | "research-state"
  | "order-review"
  | "order-submission"
  | "order-management"
  | "approval"
  | "emergency-control"
  | "reconciliation"
  | "publication";

export type CapabilityRule = Readonly<{
  actionFamilies: readonly FinancialActionFamily[];
  inputSchemaSha256: string | null;
  mutationClass: MutationClass;
  outputSchemaSha256: string | null;
  toolName: string;
}>;

export type CapitalConstitution = Readonly<{
  allowedAccountAliases: readonly string[];
  allowedEnvironments: readonly FinancialEnvironment[];
  capabilityRules: readonly CapabilityRule[];
  constitutionId: string;
  profileVersion: string;
  schemaVersion: "runbook.capital-constitution.v0";
  unknownMutationDecision: "deny";
  unlistedCapabilityDecision: "deny";
}>;

export type NormalizedFinancialAction = Readonly<{
  accountAlias: string;
  actionFamily: FinancialActionFamily;
  actionId: string;
  approvalBindingSha256: string | null;
  assetClass: "equity" | "option" | "crypto" | "event" | "future" | "cash" | "other" | null;
  decisionContextSha256: string;
  environment: FinancialEnvironment;
  idempotencyKeySha256: string | null;
  inputSchemaSha256: string | null;
  instrumentAlias: string | null;
  mutationClass: MutationClass;
  notionalDecimal: string | null;
  orderType: "market" | "limit" | "stop" | "stop-limit" | "none";
  outputSchemaSha256: string | null;
  quantityDecimal: string | null;
  schemaVersion: "runbook.normalized-financial-action.v0";
  side: "buy" | "sell" | "none";
  timeInForce: "day" | "gtc" | "ioc" | "fok" | "none";
  toolName: string;
}>;

export type CapabilityTool = Readonly<{
  actionFamilies: readonly FinancialActionFamily[];
  descriptionSha256: string;
  inputSchemaSha256: string | null;
  mutationClass: MutationClass;
  outputSchemaSha256: string | null;
  toolName: string;
}>;

export type CapabilitySnapshot = Readonly<{
  captureMethod: "authorized-client-discovery" | "user-supplied-export" | "manual-public-documentation";
  observedAtDeclared: string;
  productLabelSha256: string;
  profileVersion: string;
  providerLabelSha256: string;
  schemaVersion: "runbook.capability-snapshot.v0";
  snapshotId: string;
  tools: readonly CapabilityTool[];
  trustClass: "client-reported" | "user-asserted" | "public-documentation";
}>;

export type CapabilityChangedField =
  | "action-families"
  | "description"
  | "input-schema"
  | "mutation-class"
  | "output-schema";

export type CapabilityChange = Readonly<{
  changedFields: readonly CapabilityChangedField[];
  current: CapabilityTool;
  previous: CapabilityTool;
  toolName: string;
}>;

export type FindingCode =
  | "account-out-of-scope"
  | "action-denied"
  | "capability-action-families-changed"
  | "capability-added"
  | "capability-description-changed"
  | "capability-input-schema-changed"
  | "capability-mutation-changed"
  | "capability-mutation-escalated"
  | "capability-output-schema-changed"
  | "capability-removed"
  | "capability-undocumented"
  | "environment-out-of-scope"
  | "mutation-unclassified"
  | "policy-capability-uncovered"
  | "policy-coverage-invalidated"
  | "scenario-precondition-not-met"
  | "scenario-skipped"
  | "scenario-unsupported"
  | "scenarios-rerun-required";

export type CapabilityDiffFinding = Readonly<{ code: FindingCode; toolName: string }>;

export type CapabilityDiff = Readonly<{
  addedTools: readonly string[];
  affectedActionFamilies: readonly FinancialActionFamily[];
  baselineSnapshotSha256: string;
  blockedToolNames: readonly string[];
  changedTools: readonly CapabilityChange[];
  currentSnapshotSha256: string;
  diffSha256: string;
  findings: readonly CapabilityDiffFinding[];
  removedTools: readonly string[];
  schemaVersion: "runbook.capability-diff.v0";
  unchangedTools: readonly string[];
  unknownMutationTools: readonly string[];
}>;

export type ScenarioId =
  | "scenario-01-wrong-account"
  | "scenario-04-undocumented-tool"
  | "scenario-05-mutation-capability-drift"
  | "scenario-06-incompatible-schema-drift";
export type ScenarioMode = "evaluate" | "skip" | "unsupported";
export type ScenarioStatus = "pass" | "fail" | "not-evaluable" | "skipped" | "unsupported";

type ScenarioBase = Readonly<{
  expectedFindingCodes: readonly FindingCode[];
  mode: ScenarioMode;
  schemaVersion: "runbook.financial-bench-scenario.v0";
}>;

export type WrongAccountScenarioDefinition = ScenarioBase & Readonly<{
  action: NormalizedFinancialAction;
  constitution: CapitalConstitution;
  kind: "wrong-account";
  scenarioId: "scenario-01-wrong-account";
}>;
export type UndocumentedToolScenarioDefinition = ScenarioBase & Readonly<{
  action: NormalizedFinancialAction;
  constitution: CapitalConstitution;
  currentSnapshot: CapabilitySnapshot;
  kind: "undocumented-tool";
  scenarioId: "scenario-04-undocumented-tool";
}>;
export type MutationCapabilityDriftScenarioDefinition = ScenarioBase & Readonly<{
  baselineSnapshot: CapabilitySnapshot;
  constitution: CapitalConstitution;
  currentSnapshot: CapabilitySnapshot;
  kind: "mutation-capability-drift";
  scenarioId: "scenario-05-mutation-capability-drift";
  toolName: string;
}>;
export type IncompatibleSchemaDriftScenarioDefinition = ScenarioBase & Readonly<{
  baselineSnapshot: CapabilitySnapshot;
  constitution: CapitalConstitution;
  currentSnapshot: CapabilitySnapshot;
  kind: "incompatible-schema-drift";
  scenarioId: "scenario-06-incompatible-schema-drift";
  toolName: string;
}>;
export type ScenarioDefinition =
  | WrongAccountScenarioDefinition
  | UndocumentedToolScenarioDefinition
  | MutationCapabilityDriftScenarioDefinition
  | IncompatibleSchemaDriftScenarioDefinition;

export type ScenarioResult = Readonly<{
  actionSha256: string | null;
  baselineSnapshotSha256: string | null;
  constitutionSha256: string;
  currentSnapshotSha256: string | null;
  findingCodes: readonly FindingCode[];
  scenarioDefinitionSha256: string;
  scenarioId: ScenarioId;
  status: ScenarioStatus;
}>;

export type BenchCoverage = Readonly<{
  class: "caller-selected" | "frozen-synthetic-v0-complete";
  corpusManifestSha256: string | null;
  requiredScenarioIds: readonly ScenarioId[];
}>;

export type BenchRunReceipt = Readonly<{
  analysisComplete: true;
  counts: Readonly<Record<ScenarioStatus, number>>;
  coverage: BenchCoverage;
  limitations: readonly [
    "synthetic-inputs-only",
    "receipt-does-not-prove-live-capabilities-execution-performance-safety-suitability-or-compliance",
    "capability-snapshots-are-source-reported-and-may-be-incomplete",
    "scenario-pass-means-the-modeled-control-produced-the-frozen-expected-findings",
    "receipt-is-unsigned-local-analysis",
    "analysis-complete-means-every-supplied-scenario-was-processed-not-full-corpus-coverage"
  ];
  profileVersion: "runbook.synthetic-financial-agent-safety.v0";
  resultSetSha256: string;
  results: readonly ScenarioResult[];
  runFingerprintSha256: string;
  schemaVersion: "runbook.financial-bench-receipt.v0";
}>;

export type FinancialBenchCorpusManifest = Readonly<{
  corpusId: "runbook.synthetic-financial-agent-safety.v0";
  corpusSha256: string;
  profileVersion: "runbook.synthetic-financial-agent-safety.v0";
  scenarioDefinitions: readonly Readonly<{ scenarioDefinitionSha256: string; scenarioId: ScenarioId }>[];
  schemaVersion: "runbook.financial-bench-corpus-manifest.v0";
}>;
