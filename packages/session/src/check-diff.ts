/**
 * Check-by-check dual preflight theater: ledger policy vs session policy.
 * Process disagreement theater — not risk scoring for live capital.
 */

import { evaluateProposal, type PreflightResult } from "@runbook/engine/policy";
import type { RiskPolicy, TradeProposal } from "@runbook/engine/schema";
import { resolveCharterDualEval, type CharterBindingEnforcement } from "./charter-binding.js";

export type PolicyCheckRow = Readonly<{
  id: string;
  label: string;
  ledgerPassed: boolean | null;
  sessionPassed: boolean | null;
  agreement: "both-pass" | "both-fail" | "ledger-only" | "session-only" | "missing";
}>;

export type DualCheckDiffReport = Readonly<{
  schemaVersion: "runbook.dual-check-diff.v1";
  ledgerAllowed: boolean;
  sessionAllowed: boolean | null;
  processAllowed: boolean;
  processDeniedBySession: boolean;
  sessionCharterBinding: string;
  charterBindingEnforcement: CharterBindingEnforcement;
  checks: PolicyCheckRow[];
  disagreementCount: number;
  brokerEffect: false;
  compositeScore: false;
  notTradingPerformance: true;
  message: string;
}>;

function indexChecks(result: PreflightResult): Map<string, { label: string; passed: boolean }> {
  const map = new Map<string, { label: string; passed: boolean }>();
  for (const check of result.checks) {
    map.set(check.id, { label: check.label, passed: check.passed });
  }
  return map;
}

/**
 * Evaluate the same proposal under ledger charter and session charter; align checks by id.
 */
export function buildDualCheckDiff(input: {
  ledgerPolicy: RiskPolicy;
  sessionPolicy: RiskPolicy | undefined;
  proposal: TradeProposal;
  enforcement: CharterBindingEnforcement;
}): DualCheckDiffReport {
  const ledgerEval = evaluateProposal(input.ledgerPolicy, input.proposal);
  const sessionEval =
    input.sessionPolicy !== undefined ? evaluateProposal(input.sessionPolicy, input.proposal) : undefined;

  const dual = resolveCharterDualEval({
    ledgerAllowed: ledgerEval.allowed,
    sessionPresent: true,
    sessionHasCharter: input.sessionPolicy !== undefined,
    ...(sessionEval !== undefined ? { sessionAllowed: sessionEval.allowed } : {}),
    enforcement: input.enforcement,
  });

  const ledgerMap = indexChecks(ledgerEval);
  const sessionMap = sessionEval ? indexChecks(sessionEval) : new Map();
  const ids = new Set([...ledgerMap.keys(), ...sessionMap.keys()]);
  const checks: PolicyCheckRow[] = [...ids].sort().map((id) => {
    const ledger = ledgerMap.get(id);
    const session = sessionMap.get(id);
    const ledgerPassed = ledger?.passed ?? null;
    const sessionPassed = session?.passed ?? null;
    let agreement: PolicyCheckRow["agreement"] = "missing";
    if (ledgerPassed === null || sessionPassed === null) agreement = "missing";
    else if (ledgerPassed && sessionPassed) agreement = "both-pass";
    else if (!ledgerPassed && !sessionPassed) agreement = "both-fail";
    else if (ledgerPassed && !sessionPassed) agreement = "ledger-only";
    else agreement = "session-only";
    return {
      id,
      label: ledger?.label ?? session?.label ?? id,
      ledgerPassed,
      sessionPassed,
      agreement,
    };
  });

  const disagreementCount = checks.filter(
    (c) => c.agreement === "ledger-only" || c.agreement === "session-only",
  ).length;

  return {
    schemaVersion: "runbook.dual-check-diff.v1",
    ledgerAllowed: dual.ledgerAllowed,
    sessionAllowed: dual.sessionPolicyAllowed ?? null,
    processAllowed: dual.allowed,
    processDeniedBySession: dual.processDeniedBySession,
    sessionCharterBinding: dual.sessionCharterBinding,
    charterBindingEnforcement: dual.charterBindingEnforcement,
    checks,
    disagreementCount,
    brokerEffect: false,
    compositeScore: false,
    notTradingPerformance: true,
    message:
      disagreementCount === 0
        ? "Ledger and session check sets agree on this proposal (process layer)."
        : `${disagreementCount} check-level disagreement(s) — mandate fidelity theater, not capital risk grade.`,
  };
}
