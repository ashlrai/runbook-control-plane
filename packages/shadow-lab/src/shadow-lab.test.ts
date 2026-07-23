import { describe, expect, it } from "vitest";
import type { RiskPolicy } from "@runbook/engine/schema";
import {
  CURRICULUM_ID,
  MAX_LEDGER_CANDIDATES,
  MAX_MERGED_CURRICULUM_SIZE,
  PRODUCT_SURFACE,
  REFERENCE_ELITE_POLICY,
  SHADOW_CURRICULUM,
  WEAK_STARTER_POLICY,
  buildDeterministicMutant,
  candidateIdFromProposalId,
  computeParetoFront,
  curriculumScenarioIds,
  curriculumTagSet,
  dominates,
  evaluateCharter,
  evaluateCharterAgainstMergedCurriculum,
  evaluateOperatorAugmentedCurriculum,
  extractCurriculumCandidatesFromEvents,
  mergeCurriculum,
  normalizeOperatorScenario,
  proposalFingerprint,
  proposeRefinement,
  runRecursiveImprovement,
  runShadowTournament,
  stripCredentialShapedNotes,
  tagsFromFailedCheckIds,
  type MinimalLedgerEvent,
} from "./index.js";

function assertNoCompositeScoreFields(value: unknown): void {
  const banned = [
    "compositeScore",
    "composite",
    "overallScore",
    "safetyScore",
    "agentScore",
    "grade",
    "readinessScore",
    "isSafe",
    "agentIsSafe",
  ];
  // Tournament artifacts may carry an explicit compositeScore:false sentinel
  // documenting multi-axis-only scoring — strip that before key bans.
  const json = JSON.stringify(value).replaceAll('"compositeScore":false', "");
  for (const key of banned) {
    expect(json.includes(`"${key}"`)).toBe(false);
  }
}

describe("synthetic curriculum", () => {
  it("is a closed deterministic set with stable ids and tags", () => {
    expect(SHADOW_CURRICULUM.length).toBeGreaterThanOrEqual(12);
    expect(SHADOW_CURRICULUM.length).toBeLessThanOrEqual(20);

    const ids = curriculumScenarioIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(curriculumScenarioIds()).toEqual(ids);
    expect(ids).toEqual(SHADOW_CURRICULUM.map((scenario) => scenario.id));

    const tags = curriculumTagSet();
    expect(tags).toContain("denied-symbol");
    expect(tags).toContain("clean-allowlisted-equity");
    expect(tags).toContain("options-blocked");
    expect(tags).toContain("crypto-blocked");
    expect(tags).toContain("oversize-order");
    expect(tags).toContain("drawdown-halt");
    expect(tags).toContain("daily-cap");
    expect(curriculumTagSet()).toEqual(tags);
  });

  it("labels include both adversarial denies and constructive allows", () => {
    const allows = SHADOW_CURRICULUM.filter((scenario) => scenario.shouldAllow);
    const denies = SHADOW_CURRICULUM.filter((scenario) => !scenario.shouldAllow);
    expect(allows.length).toBeGreaterThanOrEqual(3);
    expect(denies.length).toBeGreaterThanOrEqual(8);
  });
});

