#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(SCRIPT_DIR, "../fixtures/robinhood");
const OUTPUT_DIR = process.argv[2] === undefined ? FIXTURE_DIR : resolve(process.argv[2]);

if (process.argv.length > 3) {
  throw new Error("usage: build-robinhood-fixtures.mjs [output-directory]");
}

const SOURCE_FILES = {
  banking: {
    filename: "banking-source-projection.jcs",
    sha256: "980bef414a42c6437857558565405fce128eea4689a2b0a813bff5beddd58aa5",
  },
  trading45: {
    filename: "trading-45-source-projection.jcs",
    sha256: "7346e19ce302b28cd78edbcf0443d7042e76622ecc02c5532474b862263d17c0",
  },
  trading50: {
    filename: "trading-50-source-projection.jcs",
    sha256: "06beecd4a73fe69b3e6cb70e1a2b0de07a589772c2e472860edaa3308a9410d9",
  },
};

const EXPECTED_CATEGORIES = new Map([
  ["Account, portfolio, and other tools", ["get_accounts", "get_portfolio", "get_realized_pnl", "get_pnl_trade_history", "search"]],
  ["Watchlist tools", ["get_watchlists", "get_watchlist_items", "get_option_watchlist", "get_popular_watchlists", "create_watchlist", "update_watchlist", "follow_watchlist", "unfollow_watchlist", "add_to_watchlist", "remove_from_watchlist", "add_option_to_watchlist", "remove_option_from_watchlist"]],
  ["Market data tools", ["get_equity_historicals", "get_equity_fundamentals", "get_financials", "get_equity_price_book", "get_equity_technical_indicators", "get_earnings_results", "get_earnings_calendar", "get_indexes", "get_index_quotes"]],
  ["Equities tools", ["get_equity_positions", "get_equity_tax_lots", "get_equity_quotes", "get_equity_orders", "get_equity_tradability", "review_equity_order", "place_equity_order", "cancel_equity_order"]],
  ["Options tools", ["get_option_level_upgrade_info", "get_option_historicals", "get_option_chains", "get_option_instruments", "get_option_quotes", "get_option_positions", "get_option_orders", "review_option_order", "cancel_option_order", "place_option_order"]],
  ["Scanner tool calls", ["get_scans", "get_scanner_filter_specs", "create_scan", "run_scan", "update_scan_filters", "update_scan_config"]],
]);

const ADDITIONS = [
  "get_equity_price_book",
  "get_equity_tax_lots",
  "get_financials",
  "get_option_historicals",
  "get_scanner_filter_specs",
];

// Robinhood's public Trading documentation exposes paired inverse operations
// only for these research-state writers. The append-only risk-correction
// revision fails every other writer closed; immutable prior revisions retain
// their original bytes.
const DOCUMENTED_INVERSE_RESEARCH_WRITERS = new Set([
  "add_option_to_watchlist",
  "add_to_watchlist",
  "follow_watchlist",
  "remove_from_watchlist",
  "remove_option_from_watchlist",
  "unfollow_watchlist",
]);

const OBSERVED_AT = "2026-07-22T07:10:00Z";
const RETRIEVED_AT = "2026-07-22T07:00:00Z";
const PROFILE = "runbook.financial-capability-registry.v1";
const SNAPSHOT_SCHEMA = "runbook.financial-capability-snapshot.v1";
const TRADING_SNAPSHOT_SOURCE_ID = "robinhood-trading-public-documentation";
const CONTRACT_NOT_CAPTURED = Object.freeze({ sha256: null, state: "not-captured" });
const CONTRACT_NOT_PUBLISHED = Object.freeze({ sha256: null, state: "not-published" });

