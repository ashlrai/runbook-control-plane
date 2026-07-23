import { describe, expect, it } from "vitest";
import {
  buildSocialBaselineExport,
  buildSocialBaselineRecord,
  socialBaselineSchema,
  summarizeSocialBaselines,
  type SocialBaselineInput,
} from "./social-baseline";

const input: SocialBaselineInput = {
  capturedAtLocal: "2026-07-21T14:30",
  bioVariant: "unchanged",
  counterAvailability: {
    following: "available",
    postsWithEngagement: "available",
    reactions: "available",
    comments: "available",
    impressions: "not-available",
    profileViews: "unclear",
  },
  counts: {
    followerCount: 12,
    followingCount: 7,
    existingPostCount: 3,
    postsWithEngagementCount: 2,
    totalVisibleReactions: 9,
    totalVisibleComments: 4,
    totalVisibleImpressions: null,
    profileViewsCount: null,
  },
};

function record(overrides: Partial<SocialBaselineInput> = {}, id = "019f86c5-9fb1-7642-9c6f-60b62038bb09") {
  return buildSocialBaselineRecord(
    { ...input, ...overrides },
    { baselineId: id, recordedAt: "2026-07-21T20:00:00.000Z", nowMs: Date.parse("2026-07-21T20:00:00.000Z") },
  );
}

describe("Robinhood Social baseline records", () => {
  it("accepts only strict, aggregate, manual records", () => {
    const baseline = record();
    expect(baseline).toMatchObject({
      schemaVersion: "runbook.social-baseline.v1",
      source: "manual-robinhood-client-observation",
      observationalOnly: true,
      bioVariant: "unchanged",
    });
    expect(() => socialBaselineSchema.parse({ ...baseline, username: "not-allowed" })).toThrow();
    expect(() => socialBaselineSchema.parse({ ...baseline, postText: "not-allowed" })).toThrow();
  });

  it("requires an available counter to have a count and unavailable counters to remain null", () => {
    expect(() => record({
      counts: { ...input.counts, totalVisibleReactions: null },
    })).toThrow(/required/);
    expect(() => record({
      counterAvailability: { ...input.counterAvailability, impressions: "unclear" },
      counts: { ...input.counts, totalVisibleImpressions: 100 },
    })).toThrow(/must remain null/);
  });

  it("rejects impossible aggregate and future observations", () => {
    expect(() => record({
      counts: { ...input.counts, existingPostCount: 2, postsWithEngagementCount: 3 },
    })).toThrow(/cannot exceed/);
    expect(() => record({ capturedAtLocal: "2026-07-22T14:30" })).toThrow(/future/);
  });

  it("summarizes raw observed deltas without adding a causal score", () => {
    const first = record();
    const second = record({
      capturedAtLocal: "2026-07-21T15:30",
      counts: { ...input.counts, followerCount: 15, followingCount: 8, existingPostCount: 4 },
    }, "019f86c5-9fb1-7642-9c6f-60b62038bb10");
    const summary = summarizeSocialBaselines([second, first]);

    expect(summary).toMatchObject({
      recordCount: 2,
      latestFollowerCount: 15,
      observedFollowerDelta: 3,
      observedFollowingDelta: 1,
      latestExistingPostCount: 4,
    });
    expect(summary).not.toHaveProperty("rank");
    expect(summary).not.toHaveProperty("causalImpact");
  });

  it("exports only validated non-identifying JSON", () => {
    const exported = buildSocialBaselineExport([record()], "2026-07-21T19:05:00.000Z");
    const parsed = JSON.parse(exported) as Record<string, unknown>;

    expect(parsed.dataClass).toBe("non-identifying-aggregate-counts-only");
    expect(exported).toContain("Observed changes do not establish ranking behavior or causality");
    expect(exported).not.toMatch(/username|profileLink|postText|commentText|commentAuthor|screenshot|tradeSymbol/);
  });
});
