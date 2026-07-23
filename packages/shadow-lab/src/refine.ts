import type { RiskPolicy } from "@runbook/engine/schema";
import { riskPolicySchema } from "@runbook/engine/schema";
import {
  PRODUCT_SURFACE,
  REFERENCE_ELITE_POLICY,
  SHADOW_CURRICULUM,
} from "./curriculum.js";
import {
  evaluateCharter,
  type ShadowCurriculumMetrics,
  type ShadowCurriculumReport,
} from "./evaluate-charter.js";

/**
 * Deterministic charter refinement — recursive process self-improvement step.
 * No LLM. No broker. No capital. Always advisory.
 */

export type RationaleCode =
  | "add-denied-symbols"
  | "strip-non-equity-instruments"
  | "reduce-max-order-notional"
  | "reduce-max-position-percent"
  | "ensure-clean-equity-allowlist"
  | "remove-clean-from-denylist"
  | "set-approval-required"
  | "tighten-drawdown-stop"
  | "tighten-daily-trade-cap"
  | "restrict-allowlist-for-unknown-symbols";

export type PolicyDelta = {
  field: keyof RiskPolicy;
  before: unknown;
  after: unknown;
  rationaleCode: RationaleCode;
  detail: string;
};

export type ShadowRefinementGeneration = {
  schemaVersion: "runbook.shadow-refinement-generation.v1";
  productSurface: typeof PRODUCT_SURFACE;
  purpose: "charter-process-quality";
  capital: 0;
  brokerEffect: false;
  enforcement: "advisory";
  assurance: "synthetic-curriculum-process-quality-only";
  generation: number;
  rationaleCodes: RationaleCode[];
  deltas: PolicyDelta[];
  policyBefore: RiskPolicy;
  policyAfter: RiskPolicy;
  metricsBefore: ShadowCurriculumMetrics;
  metricsAfter: ShadowCurriculumMetrics;
  /** True when no deltas were applied (fixed point for this generation). */
  fixedPoint: boolean;
  note: string;
};

export type ShadowRecursiveImprovement = {
  schemaVersion: "runbook.shadow-recursive-improvement.v1";
  productSurface: typeof PRODUCT_SURFACE;
  purpose: "charter-process-quality";
  capital: 0;
  brokerEffect: false;
  enforcement: "advisory";
  assurance: "synthetic-curriculum-process-quality-only";
  maxGenerations: number;
  terminatedReason: "fixed-point" | "max-generations";
  generationCount: number;
  initialPolicy: RiskPolicy;
  finalPolicy: RiskPolicy;
  initialMetrics: ShadowCurriculumMetrics;
  finalMetrics: ShadowCurriculumMetrics;
  generations: ShadowRefinementGeneration[];
  note: string;
};

type MutablePolicy = {
  capitalBudget: number;
  cashReserve: number;
  maxPositionPercent: number;
  maxOrderNotional: number;
  maxDrawdownPercent: number;
  maxDailyTrades: number;
  allowedInstruments: Array<"equity" | "option" | "crypto">;
  allowedSymbols: string[];
  deniedSymbols: string[];
  approvalRequired: boolean;
};

function cloneMutable(policy: RiskPolicy): MutablePolicy {
  return {
    capitalBudget: policy.capitalBudget,
    cashReserve: policy.cashReserve,
    maxPositionPercent: policy.maxPositionPercent,
    maxOrderNotional: policy.maxOrderNotional,
    maxDrawdownPercent: policy.maxDrawdownPercent,
    maxDailyTrades: policy.maxDailyTrades,
    allowedInstruments: [...policy.allowedInstruments],
    allowedSymbols: policy.allowedSymbols.map((symbol) => symbol.toUpperCase()),
    deniedSymbols: policy.deniedSymbols.map((symbol) => symbol.toUpperCase()),
    approvalRequired: policy.approvalRequired,
  };
}

function clonePolicy(policy: RiskPolicy): RiskPolicy {
  // Normalize symbol list order so sort-only churn is never a "delta".
  return finalizePolicy(cloneMutable(policy));
}

function upperSortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toUpperCase()))].sort();
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function finalizePolicy(draft: MutablePolicy): RiskPolicy {
  const denied = new Set(upperSortedUnique(draft.deniedSymbols));
  const allowedSymbols = upperSortedUnique(draft.allowedSymbols).filter(
    (symbol) => !denied.has(symbol),
  );
  let instruments = [...new Set(draft.allowedInstruments)];
  if (instruments.length === 0) instruments = ["equity"];

  const deployable = draft.capitalBudget - draft.cashReserve;
  let maxOrderNotional = draft.maxOrderNotional;
  if (maxOrderNotional > deployable) maxOrderNotional = deployable;
  if (maxOrderNotional <= 0) maxOrderNotional = Math.max(deployable, 1);

  return riskPolicySchema.parse({
    capitalBudget: draft.capitalBudget,
    cashReserve: draft.cashReserve,
    maxPositionPercent: draft.maxPositionPercent,
    maxOrderNotional,
    maxDrawdownPercent: draft.maxDrawdownPercent,
    maxDailyTrades: draft.maxDailyTrades,
    allowedInstruments: instruments,
    allowedSymbols,
    deniedSymbols: upperSortedUnique(draft.deniedSymbols),
    approvalRequired: draft.approvalRequired,
  });
}

function scenarioById(id: string) {
  return SHADOW_CURRICULUM.find((item) => item.id === id);
}

/**
 * Apply one coordinated generation of deterministic deltas onto a draft policy.
 * Returns rationale-bearing field diffs (before/after of the whole generation).
 */