describe("evaluateCharter", () => {
  it("scores the reference elite equity policy with zero hardFalseAllows", () => {
    const report = evaluateCharter(REFERENCE_ELITE_POLICY);

    expect(report.schemaVersion).toBe("runbook.shadow-curriculum-report.v1");
    expect(report.productSurface).toBe(PRODUCT_SURFACE);
    expect(report.curriculumId).toBe(CURRICULUM_ID);
    expect(report.capital).toBe(0);
    expect(report.brokerEffect).toBe(false);
    expect(report.enforcement).toBe("advisory");
    expect(report.purpose).toBe("charter-process-quality");
    expect(report.assurance).toBe("synthetic-curriculum-process-quality-only");

    expect(report.metrics.hardFalseAllows).toBe(0);
    expect(report.metrics.hardFalseDenies).toBe(0);
    expect(report.metrics.trueAllows).toBeGreaterThan(0);
    expect(report.metrics.trueDenies).toBeGreaterThan(0);
    expect(report.metrics.scenarioCount).toBe(SHADOW_CURRICULUM.length);

    // Zero-evidence is advisory-only under a clean hard path.
    expect(report.metrics.advisoryGaps).toBeGreaterThanOrEqual(1);

    assertNoCompositeScoreFields(report);
  });

  it("reports multi-axis metrics and tag coverage without composite grades", () => {
    const report = evaluateCharter(WEAK_STARTER_POLICY);
    expect(report.metrics).toEqual(
      expect.objectContaining({
        hardFalseAllows: expect.any(Number),
        hardFalseDenies: expect.any(Number),
        advisoryGaps: expect.any(Number),
        trueAllows: expect.any(Number),
        trueDenies: expect.any(Number),
        scenarioCount: SHADOW_CURRICULUM.length,
      }),
    );
    expect(report.tagCoverage.length).toBeGreaterThan(0);
    for (const entry of report.tagCoverage) {
      expect(entry).toEqual(
        expect.objectContaining({
          tag: expect.any(String),
          scenarios: expect.any(Number),
          hardFalseAllows: expect.any(Number),
          hardFalseDenies: expect.any(Number),
        }),
      );
    }
    assertNoCompositeScoreFields(report);
  });

  it("flags hard false allows on a weak policy", () => {
    const report = evaluateCharter(WEAK_STARTER_POLICY);
    expect(report.metrics.hardFalseAllows).toBeGreaterThan(0);

    const gme = report.scenarios.find((scenario) => scenario.id === "denied-gme");
    expect(gme?.hardFalseAllow).toBe(true);

    const options = report.scenarios.find((scenario) => scenario.id === "options-spy");
    expect(options?.hardFalseAllow).toBe(true);

    const crypto = report.scenarios.find((scenario) => scenario.id === "crypto-btc");
    expect(crypto?.hardFalseAllow).toBe(true);
  });
});

describe("proposeRefinement", () => {
  it("reduces hardFalseAllows for a weak policy in one generation", () => {
    const before = evaluateCharter(WEAK_STARTER_POLICY);
    const generation = proposeRefinement(WEAK_STARTER_POLICY);

    expect(generation.schemaVersion).toBe("runbook.shadow-refinement-generation.v1");
    expect(generation.capital).toBe(0);
    expect(generation.brokerEffect).toBe(false);
    expect(generation.enforcement).toBe("advisory");
    expect(generation.fixedPoint).toBe(false);
    expect(generation.deltas.length).toBeGreaterThan(0);
    expect(generation.metricsBefore.hardFalseAllows).toBe(before.metrics.hardFalseAllows);
    expect(generation.metricsAfter.hardFalseAllows).toBeLessThan(
      generation.metricsBefore.hardFalseAllows,
    );
    expect(generation.policyAfter.approvalRequired).toBe(true);
    expect(generation.policyAfter.allowedInstruments).toEqual(["equity"]);
    expect(generation.policyAfter.deniedSymbols.map((symbol) => symbol.toUpperCase())).toEqual(
      expect.arrayContaining(["GME", "AMC"]),
    );
    assertNoCompositeScoreFields(generation);
  });

  it("is a fixed point for the reference elite policy", () => {
    const generation = proposeRefinement(REFERENCE_ELITE_POLICY);
    expect(generation.metricsBefore.hardFalseAllows).toBe(0);
    expect(generation.metricsAfter.hardFalseAllows).toBe(0);
    expect(generation.fixedPoint).toBe(true);
    expect(generation.deltas).toEqual([]);
  });
});

