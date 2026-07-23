/**
 * Operator-authored synthetic process scenarios for the shadow curriculum.
 * Labels are process-training only — not market truth or trading performance.
 */

import { tradeProposalSchema, type TradeProposal } from "@runbook/engine/schema";
import {
  SHADOW_CURRICULUM,
  type CurriculumScenario,
  type CurriculumTag,
} from "./curriculum.js";
import { evaluateCharterAgainstScenarios } from "./evaluate-charter.js";
import type { RiskPolicy } from "@runbook/engine/schema";

export type OperatorScenarioDraft = {
  id: string;
  label: string;
  /** Expected allow under the policy under test (operator intent). */
  shouldAllow: boolean;
  tags?: CurriculumTag[];
  proposal: TradeProposal;
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/**
 * Validate and normalize an operator draft into a curriculum scenario.
 */
export function normalizeOperatorScenario(draft: OperatorScenarioDraft): CurriculumScenario {
  if (!ID_RE.test(draft.id)) {
    throw new Error("operator-scenario-id-invalid");
  }
  const label = draft.label.trim().slice(0, 200);
  if (label.length < 1) throw new Error("operator-scenario-label-invalid");
  const proposal = tradeProposalSchema.parse(draft.proposal);
  return {
    id: `operator.${draft.id}`,
    label: `Operator: ${label}`,
    tags: draft.tags?.length ? draft.tags : ["ledger-observed-deny"],
    shouldAllow: draft.shouldAllow,
    proposal,
  };
}

/**
 * Merge operator scenarios after the closed curriculum (operator ids win on collision).
 */
export function mergeOperatorScenarios(
  operatorDrafts: readonly OperatorScenarioDraft[],
  base: readonly CurriculumScenario[] = SHADOW_CURRICULUM,
): CurriculumScenario[] {
  const operators = operatorDrafts.map(normalizeOperatorScenario);
  const opIds = new Set(operators.map((s) => s.id));
  const kept = base.filter((s) => !opIds.has(s.id));
  return [...kept, ...operators];
}

/**
 * Evaluate a policy against closed curriculum + optional operator scenarios.
 */
export function evaluateOperatorAugmentedCurriculum(
  policy: RiskPolicy,
  operatorDrafts: readonly OperatorScenarioDraft[] = [],
) {
  const scenarios = mergeOperatorScenarios(operatorDrafts);
  const report = evaluateCharterAgainstScenarios(policy, scenarios);
  return {
    schemaVersion: "runbook.operator-scenario-eval.v1" as const,
    scenarioCount: scenarios.length,
    operatorScenarioCount: operatorDrafts.length,
    closedCurriculumCount: SHADOW_CURRICULUM.length,
    hardFalseAllows: report.metrics.hardFalseAllows,
    hardFalseDenies: report.metrics.hardFalseDenies,
    report,
    brokerEffect: false as const,
    compositeScore: false as const,
    notTradingPerformance: true as const,
    limitations: [
      "synthetic-process-labels-not-market-truth",
      "operator-authored-not-broker-enforcement",
      "not-trading-performance",
      "no-composite-safety-score",
    ] as const,
  };
}