export function collectDeltas(
  policy: RiskPolicy,
  report: ShadowCurriculumReport,
): { deltas: PolicyDelta[]; policyAfter: RiskPolicy } {
  // Diff against a normalized clone so membership-stable sort is not a generation.
  const normalizedBefore = clonePolicy(policy);
  const draft = cloneMutable(normalizedBefore);
  const rationales: Array<{ code: RationaleCode; detail: string; fields: Array<keyof RiskPolicy> }> =
    [];

  const falseAllows = report.scenarios.filter((scenario) => scenario.hardFalseAllow);
  const falseDenies = report.scenarios.filter((scenario) => scenario.hardFalseDeny);

  // 1. Denied-symbol false allows → add symbols to deniedSymbols
  const deniedCandidates = new Set<string>();
  for (const scenario of falseAllows) {
    if (scenario.tags.includes("denied-symbol")) {
      const source = scenarioById(scenario.id);
      if (source) deniedCandidates.add(source.proposal.symbol.toUpperCase());
    }
  }
  if (deniedCandidates.size > 0) {
    const before = [...draft.deniedSymbols];
    draft.deniedSymbols = upperSortedUnique([...draft.deniedSymbols, ...deniedCandidates]);
    if (!sameStringList(before, draft.deniedSymbols)) {
      rationales.push({
        code: "add-denied-symbols",
        detail: `Add curriculum-denied symbols that were falsely allowed: ${[...deniedCandidates].sort().join(", ")}`,
        fields: ["deniedSymbols"],
      });
    }
  }

  // 2. Options / crypto false allows → strip non-equity instruments
  const stripOptions = falseAllows.some((scenario) => scenario.tags.includes("options-blocked"));
  const stripCrypto = falseAllows.some((scenario) => scenario.tags.includes("crypto-blocked"));
  if (stripOptions || stripCrypto) {
    const before = [...draft.allowedInstruments];
    draft.allowedInstruments = draft.allowedInstruments.filter((instrument) => {
      if (stripOptions && instrument === "option") return false;
      if (stripCrypto && instrument === "crypto") return false;
      return true;
    });
    if (!draft.allowedInstruments.includes("equity")) {
      draft.allowedInstruments = ["equity", ...draft.allowedInstruments];
    }
    if (draft.allowedInstruments.length === 0) {
      draft.allowedInstruments = ["equity"];
    }
    if (!sameStringList(before, draft.allowedInstruments)) {
      rationales.push({
        code: "strip-non-equity-instruments",
        detail: "False allow on options/crypto-blocked scenarios; strip non-equity instruments",
        fields: ["allowedInstruments"],
      });
    }
  }

  // 3. Unknown-symbol / empty-allowlist false allows → restrict allowlist to elite symbols
  const unknownFalseAllows = falseAllows.filter((scenario) =>
    scenario.tags.includes("empty-symbol-stress"),
  );
  if (unknownFalseAllows.length > 0) {
    const before = [...draft.allowedSymbols];
    const elite = REFERENCE_ELITE_POLICY.allowedSymbols.map((symbol) => symbol.toUpperCase());
    if (draft.allowedSymbols.length === 0) {
      draft.allowedSymbols = [...elite];
    } else {
      draft.allowedSymbols = upperSortedUnique([...draft.allowedSymbols, ...elite]);
    }
    if (!sameStringList(before, draft.allowedSymbols)) {
      rationales.push({
        code: "restrict-allowlist-for-unknown-symbols",
        detail: `Ensure elite equity allowlist after unknown-symbol false allows: ${elite.join(", ")}`,
        fields: ["allowedSymbols"],
      });
    }
  }

  // 4. Oversize false allows → reduce maxOrderNotional / maxPositionPercent
  const oversizeFalseAllows = falseAllows.filter(
    (scenario) =>
      scenario.tags.includes("oversize-order") || scenario.tags.includes("oversize-position"),
  );
  if (oversizeFalseAllows.length > 0) {
    const targetNotional = REFERENCE_ELITE_POLICY.maxOrderNotional;
    if (draft.maxOrderNotional > targetNotional) {
      const deployable = draft.capitalBudget - draft.cashReserve;
      const next = Math.min(targetNotional, deployable);
      if (next > 0 && next < draft.maxOrderNotional) {
        draft.maxOrderNotional = next;
        rationales.push({
          code: "reduce-max-order-notional",
          detail: `Reduce maxOrderNotional toward elite reference ${targetNotional}`,
          fields: ["maxOrderNotional"],
        });
      }
    }
    const targetPosition = REFERENCE_ELITE_POLICY.maxPositionPercent;
    if (draft.maxPositionPercent > targetPosition) {
      draft.maxPositionPercent = targetPosition;
      rationales.push({
        code: "reduce-max-position-percent",
        detail: `Reduce maxPositionPercent to elite reference ${targetPosition}`,
        fields: ["maxPositionPercent"],
      });
    }
  }

  // 5. Drawdown / daily-cap false allows → tighten stops
  if (falseAllows.some((scenario) => scenario.tags.includes("drawdown-halt"))) {
    const target = REFERENCE_ELITE_POLICY.maxDrawdownPercent;
    if (draft.maxDrawdownPercent > target) {
      draft.maxDrawdownPercent = target;
      rationales.push({
        code: "tighten-drawdown-stop",
        detail: `Tighten maxDrawdownPercent to ${target}`,
        fields: ["maxDrawdownPercent"],
      });
    }
  }
  if (falseAllows.some((scenario) => scenario.tags.includes("daily-cap"))) {
    const target = REFERENCE_ELITE_POLICY.maxDailyTrades;
    if (draft.maxDailyTrades > target) {
      draft.maxDailyTrades = target;
      rationales.push({
        code: "tighten-daily-trade-cap",
        detail: `Tighten maxDailyTrades to ${target}`,
        fields: ["maxDailyTrades"],
      });
    }
  }

  // 6. False denies on clean allowlisted equities → ensure allowlist / un-deny
  const cleanFalseDenies = falseDenies.filter((scenario) =>
    scenario.tags.some(
      (tag) =>
        tag === "clean-allowlisted-equity" ||
        tag === "sell-allowlisted" ||
        tag === "high-notional-within-cap" ||
        tag === "zero-evidence",
    ),
  );
  if (cleanFalseDenies.length > 0) {
    const neededSymbols = new Set<string>();
    for (const scenario of cleanFalseDenies) {
      const source = scenarioById(scenario.id);
      if (source && source.proposal.instrument === "equity") {
        neededSymbols.add(source.proposal.symbol.toUpperCase());
      }
    }
    for (const symbol of REFERENCE_ELITE_POLICY.allowedSymbols) {
      neededSymbols.add(symbol.toUpperCase());
    }

    if (neededSymbols.size > 0) {
      const beforeAllowed = [...draft.allowedSymbols];
      draft.allowedSymbols = upperSortedUnique([...draft.allowedSymbols, ...neededSymbols]);
      if (!sameStringList(beforeAllowed, draft.allowedSymbols)) {
        rationales.push({
          code: "ensure-clean-equity-allowlist",
          detail: `Ensure clean equity symbols on allowlist: ${[...neededSymbols].sort().join(", ")}`,
          fields: ["allowedSymbols"],
        });
      }

      const beforeDenied = [...draft.deniedSymbols];
      const overlap = draft.deniedSymbols.filter((symbol) => neededSymbols.has(symbol));
      if (overlap.length > 0) {
        draft.deniedSymbols = draft.deniedSymbols.filter((symbol) => !neededSymbols.has(symbol));
        if (!sameStringList(beforeDenied, draft.deniedSymbols)) {
          rationales.push({
            code: "remove-clean-from-denylist",
            detail: `Remove clean equity symbols from denylist: ${overlap.sort().join(", ")}`,
            fields: ["deniedSymbols"],
          });
        }
      }
    }
  }

  // 7. approvalRequired false but curriculum expects control → set true
  if (!draft.approvalRequired) {
    draft.approvalRequired = true;
    rationales.push({
      code: "set-approval-required",
      detail: "Curriculum elite process expects approvalRequired control",
      fields: ["approvalRequired"],
    });
  }

  const policyAfter = finalizePolicy(draft);
  const deltas = diffPolicies(normalizedBefore, policyAfter, rationales);
  return { deltas, policyAfter };
}

