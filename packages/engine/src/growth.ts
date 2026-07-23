import { z } from "zod";

export const RUBRIC_DIMENSIONS = [
  "existingAgentUse",
  "painIntensity",
  "charterNeed",
  "provenanceNeed",
  "deterministicControls",
  "repeatIntent",
  "willingnessToPay",
  "safeFit",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];
export type RubricScore = 0 | 1 | 2;

export const existingAgentUseSignalSchema = z.enum([
  "unknown",
  "none",
  "research-only",
  "paper-or-live-action-workflow",
]);

export const painIntensitySignalSchema = z.enum([
  "unknown",
  "hypothetical",
  "occasional-manual-friction",
  "repeated-failure-or-blocked-adoption",
]);

export const charterNeedSignalSchema = z.enum([
  "unknown",
  "does-not-value",
  "nice-to-have",
  "required-before-use",
]);

export const provenanceNeedSignalSchema = z.enum([
  "unknown",
  "does-not-value",
  "helpful",
  "required-to-trust-or-investigate",
]);

export const deterministicControlsSignalSchema = z.enum([
  "unknown",
  "prefers-model-judgment",
  "mixed",
  "explicit-requirement",
]);

export const repeatIntentSignalSchema = z.enum([
  "unknown",
  "no-second-use",
  "maybe",
  "names-next-experiment",
]);

export const priceSignalSchema = z.enum([
  "unknown",
  "zero-only",
  "monthly-19-to-39-plausible",
  "above-39-or-team-budget",
  "founding-lab-499-paid-in-full",
]);

export const safeFitSignalSchema = z.enum([
  "unknown",
  "requests-advice-or-execution",
  "needs-boundary-coaching",
  "accepts-non-custodial-scope",
]);

export const designPartnerDisqualifiersSchema = z
  .object({
    requestsAdvice: z.boolean(),
    requestsExecution: z.boolean(),
    requestsCredentials: z.boolean(),
    requestsCopiedOrders: z.boolean(),
  })
  .strict();

export const designPartnerAssessmentSchema = z
  .object({
    existingAgentUse: existingAgentUseSignalSchema,
    painIntensity: painIntensitySignalSchema,
    charterNeed: charterNeedSignalSchema,
    provenanceNeed: provenanceNeedSignalSchema,
    deterministicControls: deterministicControlsSignalSchema,
    repeatIntent: repeatIntentSignalSchema,
    willingnessToPay: priceSignalSchema,
    safeFit: safeFitSignalSchema,
    disqualifiers: designPartnerDisqualifiersSchema,
  })
  .strict();

export type PriceSignal = z.infer<typeof priceSignalSchema>;
export type DesignPartnerAssessment = z.infer<
  typeof designPartnerAssessmentSchema
>;

const SCORE_BY_SIGNAL = {
  none: 0,
  hypothetical: 0,
  "does-not-value": 0,
  "prefers-model-judgment": 0,
  "no-second-use": 0,
  "zero-only": 0,
  "requests-advice-or-execution": 0,
  "research-only": 1,
  "occasional-manual-friction": 1,
  "nice-to-have": 1,
  helpful: 1,
  mixed: 1,
  maybe: 1,
  "monthly-19-to-39-plausible": 1,
  "needs-boundary-coaching": 1,
  "paper-or-live-action-workflow": 2,
  "repeated-failure-or-blocked-adoption": 2,
  "required-before-use": 2,
  "required-to-trust-or-investigate": 2,
  "explicit-requirement": 2,
  "names-next-experiment": 2,
  "above-39-or-team-budget": 2,
  "founding-lab-499-paid-in-full": 2,
  "accepts-non-custodial-scope": 2,
} as const satisfies Record<string, RubricScore>;

type KnownSignal = keyof typeof SCORE_BY_SIGNAL;

function scoreSignal(signal: KnownSignal | "unknown"): RubricScore | null {
  return signal === "unknown" ? null : SCORE_BY_SIGNAL[signal];
}

export interface PriceSignalEvaluation {
  signal: PriceSignal;
  score: RubricScore | null;
  paymentValidated: boolean;
  reason: string;
}