describe("runRecursiveImprovement", () => {
  it("terminates and never exceeds maxGenerations", () => {
    const result = runRecursiveImprovement(WEAK_STARTER_POLICY, 5);

    expect(result.schemaVersion).toBe("runbook.shadow-recursive-improvement.v1");
    expect(result.capital).toBe(0);
    expect(result.brokerEffect).toBe(false);
    expect(result.enforcement).toBe("advisory");
    expect(result.maxGenerations).toBe(5);
    expect(result.generationCount).toBeLessThanOrEqual(5);
    expect(result.generationCount).toBeGreaterThanOrEqual(1);
    expect(["fixed-point", "max-generations"]).toContain(result.terminatedReason);

    expect(result.finalMetrics.hardFalseAllows).toBeLessThan(result.initialMetrics.hardFalseAllows);
    assertNoCompositeScoreFields(result);
  });

  it("reaches fixed point for the reference policy quickly", () => {
    const result = runRecursiveImprovement(REFERENCE_ELITE_POLICY, 5);
    expect(result.terminatedReason).toBe("fixed-point");
    expect(result.generationCount).toBe(1);
    expect(result.finalMetrics.hardFalseAllows).toBe(0);
    expect(result.finalMetrics.hardFalseDenies).toBe(0);
  });

  it("rejects non-positive maxGenerations", () => {
    expect(() => runRecursiveImprovement(WEAK_STARTER_POLICY, 0)).toThrow(/maxGenerations/);
  });

  it("improves a mismatched allowlist that false-denies clean equities", () => {
    const mismatched: RiskPolicy = {
      ...REFERENCE_ELITE_POLICY,
      allowedSymbols: ["SPY"],
      deniedSymbols: ["GME", "AMC", "VTI"],
    };
    const before = evaluateCharter(mismatched);
    expect(before.metrics.hardFalseDenies).toBeGreaterThan(0);

    const result = runRecursiveImprovement(mismatched, 5);
    expect(result.finalMetrics.hardFalseDenies).toBeLessThan(before.metrics.hardFalseDenies);
    expect(result.finalPolicy.allowedSymbols.map((symbol) => symbol.toUpperCase())).toEqual(
      expect.arrayContaining(["VTI", "BND"]),
    );
    expect(result.finalPolicy.deniedSymbols.map((symbol) => symbol.toUpperCase())).not.toContain(
      "VTI",
    );
  });
});

describe("product boundary", () => {
  it("names the lab surface and keeps capital/broker invariants on every artifact", () => {
    const report = evaluateCharter(WEAK_STARTER_POLICY);
    const generation = proposeRefinement(WEAK_STARTER_POLICY);
    const recursive = runRecursiveImprovement(WEAK_STARTER_POLICY, 2);

    for (const artifact of [report, generation, recursive]) {
      expect(artifact.productSurface).toBe("Shadow Process Laboratory");
      expect(artifact.capital).toBe(0);
      expect(artifact.brokerEffect).toBe(false);
      expect(artifact.enforcement).toBe("advisory");
      expect(artifact.purpose).toBe("charter-process-quality");
      expect(artifact.assurance).toBe("synthetic-curriculum-process-quality-only");
    }
  });
});

describe("dominates / computeParetoFront", () => {
  it("implements true two-axis non-domination", () => {
    expect(dominates({ hardFalseAllows: 0, hardFalseDenies: 1 }, { hardFalseAllows: 1, hardFalseDenies: 1 })).toBe(
      true,
    );
    expect(dominates({ hardFalseAllows: 1, hardFalseDenies: 0 }, { hardFalseAllows: 1, hardFalseDenies: 1 })).toBe(
      true,
    );
    expect(dominates({ hardFalseAllows: 1, hardFalseDenies: 1 }, { hardFalseAllows: 0, hardFalseDenies: 2 })).toBe(
      false,
    );
    expect(dominates({ hardFalseAllows: 0, hardFalseDenies: 0 }, { hardFalseAllows: 0, hardFalseDenies: 0 })).toBe(
      false,
    );

    const front = computeParetoFront([
      { id: "a", hardFalseAllows: 0, hardFalseDenies: 2 },
      { id: "b", hardFalseAllows: 1, hardFalseDenies: 0 },
      { id: "c", hardFalseAllows: 1, hardFalseDenies: 2 },
      { id: "d", hardFalseAllows: 0, hardFalseDenies: 0 },
    ]);
    expect(front.map((item) => item.id)).toEqual(["d"]);
  });
});

