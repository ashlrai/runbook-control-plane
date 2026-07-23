/**
 * Browser adapter for the `/shadow-lab` UI.
 *
 * Authority: `@runbook/shadow-lab` is the single source of truth for curriculum,
 * evaluate, refine, recursive improve, tournament, and meta-curriculum.
 * This module only maps package APIs into UI-friendly shapes
 * (tickets, generation history, export report, tournament view, meta merge).
 *
 * Improves process-control quality under a synthetic curriculum only.
 * Not investment skill. Advisory. No capital. No broker. No credentials.
 */

import { evaluateProposal, type PreflightResult } from "@runbook/engine/policy";
import type { RiskPolicy } from "@runbook/engine/schema";
import {
  META_CURRICULUM_LIMITATIONS,
  REFERENCE_ELITE_POLICY,
  SHADOW_CURRICULUM,
  TOURNAMENT_SCHEMA_VERSION,
  WEAK_STARTER_POLICY,
  evaluateCharter,
  evaluateCharterAgainstScenarios,
  extractCurriculumCandidatesFromEvents,
  mergeCurriculum,
  proposeRefinement,
  runRecursiveImprovement,
  runShadowTournament,
  type CurriculumCandidate,
  type CurriculumScenario as PackageCurriculumScenario,
  type MergedCurriculumScenario,
  type MinimalLedgerEvent,
  type PolicyDelta,
  type RunShadowTournamentOptions,
  type ShadowCurriculumMetrics,
  type ShadowTournamentReport,
  type TournamentCandidate,
  type TournamentSeedKind,
} from "@runbook/shadow-lab";

export type CurriculumScenario = PackageCurriculumScenario & {
  /** Short UI-facing process-truth blurb derived from package scenario fields. */
  rationale: string;
};

export type ScenarioVerdict = "process-correct" | "false-allow" | "false-deny";

export type ScenarioEvaluation = {
  scenario: CurriculumScenario;
  result: PreflightResult;
  verdict: ScenarioVerdict;
};

export type CurriculumMetrics = {
  scenarioCount: number;
  processCorrect: number;
  hardFalseAllows: number;
  hardFalseDenies: number;
};

export type PolicyFieldDelta = {
  field: keyof RiskPolicy;
  before: unknown;
  after: unknown;
};

export type RefineStep = {
  policy: RiskPolicy;
  appliedRules: readonly string[];
  delta: readonly PolicyFieldDelta[];
  fixedPoint: boolean;
};

export type GenerationRecord = {
  generation: number;
  policy: RiskPolicy;
  metrics: CurriculumMetrics;
  appliedRules: readonly string[];
  delta: readonly PolicyFieldDelta[];
  stoppedReason?: "fixed-point" | "curriculum-clean" | "max-generations" | "seed";
};

export type ShadowLabReport = {
  schemaVersion: "runbook.shadow-lab-report.v1";
  generatedAt: string;
  disclosures: readonly string[];
  eliteReferencePolicy: RiskPolicy;
  seedPolicy: RiskPolicy;
  finalPolicy: RiskPolicy;
  generationHistory: readonly GenerationRecord[];
  finalMetrics: CurriculumMetrics;
};

/** Elite equity-only reference charter (package authority). */
export const ELITE_EQUITY_CHARTER: RiskPolicy = REFERENCE_ELITE_POLICY;

/** Intentionally weak seed so refinement theater has work to do (package authority). */
export const SEED_LAB_POLICY: RiskPolicy = WEAK_STARTER_POLICY;

function scenarioRationale(scenario: PackageCurriculumScenario): string {
  if (scenario.shouldAllow) {
    return "Author-declared process truth: elite equity charter should allow under these tags.";
  }
  return `Author-declared process truth: elite equity charter should hard-deny (${scenario.tags.join(", ")}).`;
}

/** Fixed synthetic curriculum from `@runbook/shadow-lab` — shouldAllow is author-declared process truth. */
export const CURRICULUM_SCENARIOS: readonly CurriculumScenario[] = SHADOW_CURRICULUM.map(
  (scenario) => ({
    ...scenario,
    rationale: scenarioRationale(scenario),
  }),
);

export function clonePolicy(policy: RiskPolicy): RiskPolicy {
  return {
    ...policy,
    allowedInstruments: [...policy.allowedInstruments],
    allowedSymbols: [...policy.allowedSymbols],
    deniedSymbols: [...policy.deniedSymbols],
  };
}

