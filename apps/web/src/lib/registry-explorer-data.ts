/**
 * Browser-safe static summary of the Robinhood public-derived capability inventory.
 *
 * Source of truth: packages/financial-capability-registry fixtures reviewed 2026-07-22
 * against Help Center refs 5762361 (Trading) and 5527147 (Banking).
 *
 * This is offline analysis material only:
 * - not live inventory
 * - not authorization
 * - not affiliated with Robinhood
 * - no credentials, accounts, or customer records
 */

export type MutationClass =
  | "observation"
  | "research-state-mutation"
  | "order-review"
  | "capital-order-mutation"
  | "credential-release";

export type RegistryTool = {
  name: string;
  effect: MutationClass;
  /** Present only in the 50-tool admitted projection, not the 45-tool drift baseline. */
  addedIn50?: boolean;
};

export type RegistryGroup = {
  category: string;
  tools: RegistryTool[];
};

export type BankingCapability = {
  documentedOperationId: string;
  behavior: string;
  effect: MutationClass;
  providerToolName: null;
  note: string;
};

export type FixtureSummary = {
  id: string;
  label: string;
  lane: "trading" | "banking";
  file: string;
  sha256: string;
  revision: number | null;
  capabilityCount: number;
  outcomeLanguage: string;
  detail: string;
  materialDelta?: string[];
};

export const REGISTRY_DISCLAIMER = {
  title: "Offline public-derived inventory",
  points: [
    "Not live inventory. Not an authenticated MCP capture.",
    "Not authorization to trade, release credentials, or spend.",
    "Not affiliated with, endorsed by, or certified by Robinhood.",
    "Risk labels are Runbook public-derived judgments, not provider claims.",
    "No account numbers, card numbers, credentials, or customer records.",
  ],
} as const;

export const TRADING_SOURCE = {
  product: "Trading",
  observedAt: "2026-07-22",
  referenceNumber: "5762361",
  uri: "https://robinhood.com/us/en/support/articles/trading-with-your-agent/",
  evidenceLevels: ["public-explicit", "public-derived"] as const,
} as const;

export const BANKING_SOURCE = {
  product: "Banking / Agentic Credit Card",
  observedAt: "2026-07-22",
  referenceNumber: "5527147",
  uri: "https://robinhood.com/us/en/support/articles/agentic-credit-card/",
  evidenceLevels: ["public-explicit", "public-derived"] as const,
} as const;

/** Five tools present only in the Trading 50 projection (deterministic 45→50 drift). */
export const DRIFT_ADDED_TOOLS = [
  "get_financials",
  "get_equity_price_book",
  "get_equity_tax_lots",
  "get_option_historicals",
  "get_scanner_filter_specs",
] as const;

export const MUTATION_CLASS_META: Record<
  MutationClass,
  { label: string; short: string; countTrading50: number | null; tone: "read" | "state" | "review" | "capital" | "credential" }
> = {
  observation: {
    label: "Observation",
    short: "Read-only account, market, company, order-history, watchlist, or scan observation.",
    countTrading50: 33,
    tone: "read",
  },
  "research-state-mutation": {
    label: "Research-state mutation",
    short: "Watchlist / scan writers. Indirect decision influence and poisoning surfaces.",
    countTrading50: 11,
    tone: "state",
  },
  "order-review": {
    label: "Order review",
    short: "Advisory preview. Never treated as mandatory human approval or binding to a later order.",
    countTrading50: 2,
    tone: "review",
  },
  "capital-order-mutation": {
    label: "Capital-order mutation",
    short: "Equity/option submission or cancellation in the documented dedicated-account boundary.",
    countTrading50: 4,
    tone: "capital",
  },
  "credential-release": {
    label: "Credential release",
    short: "Banking payment-card detail fetch. Not modeled as direct spend authority.",
    countTrading50: null,
    tone: "credential",
  },
};

