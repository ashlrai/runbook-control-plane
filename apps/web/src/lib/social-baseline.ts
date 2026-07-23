import { z } from "zod";

export const counterAvailabilitySchema = z.enum(["available", "not-available", "unclear"]);
export const bioVariantSchema = z.enum(["A", "B", "C", "unchanged"]);

const boundedCountSchema = z.number().int().nonnegative().max(100_000_000);
const optionalCountSchema = boundedCountSchema.nullable();

const counterAvailabilityKeys = [
  "following",
  "postsWithEngagement",
  "reactions",
  "comments",
  "impressions",
  "profileViews",
] as const;

const countByAvailability = {
  following: "followingCount",
  postsWithEngagement: "postsWithEngagementCount",
  reactions: "totalVisibleReactions",
  comments: "totalVisibleComments",
  impressions: "totalVisibleImpressions",
  profileViews: "profileViewsCount",
} as const;

export type CounterAvailabilityKey = (typeof counterAvailabilityKeys)[number];

export const socialBaselineSchema = z.object({
  schemaVersion: z.literal("runbook.social-baseline.v1"),
  baselineId: z.string().uuid(),
  capturedAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  source: z.literal("manual-robinhood-client-observation"),
  observationalOnly: z.literal(true),
  bioVariant: bioVariantSchema,
  counterAvailability: z.object({
    following: counterAvailabilitySchema,
    postsWithEngagement: counterAvailabilitySchema,
    reactions: counterAvailabilitySchema,
    comments: counterAvailabilitySchema,
    impressions: counterAvailabilitySchema,
    profileViews: counterAvailabilitySchema,
  }).strict(),
  counts: z.object({
    followerCount: boundedCountSchema,
    followingCount: optionalCountSchema,
    existingPostCount: boundedCountSchema,
    postsWithEngagementCount: optionalCountSchema,
    totalVisibleReactions: optionalCountSchema,
    totalVisibleComments: optionalCountSchema,
    totalVisibleImpressions: optionalCountSchema,
    profileViewsCount: optionalCountSchema,
  }).strict(),
}).strict().superRefine((baseline, context) => {
  for (const availabilityKey of counterAvailabilityKeys) {
    const countKey = countByAvailability[availabilityKey];
    const availability = baseline.counterAvailability[availabilityKey];
    const count = baseline.counts[countKey];
    if (availability === "available" && count === null) {
      context.addIssue({
        code: "custom",
        path: ["counts", countKey],
        message: `${countKey} is required when its counter is available.`,
      });
    }
    if (availability !== "available" && count !== null) {
      context.addIssue({
        code: "custom",
        path: ["counts", countKey],
        message: `${countKey} must remain null when its counter is not available or unclear.`,
      });
    }
  }

  if (
    baseline.counts.postsWithEngagementCount !== null &&
    baseline.counts.postsWithEngagementCount > baseline.counts.existingPostCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["counts", "postsWithEngagementCount"],
      message: "Posts with engagement cannot exceed the total existing-post count.",
    });
  }
});

export type SocialBaseline = z.infer<typeof socialBaselineSchema>;
export type CounterAvailability = z.infer<typeof counterAvailabilitySchema>;
export type BioVariant = z.infer<typeof bioVariantSchema>;

export type SocialBaselineInput = Pick<SocialBaseline, "bioVariant" | "counterAvailability" | "counts"> & {
  capturedAtLocal: string;
};

type BaselineBuildContext = {
  baselineId: string;
  recordedAt: string;
  nowMs: number;
};

export function buildSocialBaselineRecord(
  input: SocialBaselineInput,
  context: BaselineBuildContext,
): SocialBaseline {
  const capturedDate = new Date(input.capturedAtLocal);
  if (!input.capturedAtLocal || Number.isNaN(capturedDate.valueOf())) {
    throw new Error("Capture date and time must be a valid manual observation timestamp.");
  }
  if (capturedDate.valueOf() > context.nowMs + 5 * 60 * 1000) {
    throw new Error("Capture date and time cannot be in the future.");
  }

  return socialBaselineSchema.parse({
    schemaVersion: "runbook.social-baseline.v1",
    baselineId: context.baselineId,
    capturedAt: capturedDate.toISOString(),
    recordedAt: context.recordedAt,
    source: "manual-robinhood-client-observation",
    observationalOnly: true,
    bioVariant: input.bioVariant,
    counterAvailability: input.counterAvailability,
    counts: input.counts,
  });
}

export type SocialBaselineSummary = {
  recordCount: number;
  latestFollowerCount: number | null;
  observedFollowerDelta: number | null;
  latestFollowingCount: number | null;
  observedFollowingDelta: number | null;
  latestExistingPostCount: number | null;
  latestAvailableCounterCount: number;
};

export function summarizeSocialBaselines(records: readonly SocialBaseline[]): SocialBaselineSummary {
  const validRecords = records
    .map((record) => socialBaselineSchema.parse(record))
    .toSorted((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  const first = validRecords.at(0);
  const latest = validRecords.at(-1);
  const firstFollowing = first?.counts.followingCount ?? null;
  const latestFollowing = latest?.counts.followingCount ?? null;

  return {
    recordCount: validRecords.length,
    latestFollowerCount: latest?.counts.followerCount ?? null,
    observedFollowerDelta: first && latest ? latest.counts.followerCount - first.counts.followerCount : null,
    latestFollowingCount: latestFollowing,
    observedFollowingDelta: firstFollowing !== null && latestFollowing !== null ? latestFollowing - firstFollowing : null,
    latestExistingPostCount: latest?.counts.existingPostCount ?? null,
    latestAvailableCounterCount: latest
      ? counterAvailabilityKeys.filter((key) => latest.counterAvailability[key] === "available").length
      : 0,
  };
}

export function buildSocialBaselineExport(records: readonly SocialBaseline[], exportedAt: string): string {
  const parsedExportedAt = z.iso.datetime().parse(exportedAt);
  const validRecords = records
    .map((record) => socialBaselineSchema.parse(record))
    .toSorted((left, right) => left.capturedAt.localeCompare(right.capturedAt));

  return JSON.stringify({
    schemaVersion: "runbook.social-baseline-export.v1",
    exportedAt: parsedExportedAt,
    dataClass: "non-identifying-aggregate-counts-only",
    source: "manual-robinhood-client-observation",
    limitations: [
      "No Robinhood access, scraping, uploads, or automated collection occurred.",
      "Counts are manual point-in-time observations and may be incomplete.",
      "Observed changes do not establish ranking behavior or causality.",
      "Unavailable and unclear counters remain null rather than being reconstructed.",
    ],
    baselines: validRecords,
  }, null, 2);
}