const PRICE_SIGNAL_REASONS: Record<PriceSignal, string> = {
  unknown: "No pricing evidence was recorded.",
  "zero-only": "The participant would only use a free offering.",
  "monthly-19-to-39-plausible":
    "A $19-$39 monthly price was described as plausible.",
  "above-39-or-team-budget":
    "The participant identified a team budget or willingness above $39.",
  "founding-lab-499-paid-in-full":
    "The $499 Founding Lab pilot was paid in full.",
};

export function evaluatePriceSignal(signal: PriceSignal): PriceSignalEvaluation {
  return {
    signal,
    score: scoreSignal(signal),
    paymentValidated: signal === "founding-lab-499-paid-in-full",
    reason: PRICE_SIGNAL_REASONS[signal],
  };
}

export type RubricScores = Record<RubricDimension, RubricScore | null>;

export interface DesignPartnerEvaluation {
  status: "pass" | "fail";
  passed: boolean;
  inputValid: boolean;
  scores: RubricScores;
  knownScoreSubtotal: number;
  totalScore: number | null;
  maximumScore: 16;
  priceSignal: PriceSignalEvaluation | null;
  reasons: string[];
}

const EMPTY_SCORES: RubricScores = {
  existingAgentUse: null,
  painIntensity: null,
  charterNeed: null,
  provenanceNeed: null,
  deterministicControls: null,
  repeatIntent: null,
  willingnessToPay: null,
  safeFit: null,
};

const DIMENSION_LABELS: Record<RubricDimension, string> = {
  existingAgentUse: "Existing agent use",
  painIntensity: "Pain intensity",
  charterNeed: "Charter need",
  provenanceNeed: "Provenance need",
  deterministicControls: "Deterministic controls",
  repeatIntent: "Repeat intent",
  willingnessToPay: "Willingness to pay",
  safeFit: "Safe fit",
};

const DISQUALIFIER_REASONS: Record<
  keyof DesignPartnerAssessment["disqualifiers"],
  string
> = {
  requestsAdvice: "Requested investment advice.",
  requestsExecution: "Requested trade execution.",
  requestsCredentials: "Requested credential handling.",
  requestsCopiedOrders: "Requested copied orders.",
};

function invalidInputReasons(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "input";
    return `Invalid ${path}: ${issue.message}`;
  });
}

export function evaluateDesignPartner(
  input: unknown,
): DesignPartnerEvaluation {
  const parsed = designPartnerAssessmentSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "fail",
      passed: false,
      inputValid: false,
      scores: { ...EMPTY_SCORES },
      knownScoreSubtotal: 0,
      totalScore: null,
      maximumScore: 16,
      priceSignal: null,
      reasons: invalidInputReasons(parsed.error),
    };
  }

  const assessment = parsed.data;
  const scores: RubricScores = {
    existingAgentUse: scoreSignal(assessment.existingAgentUse),
    painIntensity: scoreSignal(assessment.painIntensity),
    charterNeed: scoreSignal(assessment.charterNeed),
    provenanceNeed: scoreSignal(assessment.provenanceNeed),
    deterministicControls: scoreSignal(assessment.deterministicControls),
    repeatIntent: scoreSignal(assessment.repeatIntent),
    willingnessToPay: scoreSignal(assessment.willingnessToPay),
    safeFit: scoreSignal(assessment.safeFit),
  };
  const unknownDimensions = RUBRIC_DIMENSIONS.filter(
    (dimension) => scores[dimension] === null,
  );
  const knownScoreSubtotal = RUBRIC_DIMENSIONS.reduce(
    (sum, dimension) => sum + (scores[dimension] ?? 0),
    0,
  );
  const totalScore =
    unknownDimensions.length === 0 ? knownScoreSubtotal : null;
  const reasons = unknownDimensions.map(
    (dimension) => `${DIMENSION_LABELS[dimension]} is unknown.`,
  );

  if (scores.safeFit !== null && scores.safeFit < 2) {
    reasons.push(`Safe fit must score 2; received ${scores.safeFit}.`);
  }

  if (totalScore !== null && totalScore < 10) {
    reasons.push(`Rubric total must be at least 10; received ${totalScore}.`);
  }

  for (const [key, reason] of Object.entries(DISQUALIFIER_REASONS) as Array<
    [keyof typeof assessment.disqualifiers, string]
  >) {
    if (assessment.disqualifiers[key]) {
      reasons.push(reason);
    }
  }

  const passed = reasons.length === 0;
  return {
    status: passed ? "pass" : "fail",
    passed,
    inputValid: true,
    scores,
    knownScoreSubtotal,
    totalScore,
    maximumScore: 16,
    priceSignal: evaluatePriceSignal(assessment.willingnessToPay),
    reasons,
  };
}

