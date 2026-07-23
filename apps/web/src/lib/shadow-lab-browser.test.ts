import { describe, expect, it } from "vitest";
import {
  CURRICULUM_SCENARIOS,
  ELITE_EQUITY_CHARTER,
  SAMPLE_META_LEDGER_EVENTS,
  SEED_LAB_POLICY,
  buildExportReport,
  classifyVerdict,
  evaluateCurriculum,
  evaluatePolicyAgainstMetaCurriculum,
  extractAndMergeMetaCurriculum,
  parseLedgerEventsJson,
  policiesEqual,
  policyJsonForMcp,
  refinePolicy,
  runRefinementLoop,
  runTournament,
  sampleMetaLedgerJson,
} from "./shadow-lab-browser";

describe("shadow-lab-browser", () => {
  it("classifies process-correct, false-allow, and false-deny", () => {
    expect(classifyVerdict(true, true)).toBe("process-correct");
    expect(classifyVerdict(false, false)).toBe("process-correct");
    expect(classifyVerdict(false, true)).toBe("false-allow");
    expect(classifyVerdict(true, false)).toBe("false-deny");
  });

  it("loads a fixed curriculum with author-declared shouldAllow labels", () => {
    expect(CURRICULUM_SCENARIOS.length).toBeGreaterThanOrEqual(12);
    expect(CURRICULUM_SCENARIOS.some((s) => s.shouldAllow)).toBe(true);
    expect(CURRICULUM_SCENARIOS.some((s) => !s.shouldAllow)).toBe(true);
    expect(CURRICULUM_SCENARIOS.every((s) => s.tags.length > 0)).toBe(true);
  });

  it("elite charter is curriculum-clean (no false allows or denies)", () => {
    const { metrics, results } = evaluateCurriculum(ELITE_EQUITY_CHARTER);
    expect(metrics.scenarioCount).toBe(CURRICULUM_SCENARIOS.length);
    expect(metrics.hardFalseAllows).toBe(0);
    expect(metrics.hardFalseDenies).toBe(0);
    expect(metrics.processCorrect).toBe(metrics.scenarioCount);
    expect(results.every((r) => r.verdict === "process-correct")).toBe(true);
  });

  it("seed policy produces hard false-allows (theater work remaining)", () => {
    const { metrics } = evaluateCurriculum(SEED_LAB_POLICY);
    expect(metrics.hardFalseAllows).toBeGreaterThan(0);
    expect(metrics.processCorrect).toBeLessThan(metrics.scenarioCount);
  });

  it("one refine generation reduces hard false-allows without inventing a score", () => {
    const before = evaluateCurriculum(SEED_LAB_POLICY);
    const refined = refinePolicy(SEED_LAB_POLICY);
    const after = evaluateCurriculum(refined.policy);

    expect(refined.appliedRules.length).toBeGreaterThan(0);
    expect(refined.delta.length).toBeGreaterThan(0);
    expect(after.metrics.hardFalseAllows).toBeLessThan(before.metrics.hardFalseAllows);
    expect(JSON.stringify(refined)).not.toMatch(/processScore|returnPercent|safetyScore/i);
  });

  it("run until fixed point reaches curriculum-clean within 8 generations", () => {
    const history = runRefinementLoop({
      seed: SEED_LAB_POLICY,
      maxGenerations: 8,
      untilFixedPoint: true,
    });

    expect(history[0]?.generation).toBe(0);
    expect(history[0]?.metrics.hardFalseAllows).toBeGreaterThan(0);

    const final = history[history.length - 1]!;
    expect(final.metrics.hardFalseAllows).toBe(0);
    expect(final.metrics.hardFalseDenies).toBe(0);
    expect(
      final.stoppedReason === "curriculum-clean" || final.stoppedReason === "fixed-point",
    ).toBe(true);

    // False allows should be non-increasing across generations.
    for (let i = 1; i < history.length; i++) {
      expect(history[i]!.metrics.hardFalseAllows).toBeLessThanOrEqual(
        history[i - 1]!.metrics.hardFalseAllows,
      );
    }
  });

  it("single generation mode applies exactly one refine step", () => {
    const history = runRefinementLoop({
      seed: SEED_LAB_POLICY,
      maxGenerations: 4,
      untilFixedPoint: false,
    });
    expect(history.length).toBe(2);
    expect(history[1]?.generation).toBe(1);
    expect(history[1]?.appliedRules.length).toBeGreaterThan(0);
  });

  it("elite seed is immediately curriculum-clean (no refine work)", () => {
    const history = runRefinementLoop({
      seed: ELITE_EQUITY_CHARTER,
      maxGenerations: 4,
      untilFixedPoint: true,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.stoppedReason).toBe("curriculum-clean");
    expect(policiesEqual(history[0]!.policy, ELITE_EQUITY_CHARTER)).toBe(true);
  });

  it("export report carries disclosures and omits composite scores", () => {
    const history = runRefinementLoop({
      seed: SEED_LAB_POLICY,
      maxGenerations: 8,
      untilFixedPoint: true,
    });
    const report = buildExportReport(history);
    expect(report.schemaVersion).toBe("runbook.shadow-lab-report.v1");
    expect(report.disclosures.some((d) => /not investment skill/i.test(d))).toBe(true);
    expect(report.finalMetrics.hardFalseAllows).toBe(0);
    expect(report).not.toHaveProperty("processScore");
    expect(report.finalMetrics).not.toHaveProperty("processScore");
    expect(report.finalMetrics).not.toHaveProperty("returnPercent");
    expect(Object.keys(report.finalMetrics).sort()).toEqual(
      ["hardFalseAllows", "hardFalseDenies", "processCorrect", "scenarioCount"].sort(),
    );
    expect(policyJsonForMcp(report.finalPolicy)).toContain("capitalBudget");
  });
});

describe("shadow-lab-browser tournament", () => {
  it("runs a fixed-seed tournament with Pareto front and truth stamps", () => {
    const report = runTournament({ maxGenerations: 3, mutantCount: 2, seed: 7 });

    expect(report.schemaVersion).toBe("runbook.shadow-tournament.v1");
    expect(report.candidateCount).toBe(4); // weak + elite + 2 mutants
    expect(report.paretoCount).toBeGreaterThanOrEqual(1);
    expect(report.paretoFront.length).toBe(report.paretoCount);
    expect(report.capital).toBe(0);
    expect(report.compositeScore).toBe(false);
    expect(report.brokerEffect).toBe(false);
    expect(report.notTradingPerformance).toBe(true);

    expect(report.candidates.every((c) => typeof c.seedKind === "string")).toBe(true);
    expect(report.candidates.every((c) => typeof c.hardFalseAllows === "number")).toBe(true);
    expect(report.candidates.every((c) => typeof c.hardFalseDenies === "number")).toBe(true);
    expect(report.candidates.every((c) => typeof c.processCorrect === "boolean")).toBe(true);
    expect(report.candidates.some((c) => c.onParetoFront)).toBe(true);

    const elite = report.candidates.find((c) => c.seedKind === "reference-elite");
    expect(elite?.processCorrect).toBe(true);
    expect(elite?.onParetoFront).toBe(true);

    const json = JSON.stringify(report);
    expect(json).not.toMatch(/processScore|safetyScore|overallScore|returnPercent/i);
  });

  it("is deterministic for the same seed", () => {
    const a = runTournament({ maxGenerations: 2, mutantCount: 2, seed: 42 });
    const b = runTournament({ maxGenerations: 2, mutantCount: 2, seed: 42 });
    expect(a.candidates.map((c) => c.id)).toEqual(b.candidates.map((c) => c.id));
    expect(a.candidates.map((c) => c.hardFalseAllows)).toEqual(
      b.candidates.map((c) => c.hardFalseAllows),
    );
  });
});

describe("shadow-lab-browser meta-curriculum", () => {
  it("Load sample fixture matches packages/mcp/examples/sample-ledger-events.json", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const examplesPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../packages/mcp/examples/sample-ledger-events.json",
    );
    const packageEvents = JSON.parse(readFileSync(examplesPath, "utf8")) as unknown;
    // Button path: sampleMetaLedgerJson() → parseLedgerEventsJson
    const buttonEvents = parseLedgerEventsJson(sampleMetaLedgerJson());
    expect(buttonEvents).toEqual(packageEvents);
    expect(SAMPLE_META_LEDGER_EVENTS).toEqual(packageEvents);
  });

  it("parses sample fixture JSON and extracts candidates", () => {
    const events = parseLedgerEventsJson(sampleMetaLedgerJson());
    expect(events.length).toBe(SAMPLE_META_LEDGER_EVENTS.length);

    const view = extractAndMergeMetaCurriculum(events);
    expect(view.candidateCount).toBeGreaterThanOrEqual(2);
    expect(view.mergedCount).toBeGreaterThan(view.candidateCount);
    expect(view.ledgerDerivedInMerged).toBeGreaterThan(0);
    expect(view.ledgerMutated).toBe(false);
    expect(view.assurance).toBe("ledger-derived-synthetic-process-labels-only");
    expect(view.tags.length).toBeGreaterThan(0);
    expect(view.sampleScenarios.length).toBeGreaterThan(0);
    expect(view.candidates.every((c) => c.source === "ledger-derived")).toBe(true);
    expect(view.candidates.every((c) => c.shouldAllow === false)).toBe(true);
  });

  it("accepts { events: [...] } wrapper shape", () => {
    const wrapped = JSON.stringify({ events: SAMPLE_META_LEDGER_EVENTS });
    const events = parseLedgerEventsJson(wrapped);
    expect(events).toHaveLength(SAMPLE_META_LEDGER_EVENTS.length);
  });

  it("rejects invalid JSON and empty payloads", () => {
    expect(() => parseLedgerEventsJson("not-json")).toThrow(/Invalid JSON/i);
    expect(() => parseLedgerEventsJson("[]")).toThrow(/No events/i);
    expect(() => parseLedgerEventsJson("")).toThrow(/Paste ledger/i);
  });

  it("re-evaluates working policy against merged curriculum without composite scores", () => {
    const metrics = evaluatePolicyAgainstMetaCurriculum(
      SEED_LAB_POLICY,
      SAMPLE_META_LEDGER_EVENTS,
    );
    expect(metrics.scenarioCount).toBeGreaterThan(CURRICULUM_SCENARIOS.length - 1);
    expect(typeof metrics.hardFalseAllows).toBe("number");
    expect(typeof metrics.hardFalseDenies).toBe("number");
    expect(typeof metrics.processCorrect).toBe("number");
    expect(metrics).not.toHaveProperty("processScore");
    expect(JSON.stringify(metrics)).not.toMatch(/processScore|returnPercent/i);
  });
});
