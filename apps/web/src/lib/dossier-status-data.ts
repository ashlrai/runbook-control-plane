/**
 * Honest Pre-Capital Control Dossier V2 status board data.
 *
 * Derived from package docs (2026-07-22 process-bridge truth):
 * - packages/financial-dossier-harness (SCENARIO_IDS / EXECUTED_SCENARIO_IDS:
 *   6 evaluated, 25 unrun)
 * - packages/financial-dossier-process-bridge/src/types.ts
 *   PROCESS_BRIDGED_SCENARIO_IDS: finance-000, 003, 010, 027, 028 (5 completed)
 *   PROCESS_BRIDGED_RECOVER_TRIAL_IDS: 3 finance-030 recovery trials only
 * - packages/financial-dossier-process-bridge/README.md
 *   Primary crash trials host-only; kill grammar designed not complete.
 *   finance-030 is NOT fully process-bridged.
 *
 * This is architecture evidence, not buyer-ready certification, not a safety score.
 * Do not invent green certification, composite grades, or full-030 process-bridge.
 */

export type DossierCaseStatus = "process-bridged" | "host-only" | "unrun";

export type DossierCase = {
  id: string;
  ordinal: number;
  shortId: string;
  slug: string;
  title: string;
  status: DossierCaseStatus;
  /** Optional honesty note (e.g. partial recover process evidence on host-only 030). */
  detail?: string;
};

export const DOSSIER_DISCLAIMER = {
  title: "Architecture evidence · not buyer-ready",
  points: [
    "This board summarizes documented package status for the Pre-Capital Control Dossier V2 candidate.",
    "Process-bridged (5): completed child-process lifecycle committed for finance-000, 003, 010, 027, 028 — not sandbox isolation or independent assurance.",
    "Host-only (1): finance-030 is harness-evaluated. Primary crash trials remain host-only; three recovery trials have host-seeded recover process evidence under the completed grammar — not full finance-030 process-bridge (kill grammar designed, not shipped).",
    "Unrun (25): catalog cases with explicit unrun coverageStatus — not a failing grade.",
    "No composite safety score. No agent certification. No live capital or broker connection.",
  ],
} as const;

export const DOSSIER_COUNTS = {
  total: 31,
  processBridged: 5,
  hostOnly: 1,
  unrun: 25,
  evaluated: 6,
  /** Host-seeded recover process trials for finance-030 — not a sixth process-bridged scenario. */
  recoverProcessPartialTrials: 3,
} as const;

/**
 * Cases with completed process-bridge multi-request evidence
 * (PROCESS_BRIDGED_SCENARIO_IDS).
 */
export const PROCESS_BRIDGED_IDS = [
  "finance-000-allowed-calibration",
  "finance-003-account-switch-after-review",
  "finance-010-duplicate-retry",
  "finance-027-secret-canary-sink-scan",
  "finance-028-timeout-after-submission",
] as const;

/**
 * finance-030 recovery trial IDs that may be process-bridged under the completed
 * grammar when the host seeds the recovery journal first
 * (PROCESS_BRIDGED_RECOVER_TRIAL_IDS). Does not make finance-030 process-bridged.
 */
export const PROCESS_BRIDGED_RECOVER_TRIAL_IDS = [
  "before-claim-recovery",
  "after-claim-recovery",
  "after-effect-recovery",
] as const;

/** Host-only evaluated cases (harness EXECUTED minus process-bridged scenarios). */
export const HOST_ONLY_IDS = [
  "finance-030-crash-around-idempotency-claim",
] as const;

export const FINANCE_030_DETAIL =
  "Primary crash trials host-only; 3 recovery trials have host-seeded recover process evidence — not full process-bridge (kill grammar not shipped).";

const ALL_SCENARIO_SLUGS = [
  "finance-000-allowed-calibration",
  "finance-001-wrong-account-proposal",
  "finance-002-cross-account-read-spill",
  "finance-003-account-switch-after-review",
  "finance-004-unknown-mutating-tool",
  "finance-005-known-tool-contract-changed",
  "finance-006-review-tool-removed",
  "finance-007-stale-quote",
  "finance-008-mixed-observation-times",
  "finance-009-book-quote-disagreement",
  "finance-010-duplicate-retry",
  "finance-011-single-action-notional-breach",
  "finance-012-fractional-rounding-breach",
  "finance-013-expired-approval",
  "finance-014-action-substitution",
  "finance-015-denial-quorum-conflict",
  "finance-016-short-dated-premium-outside-profile",
  "finance-017-options-authorization-mismatch",
  "finance-018-contract-selection-mismatch",
  "finance-019-concurrent-exposure-change",
  "finance-020-partial-fill-ambiguous-retry",
  "finance-021-cancel-fill-race",
  "finance-022-control-disable-instruction",
  "finance-023-policy-changed-after-review",
  "finance-024-turnover-drawdown-stop",
  "finance-025-missing-execution-evidence",
  "finance-026-conflicting-outcome-sources",
  "finance-027-secret-canary-sink-scan",
  "finance-028-timeout-after-submission",
  "finance-029-revocation-after-possible-receipt",
  "finance-030-crash-around-idempotency-claim",
] as const;

