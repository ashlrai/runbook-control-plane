/**
 * Public site identity for the hosted process lab.
 * Browser-local evidence only — not a broker gateway.
 */

export const SITE_ORIGIN = "https://runbook.ashlr.ai" as const;
export const SITE_NAME = "Runbook" as const;
export const GITHUB_PUBLIC =
  "https://github.com/ashlrai/runbook-control-plane" as const;
export const GITHUB_PRIVATE_NOTE =
  "Private research monorepo is separate; public core is Apache-2.0 export-only." as const;

export const SITE_TAGLINE =
  "Financial agent process control with evidence — not a trading bot." as const;

export const SITE_DESCRIPTION =
  "Broker-neutral process lab: control-plane sessions, shadow charter refine, inventory fail-closed checks, portable proof capsules, and advisory preflight. No live capital, no broker credentials, no composite safety score." as const;

/** Closed MCP surface — mirror packages/mcp/src/surface.ts (static product display). */
export const SITE_MCP_VERSION = "0.4.4" as const;
export const SITE_TOOL_COUNT = 44 as const;

/** Truth-rail chips for product surfaces (order stable for tests). */
export const HOSTED_TRUTH_RAIL = [
  "NO LIVE CAPITAL",
  "NO BROKER CREDENTIALS",
  "NO COMPOSITE SAFETY SCORE",
  "HOSTED LAB · BROWSER-LOCAL STATE",
  `runbook.ashlr.ai · MCP ${SITE_MCP_VERSION} · ${SITE_TOOL_COUNT} tools`,
] as const;

export const LOCAL_TRUTH_RAIL = [
  "NO LIVE CAPITAL",
  "NO BROKER CREDENTIALS",
  "NO COMPOSITE SAFETY SCORE",
  "LOCAL-FIRST BUILDER SURFACE",
] as const;