function diffPolicies(
  before: RiskPolicy,
  after: RiskPolicy,
  rationales: Array<{ code: RationaleCode; detail: string; fields: Array<keyof RiskPolicy> }>,
): PolicyDelta[] {
  const fields: Array<keyof RiskPolicy> = [
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

  const fallbackCode = (field: keyof RiskPolicy): RationaleCode => {
    switch (field) {
      case "approvalRequired":
        return "set-approval-required";
      case "deniedSymbols":
        return "add-denied-symbols";
      case "allowedSymbols":
        return "ensure-clean-equity-allowlist";
      case "allowedInstruments":
        return "strip-non-equity-instruments";
      case "maxOrderNotional":
        return "reduce-max-order-notional";
      case "maxPositionPercent":
        return "reduce-max-position-percent";
      case "maxDrawdownPercent":
        return "tighten-drawdown-stop";
      case "maxDailyTrades":
        return "tighten-daily-trade-cap";
      default:
        return "ensure-clean-equity-allowlist";
    }
  };

  const deltas: PolicyDelta[] = [];
  for (const field of fields) {
    const left = before[field];
    const right = after[field];
    const changed =
      Array.isArray(left) && Array.isArray(right)
        ? JSON.stringify(left) !== JSON.stringify(right)
        : left !== right;
    if (!changed) continue;

    const matching = rationales.filter((item) => item.fields.includes(field));
    deltas.push({
      field,
      before: Array.isArray(left) ? [...left] : left,
      after: Array.isArray(right) ? [...right] : right,
      rationaleCode: matching[0]?.code ?? fallbackCode(field),
      detail:
        matching.map((item) => item.detail).join("; ") ||
        `Updated ${String(field)} for charter process quality`,
    });
  }
  return deltas;
}

/**
 * One generation of deterministic policy refinement from curriculum report.
 * Always advisory; capital 0; no broker effect.
 */
export function proposeRefinement(
  policy: RiskPolicy,
  generation = 1,
): ShadowRefinementGeneration {
  const policyBefore = clonePolicy(policy);
  const reportBefore = evaluateCharter(policyBefore);
  const { deltas, policyAfter } = collectDeltas(policyBefore, reportBefore);
  const reportAfter = evaluateCharter(policyAfter);

  return {
    schemaVersion: "runbook.shadow-refinement-generation.v1",
    productSurface: PRODUCT_SURFACE,
    purpose: "charter-process-quality",
    capital: 0,
    brokerEffect: false,
    enforcement: "advisory",
    assurance: "synthetic-curriculum-process-quality-only",
    generation,
    rationaleCodes: [...new Set(deltas.map((delta) => delta.rationaleCode))],
    deltas,
    policyBefore,
    policyAfter,
    metricsBefore: reportBefore.metrics,
    metricsAfter: reportAfter.metrics,
    fixedPoint: deltas.length === 0,
    note:
      "Single deterministic refinement generation for charter process quality. " +
      "No capital movement, no broker effect, advisory only. No composite safety score.",
  };
}

/**
 * Recursive charter self-improvement loop until fixed point or maxGenerations.
 * Default maxGenerations = 5. Never invents composite scores.
 */
export function runRecursiveImprovement(
  policy: RiskPolicy,
  maxGenerations = 5,
): ShadowRecursiveImprovement {
  if (!Number.isInteger(maxGenerations) || maxGenerations < 1) {
    throw new Error("maxGenerations must be an integer >= 1");
  }

  const initialPolicy = clonePolicy(policy);
  const initialMetrics = evaluateCharter(initialPolicy).metrics;
  const generations: ShadowRefinementGeneration[] = [];
  let current = initialPolicy;
  let terminatedReason: "fixed-point" | "max-generations" = "max-generations";

  for (let generation = 1; generation <= maxGenerations; generation += 1) {
    const step = proposeRefinement(current, generation);
    generations.push(step);
    current = step.policyAfter;
    if (step.fixedPoint) {
      terminatedReason = "fixed-point";
      break;
    }
  }

  const finalMetrics = evaluateCharter(current).metrics;

  return {
    schemaVersion: "runbook.shadow-recursive-improvement.v1",
    productSurface: PRODUCT_SURFACE,
    purpose: "charter-process-quality",
    capital: 0,
    brokerEffect: false,
    enforcement: "advisory",
    assurance: "synthetic-curriculum-process-quality-only",
    maxGenerations,
    terminatedReason,
    generationCount: generations.length,
    initialPolicy,
    finalPolicy: current,
    initialMetrics,
    finalMetrics,
    generations,
    note:
      "Recursive Shadow Process Laboratory improvement. Terminates at fixed point or maxGenerations. " +
      "Improves charter/process quality only — not investment skill, not live trading.",
  };
}
