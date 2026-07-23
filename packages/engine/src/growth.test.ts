import { describe, expect, it } from "vitest";

import {
  designPartnerAssessmentSchema,
  evaluateDesignPartner,
  evaluateFoundingLab30DayGate,
  evaluatePriceSignal,
  foundingLab30DayEvidenceSchema,
} from "./growth.js";

const safeDisqualifiers = {
  requestsAdvice: false,
  requestsExecution: false,
  requestsCredentials: false,
  requestsCopiedOrders: false,
};

const qualifyingAssessment = {
  existingAgentUse: "paper-or-live-action-workflow",
  painIntensity: "occasional-manual-friction",
  charterNeed: "nice-to-have",
  provenanceNeed: "helpful",
  deterministicControls: "mixed",
  repeatIntent: "maybe",
  willingnessToPay: "monthly-19-to-39-plausible",
  safeFit: "accepts-non-custodial-scope",
  disqualifiers: safeDisqualifiers,
} as const;

describe("design-partner rubric", () => {
  it("passes at the exact 10-point threshold when safe fit is 2", () => {
    const result = evaluateDesignPartner(qualifyingAssessment);

    expect(result).toMatchObject({
      status: "pass",
      passed: true,
      inputValid: true,
      totalScore: 10,
      knownScoreSubtotal: 10,
      maximumScore: 16,
      reasons: [],
    });
    expect(result.scores.safeFit).toBe(2);
  });

  it("maps the launch-playbook endpoints to 0 and 2", () => {
    const low = evaluateDesignPartner({
      existingAgentUse: "none",
      painIntensity: "hypothetical",
      charterNeed: "does-not-value",
      provenanceNeed: "does-not-value",
      deterministicControls: "prefers-model-judgment",
      repeatIntent: "no-second-use",
      willingnessToPay: "zero-only",
      safeFit: "requests-advice-or-execution",
      disqualifiers: safeDisqualifiers,
    });
    const high = evaluateDesignPartner({
      existingAgentUse: "paper-or-live-action-workflow",
      painIntensity: "repeated-failure-or-blocked-adoption",
      charterNeed: "required-before-use",
      provenanceNeed: "required-to-trust-or-investigate",
      deterministicControls: "explicit-requirement",
      repeatIntent: "names-next-experiment",
      willingnessToPay: "above-39-or-team-budget",
      safeFit: "accepts-non-custodial-scope",
      disqualifiers: safeDisqualifiers,
    });

    expect(low.totalScore).toBe(0);
    expect(Object.values(low.scores)).toEqual(Array(8).fill(0));
    expect(high.totalScore).toBe(16);
    expect(Object.values(high.scores)).toEqual(Array(8).fill(2));
  });

  it("fails a high total when safe fit is below 2", () => {
    const result = evaluateDesignPartner({
      ...qualifyingAssessment,
      existingAgentUse: "paper-or-live-action-workflow",
      painIntensity: "repeated-failure-or-blocked-adoption",
      safeFit: "needs-boundary-coaching",
    });

    expect(result.totalScore).toBeGreaterThanOrEqual(10);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("Safe fit must score 2; received 1.");
  });

  it.each([
    ["requestsAdvice", "Requested investment advice."],
    ["requestsExecution", "Requested trade execution."],
    ["requestsCredentials", "Requested credential handling."],
    ["requestsCopiedOrders", "Requested copied orders."],
  ] as const)("disqualifies %s regardless of score", (key, reason) => {
    const result = evaluateDesignPartner({
      ...qualifyingAssessment,
      disqualifiers: { ...safeDisqualifiers, [key]: true },
    });

    expect(result.status).toBe("fail");
    expect(result.reasons).toContain(reason);
  });

  it("keeps unknown evidence out of both the total and a passing result", () => {
    const result = evaluateDesignPartner({
      ...qualifyingAssessment,
      painIntensity: "unknown",
    });

    expect(result.inputValid).toBe(true);
    expect(result.scores.painIntensity).toBeNull();
    expect(result.totalScore).toBeNull();
    expect(result.knownScoreSubtotal).toBe(9);
    expect(result.status).toBe("fail");
    expect(result.reasons).toContain("Pain intensity is unknown.");
  });

  it("rejects extra fields instead of accepting PII or Social data", () => {
    const result = evaluateDesignPartner({
      ...qualifyingAssessment,
      socialHandle: "not-accepted",
    });

    expect(result.inputValid).toBe(false);
    expect(result.status).toBe("fail");
    expect(result.reasons.join(" ")).toContain("Unrecognized key");
    expect(
      designPartnerAssessmentSchema.safeParse({
        ...qualifyingAssessment,
        holdings: ["not-accepted"],
      }).success,
    ).toBe(false);
  });
});

