/**
 * Compose inventory tools/list check + optional capability notes into a drift receipt.
 * Offline process evidence only.
 */

import {
  checkObservedToolsAgainstPin,
  parseToolsListJsonText,
  type InventoryPin,
} from "@runbook/session";

export const DRIFT_SENTINEL_SCHEMA = "runbook.drift-sentinel-receipt.v1" as const;

export type DriftSentinelReceipt = {
  schemaVersion: typeof DRIFT_SENTINEL_SCHEMA;
  ok: boolean;
  enforcement: "off" | "warn" | "fail-closed";
  toolCount: number;
  parseFormat: string;
  unknownTools: string[];
  missingPinnedTools: string[];
  capitalOrderMutationInObserved: string[];
  pinToolSetSha256: string | null;
  observedToolSetSha256: string;
  message: string;
  brokerEffect: false;
  compositeScore: false;
  limitations: readonly string[];
};

export function runDriftSentinel(input: {
  pin: InventoryPin | undefined;
  toolsListJsonText: string;
  enforcement: "off" | "warn" | "fail-closed";
}): DriftSentinelReceipt {
  const parsed = parseToolsListJsonText(input.toolsListJsonText);
  const check = checkObservedToolsAgainstPin(input.pin, parsed.toolNames, input.enforcement);
  const capitalOrderMutationInObserved = parsed.toolNames.filter(
    (n) => n.startsWith("place_") || n.startsWith("cancel_"),
  );
  return {
    schemaVersion: DRIFT_SENTINEL_SCHEMA,
    ok: check.ok,
    enforcement: check.enforcement,
    toolCount: parsed.toolNames.length,
    parseFormat: parsed.format,
    unknownTools: check.unknownTools,
    missingPinnedTools: check.missingPinnedTools,
    capitalOrderMutationInObserved,
    pinToolSetSha256: check.pinToolSetSha256,
    observedToolSetSha256: check.observedToolSetSha256,
    message: check.message,
    brokerEffect: false,
    compositeScore: false,
    limitations: [
      "operator-provided-tools-list-not-runtime-confirmed",
      "not-broker-authorization",
      "does-not-block-separate-brokerage-mcp",
      "process-evidence-only",
    ],
  };
}
