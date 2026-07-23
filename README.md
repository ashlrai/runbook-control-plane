# Runbook

Runbook is a **broker-neutral process, evidence, and control layer for financial agents**. It helps a human define a Capital Constitution (risk charter) before an agent acts, evaluate synthetic or proposed actions against deterministic local policy, preserve an owned-data hash-chained decision ledger, and export portable, offline-verifiable proof artifacts—without holding credentials, custody, or the ability to place broker orders.

| | |
| --- | --- |
| **Status** | Research prototype — not a production trading system |
| **Hosted lab** | [runbook.ashlr.ai](https://runbook.ashlr.ai) · browser-local process evidence · [showcase](https://runbook.ashlr.ai/showcase) |
| **MCP** | `runbook` **v0.3.2** · closed **33-tool** inventory · `brokerExecutionTools: []` |
| **Capital** | Live-capital allocation: **$0** |
| **License** | [Apache-2.0](./LICENSE) |
| **Affiliation** | **Not affiliated with, endorsed by, or part of Robinhood Markets, Inc.** |

---

## What it is / is not

| Is | Is not |
| --- | --- |
| Local policy recorder + advisory preflight for agent workflows | A trading bot, alpha engine, or strategy optimizer |
| Hash-chained decision ledger + portable Proof Capsule evidence | A broker, OMS, or order router |
| Offline capability-registry and public OAuth-metadata analysis | Live inventory authority or trade authorization |
| Shadow Process Lab (charter quality vs synthetic curricula) | PnL optimization or live-capital performance claims |
| Pre-Capital Control Dossier **architecture slices** (V2 incomplete) | A completed product dossier, safety certification, or composite score |
| MCP companion that sits **beside** an agent (stdio) | A hard broker gateway that can block bypass tools |
| Synthetic / fixture-first evaluation harnesses | Credential vault, custody, or personalized investment advice |

---

## Quick start

Requires **Node.js 22** and the **pnpm** version pinned in root `package.json` (`packageManager`).

```bash
pnpm install
pnpm ready:elite    # install + build engine, shadow-lab, session, mcp; print next steps
pnpm demo:elite     # weak charter → refine → hardFalseAllows = 0 → agent-eval (process only)
pnpm demo:frontier  # golden-journey receipt: inventory + shadow pilot + offline demos
pnpm --filter @runbook/web dev
```

Open [http://localhost:3000](http://localhost:3000).

**Optional MCP install (Codex or any stdio host):**

```bash
pnpm mcp:build
codex mcp add runbook -- node "$PWD/packages/mcp/dist/server.js"
```

Default private ledger: `~/.runbook/events.jsonl`. Override with absolute `RUNBOOK_DATA_DIR` only for an intentional private path.

```bash
# Verify / smoke (no broker, no network required for golden path)
pnpm smoke:elite        # shadow-lab + mcp surface lockstep
pnpm smoke:all-elite    # + web shadow UI + dossier process-bridge
pnpm test && pnpm typecheck && pnpm lint && pnpm build
(cd conformance && shasum -a 256 -c SHA256SUMS)
```

`ready:elite` only needs a clean checkout of this monorepo (no private credential files, broker tokens, or external secrets).

---

## Architecture

```text
                         ┌─────────────────────────────┐
                         │  MCP host (Codex / agent)   │
                         └──────────────┬──────────────┘
                                        │ stdio
                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  @runbook/mcp  (runbook v0.3.2 · 33 tools · openWorldHint:false) │
│  ledger · preflight · offline verify · shadow · session · approvals│
└───┬──────────────┬───────────────┬──────────────┬────────────────┘
    │              │               │              │
    ▼              ▼               ▼              ▼
@runbook/engine  @runbook/     @runbook/      @runbook/session
 policy·ledger   shadow-lab    capsule        control-plane
 gateway·        curriculum    registry       charter pins
 checkpoint      refine        public-auth    dossier attach
                 tournament
    │
    ▼
 ~/.runbook/events.jsonl   (local owned-data ledger; optional RUNBOOK_DATA_DIR)

Browser / evidence (local-first, no upload required for verify path)
────────────────────────────────────────────────────────────────────
apps/web (@runbook/web) ── /verify Worker ── @runbook/capsule-browser
                       ── /lineage ────────── @runbook/capsule-lineage
                       ── /control-room ───── @runbook/engine
                       ── /safety-card ────── control-card + financial-bench
                       ── /dossier ────────── dossier-* honesty board
apps/signer ──────────── isolated device-local Creator Proof preview

Pre-Capital / Safety Bench stack (synthetic, credential-free)
────────────────────────────────────────────────────────────────────
financial-bench → harness → sandbox (Docker reviewed-bundle slice)
financial-dossier-core → adapter → harness → process-bridge
  (V2 candidate: incomplete; five completed process lifecycles, not full product)
```

**MCP sits beside the agent.** It records process evidence and offline analysis. It does not proxy a broker, fund accounts, or place orders. A direct brokerage tool configured in the same host can bypass Runbook entirely.

---

## Packages

| Package | Role |
| --- | --- |
| **`@runbook/mcp`** | Local MCP server: closed tool surface, ledger, offline demos, shadow/session tools |
| **`@runbook/engine`** | Policy evaluate, file ledger, gateway approvals, content/growth primitives, DSSE checkpoint |
| **`@runbook/shadow-lab`** | Synthetic curriculum, recursive charter refine, multi-charter tournament |
| **`@runbook/session`** | Control-plane session spine: charter digests, inventory pins, dossier/shadow attach |
| **`@runbook/capsule`** | Strict Node offline verifier for `.runbook` Proof Capsule archives |
| **`@runbook/capsule-browser`** | Browser/Web Crypto twin; Worker-isolated on `/verify` |
| **`@runbook/capsule-author`** | Deterministic capsule byte construction for authoring |
| **`@runbook/capsule-lineage`** | Multi-capsule lineage graph analysis (browser-safe) |
| **`@runbook/control-card`** | Synthetic Control Self-Test Card packaging |
| **`@runbook/creator-proof`** | Creator Proof seed / research application profile |
| **`@runbook/signer-browser`** | Browser device-author key lifecycle for isolated signer origin |
| **`@runbook/financial-bench`** | Frozen V1 Safety Bench scenarios + canonical receipts |
| **`@runbook/financial-bench-harness`** | In-process fake-tool / fake-approval subject harness |
| **`@runbook/financial-bench-sandbox`** | Docker per-case reviewed-bundle sandbox receipts |
| **`@runbook/financial-capability-registry`** | Provenance-bound capability snapshots, diffs, admission |
| **`@runbook/financial-capability-verifier-browser`** | Browser verifier for capability-registry evidence |
| **`@runbook/public-auth-metadata`** | Offline public OAuth discovery / drift analysis |
| **`@runbook/financial-dossier-core`** | Dossier V2 namespace, axes, oracles (candidate) |
| **`@runbook/financial-dossier-adapter`** | Target-visible, oracle-free protocol contract |
| **`@runbook/financial-dossier-harness`** | Host-private runner-observed harness slice |
| **`@runbook/financial-dossier-process-bridge`** | Real child-process completed lifecycle slice |
| **`@runbook/web`** (`apps/web`) | Local-first product / research UI (Next.js) |
| **`@runbook/signer`** (`apps/signer`) | Isolated static Creator Proof signer preview |

---

## MCP surface

Source of truth: [`packages/mcp/src/surface.ts`](./packages/mcp/src/surface.ts).

| Property | Value |
| --- | --- |
| Server name | `runbook` |
| Server version | **`0.3.2`** |
| Tools | **33** closed names in `TOOL_NAMES` |
| `brokerExecutionTools` | always `[]` |
| `openWorldHint` | `false` on every tool |
| Transport | stdio |
| Composite safety score | **prohibited** |

### Tool inventory (stable discovery order)

| # | Tool | Notes |
| --- | ---: | --- |
| 1 | `runbook_list_surface` | Closed inventory discovery |
| 2 | `runbook_create_experiment` | Experiment + charter |
| 3 | `runbook_preflight_trade` | Advisory proposal preflight |
| 4 | `runbook_record_approval` | Caller-asserted decision |
| 5 | `runbook_record_execution` | Owner-controlled fill import |
| 6 | `runbook_list_events` | Ledger read |
| 7 | `runbook_verify_ledger` | Chain / idempotency verify |
| 8 | `runbook_verify_capsule` | Offline `.runbook` verify |
| 9 | `runbook_verify_capability_snapshot` | Capability snapshot JCS check |
| 10 | `runbook_diff_capabilities` | Deterministic capability diff |
| 11 | `runbook_admit_capabilities` | Admit / quarantine / reject analysis |
| 12 | `runbook_inspect_public_auth_metadata` | Offline OAuth discovery parse |
| 13 | `runbook_pilot_doctor` | Shadow pilot local readiness |
| 14 | `runbook_export_public_snapshot` | Metadata-only public export |
| 15 | `runbook_run_shadow_curriculum` | Synthetic curriculum run |
| 16 | `runbook_improve_charter` | Recursive refine |
| 17 | `runbook_shadow_tournament` | Multi-charter Pareto tournament |
| 18 | `runbook_activate_refined_charter` | Explicit ledger activate |
| 19 | `runbook_agent_eval` | Process-axis agent eval |
| 20 | `runbook_expand_curriculum_from_ledger` | Synthetic labels from ledger |
| 21 | `runbook_session_create` | Control-plane session |
| 22 | `runbook_session_use` | Mark active session (local marker) |
| 23 | `runbook_session_get` | Session read |
| 24 | `runbook_session_export` | Session export |
| 25 | `runbook_session_set_charter` | Pin charter |
| 26 | `runbook_session_pin_inventory` | Pin tool inventory |
| 27 | `runbook_session_check_inventory` | Drift / unknown tools |
| 28 | `runbook_session_import_tools_list` | Import local tools/list JSON vs pin |
| 29 | `runbook_session_bind_experiment` | Bind local ledger experimentId |
| 30 | `runbook_session_attach_dossier` | Attach dossier evidence |
| 31 | `runbook_session_record_shadow` | Record shadow generation |
| 32 | `runbook_approval_create_signed` | Ed25519-bound approval artifact |
| 33 | `runbook_approval_verify` | Verify signed approval |

There are **no** `place_*` or `cancel_*` tools. Prefer `runbook_list_surface` and resource `runbook://docs/boundary` before mutating tools.

---

## Web routes

Local-first Next.js app (`pnpm --filter @runbook/web dev`):

| Route | Purpose |
| --- | --- |
| `/` | Product map (Safety Bench · Verify/Lineage · Experiment/MCP doors) |
| `/safety-card` | Browser-local control self-test + scenario gap honesty |
| `/control-room` | Live Capital Constitution theater (synthetic proposals; advisory) |
| `/registry` | Offline Capability Registry explorer / drift theater |
| `/dossier` | Pre-Capital Control Dossier V2 **status board** (no safety score) |
| `/mcp` | MCP cockpit: inventory, golden journey, offline demos |
| `/session` | Control-plane session UI |
| `/shadow-lab` | Curriculum tickets, refine, fixed-point recursion theater |
| `/experiments/new` | Local charter builder |
| `/verify` | Worker-isolated local `.runbook` verifier |
| `/lineage` | Worker-isolated Lineage Atlas |
| `/proof-capsule` | Public Verify → Clone category surface |
| `/trust` | Metadata-only portable artifact verifier + assurance ladder |
| `/content`, `/growth`, `/growth/baseline` | Research-history creator workspaces |
| `/lab/apply` | Historical founding-pilot fit check (no payment) |
| `/public/mason-agentic-arena` | Explicitly synthetic public proof-page demo |

---

## Safety boundaries

Hard rules (also at MCP resource `runbook://docs/boundary` and [`packages/mcp/src/catalog/boundary.md`](./packages/mcp/src/catalog/boundary.md)):

1. **No brokerage credentials** — API keys, OAuth tokens, passwords, card numbers never belong in tool args, notes, or the ledger.
2. **No order execution** — no `place_*` / `cancel_*`; `brokerExecutionTools` is always empty.
3. **Advisory only** — `allowed: true` is charter match on caller-supplied fields, not a hard account-wide gateway.
4. **Approvals are caller-asserted** — `actor.type: "human"` is not authenticated human authority.
5. **Disconnected shadow pilot first** — do not configure a brokerage MCP during day-1 evidence.
6. **No composite safety score** — ledger, capsule, registry, pilot-doctor, preflight remain separate axes.
7. **No Social automation** — Robinhood Social (and similar) is personal/manual; commercial or automated use is out of scope here.

A valid capsule, ledger chain, or preflight result does **not** establish author identity, independent time, broker issuance, execution truth, completeness, investment performance, suitability, or regulatory compliance.

---

## Open source / license

This project is intended for public release under the **[Apache License 2.0](./LICENSE)**.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development workflow and non-negotiable product boundaries. See [`SECURITY.md`](./SECURITY.md) for vulnerability reporting.

---

## Not affiliated with Robinhood

Runbook is an independent research prototype. It is **not** a Robinhood product, affiliate, partner program, or official integration. Mentions of Robinhood public documentation, MCP naming, or OAuth discovery origins are for **broker-neutral interface research and offline fixture analysis only**. No endorsement is implied.

---

## Status honesty

| Claim | Truth |
| --- | --- |
| Research prototype | Yes — experimental, evolving, not production-supported |
| Pre-Capital Dossier V2 | **Incomplete** architecture candidate (process-bridge slices ≠ full product) |
| Live capital | **$0** — no funded product path; buyer-validation capital remains zero |
| Broker connection | **None** in this surface |
| “Agent is safe” grade | **Prohibited** |
| Public claim evidence | See [`docs/PUBLIC_CLAIM_MATRIX.md`](./docs/PUBLIC_CLAIM_MATRIX.md) |

---

## Contributing / security

- **Contributing:** [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- **Security policy:** [`SECURITY.md`](./SECURITY.md)
- **Operator depth (optional):** [`OPERATOR_GUIDE.md`](./OPERATOR_GUIDE.md)
- **Public claim ↔ code matrix:** [`docs/PUBLIC_CLAIM_MATRIX.md`](./docs/PUBLIC_CLAIM_MATRIX.md)

Coordinate substantial work in an issue before opening a pull request. Do not weaken archive, Worker, signature, policy, provenance, or privacy limits for convenience. Never commit real account exports, positions, balances, credentials, tokens, private keys, or personally identifying customer data.

---

## Disclaimer

Runbook does not provide investment, legal, or compliance advice. Synthetic demos and process metrics measure **declared control quality**, not trading returns. Use at your own risk.
