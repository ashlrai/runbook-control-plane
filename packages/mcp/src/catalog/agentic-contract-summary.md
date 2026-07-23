# Robinhood Agentic Trading — research contract summary

**Status:** Independent technical research map (not a live inventory, not an API schema dump).  
**Verified baseline:** July 21–22, 2026 from official Robinhood US documentation.  
**Runbook affiliation:** None. Not endorsed by Robinhood.

## Why this exists

Robinhood publishes tool names and short descriptions for Agentic Trading. Inventories drift (45 → 50 tools observed). Capability names alone do not reveal schemas, approval enforcement, or runtime availability. Runbook keeps a **dated research map** so agents fail closed on unreviewed change rather than improvising.

This resource is **not** live `tools/list` from Robinhood. Never treat it as authorization to connect, trade, or claim GA availability.

## Connection facts (from official materials)

- Trading MCP endpoint documented as Streamable HTTP at `https://agent.robinhood.com/mcp/trading`.
- Connected agents may read across accounts; execution is confined to a dedicated Agentic account.
- Customers remain responsible for agent trades; agents can trade without per-order confirmation if instructed.
- Review tools are previews, not proof of mandatory provider-enforced approval.

## Published tool groups (50 names at last research cut)

| Group | Count | Notes |
|---|---:|---|
| Account / portfolio / search | 5 | Broad read scope |
| Watchlists | 12 | Includes mutations |
| Market data | 9 | Observation |
| Equities | 8 | Includes review + place + cancel |
| Options | 10 | Includes review + place + cancel |
| Scanners | 6 | Includes create/update mutations |

Order mutations of concern: `place_equity_order`, `cancel_equity_order`, `place_option_order`, `cancel_option_order`.

July 21 drift additions vs prior 45-tool snapshot: `get_financials`, `get_equity_price_book`, `get_equity_tax_lots`, `get_option_historicals`, `get_scanner_filter_specs`.

## Runbook implications

1. First pilot is **broker-disconnected shadow mode** (see `runbook://examples/shadow-pilot.manifest`).
2. Runbook never receives credentials and never exposes place/cancel tools.
3. A future connected phase needs runtime inventory capture, least-privilege review, and fail-closed admission—not prompt allowlists alone.
4. Banking MCP documents virtual-card detail retrieval as credential release; model separately from ordinary observation. Runbook does not handle card data.

## Primary sources (read officially; re-check before live phases)

- Agentic Trading overview / trading-with-your-agent support pages
- Robinhood Customer Agreement §29 (API Package personal use / Licensee Product)
- July 1, 2026 product announcement (crypto Agentic Accounts described as coming soon)

For offline capability analysis of frozen fixtures, use capability-registry tools when available; do not invent runtime inventory from this document.