function compareRaw(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new Error("unsupported JCS value");
  return `{${Object.keys(value).sort(compareRaw).map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256(bytesOrText) {
  return createHash("sha256").update(bytesOrText).digest("hex");
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareRaw);
  const wanted = [...expected].sort(compareRaw);
  if (actual.length !== wanted.length || actual.some((entry, index) => entry !== wanted[index])) {
    throw new Error(`${label}: unexpected fields`);
  }
}

function sorted(values) {
  return [...values].sort(compareRaw);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadProjection(source) {
  const bytes = readFileSync(resolve(FIXTURE_DIR, source.filename));
  assert(sha256(bytes) === source.sha256, `${source.filename}: source projection hash mismatch`);
  const text = bytes.toString("utf8");
  assert(!text.endsWith("\n"), `${source.filename}: transport newline`);
  const parsed = JSON.parse(text);
  assert(canonicalize(parsed) === text, `${source.filename}: not exact JCS`);
  return parsed;
}

function verifyTradingProjection(projection, count) {
  exactKeys(projection, ["assertions", "derivation", "limitations", "product", "projectionKind", "provider", "schemaVersion", "source"], `trading-${count}`);
  assert(projection.product === "robinhood-trading-mcp", `trading-${count}: product`);
  assert(projection.provider === "robinhood", `trading-${count}: provider`);
  assert(projection.projectionKind === "official-source-projection", `trading-${count}: kind`);
  assert(projection.schemaVersion === "runbook.financial-capability-source-projection.v1", `trading-${count}: schema`);
  assert(Array.isArray(projection.assertions) && projection.assertions.length === count, `trading-${count}: assertion count`);
  exactKeys(projection.source, ["authority", "completeness", "observedAt", "referenceNumber", "sourceId", "uri"], `trading-${count}.source`);
  assert(projection.source.authority === "public-documentation", `trading-${count}: authority`);
  assert(projection.source.completeness === "complete-enumeration", `trading-${count}: completeness`);
  assert(projection.source.observedAt === "2026-07-22", `trading-${count}: observed date`);
  assert(projection.source.referenceNumber === "5762361", `trading-${count}: reference`);
  assert(projection.source.uri === "https://robinhood.com/us/en/support/articles/trading-with-your-agent/", `trading-${count}: URI`);
  const names = new Set();
  const effectCounts = new Map();
  for (const assertion of projection.assertions) {
    exactKeys(assertion, ["classification", "officialCategory", "officialCategoryStatus", "providerToolName", "providerToolNameStatus"], `trading-${count}.assertion`);
    exactKeys(assertion.classification, ["effectClass", "status"], `trading-${count}.classification`);
    assert(assertion.officialCategoryStatus === "public-explicit", `trading-${count}: category evidence`);
    assert(assertion.providerToolNameStatus === "public-explicit", `trading-${count}: identity evidence`);
    assert(assertion.classification.status === "public-derived", `trading-${count}: risk evidence`);
    const expectedNames = EXPECTED_CATEGORIES.get(assertion.officialCategory);
    assert(expectedNames?.includes(assertion.providerToolName), `trading-${count}: category/name pair`);
    assert(!names.has(assertion.providerToolName), `trading-${count}: duplicate tool`);
    names.add(assertion.providerToolName);
    effectCounts.set(assertion.classification.effectClass, (effectCounts.get(assertion.classification.effectClass) ?? 0) + 1);
  }
  const expectedEffects = count === 50
    ? { observation: 33, "research-state-mutation": 11, "order-review": 2, "capital-order-mutation": 4 }
    : { observation: 28, "research-state-mutation": 11, "order-review": 2, "capital-order-mutation": 4 };
  assert(canonicalize(Object.fromEntries(effectCounts)) === canonicalize(expectedEffects), `trading-${count}: effect counts`);
  const expectedNames = [...EXPECTED_CATEGORIES.values()].flat().filter((name) => count === 50 || !ADDITIONS.includes(name));
  assert(canonicalize(sorted(names)) === canonicalize(sorted(expectedNames)), `trading-${count}: inventory`);
  if (count === 45) {
    exactKeys(projection.derivation, ["basis", "removedProviderToolNames", "status"], "trading-45.derivation");
    assert(projection.derivation.basis === "trading-50-source-projection-minus-documented-additions", "trading-45: derivation basis");
    assert(projection.derivation.status === "public-derived", "trading-45: derivation evidence");
    assert(canonicalize(sorted(projection.derivation.removedProviderToolNames)) === canonicalize(sorted(ADDITIONS)), "trading-45: derivation additions");
  } else {
    assert(projection.derivation === null, "trading-50: derivation must be null");
  }
}

function verifyBankingProjection(projection) {
  exactKeys(projection, ["assertions", "derivation", "externalCheckoutFacts", "limitations", "policyFacts", "product", "projectionKind", "provider", "schemaVersion", "source"], "banking");
  assert(projection.product === "robinhood-banking-mcp", "banking: product");
  assert(projection.provider === "robinhood", "banking: provider");
  assert(projection.projectionKind === "official-source-projection", "banking: kind");
  assert(projection.schemaVersion === "runbook.financial-capability-source-projection.v1", "banking: schema");
  assert(projection.derivation === null, "banking: derivation");
  assert(Array.isArray(projection.assertions) && projection.assertions.length === 3, "banking: assertion count");
  exactKeys(projection.source, ["authority", "completeness", "observedAt", "referenceNumber", "sourceId", "uri"], "banking.source");
  assert(projection.source.authority === "public-documentation", "banking: authority");
  assert(projection.source.completeness === "capabilities-only", "banking: completeness");
  assert(projection.source.observedAt === "2026-07-22", "banking: observed date");
  assert(projection.source.referenceNumber === "5527147", "banking: reference");
  assert(projection.source.uri === "https://robinhood.com/us/en/support/articles/agentic-credit-card/", "banking: URI");
  const expectedOperations = new Set(["agentic-card-transaction-history-read", "agentic-card-policy-read", "agentic-card-payment-credential-release"]);
  for (const assertion of projection.assertions) {
    exactKeys(assertion, ["classification", "documentedBehavior", "documentedBehaviorStatus", "documentedOperationId", "documentedOperationIdStatus", "providerToolName", "providerToolNameStatus"], "banking.assertion");
    assert(expectedOperations.delete(assertion.documentedOperationId), "banking: operation identity");
    assert(assertion.documentedBehaviorStatus === "public-explicit", "banking: behavior evidence");
    assert(assertion.documentedOperationIdStatus === "public-derived", "banking: operation-id evidence");
    assert(assertion.providerToolName === null && assertion.providerToolNameStatus === "not-enumerated", "banking: invented provider tool name");
    assert(assertion.classification.status === "public-derived", "banking: risk evidence");
  }
  assert(expectedOperations.size === 0, "banking: missing operation");
  assert(projection.externalCheckoutFacts.bankingMcpBrowsesOrFindsPurchases === false, "banking: browsing fact");
  assert(projection.externalCheckoutFacts.cardCredentialUsedByExternalAgentAtCheckout === true, "banking: checkout fact");
  assert(projection.externalCheckoutFacts.status === "public-explicit", "banking: checkout evidence");
  assert(projection.policyFacts.perPurchaseApproval === "optional", "banking: approval fact");
  assert(projection.policyFacts.monthlyLimitRequiredWhenPerPurchaseApprovalDisabled === true, "banking: monthly limit fact");
  assert(projection.policyFacts.policyEditSurface === "robinhood-banking-app", "banking: policy surface");
  assert(projection.policyFacts.status === "public-explicit", "banking: policy evidence");
}

const APPROVAL_NONE = Object.freeze({ actionBinding: "none", bypassCondition: "none", enforcingPrincipal: "none", expiryBinding: "none", mode: "none", scopeBinding: "none" });
const APPROVAL_UNKNOWN = Object.freeze({ actionBinding: "unknown", bypassCondition: "unknown", enforcingPrincipal: "unknown", expiryBinding: "unknown", mode: "unknown", scopeBinding: "unknown" });
const APPROVAL_ADVISORY = Object.freeze({ actionBinding: "unknown", bypassCondition: "unknown", enforcingPrincipal: "unknown", expiryBinding: "unknown", mode: "advisory", scopeBinding: "unknown" });
const APPROVAL_OPTIONAL_TRADE = Object.freeze({ actionBinding: "unknown", bypassCondition: "user-instruction", enforcingPrincipal: "customer", expiryBinding: "unknown", mode: "optional", scopeBinding: "unknown" });

function risk(fields) {
  return {
    accountScope: fields.accountScope,
    actionFamilies: sorted(fields.actionFamilies),
    approvalSemantics: fields.approvalSemantics ?? APPROVAL_NONE,
    capitalAuthority: {
      assetScopes: sorted(fields.assetScopes ?? []),
      operations: sorted(fields.capitalOperations ?? []),
    },
    credentialRelease: fields.credentialRelease ?? "none",
    dataScopes: sorted(fields.dataScopes),
    decisionInfluence: fields.decisionInfluence ?? "direct",
    mutationClass: fields.mutationClass ?? "read",
    mutationScopes: sorted(fields.mutationScopes ?? ["none"]),
    stateReadDomains: sorted(fields.stateReadDomains),
    stateWriteDomains: sorted(fields.stateWriteDomains ?? ["none"]),
  };
}

function researchMutationClass(name, writes, correctedRisk) {
  if (!writes) return "read";
  if (!correctedRisk) return "reversible";
  return DOCUMENTED_INVERSE_RESEARCH_WRITERS.has(name) ? "reversible" : "unknown";
}

function tradingRisk(name, category, correctedRisk) {
  if (category === "Account, portfolio, and other tools") {
    if (name === "get_accounts") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["account-identifiers"], decisionInfluence: "none", stateReadDomains: ["account-state"] });
    if (name === "get_portfolio") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["account-balances", "account-positions"], stateReadDomains: ["portfolio-state"] });
    if (name === "get_realized_pnl") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["account-transactions"], stateReadDomains: ["account-state"] });
    if (name === "get_pnl_trade_history") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["account-transactions", "order-history"], stateReadDomains: ["account-state", "order-state"] });
    if (name === "search") return risk({ accountScope: "none", actionFamilies: ["research-observation"], dataScopes: ["company-data"], stateReadDomains: ["market-state"] });
  }
  if (category === "Watchlist tools") {
    const writes = !name.startsWith("get_");
    return risk({
      accountScope: "provider-defined",
      actionFamilies: [writes ? "research-state-management" : "research-observation"],
      approvalSemantics: writes ? APPROVAL_UNKNOWN : APPROVAL_NONE,
      dataScopes: ["watchlists"],
      decisionInfluence: writes ? "indirect" : "direct",
      mutationClass: researchMutationClass(name, writes, correctedRisk),
      mutationScopes: [writes ? "research-state" : "none"],
      stateReadDomains: ["research-state"],
      stateWriteDomains: [writes ? "research-state" : "none"],
    });
  }
  if (category === "Market data tools") {
    const companyOnly = new Set(["get_financials", "get_earnings_results", "get_earnings_calendar"]);
    const companyAndMarket = new Set(["get_equity_fundamentals"]);
    return risk({
      accountScope: "none",
      actionFamilies: ["market-observation"],
      dataScopes: companyOnly.has(name) ? ["company-data"] : companyAndMarket.has(name) ? ["company-data", "market-data"] : ["market-data"],
      stateReadDomains: ["market-state"],
    });
  }
  if (category === "Equities tools") {
    if (name === "get_equity_positions" || name === "get_equity_tax_lots") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["account-positions"], stateReadDomains: ["portfolio-state"] });
    if (name === "get_equity_orders") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["order-history"], stateReadDomains: ["order-state"] });
    if (name === "get_equity_quotes" || name === "get_equity_tradability") return risk({ accountScope: "none", actionFamilies: ["market-observation"], dataScopes: ["market-data"], stateReadDomains: ["market-state"] });
    if (name === "review_equity_order") return orderRisk("review", "equity");
    if (name === "place_equity_order") return orderRisk("place", "equity");
    if (name === "cancel_equity_order") return orderRisk("cancel", "equity");
  }
  if (category === "Options tools") {
    if (name === "get_option_level_upgrade_info") return risk({ accountScope: "provider-defined", actionFamilies: ["account-observation"], dataScopes: ["account-identifiers"], stateReadDomains: ["account-state"] });
    if (["get_option_historicals", "get_option_chains", "get_option_instruments", "get_option_quotes"].includes(name)) return risk({ accountScope: "none", actionFamilies: ["market-observation"], dataScopes: ["market-data"], stateReadDomains: ["market-state"] });
    if (name === "get_option_positions") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["account-positions"], stateReadDomains: ["portfolio-state"] });
    if (name === "get_option_orders") return risk({ accountScope: "all-linked-accounts", actionFamilies: ["account-observation"], dataScopes: ["order-history"], stateReadDomains: ["order-state"] });
    if (name === "review_option_order") return orderRisk("review", "option");
    if (name === "place_option_order") return orderRisk("place", "option");
    if (name === "cancel_option_order") return orderRisk("cancel", "option");
  }
  if (category === "Scanner tool calls") {
    const writes = ["create_scan", "update_scan_filters", "update_scan_config"].includes(name);
    return risk({
      accountScope: "provider-defined",
      actionFamilies: [writes ? "research-state-management" : "research-observation"],
      approvalSemantics: writes ? APPROVAL_UNKNOWN : APPROVAL_NONE,
      dataScopes: name === "run_scan" ? ["market-data", "scans"] : ["scans"],
      decisionInfluence: writes ? "indirect" : "direct",
      mutationClass: researchMutationClass(name, writes, correctedRisk),
      mutationScopes: [writes ? "research-state" : "none"],
      stateReadDomains: ["research-state"],
      stateWriteDomains: [writes ? "research-state" : "none"],
    });
  }
  throw new Error(`unclassified Trading capability: ${category}/${name}`);
}

function orderRisk(operation, asset) {
  if (operation === "review") return risk({ accountScope: "dedicated-account", actionFamilies: ["order-review"], approvalSemantics: APPROVAL_ADVISORY, assetScopes: [asset], capitalOperations: ["preview"], dataScopes: ["order-data"], stateReadDomains: ["order-state"] });
  if (operation === "place") return risk({ accountScope: "dedicated-account", actionFamilies: ["order-submission"], approvalSemantics: APPROVAL_OPTIONAL_TRADE, assetScopes: [asset], capitalOperations: ["submit"], dataScopes: ["order-data"], mutationClass: "capital-moving", mutationScopes: ["capital-orders"], stateReadDomains: ["order-state"], stateWriteDomains: ["order-state"] });
  return risk({ accountScope: "dedicated-account", actionFamilies: ["order-management"], approvalSemantics: APPROVAL_UNKNOWN, assetScopes: [asset], capitalOperations: ["cancel"], dataScopes: ["order-data"], mutationClass: "capital-moving", mutationScopes: ["capital-orders"], stateReadDomains: ["order-state"], stateWriteDomains: ["order-state"] });
}

function capabilityFromTradingAssertion(assertion, sourceId, correctedRisk) {
  return {
    ...tradingRisk(assertion.providerToolName, assertion.officialCategory, correctedRisk),
    capabilityId: `trading.${assertion.providerToolName}`,
    descriptionContract: CONTRACT_NOT_CAPTURED,
    identityEvidence: "public-explicit",
    identityKind: "published-tool-name",
    providerToolName: assertion.providerToolName,
    requestContract: CONTRACT_NOT_PUBLISHED,
    responseContract: CONTRACT_NOT_PUBLISHED,
    riskEvidence: "public-derived",
    sourceAssertionSha256: sha256(canonicalize(assertion)),
    sourceIds: [sourceId],
    workflowPrerequisiteCapabilityIds: [],
  };
}

function bankingRisk(operationId) {
  if (operationId === "agentic-card-transaction-history-read") return risk({ accountScope: "authorized-card", actionFamilies: ["purchase-observation"], dataScopes: ["card-transactions"], stateReadDomains: ["card-transaction-state"] });
  if (operationId === "agentic-card-policy-read") return risk({ accountScope: "authorized-card", actionFamilies: ["policy-observation"], dataScopes: ["card-policies"], stateReadDomains: ["card-policy-state"] });
  if (operationId === "agentic-card-payment-credential-release") return risk({ accountScope: "authorized-card", actionFamilies: ["credential-release"], approvalSemantics: APPROVAL_UNKNOWN, credentialRelease: "payment-credential", dataScopes: ["payment-credentials"], mutationClass: "unknown", mutationScopes: ["credential-release"], stateReadDomains: ["payment-credential-state"] });
  throw new Error(`unclassified Banking operation: ${operationId}`);
}

function capabilityFromBankingAssertion(assertion, sourceId) {
  return {
    ...bankingRisk(assertion.documentedOperationId),
    capabilityId: `banking.${assertion.documentedOperationId}`,
    descriptionContract: CONTRACT_NOT_CAPTURED,
    identityEvidence: "public-derived",
    identityKind: "documented-operation",
    providerToolName: null,
    requestContract: CONTRACT_NOT_PUBLISHED,
    responseContract: CONTRACT_NOT_PUBLISHED,
    riskEvidence: "public-derived",
    sourceAssertionSha256: sha256(canonicalize(assertion)),
    sourceIds: [sourceId],
    workflowPrerequisiteCapabilityIds: [],
  };
}

function sourceRecord(projection, digest) {
  return {
    authority: projection.source.authority,
    completeness: projection.source.completeness,
    publicUri: projection.source.uri,
    retrievedAtDeclared: RETRIEVED_AT,
    sourceId: projection.source.sourceId,
    sourceProjectionSha256: digest,
  };
}

function tradingSnapshot(projection, sourceDigest, revision, previous, correctedRisk = false) {
  // The projection IDs identify captured inventory artifacts. Registry source
  // identity is the stable public document, or every refresh would fabricate
  // changes to all capabilities through their sourceIds field.
  const sourceId = TRADING_SNAPSHOT_SOURCE_ID;
  const source = sourceRecord(projection, sourceDigest);
  return {
    capabilities: projection.assertions.map((assertion) => capabilityFromTradingAssertion(assertion, sourceId, correctedRisk)).sort((left, right) => compareRaw(left.capabilityId, right.capabilityId)),
    observedAtDeclared: OBSERVED_AT,
    previousAdmittedSnapshotSha256: previous,
    productId: "robinhood-trading-mcp",
    profileVersion: PROFILE,
    providerId: "robinhood",
    registryRevision: revision,
    schemaVersion: SNAPSHOT_SCHEMA,
    sourceSeriesId: "robinhood-trading-public-documentation",
    sources: [{ ...source, sourceId }],
  };
}

function bankingSnapshot(projection, sourceDigest) {
  const sourceId = projection.source.sourceId;
  return {
    capabilities: projection.assertions.map((assertion) => capabilityFromBankingAssertion(assertion, sourceId)).sort((left, right) => compareRaw(left.capabilityId, right.capabilityId)),
    observedAtDeclared: OBSERVED_AT,
    previousAdmittedSnapshotSha256: null,
    productId: "robinhood-banking-mcp",
    profileVersion: PROFILE,
    providerId: "robinhood",
    registryRevision: 1,
    schemaVersion: SNAPSHOT_SCHEMA,
    sourceSeriesId: "robinhood-banking-public-documentation",
    sources: [sourceRecord(projection, sourceDigest)],
  };
}

const trading45Projection = loadProjection(SOURCE_FILES.trading45);
const trading50Projection = loadProjection(SOURCE_FILES.trading50);
const bankingProjection = loadProjection(SOURCE_FILES.banking);
verifyTradingProjection(trading45Projection, 45);
verifyTradingProjection(trading50Projection, 50);
verifyBankingProjection(bankingProjection);

const names45 = new Set(trading45Projection.assertions.map((entry) => entry.providerToolName));
const additions = trading50Projection.assertions.map((entry) => entry.providerToolName).filter((name) => !names45.has(name)).sort(compareRaw);
assert(canonicalize(additions) === canonicalize(sorted(ADDITIONS)), "Trading projection delta is not the frozen five additions");

const trading45 = canonicalize(tradingSnapshot(trading45Projection, SOURCE_FILES.trading45.sha256, 1, null));
const trading45Sha256 = sha256(trading45);
const trading50 = canonicalize(tradingSnapshot(trading50Projection, SOURCE_FILES.trading50.sha256, 2, trading45Sha256));
const trading50Sha256 = sha256(trading50);
const trading50RiskCorrection = canonicalize(tradingSnapshot(
  trading50Projection,
  SOURCE_FILES.trading50.sha256,
  3,
  trading50Sha256,
  true,
));
const banking = canonicalize(bankingSnapshot(bankingProjection, SOURCE_FILES.banking.sha256));
const outputs = new Map([
  ["banking-snapshot.jcs", banking],
  ["trading-45-snapshot.jcs", trading45],
  ["trading-50-snapshot.jcs", trading50],
  ["trading-50-risk-correction-snapshot.jcs", trading50RiskCorrection],
]);

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [filename, text] of outputs) writeFileSync(resolve(OUTPUT_DIR, filename), text, "utf8");
const manifest = [...outputs].sort(([left], [right]) => compareRaw(left, right)).map(([filename, text]) => `${sha256(text)}  ${filename}`).join("\n") + "\n";
writeFileSync(resolve(OUTPUT_DIR, "SHA256SUMS"), manifest, "utf8");