describe("price signals", () => {
  it("distinguishes pricing interest from validated $499 payment", () => {
    expect(evaluatePriceSignal("above-39-or-team-budget")).toMatchObject({
      score: 2,
      paymentValidated: false,
    });
    expect(evaluatePriceSignal("founding-lab-499-paid-in-full")).toMatchObject({
      score: 2,
      paymentValidated: true,
    });
    expect(evaluatePriceSignal("unknown")).toMatchObject({
      score: null,
      paymentValidated: false,
    });
  });
});

describe("30-day Founding Lab gate", () => {
  it("passes at the exact commercial-validation targets", () => {
    const result = evaluateFoundingLab30DayGate({
      completedInterviews: 15,
      fullyPaid499Pilots: 5,
      activatedExperiments: 4,
      renewalCommitments: 3,
    });

    expect(result).toMatchObject({
      status: "pass",
      passed: true,
      inputValid: true,
      reasons: [],
    });
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it.each([
    ["completedInterviews", 14, "Completed interviews requires 15; received 14."],
    ["fullyPaid499Pilots", 4, "Fully paid $499 pilots requires 5; received 4."],
    ["activatedExperiments", 3, "Activated experiments requires 4; received 3."],
    ["renewalCommitments", 2, "Renewal commitments requires 3; received 2."],
  ] as const)("fails when %s is below target", (metric, value, reason) => {
    const evidence = {
      completedInterviews: 15,
      fullyPaid499Pilots: 5,
      activatedExperiments: 4,
      renewalCommitments: 3,
      [metric]: value,
    };
    const result = evaluateFoundingLab30DayGate(evidence);

    expect(result.status).toBe("fail");
    expect(result.reasons).toContain(reason);
  });

  it("preserves unknown counts as null and explains the failure", () => {
    const result = evaluateFoundingLab30DayGate({
      completedInterviews: null,
      fullyPaid499Pilots: 5,
      activatedExperiments: 4,
      renewalCommitments: 3,
    });

    expect(result.inputValid).toBe(true);
    expect(result.status).toBe("fail");
    expect(result.checks[0]).toMatchObject({
      metric: "completedInterviews",
      actual: null,
      passed: false,
    });
    expect(result.reasons[0]).toContain("count is unknown");
  });

  it("treats an omitted count as invalid rather than zero", () => {
    const result = evaluateFoundingLab30DayGate({
      fullyPaid499Pilots: 5,
      activatedExperiments: 4,
      renewalCommitments: 3,
    });

    expect(result).toMatchObject({
      status: "fail",
      passed: false,
      inputValid: false,
      checks: [],
    });
    expect(result.reasons.join(" ")).toContain("completedInterviews");
  });

  it("rejects impossible cohort relationships and extra fields", () => {
    expect(
      foundingLab30DayEvidenceSchema.safeParse({
        completedInterviews: 15,
        fullyPaid499Pilots: 5,
        activatedExperiments: 6,
        renewalCommitments: 3,
      }).success,
    ).toBe(false);
    expect(
      foundingLab30DayEvidenceSchema.safeParse({
        completedInterviews: 15,
        fullyPaid499Pilots: 5,
        activatedExperiments: 4,
        renewalCommitments: 3,
        participantEmail: "not-accepted",
      }).success,
    ).toBe(false);
  });
});