export function policiesEqual(a: RiskPolicy, b: RiskPolicy): boolean {
  return (
    a.capitalBudget === b.capitalBudget &&
    a.cashReserve === b.cashReserve &&
    a.maxPositionPercent === b.maxPositionPercent &&
    a.maxOrderNotional === b.maxOrderNotional &&
    a.maxDrawdownPercent === b.maxDrawdownPercent &&
    a.maxDailyTrades === b.maxDailyTrades &&
    a.approvalRequired === b.approvalRequired &&
    sameStringSet(a.allowedInstruments, b.allowedInstruments) &&
    sameStringSet(
      a.allowedSymbols.map((s) => s.toUpperCase()),
      b.allowedSymbols.map((s) => s.toUpperCase()),
    ) &&
    sameStringSet(
      a.deniedSymbols.map((s) => s.toUpperCase()),
      b.deniedSymbols.map((s) => s.toUpperCase()),
    )
  );
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map((s) => s.toUpperCase()).sort();
  const right = [...b].map((s) => s.toUpperCase()).sort();
  return left.every((value, index) => value === right[index]);
}

export function classifyVerdict(shouldAllow: boolean, allowed: boolean): ScenarioVerdict {
  if (shouldAllow === allowed) return "process-correct";
  return allowed ? "false-allow" : "false-deny";
}

function toUiMetrics(metrics: ShadowCurriculumMetrics): CurriculumMetrics {
  return {
    scenarioCount: metrics.scenarioCount,
    processCorrect: metrics.trueAllows + metrics.trueDenies,
    hardFalseAllows: metrics.hardFalseAllows,
    hardFalseDenies: metrics.hardFalseDenies,
  };
}

function toUiDelta(deltas: readonly PolicyDelta[]): PolicyFieldDelta[] {
  return deltas.map((delta) => ({
    field: delta.field,
    before: delta.before,
    after: delta.after,
  }));
}

/**
 * Evaluate working policy against the package curriculum.
 * Metrics come from `evaluateCharter`; per-scenario tickets use real `evaluateProposal`.
 */
export function evaluateCurriculum(
  policy: RiskPolicy,
  scenarios: readonly CurriculumScenario[] = CURRICULUM_SCENARIOS,
): { results: ScenarioEvaluation[]; metrics: CurriculumMetrics } {
  // Full curriculum path always uses package authority (ignore custom lists for metrics).
  const report = evaluateCharter(policy);
  const metrics = toUiMetrics(report.metrics);

  const byId = new Map(report.scenarios.map((row) => [row.id, row]));
  const results: ScenarioEvaluation[] = scenarios.map((scenario) => {
    const result = evaluateProposal(policy, scenario.proposal);
    const packaged = byId.get(scenario.id);
    const verdict: ScenarioVerdict = packaged
      ? packaged.hardFalseAllow
        ? "false-allow"
        : packaged.hardFalseDeny
          ? "false-deny"
          : "process-correct"
      : classifyVerdict(scenario.shouldAllow, result.allowed);
    return { scenario, result, verdict };
  });

  return { results, metrics };
}

export function diffPolicy(before: RiskPolicy, after: RiskPolicy): PolicyFieldDelta[] {
  const fields: (keyof RiskPolicy)[] = [
    "capitalBudget",
    "cashReserve",
    "maxPositionPercent",
    "maxOrderNotional",
    "maxDrawdownPercent",
    "maxDailyTrades",
    "allowedInstruments",
    "allowedSymbols",
    "deniedSymbols",
    "approvalRequired",
  ];

  const deltas: PolicyFieldDelta[] = [];
  for (const field of fields) {
    const left = before[field];
    const right = after[field];
    const equal =
      Array.isArray(left) && Array.isArray(right)
        ? sameStringSet(left as string[], right as string[])
        : left === right;
    if (!equal) {
      deltas.push({ field, before: left, after: right });
    }
  }
  return deltas;
}

/** One deterministic refine generation via package `proposeRefinement`. */
export function refinePolicy(policy: RiskPolicy): RefineStep {
  const generation = proposeRefinement(policy);
  return {
    policy: clonePolicy(generation.policyAfter),
    appliedRules: generation.rationaleCodes,
    delta: toUiDelta(generation.deltas),
    fixedPoint: generation.fixedPoint,
  };
}

