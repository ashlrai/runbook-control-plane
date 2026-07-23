import { describe, expect, it } from "vitest";
import {
  reviewPublicationDraft,
  scoreContentObservation,
  type PublicationDraft,
} from "./content.js";

const safeDraft: PublicationDraft = {
  surface: "robinhood-social",
  format: "review",
  body: "Week one: +0.8% over seven days versus +0.7% for VTI. The difference is noise. I own VTI. This is a limited personal experiment.",
  manualPublish: true,
  synthetic: false,
  syntheticLabelPresent: false,
  namesSecurity: true,
  holdingsDisclosurePresent: true,
  hasPerformanceClaim: true,
  measurementPeriodPresent: true,
  benchmarkPresent: true,
  limitationsPresent: true,
  materialConnection: "none",
  evidenceSourceCount: 2,
};

describe("reviewPublicationDraft", () => {
  it("clears a contextualized draft only for human review", () => {
    const review = reviewPublicationDraft(safeDraft);
    expect(review.readyForHumanReview).toBe(true);
    expect(review.humanReviewRequired).toBe(true);
    expect(review.checks).toHaveLength(9);
  });

  it("blocks trade directives, guarantees, and Social sales calls to action", () => {
    const review = reviewPublicationDraft({
      ...safeDraft,
      body: "Guaranteed easy money. You should buy this now. Join my waitlist for $19/month.",
    });
    expect(review.readyForHumanReview).toBe(false);
    expect(review.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(
      expect.arrayContaining(["no-guarantee", "no-trade-directive", "social-commercial-boundary"]),
    );
  });

  it("requires synthetic labels, holdings disclosure, and performance context", () => {
    const review = reviewPublicationDraft({
      ...safeDraft,
      synthetic: true,
      syntheticLabelPresent: false,
      holdingsDisclosurePresent: false,
      benchmarkPresent: false,
    });
    expect(review.readyForHumanReview).toBe(false);
    expect(review.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(
      expect.arrayContaining(["synthetic-label", "holdings-disclosure", "performance-context"]),
    );
  });
});

describe("scoreContentObservation", () => {
  it("continues a compliant format with qualified signal while preserving causality caveat", () => {
    const outcome = scoreContentObservation({
      observationId: "obs-1",
      hypothesis: "Rules-before-results earns substantive questions.",
      format: "charter",
      followersBefore: 100,
      followersAfter24h: 106,
      likesAfter24h: 14,
      commentsAfter24h: 4,
      substantiveQuestionsAfter24h: 3,
      qualifiedConversationsAfter24h: 1,
      manualPublish: true,
      complianceReviewed: true,
      manufacturedEvent: false,
    });
    expect(outcome).toMatchObject({ eligible: true, observedFollowerChange: 6, decision: "continue" });
    expect(outcome.caveat).toContain("does not establish");
  });

  it("stops observations that fail an integrity gate", () => {
    const outcome = scoreContentObservation({
      observationId: "obs-2",
      hypothesis: "A manufactured trade gets attention.",
      format: "decision",
      followersBefore: 100,
      followersAfter24h: 140,
      likesAfter24h: 100,
      commentsAfter24h: 20,
      substantiveQuestionsAfter24h: 10,
      qualifiedConversationsAfter24h: 4,
      manualPublish: true,
      complianceReviewed: true,
      manufacturedEvent: true,
    });
    expect(outcome).toMatchObject({ eligible: false, decision: "stop" });
  });
});
