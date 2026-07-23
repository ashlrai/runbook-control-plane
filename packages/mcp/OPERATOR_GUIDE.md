# Runbook Operator Guide

**Audience:** Mason (builder/operator) and coding agents using the Runbook MCP companion.  
**Checkout truth date:** 2026-07-23  
**Server surface:** `runbook` MCP `0.4.2` · closed **40** tools · `brokerExecutionTools: []`

This guide is operational, not marketing. Prefer exact package paths and tool names over slogans. When package docs and UI copy diverge, package sources and `packages/mcp/src/surface.ts` win.

---

## 1. What Runbook is (and is not)

### Is

- A **broker-neutral process / evidence / control layer** for financial agents.
- A place to define a **Capital Constitution** (RiskPolicy charter), **advisory-preflight** proposals, and keep a **local hash-chained decision ledger**.
- Offline assurance primitives: Proof Capsule verify, Capability Registry analysis, public OAuth metadata inspect, Financial Agent Safety Bench / Control Card, Pre-Capital Dossier V2 **architecture slices**.
- A **local MCP companion** that sits **beside** an agent (stdio), never inside a broker.
- A **Shadow Process Lab** that improves charter / process quality against synthetic curricula.

### Is not

| Claim people invent | Reality |
| --- | --- |
| Trading bot / strategy engine | No alpha optimization; shadow metrics are process axes only |
| Live capital product | **Live capital = `$0`** through first buyer-validation gate |
| Robinhood product / affiliate | Independent prototype; not affiliated with or endorsed by Robinhood |
| Hard broker gateway | Preflight `allowed` is advisory; a direct broker tool can bypass Runbook |
| Composite “agent is safe” grade | Prohibited. Multi-axis assurance only |
| Credential vault | Ledger rejects credential-shaped fields; never put secrets in tool args |

### Hard product facts

- **No credentials** (API keys, OAuth tokens, passwords, card numbers).
- **No place / cancel tools** — surface inventory freezes `brokerExecutionTools: []`.
- **No network required** for golden / elite / offline demo paths.
- Approvals with `actor.type: "human"` are **caller-asserted**, not authenticated human authority.
- Execution evidence always reports `humanAuthorityEstablished: false` and `authorizationEstablished: false`.

Read the machine boundary at MCP resource `runbook://docs/boundary` or `packages/mcp/src/catalog/boundary.md`.

---

## 2. Architecture map

Monorepo (`pnpm` workspace: `apps/*`, `packages/*`). Package manager: `pnpm@10.28.2`.

### Runtime companion path (agent day-to-day)

```text
coding agent (Codex / MCP host)
        │  stdio MCP
        ▼
@runbook/mcp  (server.js / cli.js)
   ├── @runbook/engine        policy evaluate, FileLedger, schemas, gateway, checkpoint
   ├── @runbook/shadow-lab    curriculum / refine / tournament / meta-curriculum
   ├── @runbook/session       control-plane session spine, inventory pin, signed approval intent
   ├── @runbook/capsule       offline .runbook verify (Node)
   ├── @runbook/financial-capability-registry
   └── @runbook/public-auth-metadata
        │
        ▼
  ~/.runbook/events.jsonl   (default private ledger; or RUNBOOK_DATA_DIR)
  ~/.runbook/sessions/      (control-plane sessions; or RUNBOOK_DATA_DIR/sessions)
```

**MCP sits beside the agent.** It records process evidence and offline analysis. It does not proxy Robinhood, launch sandboxes, or fund accounts.

### Offline proof / evidence stack

```text
@runbook/engine/checkpoint     DSSE/Ed25519 signed-statement primitive
@runbook/capsule               deterministic STORED-only .runbook container
@runbook/capsule-browser       browser/Web Crypto twin (Worker on /verify)
@runbook/capsule-lineage       multi-capsule graph semantics
@runbook/capsule-author        authoring helpers
@runbook/control-card          Synthetic Control Self-Test Card packaging
@runbook/creator-proof         Creator Proof seed / research artifacts
@runbook/signer-browser        browser signing primitive
apps/signer                    isolated static signer preview (deny-all CSP)
conformance/                   frozen golden + tampered corpus + SHA256SUMS
```

### Financial control product stack

```text
@runbook/financial-bench                 V1 Safety Bench schemas + 4 hostile scenarios + calibration
@runbook/financial-bench-harness         credential-free subject contract + fake tools/approvals
@runbook/financial-bench-sandbox         Docker reviewed-bundle slice (Limited-scope Sandbox Target Run Receipt)
@runbook/financial-capability-registry   50-case normative corpus + provider lineage
@runbook/financial-capability-verifier-browser
@runbook/public-auth-metadata            four-source OAuth discovery offline lane
```

