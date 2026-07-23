/**
 * Multi-charter tournament — Pareto search over process charters.
 *
 * Axes: hardFalseAllows (primary minimize), hardFalseDenies (secondary minimize).
 * Pure deterministic rules. No network, no capital, no composite score.
 */

import type { RiskPolicy } from "@runbook/engine/schema";
import { riskPolicySchema } from "@runbook/engine/schema";
import {
  PRODUCT_SURFACE,
  REFERENCE_ELITE_POLICY,
  WEAK_STARTER_POLICY,
} from "./curriculum.js";
import { evaluateCharter } from "./evaluate-charter.js";
import { runRecursiveImprovement } from "./refine.js";

export const TOURNAMENT_SCHEMA_VERSION = "runbook.shadow-tournament.v1" as const;

export type TournamentSeedKind = "weak-starter" | "reference-elite" | "mutant";

export type TournamentLineage = {
  seedId: string;
  seedKind: TournamentSeedKind;
  mutantIndex?: number;
  maxGenerations: number;
  generationCount: number;
  terminatedReason: "fixed-point" | "max-generations";
};

export type TournamentCandidate = {
  id: string;
  seedKind: TournamentSeedKind;
  lineage: TournamentLineage;
  initialPolicy: RiskPolicy;
  finalPolicy: RiskPolicy;
  hardFalseAllows: number;
  hardFalseDenies: number;
  /** True when both hard false axes are zero after improvement. */
  processCorrect: boolean;
  initialHardFalseAllows: number;
  initialHardFalseDenies: number;
  onParetoFront: boolean;
};

export type ShadowTournamentReport = {
  schemaVersion: typeof TOURNAMENT_SCHEMA_VERSION;
  productSurface: typeof PRODUCT_SURFACE;
  purpose: "charter-process-quality";
  /** Always 0 — tournament never moves capital. */
  capital: 0;
  brokerEffect: false;
  compositeScore: false;
  notTradingPerformance: true;
  enforcement: "advisory";
  assurance: "synthetic-curriculum-process-quality-only";
  maxGenerations: number;
  mutantCount: number;
  /** Deterministic mutant seed (no Math.random). */
  seed: number;
  candidateCount: number;
  candidates: TournamentCandidate[];
  paretoFront: TournamentCandidate[];
  paretoCount: number;
  note: string;
};

export type RunShadowTournamentOptions = {
  /** Generations of recursive improvement per seed (default 4). */
  maxGenerations?: number;
  /** Number of deterministic policy mutants (default 6). */
  mutantCount?: number;
  /** Deterministic seed mixed into mutant generation (default 1). */
  seed?: number;
};

const INSTRUMENT_SETS: ReadonlyArray<ReadonlyArray<"equity" | "option" | "crypto">> = [
  ["equity"],
  ["equity", "option"],
  ["equity", "crypto"],
  ["equity", "option", "crypto"],
  ["option", "crypto"],
  ["crypto"],
];

const ALLOWLIST_SETS: ReadonlyArray<readonly string[]> = [
  [],
  ["VTI"],
  ["VTI", "BND"],
  ["VTI", "BND", "VXUS"],
  ["SPY"],
  ["VTI", "SPY"],
  ["BND", "VXUS"],
];

const DENYLIST_SETS: ReadonlyArray<readonly string[]> = [
  [],
  ["GME"],
  ["AMC"],
  ["GME", "AMC"],
  ["GME", "AMC", "VTI"],
  ["XYZ"],
];

/**
 * Mulberry32-style deterministic u32 step — no Math.random.
 * Returns integers in [0, 2^32).
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function pick<T>(items: readonly T[], next: () => number): T {
  const index = next() % items.length;
  const value = items[index];
  if (value === undefined) {
    throw new Error("pick: empty collection");
  }
  return value;
}

/**
 * Build a valid RiskPolicy mutant from (seed, mutantIndex).
 * Varies caps, instruments, denylists, allowlists, and approvalRequired.
 */
