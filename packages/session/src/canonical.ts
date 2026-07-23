import { createHash } from "node:crypto";
import type { RiskPolicy } from "@runbook/engine/schema";
import type { InventoryToolEntry } from "./types.js";

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable charter digest for binding (sorted JSON keys via JSON.stringify of normalized shape). */
export function charterDigest(policy: RiskPolicy): string {
  const normalized = {
    capitalBudget: policy.capitalBudget,
    cashReserve: policy.cashReserve,
    maxPositionPercent: policy.maxPositionPercent,
    maxOrderNotional: policy.maxOrderNotional,
    maxDrawdownPercent: policy.maxDrawdownPercent,
    maxDailyTrades: policy.maxDailyTrades,
    allowedInstruments: [...policy.allowedInstruments].sort(),
    allowedSymbols: [...policy.allowedSymbols].map((s) => s.toUpperCase()).sort(),
    deniedSymbols: [...policy.deniedSymbols].map((s) => s.toUpperCase()).sort(),
    approvalRequired: policy.approvalRequired,
  };
  return sha256Hex(JSON.stringify(normalized));
}

export function toolSetSha256(toolNames: readonly string[]): string {
  const sorted = [...new Set(toolNames.map((n) => n.trim()).filter(Boolean))].sort();
  return sha256Hex(sorted.join("\n"));
}

export function toolSetSha256FromEntries(tools: readonly InventoryToolEntry[]): string {
  return toolSetSha256(tools.map((t) => t.name));
}

export function newId(prefix: string): string {
  const rand = sha256Hex(`${Date.now()}-${Math.random()}`).slice(0, 12);
  return `${prefix}-${rand}`;
}
