/**
 * Closed synthetic curriculum for charter process quality.
 * Not market data. Not investment advice. Not live trading.
 */

import type { RiskPolicy, TradeProposal } from "@runbook/engine/schema";

export const PRODUCT_SURFACE = "Shadow Process Laboratory" as const;
export const CURRICULUM_ID = "runbook.shadow-curriculum.synthetic.v1" as const;

export type CurriculumTag =
  | "clean-allowlisted-equity"
  | "denied-symbol"
  | "options-blocked"
  | "crypto-blocked"
  | "oversize-order"
  | "oversize-position"
  | "daily-cap"
  | "drawdown-halt"
  | "missing-thesis"
  | "missing-invalidation"
  | "zero-evidence"
  | "high-notional-within-cap"
  | "sell-allowlisted"
  | "empty-symbol-stress"
  /** Ledger-derived deny without a tighter closed-tag mapping. */
  | "ledger-observed-deny";

export const CURRICULUM_TAGS: readonly CurriculumTag[] = Object.freeze([
  "clean-allowlisted-equity",
  "denied-symbol",
  "options-blocked",
  "crypto-blocked",
  "oversize-order",
  "oversize-position",
  "daily-cap",
  "drawdown-halt",
  "missing-thesis",
  "missing-invalidation",
  "zero-evidence",
  "high-notional-within-cap",
  "sell-allowlisted",
  "empty-symbol-stress",
  "ledger-observed-deny",
]);

export type CurriculumScenario = {
  id: string;
  label: string;
  tags: CurriculumTag[];
  /** Expected under the reference elite equity charter. */
  shouldAllow: boolean;
  proposal: TradeProposal;
};

/** Elite process charter: equities-only, tight risk, approval required. Not return-optimized. */
export const REFERENCE_ELITE_POLICY: RiskPolicy = {
  capitalBudget: 500,
  cashReserve: 125,
  maxPositionPercent: 25,
  maxOrderNotional: 125,
  maxDrawdownPercent: 8,
  maxDailyTrades: 2,
  allowedInstruments: ["equity"],
  allowedSymbols: ["VTI", "BND", "VXUS"],
  deniedSymbols: ["GME", "AMC"],
  approvalRequired: true,
};

/** Alias used by modules that prefer the longer name. */
export const REFERENCE_ELITE_EQUITY_POLICY = REFERENCE_ELITE_POLICY;

/** Intentionally weak policy used to demonstrate recursive improvement. */
export const WEAK_STARTER_POLICY: RiskPolicy = {
  capitalBudget: 10_000,
  cashReserve: 100,
  maxPositionPercent: 90,
  maxOrderNotional: 9_000,
  maxDrawdownPercent: 50,
  maxDailyTrades: 100,
  allowedInstruments: ["equity", "option", "crypto"],
  allowedSymbols: [],
  deniedSymbols: [],
  approvalRequired: false,
};

const base = {
  experimentId: "CURRICULUM",
  side: "buy" as const,
  dailyTradesAfter: 1,
  currentDrawdownPercent: 1,
  hasThesis: true,
  hasInvalidation: true,
  evidenceSourceCount: 2,
};

/**
 * Frozen synthetic curriculum (16 scenarios).
 * Tags drive deterministic refinement rules in refine.ts.
 */