### Pre-Capital Control Dossier V2 candidate (architecture, not buyer product)

```text
@runbook/financial-dossier-core              finance-000…030 namespace, axes, oracles
@runbook/financial-dossier-adapter           target-visible protocol (oracle-free)
@runbook/financial-dossier-harness           host-private runner-observed slice
@runbook/financial-dossier-process-bridge    real child-process completed lifecycles
```

### Web + signer surfaces

```text
apps/web (@runbook/web)     local-first product / research UI (Next.js)
apps/signer (@runbook/signer)  isolated device-local Creator Proof fork preview
```

### How the pieces connect in practice

| Goal | Primary package | Surface |
| --- | --- | --- |
| Agent records charter + preflight | `@runbook/mcp` + `@runbook/engine` | MCP tools / CLI |
| Recursive charter improve | `@runbook/shadow-lab` via MCP | MCP shadow tools, `/shadow-lab`, `pnpm demo:elite` |
| Verify a `.runbook` file | `@runbook/capsule` / browser twin | MCP tool, CLI, `/verify` |
| Capability drift theater | registry package | MCP offline tools, `/registry` |
| Dossier honesty board | process-bridge + harness truth | `/dossier`, `runbook://status/dossier` |
| Safety Bench self-test | financial-bench + control-card | `/safety-card` |
| Docker sandbox receipts | financial-bench-sandbox | **not** on the elite/MCP golden path |

### Shadow lab recursion (process only)

```text
weak RiskPolicy
    → evaluateCharter (curriculum)     hardFalseAllows often > 0
    → runRecursiveImprovement          deterministic refine rules
    → finalPolicy                      target hardFalseAllows = 0
    → optional tournament (Pareto)
    → optional ledger activate         explicit only
    → agent_eval + expand_curriculum   process axes / synthetic labels
```

Never optimizes PnL. Never places orders. Assurance: `synthetic-curriculum-process-quality-only`.

---

## 3. Quick start (15 minutes)

From repository root:

### Install and build

```bash
pnpm setup:elite            # install + build engine + shadow-lab + mcp (preferred first-time path)
# or:
pnpm install
pnpm build                  # optional full workspace
pnpm mcp:build              # MCP + deps (engine, shadow-lab via prebuild)
```

### Elite process demos (no Docker, no credentials, $0 capital)

```bash
pnpm demo:frontier     # golden-journey: inventory + shadow pilot day-1 + offline demos
pnpm demo:elite        # weak → hardFalseAllows > 0 → refine → 0 → agent-eval + SUCCESS banner
pnpm demo:tournament   # multi-charter Pareto (generations 4, mutants 4, seed 7)
pnpm demo:recursive    # alias of demo:elite
```

Expected stdout schemas (success exit `0`):

| Script | Receipt / behavior |
| --- | --- |
| `demo:frontier` | `runbook.golden-journey-receipt.v1` |
| `demo:elite` | `runbook.recursive-elite-demo.v1` |
| `demo:tournament` | `runbook.shadow-tournament.v1` |

Smokes:

```bash
pnpm smoke:elite       # @runbook/shadow-lab + @runbook/mcp tests
pnpm smoke:web-shadow  # web vitest shadow-lab adapter + UI
pnpm smoke:dossier     # @runbook/financial-dossier-process-bridge tests
pnpm smoke:all-elite   # all three
pnpm smoke:mcp         # mcp build + full package tests
```

### Web app

```bash
pnpm --filter @runbook/web dev
```