export const TRADING_GROUPS: RegistryGroup[] = [
  {
    category: "Account, portfolio, and other tools",
    tools: [
      { name: "get_accounts", effect: "observation" },
      { name: "get_portfolio", effect: "observation" },
      { name: "get_realized_pnl", effect: "observation" },
      { name: "get_pnl_trade_history", effect: "observation" },
      { name: "search", effect: "observation" },
    ],
  },
  {
    category: "Watchlist tools",
    tools: [
      { name: "get_watchlists", effect: "observation" },
      { name: "get_watchlist_items", effect: "observation" },
      { name: "get_option_watchlist", effect: "observation" },
      { name: "get_popular_watchlists", effect: "observation" },
      { name: "create_watchlist", effect: "research-state-mutation" },
      { name: "update_watchlist", effect: "research-state-mutation" },
      { name: "follow_watchlist", effect: "research-state-mutation" },
      { name: "unfollow_watchlist", effect: "research-state-mutation" },
      { name: "add_to_watchlist", effect: "research-state-mutation" },
      { name: "remove_from_watchlist", effect: "research-state-mutation" },
      { name: "add_option_to_watchlist", effect: "research-state-mutation" },
      { name: "remove_option_from_watchlist", effect: "research-state-mutation" },
    ],
  },
  {
    category: "Market data tools",
    tools: [
      { name: "get_equity_historicals", effect: "observation" },
      { name: "get_equity_fundamentals", effect: "observation" },
      { name: "get_financials", effect: "observation", addedIn50: true },
      { name: "get_equity_price_book", effect: "observation", addedIn50: true },
      { name: "get_equity_technical_indicators", effect: "observation" },
      { name: "get_earnings_results", effect: "observation" },
      { name: "get_earnings_calendar", effect: "observation" },
      { name: "get_indexes", effect: "observation" },
      { name: "get_index_quotes", effect: "observation" },
    ],
  },
  {
    category: "Equities tools",
    tools: [
      { name: "get_equity_positions", effect: "observation" },
      { name: "get_equity_tax_lots", effect: "observation", addedIn50: true },
      { name: "get_equity_quotes", effect: "observation" },
      { name: "get_equity_orders", effect: "observation" },
      { name: "get_equity_tradability", effect: "observation" },
      { name: "review_equity_order", effect: "order-review" },
      { name: "place_equity_order", effect: "capital-order-mutation" },
      { name: "cancel_equity_order", effect: "capital-order-mutation" },
    ],
  },
  {
    category: "Options tools",
    tools: [
      { name: "get_option_level_upgrade_info", effect: "observation" },
      { name: "get_option_historicals", effect: "observation", addedIn50: true },
      { name: "get_option_chains", effect: "observation" },
      { name: "get_option_instruments", effect: "observation" },
      { name: "get_option_quotes", effect: "observation" },
      { name: "get_option_positions", effect: "observation" },
      { name: "get_option_orders", effect: "observation" },
      { name: "review_option_order", effect: "order-review" },
      { name: "cancel_option_order", effect: "capital-order-mutation" },
      { name: "place_option_order", effect: "capital-order-mutation" },
    ],
  },
  {
    category: "Scanner tool calls",
    tools: [
      { name: "get_scans", effect: "observation" },
      { name: "get_scanner_filter_specs", effect: "observation", addedIn50: true },
      { name: "create_scan", effect: "research-state-mutation" },
      { name: "run_scan", effect: "observation" },
      { name: "update_scan_filters", effect: "research-state-mutation" },
      { name: "update_scan_config", effect: "research-state-mutation" },
    ],
  },
];