export const SHADOW_CURRICULUM: readonly CurriculumScenario[] = Object.freeze([
  {
    id: "clean-vti",
    label: "Clean allowlisted VTI buy within caps",
    tags: ["clean-allowlisted-equity"],
    shouldAllow: true,
    proposal: {
      ...base,
      proposalId: "curr-clean-vti",
      symbol: "VTI",
      instrument: "equity",
      notional: 100,
      projectedPositionNotional: 100,
    },
  },
  {
    id: "clean-bnd",
    label: "Clean allowlisted BND buy",
    tags: ["clean-allowlisted-equity"],
    shouldAllow: true,
    proposal: {
      ...base,
      proposalId: "curr-clean-bnd",
      symbol: "BND",
      instrument: "equity",
      notional: 80,
      projectedPositionNotional: 80,
    },
  },
  {
    id: "sell-vti",
    label: "Sell allowlisted equity",
    tags: ["sell-allowlisted", "clean-allowlisted-equity"],
    shouldAllow: true,
    proposal: {
      ...base,
      proposalId: "curr-sell-vti",
      symbol: "VTI",
      instrument: "equity",
      side: "sell",
      notional: 50,
      projectedPositionNotional: 50,
    },
  },
  {
    id: "denied-gme",
    label: "Denied meme equity GME",
    tags: ["denied-symbol"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-gme",
      symbol: "GME",
      instrument: "equity",
      notional: 50,
      projectedPositionNotional: 50,
    },
  },
  {
    id: "denied-amc",
    label: "Denied meme equity AMC",
    tags: ["denied-symbol"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-amc",
      symbol: "AMC",
      instrument: "equity",
      notional: 40,
      projectedPositionNotional: 40,
    },
  },
  {
    id: "options-spy",
    label: "Options instrument blocked",
    tags: ["options-blocked"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-opt",
      symbol: "SPY",
      instrument: "option",
      notional: 50,
      projectedPositionNotional: 50,
    },
  },
  {
    id: "crypto-btc",
    label: "Crypto instrument blocked",
    tags: ["crypto-blocked"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-btc",
      symbol: "BTC",
      instrument: "crypto",
      notional: 50,
      projectedPositionNotional: 50,
    },
  },
  {
    id: "oversize-order",
    label: "Order notional above elite cap",
    tags: ["oversize-order"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-over-order",
      symbol: "VTI",
      instrument: "equity",
      notional: 300,
      projectedPositionNotional: 300,
    },
  },
  {
    id: "oversize-position",
    label: "Projected position above elite process cap",
    tags: ["oversize-position"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-over-pos",
      symbol: "VTI",
      instrument: "equity",
      notional: 100,
      projectedPositionNotional: 3_000,
    },
  },
  {
    id: "daily-cap",
    label: "Exceeds daily trade limit",
    tags: ["daily-cap"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-daily",
      symbol: "VTI",
      instrument: "equity",
      notional: 50,
      projectedPositionNotional: 50,
      dailyTradesAfter: 5,
    },
  },
  {
    id: "drawdown-halt",
    label: "At or past drawdown stop",
    tags: ["drawdown-halt"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-dd",
      symbol: "VTI",
      instrument: "equity",
      notional: 50,
      projectedPositionNotional: 50,
      currentDrawdownPercent: 12,
    },
  },
  {
    id: "missing-thesis",
    label: "Missing thesis",
    tags: ["missing-thesis"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-no-thesis",
      symbol: "VTI",
      instrument: "equity",
      notional: 50,
      projectedPositionNotional: 50,
      hasThesis: false,
    },
  },
  {
    id: "missing-invalidation",
    label: "Missing invalidation",
    tags: ["missing-invalidation"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-no-inv",
      symbol: "VTI",
      instrument: "equity",
      notional: 50,
      projectedPositionNotional: 50,
      hasInvalidation: false,
    },
  },
  {
    id: "zero-evidence",
    label: "Zero evidence sources (advisory)",
    tags: ["zero-evidence", "clean-allowlisted-equity"],
    shouldAllow: true,
    proposal: {
      ...base,
      proposalId: "curr-no-ev",
      symbol: "VTI",
      instrument: "equity",
      notional: 50,
      projectedPositionNotional: 50,
      evidenceSourceCount: 0,
    },
  },
  {
    id: "within-cap-high",
    label: "High but within elite caps",
    tags: ["high-notional-within-cap", "clean-allowlisted-equity"],
    shouldAllow: true,
    proposal: {
      ...base,
      proposalId: "curr-high",
      symbol: "VXUS",
      instrument: "equity",
      notional: 125,
      projectedPositionNotional: 125,
    },
  },
  {
    id: "unknown-symbol",
    label: "Symbol outside allowlist",
    tags: ["empty-symbol-stress"],
    shouldAllow: false,
    proposal: {
      ...base,
      proposalId: "curr-xyz",
      symbol: "XYZ",
      instrument: "equity",
      notional: 50,
      projectedPositionNotional: 50,
    },
  },
]);

/** Alias kept for callers that prefer the synthetic naming. */
export const SYNTHETIC_CURRICULUM = SHADOW_CURRICULUM;

export function curriculumScenarioCount(): number {
  return SHADOW_CURRICULUM.length;
}

export function curriculumScenarioIds(): string[] {
  return SHADOW_CURRICULUM.map((scenario) => scenario.id);
}

export function curriculumTagSet(): string[] {
  const tags = new Set<string>();
  for (const scenario of SHADOW_CURRICULUM) {
    for (const tag of scenario.tags) tags.add(tag);
  }
  return [...tags].sort();
}