/**
 * Generation history for the UI theater.
 * - untilFixedPoint: package `runRecursiveImprovement`
 * - single step: one `proposeRefinement`
 * Seed-clean short-circuits without calling refine.
 */
export function runRefinementLoop(options: {
  seed?: RiskPolicy;
  maxGenerations?: number;
  untilFixedPoint?: boolean;
}): GenerationRecord[] {
  const seed = clonePolicy(options.seed ?? SEED_LAB_POLICY);
  const maxGenerations = Math.min(8, Math.max(1, options.maxGenerations ?? 4));
  const untilFixedPoint = options.untilFixedPoint ?? false;

  const history: GenerationRecord[] = [];
  const seedEval = evaluateCurriculum(seed);
  history.push({
    generation: 0,
    policy: clonePolicy(seed),
    metrics: seedEval.metrics,
    appliedRules: [],
    delta: [],
    stoppedReason: "seed",
  });

  if (
    seedEval.metrics.hardFalseAllows === 0 &&
    seedEval.metrics.hardFalseDenies === 0
  ) {
    history[0] = { ...history[0]!, stoppedReason: "curriculum-clean" };
    return history;
  }

  if (!untilFixedPoint) {
    const step = proposeRefinement(seed, 1);
    if (step.fixedPoint || step.deltas.length === 0) {
      history[0] = { ...history[0]!, stoppedReason: "fixed-point" };
      return history;
    }
    const metrics = toUiMetrics(step.metricsAfter);
    history.push({
      generation: 1,
      policy: clonePolicy(step.policyAfter),
      metrics,
      appliedRules: step.rationaleCodes,
      delta: toUiDelta(step.deltas),
      stoppedReason:
        metrics.hardFalseAllows === 0 && metrics.hardFalseDenies === 0
          ? "curriculum-clean"
          : undefined,
    });
    return history;
  }

  const recursive = runRecursiveImprovement(seed, maxGenerations);
  for (const gen of recursive.generations) {
    if (gen.fixedPoint || gen.deltas.length === 0) {
      history[history.length - 1] = {
        ...history[history.length - 1]!,
        stoppedReason:
          history[history.length - 1]!.metrics.hardFalseAllows === 0 &&
          history[history.length - 1]!.metrics.hardFalseDenies === 0
            ? "curriculum-clean"
            : "fixed-point",
      };
      break;
    }

    const metrics = toUiMetrics(gen.metricsAfter);
    const record: GenerationRecord = {
      generation: gen.generation,
      policy: clonePolicy(gen.policyAfter),
      metrics,
      appliedRules: gen.rationaleCodes,
      delta: toUiDelta(gen.deltas),
    };

    if (metrics.hardFalseAllows === 0 && metrics.hardFalseDenies === 0) {
      record.stoppedReason = "curriculum-clean";
      history.push(record);
      // Package may still emit a subsequent fixed-point gen; we stop for UI.
      break;
    }

    history.push(record);
  }

  const final = history[history.length - 1]!;
  if (
    !final.stoppedReason &&
    recursive.terminatedReason === "max-generations" &&
    final.generation > 0
  ) {
    history[history.length - 1] = { ...final, stoppedReason: "max-generations" };
  }

  return history;
}

export function buildExportReport(history: readonly GenerationRecord[]): ShadowLabReport {
  const final = history[history.length - 1] ?? {
    generation: 0,
    policy: SEED_LAB_POLICY,
    metrics: evaluateCurriculum(SEED_LAB_POLICY).metrics,
    appliedRules: [],
    delta: [],
  };

  return {
    schemaVersion: "runbook.shadow-lab-report.v1",
    generatedAt: new Date().toISOString(),
    disclosures: [
      "Improves process control quality under a synthetic curriculum — not investment skill.",
      "Advisory only. No capital. No broker. No credentials. No Robinhood network.",
      "hardFalseAllows / hardFalseDenies are curriculum disagreement counts, not a safety score.",
      "No composite processScore and no return % are part of this report.",
      "Curriculum, evaluate, and refine authority: @runbook/shadow-lab.",
    ],
    eliteReferencePolicy: clonePolicy(ELITE_EQUITY_CHARTER),
    seedPolicy: clonePolicy(history[0]?.policy ?? SEED_LAB_POLICY),
    finalPolicy: clonePolicy(final.policy),
    generationHistory: history.map((row) => ({
      ...row,
      policy: clonePolicy(row.policy),
      appliedRules: [...row.appliedRules],
      delta: row.delta.map((d) => ({ ...d })),
    })),
    finalMetrics: final.metrics,
  };
}

