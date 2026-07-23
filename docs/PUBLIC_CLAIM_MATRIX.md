# Public claim matrix

Maps public-facing claims (README, MCP resources, web copy) to **code or demo evidence** in this checkout.  
Prefer package sources over marketing docs when they disagree. Surface inventory truth: [`packages/mcp/src/surface.ts`](../packages/mcp/src/surface.ts).

**Checkout reference:** MCP server `runbook` **v0.3.1**, **33** tools in `TOOL_NAMES`.

| # | Public claim | Evidence (code / demo) | Notes / non-claim |
| --- | --- | --- | --- |
| 1 | **Broker-neutral process / evidence / control layer** (not a trading bot) | Root framing in private `README.md` + operator is/is-not table in `packages/mcp/OPERATOR_GUIDE.md` §1; product boundary `packages/mcp/src/catalog/boundary.md` | No alpha/PnL optimization surface; shadow metrics are process axes only (`@runbook/shadow-lab`) |
| 2 | **No place / cancel order tools** | `TOOL_NAMES` in `packages/mcp/src/surface.ts` — no `place_*` / `cancel_*`; notes: `"Closed inventory: no place_* or cancel_* tools."`; golden asserts in `packages/mcp/src/golden-journey.ts`, `golden-recursive-elite.test.ts`, `golden-shadow-pilot.test.ts` | Host may still load a separate brokerage MCP that *does* have place tools — Runbook cannot block that |
| 3 | **`brokerExecutionTools` is always empty** | `SurfaceInventory.brokerExecutionTools: []` in `surface.ts` `buildSurfaceInventory()`; schema `z.array(z.string()).max(0)` in `packages/mcp/src/server-factory.ts` | Empty list is a surface property, not proof that the host never executes elsewhere |
| 4 | **Every tool has `openWorldHint: false`** | `buildSurfaceInventory()` maps each tool with `openWorldHint: false as const`; inventory field `openWorldHint: false` | Offline-ness of *side effects* still varies by tool; see `OFFLINE_TOOL_NAMES` set |
| 5 | **Closed MCP inventory count + version** | `SERVER_VERSION = "0.3.1"`; `TOOL_NAMES` length **33** in `packages/mcp/src/surface.ts`; discoverable via `runbook_list_surface` | Older docs that say “20 tools” / `0.2.0` or “30 tools” / `0.3.0` are stale relative to this file |
| 6 | **No brokerage credentials in product path** | Boundary rule 1 in `packages/mcp/src/catalog/boundary.md`; `SECURITY.md` scope; ledger/schema rejection patterns in `@runbook/engine` ledger/policy tests | Operators must still avoid pasting secrets into free-text fields |
| 7 | **Preflight is advisory, not a hard broker gateway** | Boundary rule 3; tool `runbook_preflight_trade` description in MCP server factory; operator guide: “a direct broker tool can bypass Runbook” | `allowed: true` ≠ account-wide enforcement |
| 8 | **Approvals are caller-asserted (not authenticated human authority)** | Boundary rule 4; execution evidence flags `humanAuthorityEstablished: false` / `authorizationEstablished: false` (operator guide §1 hard facts); gateway evaluator docs in private `README.md` “Authorization-conditions evaluator” | Signed approval tools (`runbook_approval_*`) bind keys to action digests; they still do not execute trades |
| 9 | **Local hash-chained decision ledger** | `@runbook/engine` `ledger.ts` + `runbook_verify_ledger` / `runbook_list_events`; default path `~/.runbook/events.jsonl` | Verifies local chain integrity, not external immutability or broker truth |
| 10 | **Portable offline-verifiable Proof Capsules (`.runbook`)** | `@runbook/capsule` Node verifier; `@runbook/capsule-browser` Worker path; MCP `runbook_verify_capsule`; frozen corpus under `conformance/` + `SHA256SUMS`; web `/verify` | Valid capsule ≠ author identity, skill, compliance, or broker issuance |
| 11 | **Shadow lab improves charter/process quality only (not returns)** | `@runbook/shadow-lab` README + `refine.ts` / `evaluate-charter.ts` / `tournament.ts`; MCP tools `runbook_run_shadow_curriculum`, `runbook_improve_charter`, `runbook_shadow_tournament`; demos `pnpm demo:elite`, `pnpm demo:tournament` | Assurance label intent: synthetic-curriculum process quality only |
| 12 | **Financial Capability Registry is offline analysis, not live inventory** | `@runbook/financial-capability-registry` package + MCP tools `runbook_verify_capability_snapshot`, `runbook_diff_capabilities`, `runbook_admit_capabilities`; web `/registry` | Admission receipt ≠ trade authorization |
| 13 | **Public OAuth metadata inspect is credential-free / fixture-oriented** | `@runbook/public-auth-metadata`; MCP `runbook_inspect_public_auth_metadata`; profile docs `public_auth_metadata_profile.md` | Offline parse of discovery bodies; not live auth or token handling |
| 14 | **Pre-Capital Control Dossier V2 is incomplete (architecture slices)** | Dossier packages: `financial-dossier-core`, `-adapter`, `-harness`, `-process-bridge`; web `/dossier` honesty board; process-bridge README: five completed multi-request lifecycles, not full 31-case product | Do not claim buyer-ready dossier, composite safety grade, or full V2 completion |
| 15 | **Live capital is $0 / research prototype** | Root `README.md` status paragraph (“Live-capital allocation is `$0`…”); operator guide hard product facts; `SECURITY.md` “not approved to authorize or execute live financial transactions” | Commercial readiness is a separate gate outside this matrix |
| 16 | **Not affiliated with Robinhood** | Explicit disclaimer intended for public README; `packages/mcp/ROBINHOOD_AGENTIC_CONTRACT.md` frames research transcription of public docs only | Mentions of Robinhood public MCP/docs are interface research, not partnership |
| 17 | **No composite “agent is safe” score** | Boundary rule 6; MCP package README “Composite safety score: **prohibited**”; `/dossier` and `/safety-card` gap honesty | Multi-axis assurance only (ledger / capsule / registry / pilot-doctor / preflight) |

## How to re-verify quickly

```bash
# Surface lock + no place_*/cancel_*
pnpm --filter @runbook/mcp test

# Elite process demo (process metrics only)
pnpm demo:elite

# Golden journey receipt (inventory + offline demos)
pnpm demo:frontier

# Frozen capsule corpus bytes
(cd conformance && shasum -a 256 -c SHA256SUMS)
```

## Documentation lockstep

Public/operator docs should match `surface.ts` (`33` tools, `0.3.1`):

- `packages/mcp/README.md`, `packages/mcp/OPERATOR_GUIDE.md`, `README.public.md`
- Web cockpit: `apps/web/src/lib/mcp-cockpit-data.ts` (+ `/mcp` copy)

Re-scan with: `rg -n "0\\.3\\.0|30 tools|0\\.2\\.0|20 tools" packages/mcp apps/web README.public.md docs/PUBLIC_CLAIM_MATRIX.md`  
(Intentional historical mentions only — e.g. test client version strings, lockfile package versions, claim-matrix “stale relative to” notes.)