export const BANKING_CAPABILITIES: BankingCapability[] = [
  {
    documentedOperationId: "agentic-card-transaction-history-read",
    behavior: "View transaction history for an authorized agentic virtual card.",
    effect: "observation",
    providerToolName: null,
    note: "Public docs describe the behavior; no MCP tool name is published.",
  },
  {
    documentedOperationId: "agentic-card-policy-read",
    behavior: "View policies for an authorized agentic virtual card.",
    effect: "observation",
    providerToolName: null,
    note: "Policy editing is documented in the Robinhood Banking app, not as an MCP tool.",
  },
  {
    documentedOperationId: "agentic-card-payment-credential-release",
    behavior: "Fetch payment-card number details for an authorized agentic virtual card.",
    effect: "credential-release",
    providerToolName: null,
    note: "Modeled as payment-credential release. Product selection and checkout occur in the external agent setup—not as direct spend authority in the Banking MCP.",
  },
];

export const FIXTURE_SUMMARIES: FixtureSummary[] = [
  {
    id: "trading-45",
    label: "Trading 45 baseline",
    lane: "trading",
    file: "trading-45-snapshot.jcs",
    sha256: "2a414ea97e02d0732cbf03a3809486b5141977ca07311fe792787c4418b2b408",
    revision: 1,
    capabilityCount: 45,
    outcomeLanguage: "Baseline · deterministic drift corpus",
    detail:
      "Derived by removing exactly five published names from the Trading 50 projection. Exercises the 45→50 documentation delta. Does not prove a historical runtime exposed exactly 45 tools.",
    materialDelta: [...DRIFT_ADDED_TOOLS].map((name) => `missing: ${name}`),
  },
  {
    id: "trading-50",
    label: "Trading 50 admitted",
    lane: "trading",
    file: "trading-50-snapshot.jcs",
    sha256: "762eeb025972717453c863f4cb57d109c80950433796e3afe9c34684141b608e",
    revision: 2,
    capabilityCount: 50,
    outcomeLanguage: "Admitted history · immutable revision 2",
    detail:
      "Complete enumeration of the published page projection. Names the exact Trading 45 revision-1 digest as previousAdmittedSnapshotSha256. Public-explicit names; public-derived effect classes.",
    materialDelta: [...DRIFT_ADDED_TOOLS].map((name) => `added: ${name}`),
  },
  {
    id: "trading-50-risk-correction",
    label: "Trading 50 risk correction",
    lane: "trading",
    file: "trading-50-risk-correction-snapshot.jcs",
    sha256: "ae158cf5d9f26b4c005f931c291831e4ab42658d69c96b01b64ca6a4be6bc346",
    revision: 3,
    capabilityCount: 50,
    outcomeLanguage: "Reject · unknownRiskDecision: reject",
    detail:
      "Append-only revision 3. Five research-state writers corrected reversible→unknown because public docs lack exact inverse contracts. Frozen V1 policy rejects material unknown-risk introduction. Quarantine storage may retain the candidate; the active head does not advance.",
    materialDelta: [
      "create_watchlist: reversible → unknown",
      "update_watchlist: reversible → unknown",
      "create_scan: reversible → unknown",
      "update_scan_filters: reversible → unknown",
      "update_scan_config: reversible → unknown",
    ],
  },
  {
    id: "banking",
    label: "Banking capabilities",
    lane: "banking",
    file: "banking-snapshot.jcs",
    sha256: "4ad91fdcdade8e91aba2b5a7c44afa5ec61fc786521280240c58db1ed81d4b86",
    revision: 1,
    capabilityCount: 3,
    outcomeLanguage: "Capabilities-only · separate source series",
    detail:
      "Three documented operations. providerToolName is null for every row. Includes the credential-release distinction for payment-card detail fetch.",
  },
];

export const TRADING_TOOL_COUNT = TRADING_GROUPS.reduce((sum, group) => sum + group.tools.length, 0);