export const FOUNDING_LAB_30_DAY_TARGETS = Object.freeze({
  completedInterviews: 15,
  fullyPaid499Pilots: 5,
  activatedExperiments: 4,
  renewalCommitments: 3,
} as const);

const evidenceCountSchema = z.number().int().nonnegative().max(1_000_000).nullable();

export const foundingLab30DayEvidenceSchema = z
  .object({
    completedInterviews: evidenceCountSchema,
    fullyPaid499Pilots: evidenceCountSchema,
    activatedExperiments: evidenceCountSchema,
    renewalCommitments: evidenceCountSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    const relationships = [
      ["fullyPaid499Pilots", "completedInterviews"],
      ["activatedExperiments", "fullyPaid499Pilots"],
      ["renewalCommitments", "fullyPaid499Pilots"],
    ] as const;

    for (const [subset, population] of relationships) {
      const subsetCount = evidence[subset];
      const populationCount = evidence[population];
      if (
        subsetCount !== null &&
        populationCount !== null &&
        subsetCount > populationCount
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [subset],
          message: `${subset} cannot exceed ${population}.`,
        });
      }
    }
  });

export type FoundingLab30DayEvidence = z.infer<
  typeof foundingLab30DayEvidenceSchema
>;

export type FoundingLabGateMetric = keyof typeof FOUNDING_LAB_30_DAY_TARGETS;

export interface FoundingLabGateCheck {
  metric: FoundingLabGateMetric;
  actual: number | null;
  required: number;
  passed: boolean;
  reason: string;
}

export interface FoundingLabGateEvaluation {
  status: "pass" | "fail";
  passed: boolean;
  inputValid: boolean;
  checks: FoundingLabGateCheck[];
  reasons: string[];
}

const GATE_METRIC_LABELS: Record<FoundingLabGateMetric, string> = {
  completedInterviews: "Completed interviews",
  fullyPaid499Pilots: "Fully paid $499 pilots",
  activatedExperiments: "Activated experiments",
  renewalCommitments: "Renewal commitments",
};

export function evaluateFoundingLab30DayGate(
  input: unknown,
): FoundingLabGateEvaluation {
  const parsed = foundingLab30DayEvidenceSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "fail",
      passed: false,
      inputValid: false,
      checks: [],
      reasons: invalidInputReasons(parsed.error),
    };
  }

  const evidence = parsed.data;
  const checks = (
    Object.entries(FOUNDING_LAB_30_DAY_TARGETS) as Array<
      [FoundingLabGateMetric, number]
    >
  ).map(([metric, required]) => {
    const actual = evidence[metric];
    const passed = actual !== null && actual >= required;
    const reason =
      actual === null
        ? `${GATE_METRIC_LABELS[metric]} count is unknown; unknown evidence cannot satisfy the gate.`
        : passed
          ? `${GATE_METRIC_LABELS[metric]} met the ${required} target with ${actual}.`
          : `${GATE_METRIC_LABELS[metric]} requires ${required}; received ${actual}.`;

    return { metric, actual, required, passed, reason };
  });
  const failedChecks = checks.filter((check) => !check.passed);
  const passed = failedChecks.length === 0;

  return {
    status: passed ? "pass" : "fail",
    passed,
    inputValid: true,
    checks,
    reasons: failedChecks.map((check) => check.reason),
  };
}
