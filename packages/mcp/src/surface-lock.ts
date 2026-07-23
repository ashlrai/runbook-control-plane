/**
 * Closed-surface attestation receipt — digests TOOL_NAMES + version.
 * Attests Runbook's inventory only, not the host's full MCP set.
 */

import { createHash } from "node:crypto";
import { buildSurfaceInventory, SERVER_NAME, SERVER_VERSION, TOOL_NAMES } from "./surface.js";

export const SURFACE_LOCK_SCHEMA = "runbook.surface-lock-receipt.v1" as const;

export type SurfaceLockReceipt = {
  schemaVersion: typeof SURFACE_LOCK_SCHEMA;
  serverName: typeof SERVER_NAME;
  serverVersion: typeof SERVER_VERSION;
  toolCount: number;
  toolNames: readonly string[];
  toolSetSha256: string;
  brokerExecutionTools: [];
  openWorldHint: false;
  hasPlaceOrCancelTools: false;
  inventory: ReturnType<typeof buildSurfaceInventory>;
  sealedAt: string;
  brokerEffect: false;
  compositeScore: false;
  limitations: readonly string[];
  message: string;
};

export function buildSurfaceLockReceipt(options?: { sealedAt?: string }): SurfaceLockReceipt {
  const inventory = buildSurfaceInventory();
  const toolNames = [...TOOL_NAMES];
  const toolSetSha256 = createHash("sha256").update(toolNames.join("\n"), "utf8").digest("hex");
  const placeOrCancel = toolNames.some((n) => n.includes("place_") || n.includes("cancel_"));
  if (placeOrCancel) {
    throw new Error("surface-lock: place/cancel tools present in closed inventory");
  }
  return {
    schemaVersion: SURFACE_LOCK_SCHEMA,
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    toolCount: toolNames.length,
    toolNames,
    toolSetSha256,
    brokerExecutionTools: [],
    openWorldHint: false,
    hasPlaceOrCancelTools: false,
    inventory,
    sealedAt: options?.sealedAt ?? new Date().toISOString(),
    brokerEffect: false,
    compositeScore: false,
    limitations: [
      "attests-runbook-closed-surface-only",
      "does-not-prove-host-has-no-other-mcps",
      "not-broker-authorization",
      "not-trading-performance",
    ],
    message:
      "Surface lock digests Runbook's closed MCP inventory. It does not prove the host loaded only these tools.",
  };
}
