export {
  importEventSchema,
  publicSnapshotSchema,
  type ImportEvent,
  type PublicSnapshot,
  type PolicyCheck,
  type RiskPolicy,
  type TradeProposal,
} from "@runbook/engine/schema";
export { evaluateProposal, processScore } from "@runbook/engine/policy";

import type { RiskPolicy, TradeProposal } from "@runbook/engine/schema";

export type LedgerEvent = {
  id: string;
  time: string;
  kind: "charter" | "decision" | "approval" | "execution" | "review";
  title: string;
  detail: string;
  source: string;
  hash?: string;
};

export async function fingerprintPayload(payload: string) {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const masonPolicy: RiskPolicy = {
  capitalBudget: 500,
  cashReserve: 125,
  maxPositionPercent: 25,
  maxOrderNotional: 125,
  maxDrawdownPercent: 8,
  maxDailyTrades: 2,
  allowedInstruments: ["equity"],
  allowedSymbols: [],
  deniedSymbols: [],
  approvalRequired: true,
};

export const demoProposal: TradeProposal = {
  proposalId: "proposal-vti-001",
  experimentId: "RUN-001",
  symbol: "VTI",
  instrument: "equity",
  side: "buy",
  notional: 100,
  projectedPositionNotional: 100,
  dailyTradesAfter: 1,
  currentDrawdownPercent: 0.6,
  hasThesis: true,
  hasInvalidation: true,
  evidenceSourceCount: 2,
};

export const demoEvents: LedgerEvent[] = [
  {
    id: "evt-004",
    time: "Jul 21 · 10:42",
    kind: "review",
    title: "Weekly review closed",
    detail: "No mandate changes. Broad-market baseline remains the control.",
    source: "Human review",
  },
  {
    id: "evt-003",
    time: "Jul 18 · 15:31",
    kind: "execution",
    title: "VTI order recorded",
    detail: "$100 notional · human approved · inside 25% position cap.",
    source: "Robinhood MCP import",
    hash: "a71e92f0",
  },
  {
    id: "evt-002",
    time: "Jul 18 · 15:28",
    kind: "approval",
    title: "Proposal approved",
    detail: "Ten of ten deterministic checks passed before execution.",
    source: "Runbook preflight",
  },
  {
    id: "evt-001",
    time: "Jul 15 · 09:00",
    kind: "charter",
    title: "Mandate v1.0 activated",
    detail: "$500 budget · long equities only · 8% drawdown stop.",
    source: "MasonWyatt23",
    hash: "f3b0c9d1",
  },
];
