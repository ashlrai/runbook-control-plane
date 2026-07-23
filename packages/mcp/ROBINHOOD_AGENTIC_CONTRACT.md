# Robinhood Agentic Trading contract map

**Verified:** July 21, 2026
**Scope:** Robinhood's published US Agentic Trading materials and Customer Agreement
**Status:** Independent technical research; Runbook is not affiliated with or endorsed by Robinhood

This is a current-source map, not a copied MCP schema. Robinhood publishes tool names and short descriptions, but the support page does not publish their complete input/output JSON schemas. Treat the remote inventory as changeable and re-check the official pages before any live-account phase.

## Connection and data boundary

- Official Streamable HTTP endpoint: `https://agent.robinhood.com/mcp/trading`.
- Robinhood documents Codex setup as `codex mcp add robinhood-trading --url https://agent.robinhood.com/mcp/trading`, followed by interactive authentication.
- A connected agent receives read access across **all** Robinhood accounts, including account numbers, balances, positions, transactions, order history, watchlists, and scans.
- The agent can place trades only in the separately created Robinhood Agentic account.
- Robinhood says the customer is responsible for all agent trades. An agent can trade without per-order confirmation if the user instructs it to act without approval.
- The launch announcement describes trade previews as occurring “when appropriate.” That language must not be treated as a guaranteed human-approval gate.

These facts make a disconnected first shadow pilot the correct default. Runbook's local policy evaluator cannot technically constrain an independently connected brokerage MCP.

## Published tool inventory

Robinhood currently lists **50 tools in six groups**:

| Group | Published tools |
| --- | --- |
| Account and portfolio | `get_accounts`, `get_portfolio`, `get_realized_pnl`, `get_pnl_trade_history`, `search` |
| Watchlists | `get_watchlists`, `get_watchlist_items`, `get_option_watchlist`, `get_popular_watchlists`, `create_watchlist`, `update_watchlist`, `follow_watchlist`, `unfollow_watchlist`, `add_to_watchlist`, `remove_from_watchlist`, `add_option_to_watchlist`, `remove_option_from_watchlist` |
| Market data | `get_equity_historicals`, `get_equity_fundamentals`, `get_financials`, `get_equity_price_book`, `get_equity_technical_indicators`, `get_earnings_results`, `get_earnings_calendar`, `get_indexes`, `get_index_quotes` |
| Equities | `get_equity_positions`, `get_equity_tax_lots`, `get_equity_quotes`, `get_equity_orders`, `get_equity_tradability`, `review_equity_order`, `place_equity_order`, `cancel_equity_order` |
| Options | `get_option_level_upgrade_info`, `get_option_historicals`, `get_option_chains`, `get_option_instruments`, `get_option_quotes`, `get_option_positions`, `get_option_orders`, `review_option_order`, `cancel_option_order`, `place_option_order` |
| Scans | `get_scans`, `get_scanner_filter_specs`, `create_scan`, `run_scan`, `update_scan_filters`, `update_scan_config` |

`review_equity_order` and `review_option_order` simulate orders and return pre-trade warnings. `place_equity_order` and `place_option_order` place real orders; the cancel tools mutate live order state. Watchlist and scan tools also include mutations even though they do not trade.

Robinhood's current trading support page says long equities and options are available and that more assets will be added. A May 27 launch article described equities-only beta support, so the newer support page controls this map. A July 1 announcement described crypto Agentic Accounts as a future rollout, not a currently verified trading tool here.

### July 21 inventory drift note

The official support inventory was re-read on July 21, 2026 and had grown from the 45-tool snapshot previously recorded here to 50 tools. The five newly observed entries are `get_financials`, `get_equity_price_book`, `get_equity_tax_lots`, `get_option_historicals`, and `get_scanner_filter_specs`. This is documentation drift evidence, not proof of the date each tool became available to every account. A connected phase must discover the authenticated session's actual tool inventory at runtime and fail closed on any unreviewed addition, removal, or schema change.

## Contract and safety implications

1. **Personal use only at this stage.** Customer Agreement §29 says a user may not use the API Package or develop a Licensee Product without Robinhood's express written consent, and says API Product access is solely for the customer's personal use.
2. **No credential collection.** Robinhood says external agents can access portfolio data and place real trades and that API keys, if provided, are sensitive credentials. Runbook must never request, receive, log, or proxy them.
3. **No hard-gate claim.** A Runbook preflight is advisory unless Runbook exclusively controls an authorized execution path and re-evaluates authoritative broker state immediately before submission. The current prototype does neither.
4. **Latency and rejection are normal states.** The agreement says latency can affect submission, modification, and cancellation; Robinhood vets an API order only when received and may reject it.
5. **Third-party data risk is material.** Robinhood says information shared with an external AI provider leaves Robinhood's security environment and is governed by that provider's terms.
6. **Revocation is not a rewind.** The agreement says Robinhood has no obligation to cancel, reverse, or unwind an instruction received before revocation is processed. It also says an instruction received from an authenticated agent session is final and binding on the customer even when the agent erred or behaved unexpectedly.
7. **The operator owns compliance controls.** Robinhood places responsibility for employer, regulatory, and institutional controls—and for avoiding manipulation, spoofing, layering, wash trading, marking the close, and other disruptive practices—on the customer.
8. **Inventory drift must fail closed.** Robinhood says it will add tools. A future connected phase needs a freshly captured inventory, an explicit least-privilege authorization model, and written Robinhood approval before Runbook is offered to another user.

## Official primary sources

- [Agentic Trading overview](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) — endpoint, supported clients, account-wide read access, dedicated execution account, authentication, and risk disclosures.
- [Trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/) — current published tool inventory and current equities/options availability.
- [Robinhood is Now Open to Agents](https://robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents/) — dedicated-account controls, activity feed, disconnect control, and contextual preview language.
- [Robinhood Customer Agreement §29](https://cdn.robinhood.com/assets/robinhood/legal/Robinhood-Customer-Agreement.pdf) — API/MCP authorization, personal use, data access, credentials, latency, rejection, and third-party responsibility.
- [July 1, 2026 product announcement](https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/) — crypto Agentic Accounts described as coming soon.
