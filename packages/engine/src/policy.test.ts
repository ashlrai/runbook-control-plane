import { describe, expect, it } from "vitest";
import { evaluateProposal } from "./policy.js";
import type { RiskPolicy, TradeProposal } from "./schema.js";

const policy: RiskPolicy = {
  capitalBudget: 500,
  cashReserve: 125,
  maxPositionPercent: 25,
  maxOrderNotional: 125,
  maxDrawdownPercent: 8,
  maxDailyTrades: 2,
  allowedInstruments: ["equity"],
  allowedSymbols: ["VTI", "BND"],
  deniedSymbols: ["GME"],
  approvalRequired: true,
};

const proposal: TradeProposal = {
  proposalId: "proposal-001",
  experimentId: "RUN-001",
  symbol: "VTI",
  instrument: "equity",
  side: "buy",
  notional: 100,
  projectedPositionNotional: 100,
  dailyTradesAfter: 1,
  currentDrawdownPercent: 0.5,
  hasThesis: true,
  hasInvalidation: true,
  evidenceSourceCount: 2,
};

describe("evaluateProposal", () => {
  it("allows a proposal that passes every hard control", () => {
    const result = evaluateProposal(policy, proposal);
    expect(result.allowed).toBe(true);
    expect(result.enforcement).toBe("advisory");
    expect(result.checks).toHaveLength(10);
  });

  it("blocks a denied symbol even when other controls pass", () => {
    const result = evaluateProposal(policy, { ...proposal, symbol: "gme" });
    expect(result.allowed).toBe(false);
    expect(result.checks.find((check) => check.id === "symbol.not-denied")?.passed).toBe(false);
  });

  it("blocks at the drawdown threshold rather than after it", () => {
    const result = evaluateProposal(policy, { ...proposal, currentDrawdownPercent: 8 });
    expect(result.allowed).toBe(false);
    expect(result.checks.find((check) => check.id === "drawdown.stop")?.passed).toBe(false);
  });

  it("does not let an advisory evidence failure override hard controls", () => {
    const result = evaluateProposal(policy, { ...proposal, evidenceSourceCount: 0 });
    expect(result.allowed).toBe(true);
    expect(result.checks.find((check) => check.id === "evidence.present")?.passed).toBe(false);
  });
});
