export type PublishingCadence = "weekly-plus" | "monthly" | "less-than-monthly";
export type AudienceWorkflow = "existing-recurring" | "early-recurring" | "preparing-first-series";
export type DataMode = "synthetic-paper-ok" | "real-money-required";
export type RecordIntegrity = "preserve-complete-record" | "selective-record-only";
export type CredentialBoundary = "no-credentials" | "credentials-required";
export type StartWindow = "within-30-days" | "within-60-days" | "later";
export type BudgetAuthority = "can-authorize-499" | "needs-approval" | "no-current-budget";

export type LabQualificationAnswers = {
  publishingCadence: PublishingCadence | "";
  audienceWorkflow: AudienceWorkflow | "";
  dataMode: DataMode | "";
  recordIntegrity: RecordIntegrity | "";
  credentialBoundary: CredentialBoundary | "";
  startWindow: StartWindow | "";
  budgetAuthority: BudgetAuthority | "";
};

export type QualificationField = keyof LabQualificationAnswers;
export type GateState = "pass" | "review" | "stop";
export type QualificationDecision = "incomplete" | "ready-for-human-review" | "prepare-first" | "not-a-current-fit";

export type QualificationGate = {
  id: QualificationField;
  label: string;
  state: GateState;
  detail: string;
};

export type LabQualificationResult = {
  decision: QualificationDecision;
  title: string;
  summary: string;
  missingFields: QualificationField[];
  gates: QualificationGate[];
};

type QualificationOption = {
  value: string;
  label: string;
  detail: string;
};

type QualificationQuestion = {
  id: QualificationField;
  eyebrow: string;
  question: string;
  helper: string;
  options: readonly QualificationOption[];
};

export const EMPTY_LAB_QUALIFICATION: LabQualificationAnswers = {
  publishingCadence: "",
  audienceWorkflow: "",
  dataMode: "",
  recordIntegrity: "",
  credentialBoundary: "",
  startWindow: "",
  budgetAuthority: "",
};