export function buildDeterministicMutant(seed: number, mutantIndex: number): RiskPolicy {
  if (!Number.isInteger(mutantIndex) || mutantIndex < 0) {
    throw new Error("mutantIndex must be an integer >= 0");
  }
  const next = mulberry32((seed >>> 0) ^ Math.imul(mutantIndex + 1, 0x9e3779b9));

  const capitalBudget = 500 + (next() % 50) * 100; // 500..5400 step 100
  const cashReserve = Math.min(
    capitalBudget - 50,
    50 + (next() % 20) * 25, // 50..525
  );
  const deployable = capitalBudget - cashReserve;
  const maxOrderNotional = Math.max(1, Math.min(deployable, 25 + (next() % 40) * 25)); // 25..1000-ish
  const maxPositionPercent = 5 + (next() % 19) * 5; // 5..95
  const maxDrawdownPercent = 4 + (next() % 20) * 2; // 4..42
  const maxDailyTrades = 1 + (next() % 30); // 1..30
  const instruments = [...pick(INSTRUMENT_SETS, next)];
  let allowedSymbols = [...pick(ALLOWLIST_SETS, next)];
  let deniedSymbols = [...pick(DENYLIST_SETS, next)];
  const approvalRequired = next() % 2 === 0;

  // Ensure no symbol is both allowed and denied.
  const denied = new Set(deniedSymbols.map((symbol) => symbol.toUpperCase()));
  allowedSymbols = allowedSymbols
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => !denied.has(symbol));
  deniedSymbols = [...denied].sort();
  allowedSymbols = [...new Set(allowedSymbols)].sort();

  return riskPolicySchema.parse({
    capitalBudget,
    cashReserve,
    maxPositionPercent,
    maxOrderNotional,
    maxDrawdownPercent,
    maxDailyTrades,
    allowedInstruments: instruments,
    allowedSymbols,
    deniedSymbols,
    approvalRequired,
  });
}

/** Build the tournament seed set: weak starter, reference elite, N mutants. */
export function buildTournamentSeeds(
  mutantCount: number,
  seed: number,
): Array<{ id: string; seedKind: TournamentSeedKind; mutantIndex?: number; policy: RiskPolicy }> {
  if (!Number.isInteger(mutantCount) || mutantCount < 0) {
    throw new Error("mutantCount must be an integer >= 0");
  }
  const seeds: Array<{
    id: string;
    seedKind: TournamentSeedKind;
    mutantIndex?: number;
    policy: RiskPolicy;
  }> = [
    {
      id: "seed-weak-starter",
      seedKind: "weak-starter",
      policy: riskPolicySchema.parse(WEAK_STARTER_POLICY),
    },
    {
      id: "seed-reference-elite",
      seedKind: "reference-elite",
      policy: riskPolicySchema.parse(REFERENCE_ELITE_POLICY),
    },
  ];

  for (let i = 0; i < mutantCount; i += 1) {
    seeds.push({
      id: `seed-mutant-${i}`,
      seedKind: "mutant",
      mutantIndex: i,
      policy: buildDeterministicMutant(seed, i),
    });
  }
  return seeds;
}

/**
 * True Pareto domination on (hardFalseAllows, hardFalseDenies):
 * A dominates B iff hfaA <= hfaB and hfdA <= hfdB and at least one inequality is strict.
 */
export function dominates(
  a: { hardFalseAllows: number; hardFalseDenies: number },
  b: { hardFalseAllows: number; hardFalseDenies: number },
): boolean {
  const leq = a.hardFalseAllows <= b.hardFalseAllows && a.hardFalseDenies <= b.hardFalseDenies;
  const strict = a.hardFalseAllows < b.hardFalseAllows || a.hardFalseDenies < b.hardFalseDenies;
  return leq && strict;
}

/** Candidates not dominated by any other (minimize both axes). */
export function computeParetoFront<
  T extends { hardFalseAllows: number; hardFalseDenies: number },
>(candidates: readonly T[]): T[] {
  return candidates.filter(
    (candidate, index) =>
      !candidates.some(
        (other, otherIndex) => otherIndex !== index && dominates(other, candidate),
      ),
  );
}

