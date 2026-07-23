import { describe, expect, it } from "vitest";
import {
  buildLabScopeSummary,
  EMPTY_LAB_QUALIFICATION,
  evaluateLabQualification,
  type LabQualificationAnswers,
} from "./lab-qualification";

const readyAnswers: LabQualificationAnswers = {
  publishingCadence: "weekly-plus",
  audienceWorkflow: "existing-recurring",
  dataMode: "synthetic-paper-ok",
  recordIntegrity: "preserve-complete-record",
  credentialBoundary: "no-credentials",
  startWindow: "within-30-days",
  budgetAuthority: "can-authorize-499",
};

describe("Founding Creator Lab qualification", () => {
  it("fails closed when any answer is missing or outside the enumerated contract", () => {
    expect(evaluateLabQualification(EMPTY_LAB_QUALIFICATION)).toMatchObject({
      decision: "incomplete",
      missingFields: expect.arrayContaining(["publishingCadence", "credentialBoundary", "budgetAuthority"]),
    });

    expect(evaluateLabQualification({ ...readyAnswers, dataMode: "live-broker-import" as never })).toMatchObject({
      decision: "incomplete",
      missingFields: ["dataMode"],
      gates: [],
    });
  });

  it.each([
    ["real-money requirement", { dataMode: "real-money-required" }],
    ["selective record", { recordIntegrity: "selective-record-only" }],
    ["credential requirement", { credentialBoundary: "credentials-required" }],
    ["no budget path", { budgetAuthority: "no-current-budget" }],
  ] as const)("stops on the %s boundary", (_label, change) => {
    const result = evaluateLabQualification({ ...readyAnswers, ...change });
    expect(result.decision).toBe("not-a-current-fit");
    expect(result.gates.some((item) => item.state === "stop")).toBe(true);
    expect(result.summary).toContain("Do not proceed to payment");
  });

  it("routes operational gaps to preparation without weakening safety gates", () => {
    const result = evaluateLabQualification({
      ...readyAnswers,
      publishingCadence: "monthly",
      audienceWorkflow: "early-recurring",
      startWindow: "within-60-days",
      budgetAuthority: "needs-approval",
    });

    expect(result.decision).toBe("prepare-first");
    expect(result.gates.filter((item) => item.state === "review")).toHaveLength(4);
    expect(result.gates.filter((item) => item.state === "stop")).toHaveLength(0);
  });

  it("never converts a full pass into automatic acceptance", () => {
    const result = evaluateLabQualification(readyAnswers);
    expect(result.decision).toBe("ready-for-human-review");
    expect(result.title).toBe("Ready for human scope review");
    expect(result.summary).toContain("not acceptance");
    expect(result.gates.every((item) => item.state === "pass")).toBe(true);
  });

  it("builds a deterministic non-identifying scope summary", () => {
    const result = evaluateLabQualification(readyAnswers);
    const first = buildLabScopeSummary(readyAnswers, result);
    const second = buildLabScopeSummary(readyAnswers, result);

    expect(first).toBe(second);
    expect(first).toContain("Generated locally; this flow does not submit or store the answers");
    expect(first).toContain("not investment advice, offer acceptance");
    expect(first).not.toContain("undefined");
    expect(first).not.toContain("@runbook");
  });
});