export function policyJsonForMcp(policy: RiskPolicy): string {
  return `${JSON.stringify(clonePolicy(policy), null, 2)}\n`;
}

// ── Tournament surface ──────────────────────────────────────────────────────

export type TournamentUiCandidate = {
  id: string;
  seedKind: TournamentSeedKind;
  hardFalseAllows: number;
  hardFalseDenies: number;
  processCorrect: boolean;
  onParetoFront: boolean;
  generationCount: number;
  initialHardFalseAllows: number;
  initialHardFalseDenies: number;
  finalPolicy: RiskPolicy;
};

export type TournamentUiReport = {
  schemaVersion: typeof TOURNAMENT_SCHEMA_VERSION;
  maxGenerations: number;
  mutantCount: number;
  seed: number;
  candidateCount: number;
  paretoCount: number;
  capital: 0;
  brokerEffect: false;
  compositeScore: false;
  notTradingPerformance: true;
  candidates: TournamentUiCandidate[];
  paretoFront: TournamentUiCandidate[];
  note: string;
};

export type RunTournamentOptions = {
  maxGenerations?: number;
  mutantCount?: number;
  seed?: number;
};

function toUiCandidate(candidate: TournamentCandidate): TournamentUiCandidate {
  return {
    id: candidate.id,
    seedKind: candidate.seedKind,
    hardFalseAllows: candidate.hardFalseAllows,
    hardFalseDenies: candidate.hardFalseDenies,
    processCorrect: candidate.processCorrect,
    onParetoFront: candidate.onParetoFront,
    generationCount: candidate.lineage.generationCount,
    initialHardFalseAllows: candidate.initialHardFalseAllows,
    initialHardFalseDenies: candidate.initialHardFalseDenies,
    finalPolicy: clonePolicy(candidate.finalPolicy),
  };
}

/**
 * Multi-charter tournament via package `runShadowTournament`.
 * Pareto front on (hardFalseAllows, hardFalseDenies). compositeScore always false.
 * capital always 0. Not trading performance.
 */
export function runTournament(options: RunTournamentOptions = {}): TournamentUiReport {
  const maxGenerations = Math.min(8, Math.max(1, options.maxGenerations ?? 4));
  const mutantCount = Math.min(12, Math.max(0, options.mutantCount ?? 4));
  const seed = Number.isInteger(options.seed) ? (options.seed as number) : 1;

  const packageOptions: RunShadowTournamentOptions = {
    maxGenerations,
    mutantCount,
    seed,
  };
  const report: ShadowTournamentReport = runShadowTournament(packageOptions);
  const candidates = report.candidates.map(toUiCandidate);
  const paretoFront = candidates.filter((c) => c.onParetoFront);

  return {
    schemaVersion: report.schemaVersion,
    maxGenerations: report.maxGenerations,
    mutantCount: report.mutantCount,
    seed: report.seed,
    candidateCount: report.candidateCount,
    paretoCount: report.paretoCount,
    capital: 0,
    brokerEffect: false,
    compositeScore: false,
    notTradingPerformance: true,
    candidates,
    paretoFront,
    note: report.note,
  };
}

/** Apply a tournament candidate's final policy into lab seed-history shape. */
export function adoptTournamentPolicy(candidate: TournamentUiCandidate): {
  policy: RiskPolicy;
  history: GenerationRecord[];
} {
  const policy = clonePolicy(candidate.finalPolicy);
  return { policy, history: seedHistoryForPolicy(policy) };
}

function seedHistoryForPolicy(policy: RiskPolicy): GenerationRecord[] {
  const { metrics } = evaluateCurriculum(policy);
  return [
    {
      generation: 0,
      policy: clonePolicy(policy),
      metrics,
      appliedRules: [],
      delta: [],
      stoppedReason:
        metrics.hardFalseAllows === 0 && metrics.hardFalseDenies === 0
          ? "curriculum-clean"
          : "seed",
    },
  ];
}

// ── Meta-curriculum surface ─────────────────────────────────────────────────

export type MetaCurriculumCandidateView = {
  id: string;
  label: string;
  tags: readonly string[];
  shouldAllow: boolean;
  source: "ledger-derived";
  derivedFromProposalId: string;
  failedHardCheckIds: readonly string[];
  symbol: string;
  instrument: string;
};

