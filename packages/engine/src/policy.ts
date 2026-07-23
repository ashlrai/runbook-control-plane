import {
  type PolicyCheck,
  type RiskPolicy,
  type TradeProposal,
  riskPolicySchema,
  tradeProposalSchema,
} from "./schema.js";

export type PreflightResult = {
  allowed: boolean;
  enforcement: "advisory";
  checks: PolicyCheck[];
};

export function evaluateProposal(
  rawPolicy: RiskPolicy,
  rawProposal: TradeProposal,
): PreflightResult {
  const policy = riskPolicySchema.parse(rawPolicy);
  const proposal = tradeProposalSchema.parse(rawProposal);
  const symbol = proposal.symbol.toUpperCase();
  const allowedSymbols = new Set(policy.allowedSymbols.map((item) => item.toUpperCase()));
  const deniedSymbols = new Set(policy.deniedSymbols.map((item) => item.toUpperCase()));
  const deployableCapital = policy.capitalBudget - policy.cashReserve;
  const maxPosition = policy.capitalBudget * (policy.maxPositionPercent / 100);

  const checks: PolicyCheck[] = [
    {
      id: "instrument.allowed",
      label: "Instrument permitted",
      passed: policy.allowedInstruments.includes(proposal.instrument),
      severity: "hard",
      detail: proposal.instrument,
    },
    {
      id: "symbol.not-denied",
      label: "Symbol not restricted",
      passed: !deniedSymbols.has(symbol),
      severity: "hard",
      detail: deniedSymbols.has(symbol) ? `${symbol} is on the restricted list` : `${symbol} is not restricted`,
    },
    {
      id: "symbol.allowed",
      label: "Symbol inside allowlist",
      passed: allowedSymbols.size === 0 || allowedSymbols.has(symbol),
      severity: "hard",
      detail: allowedSymbols.size === 0 ? "No allowlist configured" : `${symbol} checked against allowlist`,
    },
    {
      id: "capital.deployable",
      label: "Inside deployable capital",
      passed: proposal.notional <= deployableCapital,
      severity: "hard",
      detail: `$${proposal.notional.toFixed(2)} proposed · $${deployableCapital.toFixed(2)} deployable`,
    },
    {
      id: "order.notional",
      label: "Inside order cap",
      passed: proposal.notional <= policy.maxOrderNotional,
      severity: "hard",
      detail: `$${proposal.notional.toFixed(2)} proposed · $${policy.maxOrderNotional.toFixed(2)} max order`,
    },
    {
      id: "position.cap",
      label: "Inside position cap",
      passed: proposal.projectedPositionNotional <= maxPosition,
      severity: "hard",
      detail: `$${proposal.projectedPositionNotional.toFixed(2)} projected · $${maxPosition.toFixed(2)} max position`,
    },
    {
      id: "trades.daily",
      label: "Daily trade limit",
      passed: proposal.dailyTradesAfter <= policy.maxDailyTrades,
      severity: "hard",
      detail: `${proposal.dailyTradesAfter} of ${policy.maxDailyTrades} trades`,
    },
    {
      id: "drawdown.stop",
      label: "Drawdown stop",
      passed: proposal.currentDrawdownPercent < policy.maxDrawdownPercent,
      severity: "hard",
      detail: `${proposal.currentDrawdownPercent.toFixed(2)}% current · ${policy.maxDrawdownPercent.toFixed(2)}% stop`,
    },
    {
      id: "decision.complete",
      label: "Decision record complete",
      passed: proposal.hasThesis && proposal.hasInvalidation,
      severity: "hard",
      detail:
        proposal.hasThesis && proposal.hasInvalidation
          ? "Thesis and falsifier attached"
          : "Thesis or falsifier missing",
    },
    {
      id: "evidence.present",
      label: "Evidence attached",
      passed: proposal.evidenceSourceCount > 0,
      severity: "advisory",
      detail: `${proposal.evidenceSourceCount} source${proposal.evidenceSourceCount === 1 ? "" : "s"} attached`,
    },
  ];

  return {
    allowed: checks.filter((check) => check.severity === "hard").every((check) => check.passed),
    enforcement: "advisory",
    checks,
  };
}

export function processScore(
  checks: PolicyCheck[],
  reviewedDecisions: number,
  totalDecisions: number,
) {
  if (checks.length === 0) return 0;
  const compliance = checks.filter((check) => check.passed).length / checks.length;
  const reviewRate = totalDecisions === 0 ? 0 : reviewedDecisions / totalDecisions;
  return Math.round((compliance * 0.7 + reviewRate * 0.3) * 100);
}