export const qualificationQuestions: readonly QualificationQuestion[] = [
  {
    id: "publishingCadence",
    eyebrow: "Publishing cadence",
    question: "How often do you publish investing, fintech, or agent work today?",
    helper: "No profile link, follower count, or platform handle needed.",
    options: [
      { value: "weekly-plus", label: "Weekly or more", detail: "A recurring evidence workflow already has somewhere to live." },
      { value: "monthly", label: "About monthly", detail: "The pilot may need a tighter publication cadence." },
      { value: "less-than-monthly", label: "Less than monthly", detail: "Build a repeatable publishing rhythm before a concierge pilot." },
    ],
  },
  {
    id: "audienceWorkflow",
    eyebrow: "Audience + workflow",
    question: "Which publishing workflow best matches your current stage?",
    helper: "Choose a stage, not an audience size.",
    options: [
      { value: "existing-recurring", label: "Existing audience + recurring series", detail: "You already operate a repeatable public format." },
      { value: "early-recurring", label: "Early audience + recurring publishing", detail: "You publish consistently while the audience develops." },
      { value: "preparing-first-series", label: "Preparing a first recurring series", detail: "The concept exists, but the workflow is not operating yet." },
    ],
  },
  {
    id: "dataMode",
    eyebrow: "Experiment data",
    question: "Can this pilot use synthetic or paper data while the proof workflow is validated?",
    helper: "No real-money activity should be created to qualify for the Lab.",
    options: [
      { value: "synthetic-paper-ok", label: "Yes — synthetic or paper is acceptable", detail: "The pilot can test evidence quality without risking capital." },
      { value: "real-money-required", label: "No — I require real-money activity", detail: "That is outside this founding-pilot boundary." },
    ],
  },
  {
    id: "recordIntegrity",
    eyebrow: "Complete record",
    question: "Will you preserve failures, rejections, corrections, losses, and null results?",
    helper: "A Proof Capsule cannot be a selective highlight reel.",
    options: [
      { value: "preserve-complete-record", label: "Yes — preserve the complete bounded record", detail: "Uncomfortable evidence stays visible with its context." },
      { value: "selective-record-only", label: "No — I need editorial control over unfavorable events", detail: "Selective omission breaks the product's trust contract." },
    ],
  },
  {
    id: "credentialBoundary",
    eyebrow: "Credential refusal",
    question: "Can you work within a strict no-brokerage-credential boundary?",
    helper: "Runbook does not need a brokerage password, session, API key, token, or custody.",
    options: [
      { value: "no-credentials", label: "Yes — Runbook receives no brokerage credential", detail: "Owned evidence stays local and access remains with you." },
      { value: "credentials-required", label: "No — the workflow must access my brokerage account", detail: "That is outside the Lab's recorder-and-proof scope." },
    ],
  },
  {
    id: "startWindow",
    eyebrow: "Start window",
    question: "When could you begin a bounded 30-day implementation?",
    helper: "This is scheduling readiness, not a reservation.",
    options: [
      { value: "within-30-days", label: "Within 30 days", detail: "The charter could be reviewed and activated soon." },
      { value: "within-60-days", label: "Within 31–60 days", detail: "Useful fit, but not immediate pilot readiness." },
      { value: "later", label: "More than 60 days away", detail: "Revisit the fit check when the start window is concrete." },
    ],
  },
  {
    id: "budgetAuthority",
    eyebrow: "Budget authority",
    question: "What is your authority for the fixed $499 pilot fee?",
    helper: "No card, invoice, employer, or financial account details requested.",
    options: [
      { value: "can-authorize-499", label: "I can authorize $499", detail: "Budget authority is available if human review confirms fit." },
      { value: "needs-approval", label: "Another person must approve $499", detail: "Bring the written scope to the real decision-maker first." },
      { value: "no-current-budget", label: "No current $499 budget", detail: "Do not enter a paid pilot without a real budget path." },
    ],
  },
] as const;

const validValues = Object.fromEntries(
  qualificationQuestions.map((question) => [question.id, new Set(question.options.map((option) => option.value))]),
) as Record<QualificationField, Set<string>>;

const questionById = new Map(qualificationQuestions.map((question) => [question.id, question]));

function gate(
  id: QualificationField,
  value: string,
  passValue: string,
  reviewValues: readonly string[],
  details: { pass: string; review: string; stop: string },
): QualificationGate {
  const state: GateState = value === passValue ? "pass" : reviewValues.includes(value) ? "review" : "stop";
  return {
    id,
    label: questionById.get(id)?.eyebrow ?? id,
    state,
    detail: details[state],
  };
}

