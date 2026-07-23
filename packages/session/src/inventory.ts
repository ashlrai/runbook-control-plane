import {
  inventoryPinSchema,
  type InventoryCheckResult,
  type InventoryPin,
  type InventoryToolEntry,
} from "./types.js";
import { newId, toolSetSha256, toolSetSha256FromEntries } from "./canonical.js";

/** Closed public-docs style pin for Robinhood Trading research (names only). */
export const ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES = Object.freeze([
  "get_accounts",
  "get_portfolio",
  "get_realized_pnl",
  "get_pnl_trade_history",
  "search",
  "get_watchlists",
  "get_watchlist_items",
  "get_option_watchlist",
  "get_popular_watchlists",
  "create_watchlist",
  "update_watchlist",
  "follow_watchlist",
  "unfollow_watchlist",
  "add_to_watchlist",
  "remove_from_watchlist",
  "add_option_to_watchlist",
  "remove_option_from_watchlist",
  "get_equity_historicals",
  "get_equity_fundamentals",
  "get_financials",
  "get_equity_price_book",
  "get_equity_technical_indicators",
  "get_earnings_results",
  "get_earnings_calendar",
  "get_indexes",
  "get_index_quotes",
  "get_equity_positions",
  "get_equity_tax_lots",
  "get_equity_quotes",
  "get_equity_orders",
  "get_equity_tradability",
  "review_equity_order",
  "place_equity_order",
  "cancel_equity_order",
  "get_option_level_upgrade_info",
  "get_option_historicals",
  "get_option_chains",
  "get_option_instruments",
  "get_option_quotes",
  "get_option_positions",
  "get_option_orders",
  "review_option_order",
  "cancel_option_order",
  "place_option_order",
  "get_scans",
  "get_scanner_filter_specs",
  "create_scan",
  "run_scan",
  "update_scan_filters",
  "update_scan_config",
] as const);

function effectForName(name: string): InventoryToolEntry["effectClass"] {
  if (name.startsWith("place_") || name.startsWith("cancel_")) return "capital-order-mutation";
  if (name.startsWith("review_")) return "order-review";
  if (
    name.includes("watchlist") ||
    name.includes("scan") ||
    name.startsWith("create_") ||
    name.startsWith("update_") ||
    name.startsWith("follow_") ||
    name.startsWith("unfollow_") ||
    name.startsWith("add_") ||
    name.startsWith("remove_")
  ) {
    if (name.startsWith("get_")) return "observation";
    return "research-state-mutation";
  }
  return "observation";
}

export function buildPublicDocsInventoryPin(input?: {
  createdAt?: string;
  label?: string;
  admitted?: boolean;
}): InventoryPin {
  const tools: InventoryToolEntry[] = ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES.map((name) => ({
    name,
    source: "public-docs" as const,
    effectClass: effectForName(name),
  }));
  const pin: InventoryPin = {
    schemaVersion: "runbook.inventory-pin.v1",
    pinId: newId("pin"),
    createdAt: input?.createdAt ?? new Date().toISOString(),
    label: input?.label ?? "Robinhood Trading public-docs 50-tool pin",
    provider: "robinhood-public-docs",
    tools,
    toolSetSha256: toolSetSha256FromEntries(tools),
    admitted: input?.admitted ?? true,
    limitations: [
      "not-runtime-confirmed-unless-source-is-runtime-snapshot",
      "not-broker-authorization",
      "fail-closed-on-unknown-tools-when-enforced",
      "public-documentation-projection-only",
    ],
  };
  return inventoryPinSchema.parse(pin);
}

export function checkObservedToolsAgainstPin(
  pin: InventoryPin | undefined,
  observedToolNames: readonly string[],
  enforcement: "off" | "warn" | "fail-closed",
): InventoryCheckResult {
  const observed = [...new Set(observedToolNames.map((n) => n.trim()).filter(Boolean))].sort();
  const observedSha = toolSetSha256(observed);

  if (!pin || enforcement === "off") {
    return {
      schemaVersion: "runbook.inventory-check.v1",
      ok: true,
      enforcement,
      unknownTools: [],
      missingPinnedTools: [],
      extraTools: [],
      pinToolSetSha256: pin?.toolSetSha256 ?? null,
      observedToolSetSha256: observedSha,
      brokerEffect: false,
      compositeScore: false,
      message:
        enforcement === "off"
          ? "Inventory enforcement is off."
          : "No inventory pin attached; check treated as pass with no pin.",
    };
  }

  const pinned = new Set(pin.tools.map((t) => t.name));
  const obs = new Set(observed);
  const unknownTools = observed.filter((n) => !pinned.has(n));
  const missingPinnedTools = [...pinned].filter((n) => !obs.has(n)).sort();
  const extraTools = unknownTools.slice();

  const hasUnknown = unknownTools.length > 0;
  const ok = enforcement === "warn" ? true : !hasUnknown;

  return {
    schemaVersion: "runbook.inventory-check.v1",
    ok,
    enforcement,
    unknownTools,
    missingPinnedTools,
    extraTools,
    pinToolSetSha256: pin.toolSetSha256,
    observedToolSetSha256: observedSha,
    brokerEffect: false,
    compositeScore: false,
    message: hasUnknown
      ? enforcement === "fail-closed"
        ? `Fail-closed: ${unknownTools.length} unknown tool(s) not in admitted pin.`
        : `Warn: ${unknownTools.length} unknown tool(s) not in admitted pin.`
      : "Observed tools are within the admitted inventory pin.",
  };
}