describe("runShadowTournament", () => {
  it("returns >= 1 Pareto member with tournament schema and process-only claims", () => {
    const report = runShadowTournament({ maxGenerations: 4, mutantCount: 4, seed: 7 });

    expect(report.schemaVersion).toBe("runbook.shadow-tournament.v1");
    expect(report.productSurface).toBe(PRODUCT_SURFACE);
    expect(report.capital).toBe(0);
    expect(report.brokerEffect).toBe(false);
    expect(report.compositeScore).toBe(false);
    expect(report.notTradingPerformance).toBe(true);
    expect(report.enforcement).toBe("advisory");
    expect(report.assurance).toBe("synthetic-curriculum-process-quality-only");
    expect(report.purpose).toBe("charter-process-quality");
    expect(report.paretoCount).toBeGreaterThanOrEqual(1);
    expect(report.paretoFront.length).toBe(report.paretoCount);
    expect(report.candidateCount).toBe(2 + 4);
    expect(report.candidates.every((candidate) => typeof candidate.processCorrect === "boolean")).toBe(
      true,
    );
    // Tournament explicitly stamps compositeScore: false (honest denial of a collapsed grade).
    expect(report.compositeScore).toBe(false);
    const banned = ["overallScore", "safetyScore", "agentScore", "grade", "readinessScore", "isSafe"];
    const json = JSON.stringify(report);
    for (const key of banned) {
      expect(json.includes(`"${key}"`)).toBe(false);
    }
  });

  it("keeps the elite reference on or dominating toward the front", () => {
    const report = runShadowTournament({ maxGenerations: 4, mutantCount: 4, seed: 7 });
    const elite = report.candidates.find((candidate) => candidate.seedKind === "reference-elite");
    expect(elite).toBeDefined();
    expect(elite!.hardFalseAllows).toBe(0);
    expect(elite!.hardFalseDenies).toBe(0);
    expect(elite!.processCorrect).toBe(true);
    // (0,0) cannot be dominated; must sit on the Pareto front.
    expect(elite!.onParetoFront).toBe(true);
    expect(report.paretoFront.some((candidate) => candidate.seedKind === "reference-elite")).toBe(
      true,
    );
  });

  it("improves the weak starter into a lower hardFalseAllows region", () => {
    const report = runShadowTournament({ maxGenerations: 4, mutantCount: 2, seed: 3 });
    const weak = report.candidates.find((candidate) => candidate.seedKind === "weak-starter");
    expect(weak).toBeDefined();
    expect(weak!.initialHardFalseAllows).toBeGreaterThan(0);
    expect(weak!.hardFalseAllows).toBeLessThan(weak!.initialHardFalseAllows);
  });

  it("is deterministic for fixed seed and mutant count (no unseeded Math.random)", () => {
    const a = runShadowTournament({ maxGenerations: 3, mutantCount: 3, seed: 42 });
    const b = runShadowTournament({ maxGenerations: 3, mutantCount: 3, seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const mutantA = buildDeterministicMutant(42, 0);
    const mutantB = buildDeterministicMutant(42, 0);
    expect(mutantA).toEqual(mutantB);
    expect(buildDeterministicMutant(42, 1)).not.toEqual(mutantA);
  });
});

describe("meta-curriculum extract / merge / dedupe", () => {
  const baseProposal = {
    experimentId: "RUN-META-001",
    side: "buy" as const,
    dailyTradesAfter: 1,
    currentDrawdownPercent: 1,
    hasThesis: true,
    hasInvalidation: true,
    evidenceSourceCount: 2,
  };

  function proposalEvent(
    proposalId: string,
    overrides: Record<string, unknown> = {},
  ): MinimalLedgerEvent {
    return {
      type: "proposal.recorded",
      experimentId: "RUN-META-001",
      payload: {
        proposalId,
        experimentId: "RUN-META-001",
        symbol: "GME",
        instrument: "equity",
        notional: 50,
        projectedPositionNotional: 50,
        ...baseProposal,
        ...overrides,
      },
    };
  }

  function preflightEvent(
    proposalId: string,
    allowed: boolean,
    checks: Array<{ id: string; passed: boolean; severity: "hard" | "advisory" }>,
  ): MinimalLedgerEvent {
    return {
      type: "preflight.completed",
      experimentId: "RUN-META-001",
      payload: {
        proposalId,
        result: {
          allowed,
          enforcement: "advisory",
          checks: checks.map((check) => ({
            ...check,
            label: check.id,
            detail: check.passed ? "ok" : "failed",
          })),
        },
      },
    };
  }

  function charterEvent(deniedSymbols: string[]): MinimalLedgerEvent {
    return {
      type: "charter.activated",
      experimentId: "RUN-META-001",
      payload: {
        version: "1.0",
        policy: {
          ...REFERENCE_ELITE_POLICY,
          deniedSymbols,
        },
      },
    };
  }

  it("maps failed check ids to curriculum tags", () => {
    const optionProposal = {
      ...baseProposal,
      proposalId: "p-opt",
      experimentId: "RUN-META-001",
      symbol: "SPY",
      instrument: "option" as const,
      notional: 50,
      projectedPositionNotional: 50,
    };
    expect(tagsFromFailedCheckIds(["instrument.allowed"], optionProposal)).toContain(
      "options-blocked",
    );
    expect(tagsFromFailedCheckIds(["symbol.not-denied"], optionProposal)).toContain("denied-symbol");
    expect(tagsFromFailedCheckIds(["unknown.check"], optionProposal)).toEqual([
      "ledger-observed-deny",
    ]);
  });

  it("strips credential-shaped notes", () => {
    expect(stripCredentialShapedNotes("benign process note")).toBe("benign process note");
    expect(stripCredentialShapedNotes("password: supersecretvalue99")).toBeUndefined();
    expect(stripCredentialShapedNotes("api_key=ABCDEFGHIJKLMNOP")).toBeUndefined();
    expect(stripCredentialShapedNotes(42)).toBeUndefined();
  });

  it("extracts candidates from hard-denied preflights with deterministic ids", () => {
    const events: MinimalLedgerEvent[] = [
      charterEvent(["GME", "AMC"]),
      proposalEvent("prop-gme-deny"),
      preflightEvent("prop-gme-deny", false, [
        { id: "symbol.not-denied", passed: false, severity: "hard" },
        { id: "instrument.allowed", passed: true, severity: "hard" },
      ]),
      proposalEvent("prop-opt", { symbol: "SPY", instrument: "option" }),
      preflightEvent("prop-opt", false, [
        { id: "instrument.allowed", passed: false, severity: "hard" },
      ]),
      // Clean allow — should not become a candidate
      proposalEvent("prop-vti", { symbol: "VTI", instrument: "equity" }),
      preflightEvent("prop-vti", true, [
        { id: "symbol.not-denied", passed: true, severity: "hard" },
        { id: "instrument.allowed", passed: true, severity: "hard" },
      ]),
    ];

    const candidates = extractCurriculumCandidatesFromEvents(events);
    expect(candidates.length).toBe(2);
    expect(candidates.every((c) => c.shouldAllow === false)).toBe(true);
    expect(candidates.every((c) => c.source === "ledger-derived")).toBe(true);

    const byDerived = Object.fromEntries(
      candidates.map((c) => [c.derivedFromProposalId, c]),
    );
    expect(byDerived["prop-gme-deny"]?.tags).toContain("denied-symbol");
    expect(byDerived["prop-opt"]?.tags).toContain("options-blocked");
    expect(byDerived["prop-gme-deny"]?.id).toBe(candidateIdFromProposalId("prop-gme-deny"));

    // Deterministic across calls
    const again = extractCurriculumCandidatesFromEvents(events);
    expect(again.map((c) => c.id)).toEqual(candidates.map((c) => c.id));
  });

  it("creates deny candidates when preflight allowed a charter-denied symbol", () => {
    const events: MinimalLedgerEvent[] = [
      charterEvent(["GME"]),
      proposalEvent("prop-gme-allowed", { symbol: "GME" }),
      preflightEvent("prop-gme-allowed", true, [
        { id: "symbol.not-denied", passed: true, severity: "hard" },
        { id: "instrument.allowed", passed: true, severity: "hard" },
      ]),
    ];

    const candidates = extractCurriculumCandidatesFromEvents(events);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.shouldAllow).toBe(false);
    expect(candidates[0]?.tags).toEqual(
      expect.arrayContaining(["denied-symbol", "ledger-observed-deny"]),
    );
  });

  it("bounds candidates at max 20 and never embeds credential-shaped notes", () => {
    const events: MinimalLedgerEvent[] = [charterEvent(["GME"])];
    for (let i = 0; i < 25; i += 1) {
      const proposalId = `prop-mass-${String(i).padStart(2, "0")}`;
      events.push(
        proposalEvent(proposalId, {
          symbol: "GME",
          notional: 40 + i,
          notes: i === 0 ? "password: never-store-this-secret" : "ok",
        }),
      );
      events.push(
        preflightEvent(proposalId, false, [
          { id: "symbol.not-denied", passed: false, severity: "hard" },
        ]),
      );
    }

    const candidates = extractCurriculumCandidatesFromEvents(events);
    expect(candidates.length).toBe(MAX_LEDGER_CANDIDATES);
    const json = JSON.stringify(candidates);
    expect(json).not.toMatch(/password/i);
    expect(json).not.toMatch(/never-store-this-secret/);
  });

  it("merges with fingerprint dedupe, prefers synthetic-closed, and caps size", () => {
    const candidates = extractCurriculumCandidatesFromEvents([
      charterEvent(["GME"]),
      proposalEvent("prop-gme", {
        symbol: "GME",
        instrument: "equity",
        notional: 50,
        projectedPositionNotional: 50,
      }),
      preflightEvent("prop-gme", false, [
        { id: "symbol.not-denied", passed: false, severity: "hard" },
      ]),
      // Near-duplicate of closed curriculum denied-gme (same fingerprint bucket)
      proposalEvent("prop-gme-2", {
        symbol: "GME",
        instrument: "equity",
        notional: 45,
        projectedPositionNotional: 45,
      }),
      preflightEvent("prop-gme-2", false, [
        { id: "symbol.not-denied", passed: false, severity: "hard" },
      ]),
    ]);

    // closed denied-gme fingerprint should collide with ledger GME ~50 notional
    const closedGme = SHADOW_CURRICULUM.find((s) => s.id === "denied-gme");
    expect(closedGme).toBeDefined();
    const closedFp = proposalFingerprint(closedGme!.proposal);
    expect(candidates.some((c) => proposalFingerprint(c.proposal) === closedFp)).toBe(true);

    const merged = mergeCurriculum(SHADOW_CURRICULUM, candidates);
    expect(merged.length).toBeLessThanOrEqual(MAX_MERGED_CURRICULUM_SIZE);
    expect(merged.length).toBeGreaterThanOrEqual(SHADOW_CURRICULUM.length);
    expect(merged.filter((s) => s.id === "denied-gme")).toHaveLength(1);
    expect(merged.find((s) => s.id === "denied-gme")?.source).toBe("synthetic-closed");

    // Distinct option candidate should still merge in
    const optionOnly = extractCurriculumCandidatesFromEvents([
      proposalEvent("prop-opt-only", { symbol: "SPY", instrument: "option", notional: 75 }),
      preflightEvent("prop-opt-only", false, [
        { id: "instrument.allowed", passed: false, severity: "hard" },
      ]),
    ]);
    const withOption = mergeCurriculum(SHADOW_CURRICULUM, optionOnly);
    // closed curriculum already has options-spy — may dedupe or add depending on fingerprint
    expect(withOption.every((s) => s.source === "synthetic-closed" || s.source === "ledger-derived")).toBe(
      true,
    );
    expect(withOption.length).toBeLessThanOrEqual(MAX_MERGED_CURRICULUM_SIZE);

    // Cap enforcement
    const many = extractCurriculumCandidatesFromEvents(
      Array.from({ length: 30 }, (_, i) => [
        proposalEvent(`uniq-${i}`, {
          symbol: `U${i}`,
          instrument: "equity",
          notional: 10 + i * 3,
          projectedPositionNotional: 10 + i * 3,
        }),
        preflightEvent(`uniq-${i}`, false, [
          { id: "symbol.allowed", passed: false, severity: "hard" },
        ]),
      ]).flat(),
    );
    const capped = mergeCurriculum(SHADOW_CURRICULUM, many, { maxSize: 40 });
    expect(capped.length).toBeLessThanOrEqual(40);
  });

  it("evaluateCharterAgainstMergedCurriculum evaluates without events as closed set", () => {
    const closed = evaluateCharter(REFERENCE_ELITE_POLICY);
    const merged = evaluateCharterAgainstMergedCurriculum(REFERENCE_ELITE_POLICY);
    expect(merged.metrics.hardFalseAllows).toBe(closed.metrics.hardFalseAllows);
    expect(merged.scenarioCount).toBe(SHADOW_CURRICULUM.length);
    expect(merged.note).toMatch(/synthetic-closed/);
  });

  it("evaluateCharterAgainstMergedCurriculum folds ledger-derived denys into the report", () => {
    const events: MinimalLedgerEvent[] = [
      charterEvent(["GME"]),
      proposalEvent("prop-xyz-unique", {
        symbol: "ZZZZ",
        instrument: "crypto",
        notional: 999,
        projectedPositionNotional: 999,
      }),
      preflightEvent("prop-xyz-unique", false, [
        { id: "instrument.allowed", passed: false, severity: "hard" },
      ]),
    ];
    const report = evaluateCharterAgainstMergedCurriculum(REFERENCE_ELITE_POLICY, events);
    expect(report.scenarioCount).toBeGreaterThan(SHADOW_CURRICULUM.length);
    expect(report.note).toMatch(/ledger-derived/);
    expect(report.note).toMatch(/not market truth/i);
    expect(report.metrics.hardFalseAllows).toBe(0);
  });
});

describe("operator-scenario", () => {
  it("evaluateOperatorAugmentedCurriculum with option-should-deny keeps hardFalseAllows 0 on elite", () => {
    const result = evaluateOperatorAugmentedCurriculum(REFERENCE_ELITE_POLICY, [
      {
        id: "option-should-deny",
        label: "Operator option should deny",
        shouldAllow: false,
        tags: ["options-blocked"],
        proposal: {
          proposalId: "op-opt-deny",
          experimentId: "CURRICULUM",
          symbol: "SPY",
          instrument: "option",
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
    ]);

    expect(result.schemaVersion).toBe("runbook.operator-scenario-eval.v1");
    expect(result.operatorScenarioCount).toBe(1);
    expect(result.closedCurriculumCount).toBe(SHADOW_CURRICULUM.length);
    expect(result.scenarioCount).toBe(SHADOW_CURRICULUM.length + 1);
    expect(result.hardFalseAllows).toBe(0);
    expect(result.brokerEffect).toBe(false);
    expect(result.compositeScore).toBe(false);
    expect(result.notTradingPerformance).toBe(true);
    expect(result.report.scenarios.some((s) => s.id === "operator.option-should-deny")).toBe(true);
  });

  it("normalizeOperatorScenario rejects invalid id", () => {
    expect(() =>
      normalizeOperatorScenario({
        id: "bad id!",
        label: "invalid",
        shouldAllow: false,
        proposal: {
          proposalId: "op-bad",
          experimentId: "CURRICULUM",
          symbol: "SPY",
          instrument: "option",
          side: "buy",
          notional: 50,
          projectedPositionNotional: 50,
          dailyTradesAfter: 1,
          currentDrawdownPercent: 1,
          hasThesis: true,
          hasInvalidation: true,
          evidenceSourceCount: 1,
        },
      }),
    ).toThrow("operator-scenario-id-invalid");

    expect(() =>
      evaluateOperatorAugmentedCurriculum(REFERENCE_ELITE_POLICY, [
        {
          id: "",
          label: "empty id",
          shouldAllow: false,
          proposal: {
            proposalId: "op-empty",
            experimentId: "CURRICULUM",
            symbol: "VTI",
            instrument: "equity",
            side: "buy",
            notional: 50,
            projectedPositionNotional: 50,
            dailyTradesAfter: 1,
            currentDrawdownPercent: 1,
            hasThesis: true,
            hasInvalidation: true,
            evidenceSourceCount: 1,
          },
        },
      ]),
    ).toThrow("operator-scenario-id-invalid");
  });
});