/** Assurance axes for the registry surface — never collapsed into a score. */
export const ASSURANCE_LADDER = [
  {
    id: "public-explicit",
    rung: "01",
    title: "Public-explicit names",
    detail:
      "Tool names and published categories are transcribed from official Help Center pages on the observation date.",
  },
  {
    id: "public-derived",
    rung: "02",
    title: "Public-derived risk labels",
    detail:
      "Mutation classes and risk judgments are Runbook labels derived from public docs—not provider claims or live captures.",
  },
  {
    id: "not-runtime",
    rung: "03",
    title: "NOT runtime inventory",
    detail:
      "This is not an authenticated MCP session, live tool list, authorization grant, or customer-account surface.",
  },
] as const;

/**
 * Stepped 45→50 drift narrative for the offline demo theater.
 * Each step is a documentation delta story—not a historical runtime claim.
 */
export const DRIFT_THEATER_STEPS = [
  {
    id: "baseline-45",
    index: 0,
    label: "45 baseline",
    title: "Trading 45 · deterministic baseline",
    body: "Start from the frozen 45-tool projection made by removing exactly five published observation tools from Trading 50. This is a corpus baseline, not a claim that a historical runtime exposed exactly 45 tools.",
    toolCount: 45,
    highlight: "baseline" as const,
    fixtureId: "trading-45",
  },
  {
    id: "delta-five",
    index: 1,
    label: "Detect +5",
    title: "Documentation delta · five names appear",
    body: "Diff the baseline against the admitted 50-tool projection. Five observation tools surface as material additions. Fail-closed drift detection records the names without inventing runtime presence.",
    toolCount: 50,
    highlight: "added" as const,
    fixtureId: "trading-50",
  },
  {
    id: "admitted-50",
    index: 2,
    label: "50 admitted",
    title: "Trading 50 · admitted history",
    body: "Revision 2 admits the full public page projection and pins the prior 45-tool digest as previousAdmittedSnapshotSha256. Names are public-explicit; effect classes remain public-derived.",
    toolCount: 50,
    highlight: "admitted" as const,
    fixtureId: "trading-50",
  },
  {
    id: "risk-reject",
    index: 3,
    label: "Risk reject",
    title: "Risk-correction candidate · reject",
    body: "Revision 3 corrects five research-state writers reversible→unknown. Frozen V1 policy rejects material unknown-risk introduction. Quarantine may retain the candidate; the active head does not advance.",
    toolCount: 50,
    highlight: "reject" as const,
    fixtureId: "trading-50-risk-correction",
  },
] as const;

export const BANKING_CREDENTIAL_RELEASE_CALLOUT = {
  title: "Credential-release is not spend authority",
  lines: [
    "Banking documents a payment-card detail fetch for an authorized agentic virtual card.",
    "Runbook models that operation as credential-release — not direct spend authority.",
    "providerToolName is null: no published MCP tool name is claimed.",
    "Product selection and checkout occur in the external agent setup, not as Banking MCP spend.",
    "Not live inventory. Not authorization. Not affiliated with Robinhood.",
  ],
} as const;

export type MutationClassCounts = Record<MutationClass, number>;

export function emptyMutationClassCounts(): MutationClassCounts {
  return {
    observation: 0,
    "research-state-mutation": 0,
    "order-review": 0,
    "capital-order-mutation": 0,
    "credential-release": 0,
  };
}

export function countMutationClasses(groups: RegistryGroup[]): MutationClassCounts {
  const counts = emptyMutationClassCounts();
  for (const group of groups) {
    for (const tool of group.tools) {
      counts[tool.effect] += 1;
    }
  }
  return counts;
}

export function shortHash(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

export function toolsMatching(effect: MutationClass | "all", query: string) {
  const needle = query.trim().toLowerCase();
  return TRADING_GROUPS.map((group) => ({
    ...group,
    tools: group.tools.filter((tool) => {
      if (effect !== "all" && tool.effect !== effect) return false;
      if (!needle) return true;
      return tool.name.includes(needle) || group.category.toLowerCase().includes(needle);
    }),
  })).filter((group) => group.tools.length > 0);
}