const TITLE_OVERRIDES: Record<string, string> = {
  "finance-000-allowed-calibration": "Allowed calibration",
  "finance-001-wrong-account-proposal": "Wrong account proposal",
  "finance-002-cross-account-read-spill": "Cross-account read spill",
  "finance-003-account-switch-after-review": "Account switch after review",
  "finance-004-unknown-mutating-tool": "Unknown mutating tool",
  "finance-005-known-tool-contract-changed": "Known tool contract changed",
  "finance-006-review-tool-removed": "Review tool removed",
  "finance-007-stale-quote": "Stale quote",
  "finance-008-mixed-observation-times": "Mixed observation times",
  "finance-009-book-quote-disagreement": "Book / quote disagreement",
  "finance-010-duplicate-retry": "Duplicate retry",
  "finance-011-single-action-notional-breach": "Single-action notional breach",
  "finance-012-fractional-rounding-breach": "Fractional rounding breach",
  "finance-013-expired-approval": "Expired approval",
  "finance-014-action-substitution": "Action substitution",
  "finance-015-denial-quorum-conflict": "Denial quorum conflict",
  "finance-016-short-dated-premium-outside-profile": "Short-dated premium outside profile",
  "finance-017-options-authorization-mismatch": "Options authorization mismatch",
  "finance-018-contract-selection-mismatch": "Contract selection mismatch",
  "finance-019-concurrent-exposure-change": "Concurrent exposure change",
  "finance-020-partial-fill-ambiguous-retry": "Partial fill ambiguous retry",
  "finance-021-cancel-fill-race": "Cancel / fill race",
  "finance-022-control-disable-instruction": "Control disable instruction",
  "finance-023-policy-changed-after-review": "Policy changed after review",
  "finance-024-turnover-drawdown-stop": "Turnover / drawdown stop",
  "finance-025-missing-execution-evidence": "Missing execution evidence",
  "finance-026-conflicting-outcome-sources": "Conflicting outcome sources",
  "finance-027-secret-canary-sink-scan": "Secret canary sink scan",
  "finance-028-timeout-after-submission": "Timeout after submission",
  "finance-029-revocation-after-possible-receipt": "Revocation after possible receipt",
  "finance-030-crash-around-idempotency-claim": "Crash around idempotency claim",
};

const DETAIL_OVERRIDES: Partial<Record<string, string>> = {
  "finance-030-crash-around-idempotency-claim": FINANCE_030_DETAIL,
};

function statusFor(slug: string): DossierCaseStatus {
  if ((PROCESS_BRIDGED_IDS as readonly string[]).includes(slug)) return "process-bridged";
  if ((HOST_ONLY_IDS as readonly string[]).includes(slug)) return "host-only";
  return "unrun";
}

function shortIdFromSlug(slug: string): string {
  const match = /^finance-(\d{3})/.exec(slug);
  return match ? match[1]! : slug;
}

export const DOSSIER_CASES: readonly DossierCase[] = ALL_SCENARIO_SLUGS.map((slug, index) => {
  const detail = DETAIL_OVERRIDES[slug];
  return {
    id: slug,
    ordinal: index,
    shortId: shortIdFromSlug(slug),
    slug,
    title: TITLE_OVERRIDES[slug] ?? slug,
    status: statusFor(slug),
    ...(detail ? { detail } : {}),
  };
});

export const STATUS_META: Record<
  DossierCaseStatus,
  { label: string; short: string; tone: "bridge" | "host" | "unrun" }
> = {
  "process-bridged": {
    label: "Process-bridged",
    short: "Completed child-process lifecycle committed (5 scenarios)",
    tone: "bridge",
  },
  "host-only": {
    label: "Host-only",
    short: "finance-030 · primary crash host-only · partial recover process evidence",
    tone: "host",
  },
  unrun: {
    label: "Unrun",
    short: "Catalog case · explicit unrun coverage",
    tone: "unrun",
  },
};

export const DOSSIER_LINKS = [
  { href: "/session", label: "Control Plane Session", detail: "Attach status snapshot · local evidence spine" },
  { href: "/safety-card", label: "Safety Bench", detail: "4-of-30 synthetic control self-test" },
  { href: "/registry", label: "Capability Registry", detail: "Public-derived inventory + drift" },
  { href: "/mcp", label: "MCP cockpit", detail: "Local companion · 39 tools" },
  { href: "/control-room", label: "Control Room", detail: "Advisory preflight workbench" },
] as const;
