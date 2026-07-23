/**
 * Clone & challenge — one-rule charter forks for process experiments.
 * Never claims "safer strategy" or returns. Parent digest lineage only.
 */

import type { RiskPolicy } from "@runbook/engine/schema";
import { riskPolicySchema } from "@runbook/engine/schema";

export type ChallengeMutationId =
  | "lower-max-order-notional"
  | "require-approval"
  | "deny-gme"
  | "equities-only"
  | "tighter-drawdown";

export type ChallengeMutation = Readonly<{
  id: ChallengeMutationId;
  label: string;
  detail: string;
  apply: (policy: RiskPolicy) => RiskPolicy;
}>;

function clonePolicy(policy: RiskPolicy): RiskPolicy {
  return riskPolicySchema.parse({
    ...policy,
    allowedInstruments: [...policy.allowedInstruments],
    allowedSymbols: [...policy.allowedSymbols],
    deniedSymbols: [...policy.deniedSymbols],
  });
}

export const CHALLENGE_MUTATIONS: readonly ChallengeMutation[] = [
  {
    id: "lower-max-order-notional",
    label: "Lower max order notional (−25%)",
    detail: "Tighter process limit — not a performance claim.",
    apply: (policy) => {
      const next = clonePolicy(policy);
      next.maxOrderNotional = Math.max(1, Math.floor(next.maxOrderNotional * 0.75));
      return riskPolicySchema.parse(next);
    },
  },
  {
    id: "require-approval",
    label: "Require approval",
    detail: "Force approvalRequired true on child charter.",
    apply: (policy) => riskPolicySchema.parse({ ...clonePolicy(policy), approvalRequired: true }),
  },
  {
    id: "deny-gme",
    label: "Deny GME",
    detail: "Add GME to deniedSymbols (idempotent).",
    apply: (policy) => {
      const next = clonePolicy(policy);
      const set = new Set(next.deniedSymbols.map((s) => s.toUpperCase()));
      set.add("GME");
      next.deniedSymbols = [...set].sort();
      return riskPolicySchema.parse(next);
    },
  },
  {
    id: "equities-only",
    label: "Equities only",
    detail: "Restrict allowedInstruments to equity.",
    apply: (policy) =>
      riskPolicySchema.parse({ ...clonePolicy(policy), allowedInstruments: ["equity"] }),
  },
  {
    id: "tighter-drawdown",
    label: "Tighter max drawdown (−2pp)",
    detail: "Reduce maxDrawdownPercent by 2 points (floor 1).",
    apply: (policy) => {
      const next = clonePolicy(policy);
      next.maxDrawdownPercent = Math.max(1, next.maxDrawdownPercent - 2);
      return riskPolicySchema.parse(next);
    },
  },
];

export function applyChallengeMutation(
  policy: RiskPolicy,
  mutationId: ChallengeMutationId,
): RiskPolicy {
  const mutation = CHALLENGE_MUTATIONS.find((m) => m.id === mutationId);
  if (!mutation) throw new Error(`Unknown challenge mutation: ${mutationId}`);
  return mutation.apply(policy);
}

export type CloneChallengeReceipt = Readonly<{
  schemaVersion: "runbook.clone-challenge.v1";
  parentSessionId: string;
  parentCharterDigest: string | null;
  childSessionId: string;
  mutationId: ChallengeMutationId;
  mutationLabel: string;
  notTradingPerformance: true;
  brokerEffect: false;
  compositeScore: false;
  capitalAtRisk: 0;
  note: string;
}>;

export function buildCloneChallengeReceipt(input: {
  parentSessionId: string;
  parentCharterDigest: string | null;
  childSessionId: string;
  mutationId: ChallengeMutationId;
}): CloneChallengeReceipt {
  const mutation = CHALLENGE_MUTATIONS.find((m) => m.id === input.mutationId);
  return {
    schemaVersion: "runbook.clone-challenge.v1",
    parentSessionId: input.parentSessionId,
    parentCharterDigest: input.parentCharterDigest,
    childSessionId: input.childSessionId,
    mutationId: input.mutationId,
    mutationLabel: mutation?.label ?? input.mutationId,
    notTradingPerformance: true,
    brokerEffect: false,
    compositeScore: false,
    capitalAtRisk: 0,
    note: "Child charter is a process fork only — not a safer strategy or returns claim. Lineage is digest binding, not identity.",
  };
}
