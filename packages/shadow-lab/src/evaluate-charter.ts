import { evaluateProposal } from "@runbook/engine/policy";
import type { RiskPolicy } from "@runbook/engine/schema";
import {
  CURRICULUM_ID,
  PRODUCT_SURFACE,
  SHADOW_CURRICULUM,
  type CurriculumScenario,
  type CurriculumTag,
} from "./curriculum.js";

/**
 * Multi-axis process metrics only — no composite "agent is safe" score.
 * hardFalseAllows is the critical process-failure axis.
 */
export type ShadowCurriculumMetrics = {
  hardFalseAllows: number;
  hardFalseDenies: number;
  advisoryGaps: number;
  trueAllows: number;
  trueDenies: number;
  scenarioCount: number;
};

export type TagCoverageEntry = {
  tag: CurriculumTag | string;
  scenarios: number;
  hardFalseAllows: number;
  hardFalseDenies: number;
  advisoryGaps: number;
  trueAllows: number;
  trueDenies: number;
};

export type ScenarioEvaluation = {
  id: string;
  label: string;
  tags: readonly string[];
  shouldAllow: boolean;
  allowed: boolean;
  hardFalseAllow: boolean;
  hardFalseDeny: boolean;
  advisoryGap: boolean;
  failedHardChecks: string[];
  failedAdvisoryChecks: string[];
  passedHardChecks: string[];
};

export type ShadowCurriculumReport = {
  schemaVersion: "runbook.shadow-curriculum-report.v1";
  productSurface: typeof PRODUCT_SURFACE;
  purpose: "charter-process-quality";
  /** Always 0 — lab evaluation never moves capital. */
  capital: 0;
  brokerEffect: false;
  enforcement: "advisory";
  assurance: "synthetic-curriculum-process-quality-only";
  curriculumId: typeof CURRICULUM_ID;
  scenarioCount: number;
  metrics: ShadowCurriculumMetrics;
  tagCoverage: TagCoverageEntry[];
  scenarios: ScenarioEvaluation[];
  note: string;
};

function evaluateScenario(policy: RiskPolicy, scenario: CurriculumScenario): ScenarioEvaluation {
  const result = evaluateProposal(policy, scenario.proposal);
  const failedHardChecks = result.checks
    .filter((check) => check.severity === "hard" && !check.passed)
    .map((check) => check.id);
  const failedAdvisoryChecks = result.checks
    .filter((check) => check.severity === "advisory" && !check.passed)
    .map((check) => check.id);
  const passedHardChecks = result.checks
    .filter((check) => check.severity === "hard" && check.passed)
    .map((check) => check.id);

  const hardFalseAllow = result.allowed && !scenario.shouldAllow;
  const hardFalseDeny = !result.allowed && scenario.shouldAllow;
  // Advisory gap: curriculum expects allow, hard path allows, but advisory failed.
  const advisoryGap =
    scenario.shouldAllow && result.allowed && failedAdvisoryChecks.length > 0;

  return {
    id: scenario.id,
    label: scenario.label,
    tags: scenario.tags,
    shouldAllow: scenario.shouldAllow,
    allowed: result.allowed,
    hardFalseAllow,
    hardFalseDeny,
    advisoryGap,
    failedHardChecks,
    failedAdvisoryChecks,
    passedHardChecks,
  };
}

function emptyMetrics(scenarioCount: number): ShadowCurriculumMetrics {
  return {
    hardFalseAllows: 0,
    hardFalseDenies: 0,
    advisoryGaps: 0,
    trueAllows: 0,
    trueDenies: 0,
    scenarioCount,
  };
}

function aggregateMetrics(scenarios: ScenarioEvaluation[]): ShadowCurriculumMetrics {
  const metrics = emptyMetrics(scenarios.length);
  for (const scenario of scenarios) {
    if (scenario.hardFalseAllow) metrics.hardFalseAllows += 1;
    if (scenario.hardFalseDeny) metrics.hardFalseDenies += 1;
    if (scenario.advisoryGap) metrics.advisoryGaps += 1;
    if (scenario.allowed && scenario.shouldAllow) metrics.trueAllows += 1;
    if (!scenario.allowed && !scenario.shouldAllow) metrics.trueDenies += 1;
  }
  return metrics;
}

function buildTagCoverage(scenarios: ScenarioEvaluation[]): TagCoverageEntry[] {
  const byTag = new Map<string, TagCoverageEntry>();

  for (const scenario of scenarios) {
    for (const tag of scenario.tags) {
      let entry = byTag.get(tag);
      if (!entry) {
        entry = {
          tag,
          scenarios: 0,
          hardFalseAllows: 0,
          hardFalseDenies: 0,
          advisoryGaps: 0,
          trueAllows: 0,
          trueDenies: 0,
        };
        byTag.set(tag, entry);
      }
      entry.scenarios += 1;
      if (scenario.hardFalseAllow) entry.hardFalseAllows += 1;
      if (scenario.hardFalseDeny) entry.hardFalseDenies += 1;
      if (scenario.advisoryGap) entry.advisoryGaps += 1;
      if (scenario.allowed && scenario.shouldAllow) entry.trueAllows += 1;
      if (!scenario.allowed && !scenario.shouldAllow) entry.trueDenies += 1;
    }
  }

  return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Evaluate a RiskPolicy against an arbitrary curriculum scenario list.
 * Reports multi-axis process metrics only — never a composite safety grade.
 */
export function evaluateCharterAgainstScenarios(
  policy: RiskPolicy,
  curriculum: readonly CurriculumScenario[],
): ShadowCurriculumReport {
  const scenarios = curriculum.map((scenario) => evaluateScenario(policy, scenario));
  const metrics = aggregateMetrics(scenarios);

  return {
    schemaVersion: "runbook.shadow-curriculum-report.v1",
    productSurface: PRODUCT_SURFACE,
    purpose: "charter-process-quality",
    capital: 0,
    brokerEffect: false,
    enforcement: "advisory",
    assurance: "synthetic-curriculum-process-quality-only",
    curriculumId: CURRICULUM_ID,
    scenarioCount: scenarios.length,
    metrics,
    tagCoverage: buildTagCoverage(scenarios),
    scenarios,
    note:
      "Shadow Process Laboratory charter evaluation. Axes are independent process metrics; " +
      "there is no composite agent-safety score, investment skill claim, or live-capital effect.",
  };
}

/**
 * Evaluate a RiskPolicy charter against the frozen synthetic curriculum.
 * Reports multi-axis process metrics only — never a composite safety grade.
 */
export function evaluateCharter(policy: RiskPolicy): ShadowCurriculumReport {
  return evaluateCharterAgainstScenarios(policy, SHADOW_CURRICULUM);
}

/** Alias for callers that prefer an explicit name. */
export const evaluateCharterAgainstCurriculum = evaluateCharter;