/**
 * Multi-charter tournament: evaluate + recursively improve each seed, then
 * return the Pareto front on hardFalseAllows vs hardFalseDenies.
 *
 * Explicitly not trading performance. compositeScore is always false.
 * capital is always 0. brokerEffect is always false.
 */
export function runShadowTournament(
  options: RunShadowTournamentOptions = {},
): ShadowTournamentReport {
  const maxGenerations = options.maxGenerations ?? 4;
  const mutantCount = options.mutantCount ?? 6;
  const seed = options.seed ?? 1;

  if (!Number.isInteger(maxGenerations) || maxGenerations < 1) {
    throw new Error("maxGenerations must be an integer >= 1");
  }
  if (!Number.isInteger(mutantCount) || mutantCount < 0) {
    throw new Error("mutantCount must be an integer >= 0");
  }
  if (!Number.isInteger(seed)) {
    throw new Error("seed must be an integer");
  }

  const seeds = buildTournamentSeeds(mutantCount, seed);
  const candidates: TournamentCandidate[] = [];

  for (const seedEntry of seeds) {
    const initialReport = evaluateCharter(seedEntry.policy);
    const improve = runRecursiveImprovement(seedEntry.policy, maxGenerations);
    const finalMetrics = improve.finalMetrics;
    const processCorrect =
      finalMetrics.hardFalseAllows === 0 && finalMetrics.hardFalseDenies === 0;

    const lineage: TournamentLineage = {
      seedId: seedEntry.id,
      seedKind: seedEntry.seedKind,
      ...(seedEntry.mutantIndex !== undefined ? { mutantIndex: seedEntry.mutantIndex } : {}),
      maxGenerations: improve.maxGenerations,
      generationCount: improve.generationCount,
      terminatedReason: improve.terminatedReason,
    };

    candidates.push({
      id: `candidate-${seedEntry.id}`,
      seedKind: seedEntry.seedKind,
      lineage,
      initialPolicy: improve.initialPolicy,
      finalPolicy: improve.finalPolicy,
      hardFalseAllows: finalMetrics.hardFalseAllows,
      hardFalseDenies: finalMetrics.hardFalseDenies,
      processCorrect,
      initialHardFalseAllows: initialReport.metrics.hardFalseAllows,
      initialHardFalseDenies: initialReport.metrics.hardFalseDenies,
      onParetoFront: false,
    });
  }

  const front = computeParetoFront(candidates);
  const frontIds = new Set(front.map((candidate) => candidate.id));
  for (const candidate of candidates) {
    candidate.onParetoFront = frontIds.has(candidate.id);
  }

  // Stable sort: HFA asc, then HFD asc, then id.
  const sortAxes = (a: TournamentCandidate, b: TournamentCandidate) => {
    if (a.hardFalseAllows !== b.hardFalseAllows) {
      return a.hardFalseAllows - b.hardFalseAllows;
    }
    if (a.hardFalseDenies !== b.hardFalseDenies) {
      return a.hardFalseDenies - b.hardFalseDenies;
    }
    return a.id.localeCompare(b.id);
  };
  candidates.sort(sortAxes);
  const paretoFront = candidates.filter((candidate) => candidate.onParetoFront);

  return {
    schemaVersion: TOURNAMENT_SCHEMA_VERSION,
    productSurface: PRODUCT_SURFACE,
    purpose: "charter-process-quality",
    capital: 0,
    brokerEffect: false,
    compositeScore: false,
    notTradingPerformance: true,
    enforcement: "advisory",
    assurance: "synthetic-curriculum-process-quality-only",
    maxGenerations,
    mutantCount,
    seed,
    candidateCount: candidates.length,
    candidates,
    paretoFront,
    paretoCount: paretoFront.length,
    note:
      "Multi-charter Shadow Process Laboratory tournament. Pareto front minimizes " +
      "hardFalseAllows then hardFalseDenies (true non-domination). Not trading performance, " +
      "not capital allocation, no composite score. capital 0, brokerEffect false.",
  };
}
