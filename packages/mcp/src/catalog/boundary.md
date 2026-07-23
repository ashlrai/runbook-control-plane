# Runbook product boundary

Runbook is a **local, broker-neutral** policy recorder and advisory workbench for financial agents.

## Hard rules

1. **No brokerage credentials.** Never put API keys, OAuth tokens, passwords, or card numbers in tool arguments, notes, env values meant for logs, or the ledger.
2. **No order execution.** Runbook never places, routes, previews, or cancels broker orders. It has no `place_*` or `cancel_*` tools.
3. **Advisory only.** `allowed: true` means the submitted proposal passed the recorded charter checks. It does **not** mean an account-wide control prevented other actions.
4. **Approvals are caller-asserted.** An agent can claim `actor.type: "human"`. That is **not** authenticated human authority. Execution evidence always reports `humanAuthorityEstablished: false` and `authorizationEstablished: false`.
5. **Disconnected shadow pilot first.** Do not configure or authenticate Robinhood Trading MCP (or any brokerage MCP) during the shadow pilot. A direct brokerage tool can bypass Runbook entirely.
6. **No composite safety score.** Ledger validity, capsule integrity, registry admission, and pilot-doctor readiness are separate assurance axes. Do not invent a single green/red “agent is safe” grade.
7. **No Social automation.** Robinhood Social is personal and manual; commercial use and automated access are permission-gated.

## What Runbook does

- Record experiments and risk charters
- Preflight trade *proposals* against deterministic local policy
- Record caller-asserted decisions and owner-controlled execution imports
- Verify a local hash-chained ledger
- Offline-verify proof capsules and analyze public capability/auth fixtures

## Assurance ladder (never collapse)

| Axis | What a pass means | What it does **not** mean |
|---|---|---|
| Ledger verify | Local chain/idempotency intact relative to this file | External immutability, broker truth |
| Pilot doctor ready | Shadow declaration + local checks passed | System-wide broker disconnection |
| Capsule valid | Transport, digests, author signature verify | Author identity, skill, compliance, broker issuance |
| Registry admit/reject | Offline analysis of reviewed claims | Live inventory, trade authorization |
| Preflight allowed | Proposal matched charter inputs | Hard gateway over the broker |

Read `runbook://docs/tool-contract` and `runbook://docs/assurance` next. Prefer prompt `runbook_shadow_pilot` for day-1 workflow.
