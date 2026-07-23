import { z } from "zod";

export const publicationSurfaceSchema = z.enum([
  "robinhood-social",
  "public-lab",
  "newsletter",
  "other",
]);

export const contentFormatSchema = z.enum([
  "charter",
  "decision",
  "rejection",
  "no-trade",
  "review",
  "correction",
  "explainer",
]);

export const publicationDraftSchema = z.object({
  surface: publicationSurfaceSchema,
  format: contentFormatSchema,
  body: z.string().trim().min(1).max(5_000),
  manualPublish: z.boolean(),
  synthetic: z.boolean(),
  syntheticLabelPresent: z.boolean(),
  namesSecurity: z.boolean(),
  holdingsDisclosurePresent: z.boolean(),
  hasPerformanceClaim: z.boolean(),
  measurementPeriodPresent: z.boolean(),
  benchmarkPresent: z.boolean(),
  limitationsPresent: z.boolean(),
  materialConnection: z.enum(["none", "disclosed", "undisclosed"]),
  evidenceSourceCount: z.number().int().nonnegative().max(100),
}).strict();

export type PublicationDraft = z.infer<typeof publicationDraftSchema>;

export type PublicationCheck = {
  id: string;
  label: string;
  passed: boolean;
  severity: "blocking" | "advisory";
  detail: string;
};

export type PublicationReview = {
  readyForHumanReview: boolean;
  humanReviewRequired: true;
  checks: PublicationCheck[];
  warning: string;
};