Open [http://localhost:3000](http://localhost:3000).

Key URLs immediately:

| URL | Why |
| --- | --- |
| `/` | Product map — three builder doors |
| `/shadow-lab` | Curriculum / refine / tournament / meta theater |
| `/mcp` | 40-tool inventory, install copy, golden journey checklist |
| `/session` | Control-plane session UI (charter · inventory pin · shadow · dossier) |
| `/dossier` | Honest V2 case board |
| `/control-room` | Live engine preflight on synthetic proposals |
| `/safety-card` | Reference control self-test |
| `/verify` | Browser Worker capsule verifier |
| `/registry` | 45→50 capability drift theater |

### Install Runbook MCP into Codex

```bash
pnpm --filter @runbook/mcp build
codex mcp add runbook -- node "$PWD/packages/mcp/dist/server.js"
codex mcp list
```

Optional private data root (must be **absolute**):

```bash
codex mcp add runbook \
  --env RUNBOOK_DATA_DIR=/ABSOLUTE/PRIVATE/PATH \
  -- node "$PWD/packages/mcp/dist/server.js"
```

Default ledger: `~/.runbook/events.jsonl`.

Start a **new** agent task after install so tools, resources, and prompts rediscover.

**First agent moves:**

1. `runbook_list_surface` — confirm 40 tools, empty `brokerExecutionTools`.
2. Read `runbook://docs/boundary` and `runbook://docs/assurance`.
3. Prompt `runbook_shadow_pilot` or CLI `node packages/mcp/dist/cli.js golden-journey`.
4. For elite loop: prompt `runbook_elite_recursive_loop` or `pnpm demo:elite`.
5. Optional control-plane: prompt `runbook_control_plane_session` or open `/session`.

---

## 4. MCP tool catalog

Server: `runbook` / `0.4.2`. Source of truth: `packages/mcp/src/surface.ts` (`TOOL_NAMES`, length **40**).  
All tools: `openWorldHint: false`, no broker side effects. Closed inventory — do not invent tools.  
Breakdown: **1** discovery + **6** ledger + **7** offline + **6** shadow + **13** control-plane session.

### Discovery / surface (1)

| Tool | Effect | Read-only |
| --- | --- | --- |
| `runbook_list_surface` | Closed inventory: tools, resource URIs, prompts, version, `brokerExecutionTools: []` | yes |

### Ledger / shadow pilot (6)

| Tool | Effect | Read-only |
| --- | --- | --- |
| `runbook_create_experiment` | Record experiment + charter v1 | no |
| `runbook_preflight_trade` | Record proposal + advisory policy checks; dual-eval session charter when active (`ledgerAllowed`, `sessionCharterBinding`, optional process deny under `charterBindingEnforcement: fail-closed`) | no |
| `runbook_record_approval` | Caller-asserted human decision (unauthenticated) | no |
| `runbook_record_execution` | Import owner-controlled fill data | no |
| `runbook_list_events` | Read local ledger events | yes |
| `runbook_verify_ledger` | Sequence, idempotency, SHA-256 chain | yes |

Day-1 shadow pilot: create → preflight → **hard stop** (no approval/execution) → verify. Prefer equity-only charter with `approvalRequired: true`.

### Offline demos (registry, capsule, auth, doctor, snapshot) (7)

| Tool | Effect | Assurance |
| --- | --- | --- |
| `runbook_verify_capsule` | Offline `.runbook` (path or fixtureId) | self-asserted-author-key-integrity |
| `runbook_verify_capability_snapshot` | Exact-JCS capability snapshot check | offline-reviewed-claim-analysis |
| `runbook_diff_capabilities` | Deterministic capability diff | offline-reviewed-claim-analysis |
| `runbook_admit_capabilities` | Admit / quarantine / reject analysis only | offline-reviewed-claim-analysis |
| `runbook_inspect_public_auth_metadata` | Offline OAuth discovery body parse | offline-fixture-or-operator-capture-analysis |
| `runbook_pilot_doctor` | Shadow pilot local readiness | local-attestation-and-ledger-only |
| `runbook_export_public_snapshot` | Metadata-only public export | local-ledger-read |

Fixture IDs are SHA-256 pinned (`runbook://fixtures/catalog`). Unknown IDs fail closed.

### Recursive improve (6)

| Tool | Effect | Read-only | Notes |
| --- | --- | --- | --- |
| `runbook_run_shadow_curriculum` | Multi-axis synthetic curriculum report | yes | policy override → ledger charter → reference elite |
| `runbook_improve_charter` | Recursive offline refinement | yes | **never** auto-writes ledger (`activatedOnLedger: false`) |
| `runbook_shadow_tournament` | Multi-charter Pareto front | yes | weak + elite + mutants; not trading performance |
| `runbook_activate_refined_charter` | Explicit `charter.activated` append | no | human/operator intent only |
| `runbook_agent_eval` | Local ledger process axes | yes | `runbook.agent-eval.v1`; not PnL |
| `runbook_expand_curriculum_from_ledger` | Derive synthetic deny scenarios from preflight fails | yes | does not mutate ledger |

### Control plane session (13)

Local process/evidence spine via `@runbook/session`. Files under `RUNBOOK_DATA_DIR/sessions` or `~/.runbook/sessions`. **Not** a hard broker gateway; **not** trading performance; device-key signatures are local attestation only.

| Tool | Effect | Read-only | Notes |
| --- | --- | --- | --- |
| `runbook_session_create` | Create session (label, optional policy / sessionId) | no | optional `inventoryEnforcement`, `charterBindingEnforcement` (default `warn`) |
| `runbook_session_use` | Mark active session (local marker only) | no | writes `active-session.json`; not broker authorization |
| `runbook_session_get` | Read session by id | yes | local filesystem only |
| `runbook_session_export` | Evidence pack export | yes | local-control-plane-export-only |
| `runbook_session_set_charter` | Bind advisory policy + `charterDigest` | no | does not activate ledger charter |
| `runbook_session_pin_inventory` | Pin admitted tool inventory | no | default public-docs 50-tool research pin |
| `runbook_session_check_inventory` | Observed tools vs pin | yes | **fail-closed** when `inventoryEnforcement: "fail-closed"` |
| `runbook_session_import_tools_list` | Import local tools/list JSON and check vs pin | no | never network fetch; path preferred; O_NOFOLLOW ≤1MiB |
| `runbook_session_bind_experiment` | Bind local ledger `experimentId` (+ optional head hash) | no | local id linkage only — not brokerage account binding |
| `runbook_session_attach_dossier` | Attach architecture evidence note | no | not certification |
| `runbook_session_record_shadow` | Record hardFalseAllows / hardFalseDenies | no | process metrics only |
| `runbook_approval_create_signed` | Ephemeral Ed25519 approval intent | no | private key not persisted |
| `runbook_approval_verify` | Verify signed intent (SPKI base64) | yes | not broker authorization |

Prompt: `runbook_control_plane_session`. Web UI: `/session`.

### Resources that matter

| URI | Purpose |
| --- | --- |
| `runbook://docs/boundary` | Hard product boundary |
| `runbook://docs/assurance` | Multi-axis assurance vocabulary |
| `runbook://docs/tool-contract` | Machine tool table |
| `runbook://docs/robinhood-agentic-contract` | Dated public-doc research map (not live inventory) |
| `runbook://schemas/shadow-pilot-manifest` | Shadow manifest JSON Schema |
| `runbook://examples/shadow-pilot.manifest` | Disconnected zero-capital example |
| `runbook://examples/equity-only-charter-policy` | Safe demo RiskPolicy |
| `runbook://fixtures/catalog` | Closed fixture IDs + pins |
| `runbook://demos/capability-drift` | 45→50 + risk-correction reject |
| `runbook://demos/public-auth-offline` | Offline OAuth inspect |
| `runbook://demos/capsule-golden` | Valid vs tampered capsule |
| `runbook://demos/shadow-pilot` | Day-1 SOP |
| `runbook://demos/shadow-self-improve` | Short improve loop SOP |
| `runbook://playbooks/recursive-elite-process` | Full 10-step elite loop |
| `runbook://status/dossier` | Honest Dossier V2 status |
| `runbook://ledger/verification` | Dynamic local chain verification |

### Prompts that matter

| Prompt | Purpose |
| --- | --- |
| `runbook_explain_boundary` | Restate boundary before mutating tools |
| `runbook_shadow_pilot` | Day-1 create → preflight → hard stop → verify |
| `runbook_preflight_review` | Explain checks; restate advisory enforcement |
| `runbook_verify_artifact` | Route capsule / ledger / registry / public-auth verify |
| `runbook_offline_frontier_demo` | Diff → reject → capsule pair → public-auth |
| `runbook_recursive_improve` | Curriculum → improve → re-eval → fixed point |
| `runbook_elite_recursive_loop` | Full 10-step elite loop (bound to playbook resource) |

### CLI (after `pnpm mcp:build`)

```text
node packages/mcp/dist/cli.js verify [--data-dir ABS] [--ledger-id ID]
node packages/mcp/dist/cli.js export-public EXPERIMENT_ID [--data-dir ABS]
node packages/mcp/dist/cli.js pilot-doctor MANIFEST_PATH --data-dir ABS --workspace-root ABS
node packages/mcp/dist/cli.js golden-journey [--data-dir ABS] [--workspace-root ABS]
node packages/mcp/dist/cli.js shadow-curriculum [--policy path.json]
node packages/mcp/dist/cli.js shadow-improve [--policy path.json] [--generations N]
node packages/mcp/dist/cli.js shadow-tournament [--generations N] [--mutants N] [--seed N]
node packages/mcp/dist/cli.js agent-eval --experiment RUN-ID --data-dir DIR
node packages/mcp/dist/cli.js verify-capsule CAPSULE.runbook
node packages/mcp/dist/cli.js verify-checkpoint ENVELOPE_JSON STATEMENT_JSON PUBLIC_KEY_DER
```

---

## 5. Control Plane Session

Local **process / evidence** spine shared across MCP tools, shadow-lab metrics, and dossier attachments. Package: `@runbook/session`. Server surface includes **13** session tools (see §4).

### What operators use it for

1. **Create** a session (`runbook_session_create`) with an optional equity-only charter; optionally **use** it (`runbook_session_use`) to write the local active-session marker.
2. **Pin inventory** (`runbook_session_pin_inventory`) — default is the public-docs 50-tool Robinhood Trading research pin; optional operator-declared `toolNames`.
3. **Check inventory fail-closed** (`runbook_session_check_inventory`) — unknown observed tools fail when `session.inventoryEnforcement` is `"fail-closed"` (preferred for day-1 evidence). Modes: `off` | `warn` | `fail-closed`. Optional: **import tools/list** (`runbook_session_import_tools_list`) from a local JSON path (never network fetch) and check against the pin.
4. **Bind experiment** (`runbook_session_bind_experiment`) to a local ledger `experimentId` (+ optional head hash) — local id linkage only.
5. Optionally **record shadow** metrics and **attach dossier** architecture notes; export an evidence pack.
6. Optional demo **signed approval intent** (`runbook_approval_create_signed` / `runbook_approval_verify`) — ephemeral Ed25519; private key is not persisted; **not** broker authorization or authenticated legal human identity.

### Web UI

Open **`/session`** in the local web app (`pnpm --filter @runbook/web dev`) for charter seed, inventory pin, shadow/dossier attach, and evidence export theater. MCP tools remain the machine path for agents.

### Hard non-claims

- Not a hard broker gateway (direct broker tools can still bypass Runbook)
- Not trading performance / not capital allocation (`capitalAtRisk: 0`)
- No composite safety score
- No credentials or place/cancel tools

Prefer prompt `runbook_control_plane_session` and resource `runbook://docs/boundary` before mutating session state.

---

## 6. Recursive elite process loop (step by step)

Authoritative playbook: MCP resource `runbook://playbooks/recursive-elite-process`  
Prompt: `runbook_elite_recursive_loop`  
Operator one-shot: `pnpm demo:elite`

### Hard rules (never)

1. **NEVER broker** — no Robinhood Trading MCP, no credentials, no `place_*` / `cancel_*`.
2. **NEVER returns claims** — no alpha, Sharpe, PnL, “agent is profitable.”
3. **NEVER composite score** — keep curriculum, agent-eval, tournament, ledger, pilot-doctor separate.
4. **Activation is explicit** — improve/tournament never auto-write the ledger.

### 10 steps

1. **`runbook_list_surface` + read boundary**  
   Confirm `brokerExecutionTools: []`, all `openWorldHint: false`, shadow tools present, no place/cancel. Read `runbook://docs/boundary` and `runbook://docs/assurance`.

2. **Shadow curriculum on weak (or active) charter**  
   Call `runbook_run_shadow_curriculum` with a weak policy override (options/crypto allowed, empty denylist, high notional, `approvalRequired: false`) **or** an `experimentId` active charter.  
   Expect multi-axis report. Weak path: `hardFalseAllows > 0`. Synthetic only.

3. **`runbook_improve_charter` to fixed point**  
   `maxGenerations` 1–8 (elite often 6–8). Inspect `generations[]`, `finalPolicy`, `initialHardFalseAllows` → `finalHardFalseAllows`.  
   Target: `finalHardFalseAllows === 0`, typically `fixedPoint: true`. Confirm `activatedOnLedger: false`.

4. **Optional tournament**  
   `runbook_shadow_tournament` (`maxGenerations`, `mutantCount`, `seed`). Schema `runbook.shadow-tournament.v1`. Pick Pareto candidate by min `hardFalseAllows` then `hardFalseDenies` — **not** returns.

5. **Create experiment + optional activate**  
   `runbook_create_experiment` with refined `finalPolicy` as initial charter.  
   If swapping an existing experiment: `runbook_activate_refined_charter` only with explicit operator intent.

6. **Synthetic preflights (clean + denied)**  
   Clean equity (e.g. VTI within budget) → allowed under refined policy.  
   Denied path (denylisted symbol and/or option/crypto) → denied.  
   Day-1 elite evidence does **not** require approval/execution events.

7. **`runbook_agent_eval`**  
   Expect `runbook.agent-eval.v1`, `processCorrect: true`, `compositeScore: false`, `notTradingPerformance: true`, `notPnL: true`, `brokerEffect: false`.

8. **`runbook_expand_curriculum_from_ledger`**  
   Schema `runbook.meta-curriculum.v1`. Candidates are synthetic process labels, not market truth. Confirm `ledgerMutated: false`.

9. **Re-improve if new candidates**  
   If `candidateCount > 0` or defects remain, re-run improve/curriculum. Stop at fixed point or generation budget.

10. **Final report discipline**  
    Process metrics only. Explicitly state: not trading performance; not capital allocation; no composite score; no broker side effects. Do not configure a brokerage MCP.

### Golden signals

| Step | Signal |
| --- | --- |
| Inventory | Shadow tools listed; no `place_*` |
| Weak curriculum | `hardFalseAllows > 0` |
| Improve | `finalHardFalseAllows === 0` |
| Tournament (opt) | non-empty `paretoFront`, `capital: 0` |
| Agent eval | `processCorrect: true` |
| Expand | `ledgerMutated: false` |

Shorter loop (no tournament / full ledger story): prompt `runbook_recursive_improve` + resource `runbook://demos/shadow-self-improve`.

---

## 7. Web product map

Start: `pnpm --filter @runbook/web dev` → [http://localhost:3000](http://localhost:3000).

### Primary doors (`/`)

| Door | Route | What to click |
| --- | --- | --- |
| Break the agent safely | `/safety-card` | **Open Safety Bench** → **Reproduce reference behavior** |
| Verify portable evidence | `/verify` | **Open capsule verifier** → **Run embedded fixture** (valid / tampered) |
| Record human-owned experiment | `/experiments/new` | **Start experiment charter** → **Save local charter** / **Validate & fingerprint** |

### First-class product routes

| Route | Purpose | Operator clicks / actions |
| --- | --- | --- |
| `/registry` | Capability Registry explorer; 45→50 drift theater | Filter effect chips; step through drift / mutation theater; note banking credential-release callout |
| `/control-room` | Live Capital Constitution theater | Edit charter/proposal fields → **Run engine preflight** (advisory only) |
| `/shadow-lab` | Recursive process lab | Tabs: **Refine** / **Tournament** / **Meta**. Refine: **Run refinement generation**, **Run until fixed point**, load seed/elite, **Copy policy JSON**. Tournament: **Run tournament**, adopt candidate. Meta: load sample ledger → **Extract** / re-evaluate |
| `/dossier` | Honest Dossier V2 board | Read counts + case grid only (no run button — status surface) |
| `/mcp` | MCP cockpit | **Copy** install / pilot-doctor commands; golden-journey checklist toggles; paste snapshot → **Validate snapshot** |
| `/session` | Control Plane Session | Create/read session, pin inventory, fail-closed check theater, shadow/dossier attach, export pack |
| `/safety-card` | Pre-Capital / Safety Bench reference | **Reproduce reference behavior**; download exact evidence |
| `/verify` | Browser Worker `.runbook` verifier | **Run embedded fixture** / **Download exact fixture**; **Copy exact JCS** / **Download receipt** |
| `/lineage` | Multi-capsule Lineage Atlas | Load multiple local capsules; inspect roots/edges/missing parents; export metadata-only receipts |
| `/proof-capsule` | Verify → Clone category story | **Run the capsule verifier** → `/verify` |
| `/trust` | Metadata-only artifact trust ladder | Paste/inspect portable metadata; read assurance limits |
| `/experiments/new` | Local charter builder | **Save local charter**; **Validate & fingerprint** owned-data import |

### Research history (shipped, not the commercial wedge)

| Route | Note |
| --- | --- |
| `/growth` | Local-first creator experiment cockpit |
| `/growth/baseline` | Manual MasonWyatt23 baseline capture |
| `/content` | Draft workspace + pre-publication checks |
| `/lab/apply` | Seven-gate local fit check for historical $499 pilot (no payment) |
| `/public/mason-agentic-arena` | Explicitly synthetic public proof-page demo |

### Signer (separate app)

`apps/signer` — isolated static preview for one fixed synthetic Creator Proof fork. Not deployed as the main product; deny-all network CSP; not an independent identity product. Build/serve from that package’s README when needed.

---

## 8. Dossier V2 honest status

Namespace: **finance-000 … finance-030** (31 cases).  
UI: `/dossier` · MCP: `runbook://status/dossier` · packages: `financial-dossier-*`.

### Counts (product truth)

| Bucket | Count | IDs / notes |
| --- | --- | --- |
| **Process-bridged** (completed multi-request child-process lifecycle) | **5** | `finance-000`, `003`, `010`, `027`, `028` |
| **Host-only evaluated** (030 partial) | **1** | `finance-030` crash-around-idempotency — **not** full process-bridge |
| **Explicit unrun** | **25** | remaining catalog cases |
| **Evaluated total** | **6** | 5 bridged + 030 host-only |

### Process-bridged five (completed)

- `finance-000-allowed-calibration`
- `finance-003-account-switch-after-review`
- `finance-010-duplicate-retry`
- `finance-027-secret-canary-sink-scan`
- `finance-028-timeout-after-submission`

### finance-030 partial

- Harness-evaluated under host program.
- Three recovery trials may carry **host-seeded recover process evidence** under completed grammar (`before-claim-recovery`, `after-claim-recovery`, `after-effect-recovery`).
- That does **not** make finance-030 a sixth process-bridged scenario.
- Full crash/recovery process-bridge (including complete kill grammar for all primary branches) is incomplete.
- Recovery case alone needs six target lifecycles in a complete V2 claim; full suite ≥ 36 fresh target executions, not 31.

### What process-bridged does **not** mean

- Not Docker sandbox isolation (child still shares host filesystem/network/user today).
- Not independent third-party assurance (same-project verification).
- Not buyer-ready Pre-Capital Control Dossier product.
- Not composite safety score or agent certification.
- Not credentials, capital, or live broker connection.

### V2 still blocked on (summary)

Complete crash trials, 31 isolated case groups with fresh lifecycle per trial, escape/resource/substitution matrix, target-separated oracle packaging, independent dossier verifier/artifacts, provider-rights review, unrelated integration evidence, paid-buyer validation.

Until then: truthful product = **V1 five-case-style reviewed synthetic adapter receipts** + **incomplete V2 candidate with five real-process completed lifecycles**.

---

## 9. Safety boundaries cheat sheet

```text
NO credentials / OAuth tokens / card numbers in args, env logs, or ledger
NO place_* / cancel_* tools (brokerExecutionTools always [])
NO live capital (capitalAtRisk / capital: 0)
NO composite safety score
NO Social automation / scraping / AI training on Social
NO “approval = authenticated human”
NO “preflight allowed = hard broker gate”
NO “capsule valid = identity / skill / compliance”
NO “pilot-doctor ready = system-wide broker disconnect”
NO “registry admit = trade authorization”
NO “processCorrect = profitable / production-ready agent”
```

| Axis | Pass means | Does not mean |
| --- | --- | --- |
| Ledger verify | Local chain/idempotency intact | External immutability, broker truth |
| Pilot doctor | Shadow declaration + local checks | System-wide broker disconnect |
| Capsule valid | Transport + digests + author signature | Identity, skill, compliance, issuance |
| Registry admit/reject | Offline claim analysis | Live inventory, trade auth |
| Preflight allowed | Proposal matched charter inputs | Hard gateway over broker |
| Curriculum HFA=0 | Process quality on synthetic set | Market regime coverage |
| Agent eval processCorrect | Local process axes | PnL, certification |
| Dossier process-bridged | Child lifecycle committed for that case | Full V2 / sandbox / buyer product |

Robinhood is a **personal compatibility research target**, not a product dependency. Commercial MCP/API integration and commercial Social activity require separate written authorization. See `packages/mcp/ROBINHOOD_AGENTIC_CONTRACT.md` and root `SECURITY.md`.

---

## 10. Troubleshooting

### `pnpm --filter` / package not found

- Filters use package **names**, not directory names:

```bash
pnpm --filter @runbook/mcp build
pnpm --filter @runbook/web dev
pnpm --filter @runbook/shadow-lab test
pnpm --filter @runbook/financial-dossier-process-bridge test
```

- Wrong: `pnpm --filter mcp build`, `pnpm --filter packages/mcp build`.
- After clone: always `pnpm install` at repo root first (workspace protocol).
- MCP `prebuild`/`pretest` builds engine, shadow-lab, capsule, registry, public-auth as needed — if a tool fails with “Cannot find module `@runbook/...`”, rebuild deps:

```bash
pnpm --filter @runbook/engine build
pnpm --filter @runbook/shadow-lab build
pnpm mcp:build
```

### Docker is not needed for the elite path

| Path | Docker? |
| --- | --- |
| `demo:elite`, `demo:frontier`, `demo:tournament` | **No** |
| MCP golden journey / shadow tools | **No** |
| Capsule verify, registry offline tools | **No** |
| Web `/shadow-lab`, `/verify`, `/dossier` | **No** |
| `@runbook/financial-bench-sandbox` Limited-scope receipts | **Yes** (separate reviewed-bundle tier) |

Do not block elite process work on Docker install.

### `RUNBOOK_DATA_DIR` / pilot-doctor data dir permissions

- Must be an **absolute** path. Relative paths make the server refuse to start (`RUNBOOK_DATA_DIR must be an absolute path`).
- Ledger root must be **owned by the current OS user** and deny group/other bits (normally `0700`). Files normally `0600`.
- Symlinks, foreign ownership, and group-writable paths fail closed — Runbook will **not** silently chmod an existing user path.
- Avoid synced folders (Dropbox, iCloud Drive, OneDrive, Google Drive); pilot-doctor treats obvious sync path components as advisory/blocking hygiene issues.
- Repair manually after inspecting ownership:

```bash
mkdir -p "$HOME/.runbook-shadow-pilot"
chmod 700 "$HOME/.runbook-shadow-pilot"
export RUNBOOK_SHADOW_DATA_DIR="$HOME/.runbook-shadow-pilot"
node packages/mcp/dist/cli.js pilot-doctor \
  packages/mcp/examples/shadow-pilot.manifest.json \
  --data-dir "$RUNBOOK_SHADOW_DATA_DIR" \
  --ledger-id shadow-pilot \
  --workspace-root "$PWD"
```

Before doctor reports ready: create experiment `RUN-SHADOW-001` via MCP with equity-only `approvalRequired: true`, record one synthetic preflight, then rerun.

### MCP tools missing in the agent

- Rebuild: `pnpm mcp:build`.
- Re-add MCP with absolute `node` path to `packages/mcp/dist/server.js`.
- Start a **new** agent task (tool list is discovered at session start).
- Call `runbook_list_surface` — if count ≠ 39 or names drift, rebuild and retest `pnpm smoke:elite`.

### Capsule verify disagreements

- Node: `node packages/mcp/dist/cli.js verify-capsule conformance/fixtures/minimal-synthetic-root.runbook` → exit 0.
- Tampered twin → exit 1 with payload digest mismatch (author signature may still verify).
- Browser `/verify` is same-project differential evidence, not an independent implementation.

### Credential-shaped ledger rejections

`FileLedger` rejects JWT-like strings, PEM keys, credential-ish keys (`apiKey`, `password`, …), and high-entropy secret shapes. Use synthetic/demo-prefixed IDs for fixtures. Never “relabel” real secrets with a `demo-` prefix.

### Surface lockstep failures in tests

`TOOL_NAMES` in `surface.ts` must match server registration, `tool-contract.json`, web `mcp-cockpit-data.ts`, and golden journey inventories. Fix inventory in one place and update the closed set everywhere — do not paper over with “extra” tools.

### Web Worker build issues

Browser verifier / Lineage Atlas Workers are generated from TypeScript before dev/test/build and are intentionally not committed. Prefer package scripts (`pnpm --filter @runbook/web dev|test|build`) over ad-hoc next invocations.

---

## 11. Operator command index

```bash
# Workspace
pnpm setup:elite            # install + engine + shadow-lab + mcp
pnpm test && pnpm lint && pnpm typecheck && pnpm build

# Elite demos
pnpm demo:frontier
pnpm demo:elite
pnpm demo:tournament
pnpm smoke:all-elite

# MCP
pnpm mcp:build
codex mcp add runbook -- node "$PWD/packages/mcp/dist/server.js"
node packages/mcp/dist/cli.js golden-journey

# Web
pnpm --filter @runbook/web dev   # http://localhost:3000

# Capsule conformance
node packages/mcp/dist/cli.js verify-capsule conformance/fixtures/minimal-synthetic-root.runbook
(cd conformance && shasum -a 256 -c SHA256SUMS)
```

---

## 12. Further reading (in-repo)

| Doc | Use |
| --- | --- |
| [`../../README.md`](../../README.md) | Product status + workspace overview |
| [`./README.md`](./README.md) | Full MCP contract, CLI, safety model |
| [`../shadow-lab/README.md`](../shadow-lab/README.md) | Curriculum / refine / tournament truth |
| [`../financial-dossier-process-bridge/README.md`](../financial-dossier-process-bridge/README.md) | Five completed lifecycles + 030 partial |
| [`./ROBINHOOD_AGENTIC_CONTRACT.md`](./ROBINHOOD_AGENTIC_CONTRACT.md) | Dated Robinhood public-doc tool map |
| [`../../SECURITY.md`](../../SECURITY.md) | Security posture |
| [`../../RELEASE.md`](../../RELEASE.md) | Release gates |
| [`../../task_plan.md`](../../task_plan.md) | Execution status |

---

*Runbook is an independent research prototype. Not affiliated with Robinhood. Live capital $0. No credentials. No place/cancel tools.*