export function evaluateLabQualification(input: Partial<LabQualificationAnswers>): LabQualificationResult {
  const missingFields = qualificationQuestions
    .map((question) => question.id)
    .filter((field) => {
      const value = input[field];
      return typeof value !== "string" || !validValues[field].has(value);
    });

  if (missingFields.length > 0) {
    return {
      decision: "incomplete",
      title: "Complete every fit gate",
      summary: "No readiness result is issued until all seven non-identifying questions have valid answers.",
      missingFields,
      gates: [],
    };
  }

  const answers = input as LabQualificationAnswers;
  const gates: QualificationGate[] = [
    gate("publishingCadence", answers.publishingCadence, "weekly-plus", ["monthly", "less-than-monthly"], {
      pass: "A weekly-or-better cadence can support four consecutive reports.",
      review: "A concrete four-week publishing cadence should be operating before scope review.",
      stop: "A repeatable publication cadence should be established first.",
    }),
    gate("audienceWorkflow", answers.audienceWorkflow, "existing-recurring", ["early-recurring", "preparing-first-series"], {
      pass: "An operating public workflow is already in place.",
      review: "The recurring workflow should be operating consistently before scope review.",
      stop: "Launch the recurring series before adding concierge proof operations.",
    }),
    gate("dataMode", answers.dataMode, "synthetic-paper-ok", [], {
      pass: "The pilot can validate proof operations without creating real-money activity.",
      review: "Synthetic or paper data is required for this founding fit check.",
      stop: "A real-money-only requirement is outside the founding-pilot boundary.",
    }),
    gate("recordIntegrity", answers.recordIntegrity, "preserve-complete-record", [], {
      pass: "Failures, corrections, rejections, losses, and nulls remain in scope.",
      review: "A complete bounded record is required.",
      stop: "Selective omission conflicts with the Proof Capsule trust contract.",
    }),
    gate("credentialBoundary", answers.credentialBoundary, "no-credentials", [], {
      pass: "The workflow can operate without brokerage credentials or custody.",
      review: "Credential refusal is mandatory.",
      stop: "Any requirement for brokerage access is outside the Lab's scope.",
    }),
    gate("startWindow", answers.startWindow, "within-30-days", ["within-60-days", "later"], {
      pass: "A near-term 30-day implementation window is available.",
      review: "The fit may be promising, but a concrete near-term start window is still needed.",
      stop: "Re-run the check when a concrete start window is available.",
    }),
    gate("budgetAuthority", answers.budgetAuthority, "can-authorize-499", ["needs-approval"], {
      pass: "The respondent can authorize the fixed pilot fee after human review.",
      review: "A separate budget decision-maker must review the written scope.",
      stop: "There is no current budget path for the fixed $499 pilot.",
    }),
  ];

  const hardStopIds: QualificationField[] = ["dataMode", "recordIntegrity", "credentialBoundary", "budgetAuthority"];
  const hasHardStop = gates.some((item) => hardStopIds.includes(item.id) && item.state === "stop");
  const hasPreparationGate = gates.some((item) => item.state !== "pass");

  if (hasHardStop) {
    return {
      decision: "not-a-current-fit",
      title: "Not a current fit",
      summary: "At least one non-negotiable pilot boundary is not satisfied. Do not proceed to payment or treat this result as an invitation.",
      missingFields: [],
      gates,
    };
  }

  if (hasPreparationGate) {
    return {
      decision: "prepare-first",
      title: "Promising fit — prepare first",
      summary: "The safety boundaries pass, but cadence, workflow, timing, or authority needs preparation before a human scope review.",
      missingFields: [],
      gates,
    };
  }

  return {
    decision: "ready-for-human-review",
    title: "Ready for human scope review",
    summary: "The deterministic fit gates pass. This is not acceptance, an offer, or a reservation; a human must still review scope and capacity.",
    missingFields: [],
    gates,
  };
}

export function buildLabScopeSummary(input: LabQualificationAnswers, result: LabQualificationResult): string {
  const answerLines = qualificationQuestions.map((question) => {
    const selected = question.options.find((option) => option.value === input[question.id]);
    return `- ${question.eyebrow}: ${selected?.label ?? "Invalid or missing"}`;
  });
  const gateLines = result.gates.map((item) => `- ${item.label}: ${item.state.toUpperCase()} — ${item.detail}`);

  return [
    "RUNBOOK FOUNDING CREATOR LAB — LOCAL FIT CHECK",
    "",
    "Non-identifying summary. Generated locally; this flow does not submit or store the answers with Runbook.",
    `Result: ${result.title}`,
    `Interpretation: ${result.summary}`,
    "",
    "DECLARED FIT INPUTS",
    ...answerLines,
    "",
    "DETERMINISTIC GATES",
    ...(gateLines.length > 0 ? gateLines : ["- No gate result until all questions are complete."]),
    "",
    "FIXED HUMAN-REVIEW BOUNDARY",
    "This fit check is not investment advice, offer acceptance, a place reservation, a payment, or approval to join the Lab. A human must review scope, truth boundaries, privacy, and capacity. Runbook receives no brokerage credential through this flow.",
  ].join("\n");
}