const GUARANTEE_PATTERN = /\b(?:guaranteed?|risk[- ]?free|can(?:not|'t) miss|sure thing|proven alpha|easy money|will beat)\b/i;
const DIRECTIVE_PATTERN = /\b(?:you|everyone|followers?|we)\s+(?:should|must|need to)\s+(?:buy|sell|hold|copy|trade|allocate)|\b(?:buy|sell|copy)\s+(?:this|now|today)\b/i;
const COMMERCIAL_CTA_PATTERN = /\b(?:sign up|join (?:my|the) waitlist|use (?:my|the) referral|book a demo|pricing|subscribe for|dm me to (?:join|buy|subscribe))\b|\$\d+(?:\.\d{2})?\s*\/\s*(?:mo|month)/i;

export function reviewPublicationDraft(rawDraft: PublicationDraft): PublicationReview {
  const draft = publicationDraftSchema.parse(rawDraft);
  const isRobinhoodSocial = draft.surface === "robinhood-social";
  const containsGuarantee = GUARANTEE_PATTERN.test(draft.body);
  const containsDirective = DIRECTIVE_PATTERN.test(draft.body);
  const containsCommercialCta = COMMERCIAL_CTA_PATTERN.test(draft.body);

  const checks: PublicationCheck[] = [
    {
      id: "manual-publish",
      label: "Manual publishing",
      passed: draft.manualPublish,
      severity: "blocking",
      detail: draft.manualPublish
        ? "Draft is queued for a person to review and submit."
        : "Automated Social publishing is outside the pilot boundary.",
    },
    {
      id: "no-guarantee",
      label: "No performance promise",
      passed: !containsGuarantee,
      severity: "blocking",
      detail: containsGuarantee
        ? "Remove guarantee, certainty, risk-free, or unsupported alpha language."
        : "No prohibited certainty language detected.",
    },
    {
      id: "no-trade-directive",
      label: "No instruction to trade",
      passed: !containsDirective,
      severity: "blocking",
      detail: containsDirective
        ? "Remove language directing readers or followers to buy, sell, hold, copy, or allocate."
        : "No direct trading instruction detected.",
    },
    {
      id: "social-commercial-boundary",
      label: "No Social commercial solicitation",
      passed: !isRobinhoodSocial || !containsCommercialCta,
      severity: "blocking",
      detail: isRobinhoodSocial && containsCommercialCta
        ? "Remove pricing, referral, waitlist, subscription, or sales calls to action from the Social draft."
        : "No prohibited Social sales call to action detected.",
    },
    {
      id: "synthetic-label",
      label: "Synthetic activity labeled",
      passed: !draft.synthetic || draft.syntheticLabelPresent,
      severity: "blocking",
      detail: draft.synthetic && !draft.syntheticLabelPresent
        ? "Label synthetic, hypothetical, paper, or shadow activity prominently."
        : "Activity status is represented consistently.",
    },
    {
      id: "holdings-disclosure",
      label: "Holdings conflict stated",
      passed: !draft.namesSecurity || draft.holdingsDisclosurePresent,
      severity: "blocking",
      detail: draft.namesSecurity && !draft.holdingsDisclosurePresent
        ? "State whether Mason currently holds the named security."
        : "Named-security ownership is addressed or not applicable.",
    },
    {
      id: "performance-context",
      label: "Performance context complete",
      passed: !draft.hasPerformanceClaim || (
        draft.measurementPeriodPresent &&
        draft.benchmarkPresent &&
        draft.limitationsPresent
      ),
      severity: "blocking",
      detail: draft.hasPerformanceClaim
        ? "Performance needs a period, benchmark, and material limitation."
        : "No performance claim requires contextualization.",
    },
    {
      id: "material-connection",
      label: "No paid Social promotion",
      passed: isRobinhoodSocial
        ? draft.materialConnection === "none"
        : draft.materialConnection !== "undisclosed",
      severity: "blocking",
      detail: isRobinhoodSocial && draft.materialConnection !== "none"
        ? "The current Robinhood Social pilot permits no paid or non-cash promotion."
        : draft.materialConnection === "undisclosed"
          ? "Disclose or remove the material connection before publication."
          : "No undisclosed material connection is recorded.",
    },
    {
      id: "evidence",
      label: "Evidence attached",
      passed: draft.evidenceSourceCount > 0,
      severity: "advisory",
      detail: draft.evidenceSourceCount > 0
        ? `${draft.evidenceSourceCount} first-party or public evidence source${draft.evidenceSourceCount === 1 ? "" : "s"} recorded.`
        : "Add a first-party record or public source before making factual claims.",
    },
  ];

  return {
    readyForHumanReview: checks
      .filter((check) => check.severity === "blocking")
      .every((check) => check.passed),
    humanReviewRequired: true,
    checks,
    warning: "Automated checks are incomplete and are not legal, compliance, or investment-advice clearance.",
  };
}

export const contentObservationSchema = z.object({
  observationId: z.string().trim().min(1).max(120),
  hypothesis: z.string().trim().min(1).max(240),
  format: contentFormatSchema,
  followersBefore: z.number().int().nonnegative().max(100_000_000),
  followersAfter24h: z.number().int().nonnegative().max(100_000_000),
  likesAfter24h: z.number().int().nonnegative().max(100_000_000),
  commentsAfter24h: z.number().int().nonnegative().max(100_000_000),
  substantiveQuestionsAfter24h: z.number().int().nonnegative().max(100_000_000),
  qualifiedConversationsAfter24h: z.number().int().nonnegative().max(100_000_000),
  manualPublish: z.boolean(),
  complianceReviewed: z.boolean(),
  manufacturedEvent: z.boolean(),
}).strict().superRefine((observation, context) => {
  if (observation.substantiveQuestionsAfter24h > observation.commentsAfter24h) {
    context.addIssue({
      code: "custom",
      path: ["substantiveQuestionsAfter24h"],
      message: "Substantive questions cannot exceed total comments.",
    });
  }
});

export type ContentObservation = z.infer<typeof contentObservationSchema>;

export type ContentOutcome = {
  eligible: boolean;
  observedFollowerChange: number;
  observedFollowerChangePercent: number | null;
  substantiveQuestionRatePercent: number | null;
  qualifiedConversations: number;
  decision: "continue" | "revise" | "stop";
  rationale: string;
  caveat: string;
};

export function scoreContentObservation(rawObservation: ContentObservation): ContentOutcome {
  const observation = contentObservationSchema.parse(rawObservation);
  const eligible = observation.manualPublish && observation.complianceReviewed && !observation.manufacturedEvent;
  const observedFollowerChange = observation.followersAfter24h - observation.followersBefore;
  const observedFollowerChangePercent = observation.followersBefore === 0
    ? null
    : Number(((observedFollowerChange / observation.followersBefore) * 100).toFixed(2));
  const substantiveQuestionRatePercent = observation.commentsAfter24h === 0
    ? null
    : Number(((observation.substantiveQuestionsAfter24h / observation.commentsAfter24h) * 100).toFixed(2));

  if (!eligible) {
    return {
      eligible,
      observedFollowerChange,
      observedFollowerChangePercent,
      substantiveQuestionRatePercent,
      qualifiedConversations: observation.qualifiedConversationsAfter24h,
      decision: "stop",
      rationale: "Do not use this observation for growth decisions because a pilot integrity gate failed.",
      caveat: "The 24-hour change is observational and does not establish that the post caused follower growth.",
    };
  }

  const continueSignal =
    observation.qualifiedConversationsAfter24h >= 1 ||
    observation.substantiveQuestionsAfter24h >= 2 ||
    observedFollowerChange >= 5;

  return {
    eligible,
    observedFollowerChange,
    observedFollowerChangePercent,
    substantiveQuestionRatePercent,
    qualifiedConversations: observation.qualifiedConversationsAfter24h,
    decision: continueSignal ? "continue" : "revise",
    rationale: continueSignal
      ? "Repeat the format once with the same measurement window before drawing a conclusion."
      : "Change one content variable and run another manual observation; do not manufacture market activity.",
    caveat: "The 24-hour change is observational and does not establish that the post caused follower growth.",
  };
}
