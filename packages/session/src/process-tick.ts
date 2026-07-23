/**
 * Process-layer supervisor tick: inventory + dual-eval → proceed|warn|stop.
 * Not a hard broker gateway — host may still bypass Runbook.
 */

import type { InventoryCheckResult } from "./types.js";
import type { CharterDualEvalResult } from "./charter-binding.js";

export type ProcessTickRecommendation = "proceed" | "warn" | "stop";

export type ProcessTickResult = Readonly<{
  schemaVersion: "runbook.process-tick.v1";
  recommendation: ProcessTickRecommendation;
  inventoryOk: boolean;
  inventoryUnknownTools: string[];
  sessionCharterBinding: CharterDualEvalResult["sessionCharterBinding"] | "not-evaluated";
  ledgerAllowed?: boolean;
  processAllowed?: boolean;
  processDeniedBySession: boolean;
  charterBindingEnforcement?: CharterDualEvalResult["charterBindingEnforcement"];
  message: string;
  brokerEffect: false;
  compositeScore: false;
  capitalAtRisk: 0;
  limitations: readonly string[];
}>;

const LIMITATIONS = [
  "process-layer-only-not-hard-broker-gateway",
  "host-may-bypass-runbook-with-other-tools",
  "not-trading-performance",
  "no-composite-safety-score",
] as const;

/**
 * Compose inventory check + optional dual-eval into a single supervisor tick.
 */
export function resolveProcessTick(input: {
  inventory: InventoryCheckResult;
  dualEval?: CharterDualEvalResult;
}): ProcessTickResult {
  const inventoryOk = input.inventory.ok;
  const inventoryUnknownTools = [...input.inventory.unknownTools];
  const dual = input.dualEval;

  let recommendation: ProcessTickRecommendation = "proceed";
  if (!inventoryOk) {
    recommendation = "stop";
  } else if (dual?.processDeniedBySession) {
    recommendation = "stop";
  } else if (
    dual &&
    (dual.sessionCharterBinding === "mismatch-session-denies" ||
      dual.sessionCharterBinding === "no-session-charter")
  ) {
    recommendation = dual.charterBindingEnforcement === "fail-closed" ? "stop" : "warn";
  } else if (input.inventory.enforcement === "warn" && inventoryUnknownTools.length > 0) {
    recommendation = "warn";
  }

  const parts: string[] = [];
  if (!inventoryOk) {
    parts.push(`Inventory fail-closed: ${inventoryUnknownTools.join(", ") || "unknown tools"}.`);
  } else if (inventoryUnknownTools.length > 0) {
    parts.push(`Inventory warn: ${inventoryUnknownTools.join(", ")}.`);
  } else {
    parts.push("Inventory within pin.");
  }
  if (dual) {
    parts.push(
      `Charter binding=${dual.sessionCharterBinding} ledgerAllowed=${String(dual.ledgerAllowed)} processAllowed=${String(dual.allowed)}.`,
    );
    if (dual.processDeniedBySession) {
      parts.push("Session process deny under fail-closed.");
    }
  } else {
    parts.push("Charter dual-eval not evaluated (no proposal or no session charter).");
  }
  parts.push("Process-layer only — not a hard broker gateway.");

  return {
    schemaVersion: "runbook.process-tick.v1",
    recommendation,
    inventoryOk,
    inventoryUnknownTools,
    sessionCharterBinding: dual?.sessionCharterBinding ?? "not-evaluated",
    ...(dual !== undefined
      ? {
          ledgerAllowed: dual.ledgerAllowed,
          processAllowed: dual.allowed,
          charterBindingEnforcement: dual.charterBindingEnforcement,
        }
      : {}),
    processDeniedBySession: dual?.processDeniedBySession === true,
    message: parts.join(" "),
    brokerEffect: false,
    compositeScore: false,
    capitalAtRisk: 0,
    limitations: LIMITATIONS,
  };
}