export type MetaCurriculumMergeView = {
  candidateCount: number;
  ledgerDerivedInMerged: number;
  syntheticClosedInMerged: number;
  mergedCount: number;
  tags: readonly string[];
  candidates: MetaCurriculumCandidateView[];
  sampleScenarios: ReadonlyArray<{
    id: string;
    label: string;
    tags: readonly string[];
    source: "synthetic-closed" | "ledger-derived";
    shouldAllow: boolean;
  }>;
  limitations: readonly string[];
  ledgerMutated: false;
  assurance: "ledger-derived-synthetic-process-labels-only";
};

export type MetaCurriculumEvalMetrics = CurriculumMetrics & {
  note: string;
  scenarioCount: number;
};

/**
 * Sample ledger-like events: proposal + hard-deny preflight pairs for the
 * offline meta-curriculum demo. No credentials, no broker payloads.
 *
 * Package source of truth (byte twin for first-run fixtures):
 *   packages/mcp/examples/sample-ledger-events.json
 * The Shadow Lab "Load sample fixture" button uses this constant; tests assert
 * deep equality against the package JSON so the button always tracks the fixture.
 *
 * Sample proposal+preflight pairs intentionally use symbols / notional buckets
 * that do not fingerprint-collide with the closed synthetic curriculum, so
 * extract→merge surfaces ledger-derived rows in the demo.
 */
export const SAMPLE_META_LEDGER_EVENTS: readonly MinimalLedgerEvent[] = [
  {
    type: "charter.activated",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      version: "1.0",
      policy: {
        ...clonePolicy(REFERENCE_ELITE_POLICY),
        // Extra denylist entry so the BBBY sample is charter-denied.
        deniedSymbols: [...REFERENCE_ELITE_POLICY.deniedSymbols, "BBBY"],
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-bbby-deny",
      experimentId: "RUN-META-SAMPLE",
      symbol: "BBBY",
      instrument: "equity",
      side: "buy",
      notional: 75,
      projectedPositionNotional: 75,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-bbby-deny",
      result: {
        allowed: false,
        enforcement: "advisory",
        checks: [
          {
            id: "symbol.not-denied",
            passed: false,
            severity: "hard",
            label: "symbol.not-denied",
            detail: "BBBY is denied",
          },
          {
            id: "instrument.allowed",
            passed: true,
            severity: "hard",
            label: "instrument.allowed",
            detail: "ok",
          },
        ],
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-qqq-opt-deny",
      experimentId: "RUN-META-SAMPLE",
      symbol: "QQQ",
      instrument: "option",
      side: "buy",
      notional: 80,
      projectedPositionNotional: 80,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-qqq-opt-deny",
      result: {
        allowed: false,
        enforcement: "advisory",
        checks: [
          {
            id: "instrument.allowed",
            passed: false,
            severity: "hard",
            label: "instrument.allowed",
            detail: "option blocked",
          },
        ],
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-oversize-vxus",
      experimentId: "RUN-META-SAMPLE",
      symbol: "VXUS",
      instrument: "equity",
      side: "buy",
      notional: 750,
      projectedPositionNotional: 750,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-oversize-vxus",
      result: {
        allowed: false,
        enforcement: "advisory",
        checks: [
          {
            id: "order.notional",
            passed: false,
            severity: "hard",
            label: "order.notional",
            detail: "oversize",
          },
        ],
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-clean-vti",
      experimentId: "RUN-META-SAMPLE",
      symbol: "VTI",
      instrument: "equity",
      side: "buy",
      notional: 50,
      projectedPositionNotional: 50,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: "RUN-META-SAMPLE",
    payload: {
      proposalId: "sample-clean-vti",
      result: {
        allowed: true,
        enforcement: "advisory",
        checks: [
          {
            id: "symbol.not-denied",
            passed: true,
            severity: "hard",
            label: "symbol.not-denied",
            detail: "ok",
          },
          {
            id: "instrument.allowed",
            passed: true,
            severity: "hard",
            label: "instrument.allowed",
            detail: "ok",
          },
        ],
      },
    },
  },
];

export function sampleMetaLedgerJson(): string {
  return `${JSON.stringify(SAMPLE_META_LEDGER_EVENTS, null, 2)}\n`;
}

/**
 * Parse pasted ledger-like JSON into MinimalLedgerEvent[].
 * Accepts a bare array or `{ events: [...] }`. Throws on invalid JSON/shape.
 */
export function parseLedgerEventsJson(raw: string): MinimalLedgerEvent[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Paste ledger-like JSON events, or load the sample fixture.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("Invalid JSON — expected an array of ledger events.");
  }

  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed !== null &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { events?: unknown }).events)
      ? ((parsed as { events: unknown[] }).events)
      : [];

  if (list.length === 0) {
    throw new Error("No events found — provide an array or { events: [...] }.");
  }

  const events: MinimalLedgerEvent[] = [];
  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each event must be an object with type and payload.");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.type !== "string" || record.type.length === 0) {
      throw new Error("Each event requires a non-empty string type.");
    }
    const payload =
      record.payload !== null &&
      typeof record.payload === "object" &&
      !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : {};
    events.push({
      type: record.type,
      payload,
      ...(typeof record.experimentId === "string"
        ? { experimentId: record.experimentId }
        : {}),
      ...(typeof record.occurredAt === "string" ? { occurredAt: record.occurredAt } : {}),
    });
  }
  return events;
}

