# Robinhood official-source projections

These fixtures are exact-JCS local projections of facts stated in Robinhood public documentation plus clearly separated Runbook-derived labels. They are not registry snapshots, saved webpages, hashes of Robinhood's complete web responses, authenticated MCP captures, runtime schemas, permission grants, endorsements, or evidence of current tool availability. They contain no customer account, card, credential, position, order, transaction, or policy values.

## Files

- `trading-45-source-projection.jcs` is a deterministic drift-test baseline formed from the 50-tool projection by removing exactly `get_financials`, `get_equity_price_book`, `get_equity_tax_lots`, `get_option_historicals`, and `get_scanner_filter_specs`. It does not prove that a preserved historical page or authenticated runtime exposed exactly 45 tools.
- `trading-50-source-projection.jcs` contains the 50 category/name pairs enumerated by Robinhood Help Center reference 5762361 as observed on 2026-07-22.
- `banking-source-projection.jcs` contains the three capabilities described by Robinhood Help Center reference 5527147 as observed on 2026-07-22. Robinhood does not publicly enumerate Banking MCP tool names, so every `providerToolName` is `null`.

## Exact projection members

Both Trading projections contain exactly these top-level members: `assertions`, `derivation`, `limitations`, `product`, `projectionKind`, `provider`, `schemaVersion`, and `source`.

Each Trading assertion contains exactly `classification`, `officialCategory`, `officialCategoryStatus`, `providerToolName`, and `providerToolNameStatus`. Its `classification` contains `effectClass` and `status`. Provider names and categories are `public-explicit`; effect classes are `public-derived`. No argument, result, schema, OAuth, runtime-annotation, approval-token, or account-entitlement field is projected.

The Banking projection contains exactly these top-level members: `assertions`, `derivation`, `externalCheckoutFacts`, `limitations`, `policyFacts`, `product`, `projectionKind`, `provider`, `schemaVersion`, and `source`.

Each Banking assertion contains exactly `classification`, `documentedBehavior`, `documentedBehaviorStatus`, `documentedOperationId`, `documentedOperationIdStatus`, `providerToolName`, and `providerToolNameStatus`. The behavior is `public-explicit`; the stable operation identifier and effect class are `public-derived`; the provider tool name is `not-enumerated`. `externalCheckoutFacts` preserves Robinhood's distinction that the Banking MCP does not browse for purchases and the external agent uses released card details at checkout. `policyFacts` preserves that per-purchase approval is optional, a monthly limit is required when it is disabled, and policy editing is documented in the Robinhood Banking app.

Every `source` contains exactly `authority`, `completeness`, `observedAt`, `referenceNumber`, `sourceId`, and `uri`. The source-projection SHA-256 used by a registry snapshot is the digest of the complete local `.jcs` bytes; it is not a digest of the remote webpage.

The admitted revision-1 and revision-2 Trading snapshots are immutable historical bytes; they retain their original derived classification of all eleven research-state writers as `reversible`. The append-only `trading-50-risk-correction-snapshot.jcs` is revision 3 and classifies a writer as `reversible` only when the public Trading inventory includes its explicit inverse: follow/unfollow, add/remove equity, or add/remove option. `create_watchlist`, `update_watchlist`, `create_scan`, `update_scan_filters`, and `update_scan_config` are `unknown`, because the public documentation does not publish an exact inverse contract. This is a fail-closed risk classification, not a claim that reversal is impossible at runtime.

Revision 3 names the exact revision-2 digest as `previousAdmittedSnapshotSha256`; it does not rewrite either admitted predecessor. The frozen V1 policy rejects the candidate because it introduces unknown risk semantics. Quarantine storage may retain that rejected candidate for inspection, but the verifier's exact outcome remains `reject` and no active registry head advances.

## Primary sources

- Trading: https://robinhood.com/us/en/support/articles/trading-with-your-agent/
- Banking: https://robinhood.com/us/en/support/articles/agentic-credit-card/
