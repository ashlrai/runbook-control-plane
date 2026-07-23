/**
 * Aggregate process-quality health from a control-plane session.
 * Multi-axis only — never a composite safety grade.
 */

import type { ControlPlaneSession } from "./types.js";

export type ProcessHealthReport = Readonly<{
  schemaVersion: "runbook.process-health.v1";
  sessionId: string;
  tickCount: number;
  proceedCount: number;
  warnCount: number;
  stopCount: number;
  lastRecommendation: "proceed" | "warn" | "stop" | null;
  lastSessionCharterBinding: string | null;
  inventoryUnknownEver: string[];
  lastShadowHardFalseAllows: number | null;
  lastShadowHardFalseDenies: number | null;
  shadowGenerationCount: number;
  hasCharter: boolean;
  hasInventoryPin: boolean;
  charterBindingEnforcement: string;
  inventoryEnforcement: string;
  /** True when no stop ticks and last HFA is 0 when shadow exists. */
  processClean: boolean;
  brokerEffect: false;
  compositeScore: false;
  capitalAtRisk: 0;
  notTradingPerformance: true;
  message: string;
  limitations: readonly string[];
}>;

/**
 * Summarize processTicks + shadow metrics for operator/agent review.
 */
export function buildProcessHealthReport(session: ControlPlaneSession): ProcessHealthReport {
  const ticks = session.processTicks ?? [];
  let proceedCount = 0;
  let warnCount = 0;
  let stopCount = 0;
  const unknown = new Set<string>();
  for (const t of ticks) {
    if (t.recommendation === "proceed") proceedCount += 1;
    else if (t.recommendation === "warn") warnCount += 1;
    else stopCount += 1;
    for (const u of t.inventoryUnknownTools) unknown.add(u);
  }
  const last = ticks.length > 0 ? ticks[ticks.length - 1]! : null;
  const hasShadow = (session.shadowGenerations?.length ?? 0) > 0;
  const hfa = session.lastShadowHardFalseAllows;
  const processClean =
    stopCount === 0 &&
    (!hasShadow || hfa === 0) &&
    session.charter !== undefined &&
    session.inventoryPin !== undefined;

  const parts: string[] = [];
  parts.push(`ticks=${ticks.length} (proceed=${proceedCount} warn=${warnCount} stop=${stopCount})`);
  if (last) parts.push(`last=${last.recommendation}`);
  if (hasShadow) parts.push(`shadow HFA=${hfa ?? "—"} HFD=${session.lastShadowHardFalseDenies ?? "—"}`);
  parts.push(processClean ? "processClean=true" : "processClean=false");
  parts.push("Multi-axis process observation only — not a composite safety grade.");

  return {
    schemaVersion: "runbook.process-health.v1",
    sessionId: session.sessionId,
    tickCount: ticks.length,
    proceedCount,
    warnCount,
    stopCount,
    lastRecommendation: last?.recommendation ?? null,
    lastSessionCharterBinding: last?.sessionCharterBinding ?? null,
    inventoryUnknownEver: [...unknown].sort(),
    lastShadowHardFalseAllows: hfa ?? null,
    lastShadowHardFalseDenies: session.lastShadowHardFalseDenies ?? null,
    shadowGenerationCount: session.shadowGenerations?.length ?? 0,
    hasCharter: session.charter !== undefined,
    hasInventoryPin: session.inventoryPin !== undefined,
    charterBindingEnforcement: session.charterBindingEnforcement ?? "warn",
    inventoryEnforcement: session.inventoryEnforcement ?? "fail-closed",
    processClean,
    brokerEffect: false,
    compositeScore: false,
    capitalAtRisk: 0,
    notTradingPerformance: true,
    message: parts.join(" · "),
    limitations: [
      "process-observation-only",
      "not-composite-safety-grade",
      "not-trading-performance",
      "not-hard-broker-gateway",
      "host-may-bypass-runbook",
    ],
  };
}