function toCandidateView(candidate: CurriculumCandidate): MetaCurriculumCandidateView {
  return {
    id: candidate.id,
    label: candidate.label,
    tags: [...candidate.tags],
    shouldAllow: candidate.shouldAllow,
    source: "ledger-derived",
    derivedFromProposalId: candidate.derivedFromProposalId,
    failedHardCheckIds: [...candidate.failedHardCheckIds],
    symbol: candidate.proposal.symbol,
    instrument: candidate.proposal.instrument,
  };
}

/**
 * Extract ledger-derived candidates and merge with the closed synthetic curriculum.
 * Does not mutate any ledger. Labels are synthetic process labels only.
 */
export function extractAndMergeMetaCurriculum(
  events: readonly MinimalLedgerEvent[],
): MetaCurriculumMergeView {
  const candidates = extractCurriculumCandidatesFromEvents(events);
  const merged: MergedCurriculumScenario[] = mergeCurriculum(SHADOW_CURRICULUM, candidates);
  const ledgerDerivedInMerged = merged.filter((s) => s.source === "ledger-derived").length;
  const syntheticClosedInMerged = merged.length - ledgerDerivedInMerged;

  const tagSet = new Set<string>();
  for (const candidate of candidates) {
    for (const tag of candidate.tags) tagSet.add(tag);
  }

  // Prefer ledger-derived samples first, then a few closed scenarios.
  const ledgerSamples = merged.filter((s) => s.source === "ledger-derived").slice(0, 6);
  const closedSamples = merged
    .filter((s) => s.source === "synthetic-closed")
    .slice(0, Math.max(0, 6 - ledgerSamples.length));
  const sampleScenarios = [...ledgerSamples, ...closedSamples].map((s) => ({
    id: s.id,
    label: s.label,
    tags: [...s.tags],
    source: s.source,
    shouldAllow: s.shouldAllow,
  }));

  return {
    candidateCount: candidates.length,
    ledgerDerivedInMerged,
    syntheticClosedInMerged,
    mergedCount: merged.length,
    tags: [...tagSet].sort(),
    candidates: candidates.map(toCandidateView),
    sampleScenarios,
    limitations: [...META_CURRICULUM_LIMITATIONS],
    ledgerMutated: false,
    assurance: "ledger-derived-synthetic-process-labels-only",
  };
}

/**
 * Re-evaluate a working policy against the merged (closed + ledger-derived) curriculum.
 * Multi-axis metrics only — never a composite score.
 */
export function evaluatePolicyAgainstMetaCurriculum(
  policy: RiskPolicy,
  events: readonly MinimalLedgerEvent[],
): MetaCurriculumEvalMetrics {
  const candidates = extractCurriculumCandidatesFromEvents(events);
  const merged = mergeCurriculum(SHADOW_CURRICULUM, candidates);
  const scenarios = merged.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    tags: scenario.tags,
    shouldAllow: scenario.shouldAllow,
    proposal: scenario.proposal,
  }));
  const report = evaluateCharterAgainstScenarios(policy, scenarios);
  return {
    ...toUiMetrics(report.metrics),
    note: report.note,
  };
}

export type { MinimalLedgerEvent, TournamentSeedKind };
