# `@runbook/mcp` — agent runtime companion

Local, broker-neutral MCP server for financial-agent **policy recording**, **advisory preflight**, and **offline assurance demos**.

It runs beside brokerage tools without receiving credentials or placing trades.

| Property | Value |
| --- | --- |
| Server name / version | `runbook` / `0.4.0` |
| Tools | 38 (closed inventory; `brokerExecutionTools: []`) |
| Transport | stdio |
| Network | none required for golden path |
| Composite safety score | **prohibited** |

Robinhood public-doc research (time-stamped) lives in [`ROBINHOOD_AGENTIC_CONTRACT.md`](./ROBINHOOD_AGENTIC_CONTRACT.md).

---

## Agent quickstart (5 minutes)

From the repository root:

```bash
pnpm setup:elite          # install + build engine + shadow-lab + mcp
# or: pnpm install && pnpm mcp:build
# Optional: prove the whole offline path in one receipt
pnpm demo:frontier
# Optional: recursive charter self-improvement (process quality only)
pnpm demo:elite
# Optional: multi-charter Pareto tournament
pnpm demo:tournament
# Optional smokes (closed 38-tool surface + shadow + dossier)
pnpm smoke:elite          # @runbook/shadow-lab + @runbook/mcp tests
pnpm smoke:web-shadow     # web vitest for shadow-lab UI/browser adapter
pnpm smoke:dossier        # financial-dossier-process-bridge tests
pnpm smoke:all-elite      # all three smokes
```

UI theater (web app): open `/shadow-lab` for curriculum tickets, one-click refine, and fixed-point recursion.

Install into Codex (or any stdio MCP host):

```bash
codex mcp add runbook -- node "$PWD/packages/mcp/dist/server.js"
codex mcp list
```

Start a **new** agent task so tools/resources/prompts are rediscovered.

**First agent moves (recommended order):**

1. Call `runbook_list_surface` once — closed tool / resource / prompt inventory.
2. Read `runbook://docs/boundary` and `runbook://docs/assurance`.
3. Follow prompt `runbook_shadow_pilot` (create → preflight → **hard stop** → verify).
4. Optional: prompt `runbook_offline_frontier_demo` for capability / capsule / public-auth demos.
5. Operator check: `node packages/mcp/dist/cli.js golden-journey` → `runbook.golden-journey-receipt.v1`.

Isolate pilot data (absolute path, private, not a synced repo):

```bash
codex mcp add runbook \
  --env RUNBOOK_DATA_DIR=/ABSOLUTE/PRIVATE/PATH \
  -- node "$PWD/packages/mcp/dist/server.js"
```

Default private ledger: `~/.runbook/events.jsonl`.

**Never** put broker credentials in tool arguments, notes, env values meant for logs, or the ledger.

---

## Safety boundary

Hard rules (also at `runbook://docs/boundary`):

1. **No brokerage credentials** — keys, OAuth tokens, passwords, card numbers.
2. **No order execution** — no `place_*` / `cancel_*` tools; `brokerExecutionTools` is always `[]`.
3. **Advisory only** — `allowed: true` is charter match on caller-supplied fields, not a hard gateway.
4. **Approvals are caller-asserted** — `actor.type: "human"` is not authenticated human authority.
5. **Disconnected shadow pilot first** — do not configure Robinhood Trading MCP during day-1 evidence.
6. **No composite safety score** — ledger, capsule, registry, pilot-doctor, preflight are separate axes.
7. **No Social automation**.

A direct brokerage tool can bypass Runbook. Human confirmation must remain enabled at the broker when live phases begin.

---

## Full tool table (38)

All tools advertise `openWorldHint: false` and `brokerEffect: false` (or no broker side effects).  
Breakdown: **1** discovery + **6** ledger + **7** offline + **6** shadow + **13** control-plane session + **5** elite process.

### Discovery

| Tool | Effect | Read-only |
| --- | --- | --- |
| `runbook_list_surface` | Closed inventory: tool names, resource URIs, prompts, server version, `brokerExecutionTools: []` | yes |

### Ledger (6)

| Tool | Effect | Read-only |
| --- | --- | --- |
| `runbook_create_experiment` | Record experiment + charter v1 | no |
| `runbook_preflight_trade` | Record proposal + advisory policy checks | no |
| `runbook_record_approval` | Caller-asserted human decision (unauthenticated) | no |
| `runbook_record_execution` | Import owner-controlled fill data | no |
| `runbook_list_events` | Read local ledger events | yes |
| `runbook_verify_ledger` | Verify sequence, idempotency, SHA-256 chain | yes |

### Offline demos / analysis (7)

| Tool | Effect | Assurance |
| --- | --- | --- |
| `runbook_verify_capsule` | Offline `.runbook` verify (path or fixtureId) | self-asserted-author-key-integrity |
| `runbook_verify_capability_snapshot` | Exact-JCS capability snapshot check | offline-reviewed-claim-analysis |
| `runbook_diff_capabilities` | Deterministic capability diff | offline-reviewed-claim-analysis |
| `runbook_admit_capabilities` | Admit / quarantine / reject analysis only | offline-reviewed-claim-analysis |
| `runbook_inspect_public_auth_metadata` | Offline OAuth discovery body parse | offline-fixture-or-operator-capture-analysis |
| `runbook_pilot_doctor` | Shadow pilot local readiness | local-attestation-and-ledger-only |
| `runbook_export_public_snapshot` | Metadata-only public export | local-ledger-read |

### Shadow self-improvement (6)

| Tool | Effect | Read-only | Assurance |
| --- | --- | --- | --- |
| `runbook_run_shadow_curriculum` | Multi-axis synthetic curriculum report | yes | synthetic-curriculum-process-quality-only |
| `runbook_improve_charter` | Recursive offline refinement; **does not** write ledger | yes | synthetic-curriculum-process-quality-only |
| `runbook_shadow_tournament` | Multi-charter Pareto front (weak + elite + mutants) | yes | synthetic-curriculum-process-quality-only |
| `runbook_activate_refined_charter` | Explicit `charter.activated` append | no | local-ledger-write |
| `runbook_agent_eval` | Local ledger process axes (`runbook.agent-eval.v1`) | yes | process-observation-only |
| `runbook_expand_curriculum_from_ledger` | Derive synthetic deny scenarios from local preflight fails | yes | ledger-derived-synthetic-process-labels-only |

### Control plane session (13)

Local process/evidence spine (`@runbook/session`). Stored under `RUNBOOK_DATA_DIR/sessions` or `~/.runbook/sessions`. Not a hard broker gateway; not trading performance.

| Tool | Effect | Read-only | Assurance |
| --- | --- | --- | --- |
| `runbook_session_create` | Create session (label, optional policy / sessionId) | no | local-session-only |
| `runbook_session_use` | Mark active session (local `active-session.json` marker only) | no | local-session-only |
| `runbook_session_get` | Read session by id | yes | local-session-only |
| `runbook_session_export` | Evidence pack export | yes | local-control-plane-export-only |
| `runbook_session_set_charter` | Bind advisory policy + `charterDigest` | no | local-session-only |
| `runbook_session_pin_inventory` | Default public-docs pin, pinPreset, or operator-declared names | no | local-session-only |
| `runbook_session_check_inventory` | Observed tools vs pin (`inventoryEnforcement`, fail-closed default path) | yes | local-session-only |
| `runbook_session_import_tools_list` | Import local tools/list JSON and check vs pin (never network fetch) | no | local-session-only |
| `runbook_session_bind_experiment` | Bind local ledger `experimentId` (+ optional head hash) | no | local-session-only |
| `runbook_session_attach_dossier` | Attach architecture evidence note | no | architecture-evidence-not-certification |
| `runbook_session_record_shadow` | Record hardFalseAllows / hardFalseDenies | no | synthetic-curriculum-process-quality-only |
| `runbook_approval_create_signed` | Ephemeral Ed25519 approval intent; private key not persisted | no | local-device-key-attestation-only |
| `runbook_approval_verify` | Verify signed intent with public SPKI base64 | yes | local-device-key-attestation-only |

### Elite process (5)

| Tool | Effect | Read-only | Assurance |
| --- | --- | --- | --- |
| `runbook_surface_lock_receipt` | Closed-surface attestation (TOOL_NAMES digest + version) | yes | local-discovery-only |
| `runbook_process_tick` | Mid-flight inventory + optional dual-eval → proceed\|warn\|stop | no | local-session-only |
| `runbook_session_import_pack` | Import local session evidence pack JSON | no | local-session-only |
| `runbook_session_seal_capsule` | Seal session as synthetic process Proof Capsule | no | self-asserted-author-key-integrity-only |
| `runbook_drift_sentinel` | tools/list + pin fail-closed drift receipt | yes | local-session-only |

Web UI theater: `/session`. Prompt: `runbook_control_plane_session`.

Machine-readable contract: resource `runbook://docs/tool-contract`.

Mutating tools are idempotent via stable keys. MCP annotations are descriptive, not authorization controls.

`runbook_record_approval` requires literal `actor.type: "human"`, but every MCP argument is caller-supplied. Execution evidence always reports `humanAuthorityEstablished: false` and `authorizationEstablished: false`.

Structured errors use `runbook.mcp-error.v1` in content text (not success `structuredContent`) so outputSchema validation stays correct.

---

## Resource table

| URI | Purpose |
| --- | --- |
| `runbook://docs/boundary` | Hard product boundary |
| `runbook://docs/tool-contract` | Machine tool table + discovery index |
| `runbook://docs/robinhood-agentic-contract` | Dated public-doc research map (not live inventory) |
| `runbook://docs/assurance` | Multi-axis assurance vocabulary |
| `runbook://schemas/shadow-pilot-manifest` | JSON Schema for shadow manifests |
| `runbook://examples/shadow-pilot.manifest` | Disconnected zero-capital example |
| `runbook://examples/equity-only-charter-policy` | Safe demo RiskPolicy |
| `runbook://fixtures/catalog` | Closed fixture IDs, SHA-256 pins, purposes |
| `runbook://demos/capability-drift` | Playbook: 45→50 diff + risk-correction reject |
| `runbook://demos/public-auth-offline` | Playbook: offline OAuth metadata inspect |
| `runbook://demos/capsule-golden` | Playbook: valid vs tampered capsule |
| `runbook://demos/shadow-pilot` | Day-1 SOP linking tools, prompts, CLI |
| `runbook://demos/shadow-self-improve` | Curriculum → improve → re-eval → optional explicit activate |
| `runbook://playbooks/recursive-elite-process` | Elite 10-step full self-improvement loop (never broker / never returns) |
| `runbook://status/dossier` | Honest Pre-Capital Dossier V2 status (architecture slice only) |
| `runbook://ledger/verification` | Dynamic local hash-chain verification |

---

## Workflow prompts

| Prompt | Purpose |
| --- | --- |
| `runbook_explain_boundary` | Restate the boundary before mutating tools |
| `runbook_shadow_pilot` | Day-1 create → preflight → hard stop → verify |
| `runbook_preflight_review` | Explain policy checks; restate advisory enforcement |
| `runbook_verify_artifact` | Route capsule / ledger / registry / public-auth verification |
| `runbook_offline_frontier_demo` | Diff 45→50 → risk-correction reject → capsule pair → public-auth → limitations |
| `runbook_recursive_improve` | Curriculum → improve → re-eval → stop at fixed point; never broker / never claim returns |
| `runbook_elite_recursive_loop` | Full 10-step elite loop bound to `runbook://playbooks/recursive-elite-process` |

---

## Golden journey

Protocol-level day-1 proof used by tests and CLI (shared module `golden-journey.ts`):

1. Inventory freeze (no `place_*` / `cancel_*`)
2. Read boundary
3. Create equity-only experiment
4. Synthetic preflight
5. **Hard stop** (no approval / execution)
6. Verify ledger (4 events)
7. Pilot-doctor ready
8. Offline demos: capability drift, risk-correction reject, capsule pair, public-auth

```bash
# Via root scripts
pnpm mcp:golden          # vitest golden receipt contract
pnpm demo:frontier       # build + CLI journey (alias path)
pnpm smoke:mcp           # build + full package tests

# Direct CLI
node packages/mcp/dist/cli.js golden-journey
node packages/mcp/dist/cli.js golden-journey --data-dir /ABSOLUTE/PRIVATE/PATH
```

Stdout: JSON `runbook.golden-journey-receipt.v1`. Exit `0` on success, `1` on failed checks.

---

## Offline demos

Closed fixtures are SHA-256 pinned (`runbook://fixtures/catalog`). Unknown or drifted IDs fail closed.

| Demo | Resource | Primary tools | Expected signal |
| --- | --- | --- | --- |
| Capability drift | `runbook://demos/capability-drift` | `runbook_diff_capabilities` | `materialChangeCount: 5` (45→50) |
| Risk-correction | same | `runbook_admit_capabilities` | `outcome: "reject"`, `doesNotGrantBrokerPermission: true` |
| Capsule golden | `runbook://demos/capsule-golden` | `runbook_verify_capsule` | valid root / invalid tampered |
| Public auth | `runbook://demos/public-auth-offline` | `runbook_inspect_public_auth_metadata` | profile parse only; never call discovered URIs |
| Shadow pilot | `runbook://demos/shadow-pilot` | create / preflight / verify / doctor | day-1 hard stop |
| Shadow self-improve | `runbook://demos/shadow-self-improve` | curriculum / improve / agent-eval | process quality only |
| Elite recursive loop | `runbook://playbooks/recursive-elite-process` | full loop + tournament + expand | golden processCorrect |

Admit / quarantine / reject are **analysis outcomes**, not trade authorization. Capsule `valid: true` means integrity relative to the **self-asserted author key** — not identity, skill, compliance, or broker issuance.

---

## Recursive shadow improvement

Elite agents can harden a Capital Constitution charter against a **closed synthetic curriculum** without touching a broker.

Package: `@runbook/shadow-lab` (curriculum + evaluate + refine). MCP tools:

1. **`runbook_run_shadow_curriculum`** — multi-axis metrics (`hardFalseAllows`, `hardFalseDenies`, scenario verdicts). Policy source order: explicit `policy` override → active ledger charter for `experimentId` → reference elite equity policy. `brokerEffect: false`. **No composite score.**
2. **`runbook_improve_charter`** — recursive deterministic refinement (`maxGenerations` 1–8, default 3). Returns `generations[]`, `finalPolicy`, before/after hard-false counts, `limitations`. **Never auto-activates** on the ledger (`activatedOnLedger: false`).
3. **`runbook_shadow_tournament`** — multi-charter Pareto search over weak starter + reference elite + N deterministic mutants. Minimizes `hardFalseAllows` then `hardFalseDenies` (true non-domination). Schema `runbook.shadow-tournament.v1`. **Not trading performance.**
4. **`runbook_activate_refined_charter`** — optional explicit mutation. Appends a new `charter.activated` with a bumped version (`2.0`, `3.0`, …) via `RunbookService.activateCharter`. Idempotent per version key.
5. **`runbook_agent_eval`** — scores a **local experiment ledger** against elite process axes (charter + `approvalRequired`, equities-only preferred, every proposal preflighted, no execution without approval when required, hardFalseAllow-style payload checks). Schema `runbook.agent-eval.v1`. **Not trading performance / not PnL.**
6. **`runbook_expand_curriculum_from_ledger`** — offline meta-learning: derive candidate synthetic deny scenarios from local preflight failures and merge with the closed curriculum for process training. Schema `runbook.meta-curriculum.v1`. **Does not mutate the ledger.** Labels are synthetic process labels, not market truth.

Prompts:

- `runbook_recursive_improve` — curriculum → improve → re-eval → stop at fixed point; never connect a broker; never claim returns; activate only with human request.
- `runbook_elite_recursive_loop` — full 10-step elite loop (surface → weak curriculum → fixed-point improve → optional Pareto → experiment + clean/denied preflights → agent_eval → expand → re-improve). Bound to the playbook resource.

Resources:

- `runbook://demos/shadow-self-improve` — shorter demo SOP
- `runbook://playbooks/recursive-elite-process` — elite full-loop playbook

Golden protocol freeze: `src/golden-recursive-elite.test.ts` (InMemory MCP client).

Demo / smoke:

```bash
pnpm demo:elite        # end-to-end recursive refine receipt (scripts/recursive-elite-demo.mjs)
pnpm demo:recursive    # alias of demo:elite
pnpm demo:tournament   # multi-charter Pareto tournament CLI receipt
pnpm smoke:elite       # shadow-lab package tests + full MCP suite
pnpm demo:frontier     # golden-journey day-1 + offline demos
```

Web UI theater: `/shadow-lab` (curriculum tickets, one-click refine, fixed-point recursion).

Hard rules for this path:

- `openWorldHint: false`, no network
- No place/cancel tools
- No composite safety score
- Structured errors via `runbook.mcp-error.v1` (`protocol.ts`)

---

## CLI reference

```text
runbook verify [--data-dir ABSOLUTE_PATH] [--ledger-id ID]
runbook export-public EXPERIMENT_ID [--data-dir ABSOLUTE_PATH] [--ledger-id ID]
runbook pilot-doctor MANIFEST_PATH [--data-dir ABSOLUTE_PATH] [--ledger-id ID] [--workspace-root ABSOLUTE_PATH]
runbook golden-journey [--data-dir ABSOLUTE_PATH] [--workspace-root ABSOLUTE_PATH] [--keep-temp]
runbook shadow-curriculum [--policy path.json]
runbook shadow-improve [--policy path.json] [--generations N]
runbook shadow-tournament [--generations N] [--mutants N] [--seed N]
runbook agent-eval --experiment RUN-ID --data-dir DIR [--ledger-id ID]
runbook verify-checkpoint ENVELOPE_JSON STATEMENT_JSON PUBLIC_KEY_DER
runbook verify-capsule CAPSULE.runbook
```

### Offline shadow-pilot doctor

```bash
export RUNBOOK_SHADOW_DATA_DIR="$HOME/.runbook-shadow-pilot"
pnpm --filter @runbook/mcp build
node packages/mcp/dist/cli.js pilot-doctor \
  packages/mcp/examples/shadow-pilot.manifest.json \
  --data-dir "$RUNBOOK_SHADOW_DATA_DIR" \
  --ledger-id shadow-pilot \
  --workspace-root "$PWD"
```

Before ready: create `RUN-SHADOW-001` via MCP with equity-only `approvalRequired: true` charter, record one synthetic preflight, then rerun. Exit `0` = local checks passed; assurance `local-attestation-and-ledger-only` is not system-wide broker disconnection.

### Verify checkpoint / capsule

```bash
node packages/mcp/dist/cli.js verify-checkpoint \
  checkpoint.dsse.json checkpoint.statement.json author-public-key.der

runbook verify-capsule ./synthetic-example.runbook
# or bundled single-file verifier:
pnpm --filter @runbook/mcp build:standalone
node packages/mcp/release/runbook-proof.mjs ./synthetic-example.runbook
```

### Public snapshot export

```bash
node packages/mcp/dist/cli.js verify
node packages/mcp/dist/cli.js export-public RUN-001 > runbook-public-snapshot.json
```

Public snapshots are metadata-only field allowlists (not anonymity guarantees). Review before sharing. `independentlyVerifiable` is always false for filtered projections.

---

## Local assurance model

The JSONL ledger is append-only through the Runbook API, bounded to 50 MiB, serialized by a writer lock, canonicalized, and SHA-256 chained. It rejects symlinks, unsafe IDs, credential-shaped fields, foreign ownership, and group/other permission bits. New roots use `0700` / files `0600`.

This is **local tamper evidence** relative to a trusted head — not external immutability. Anyone who can rewrite the entire file can recompute the chain.

| Axis | Pass means | Does not mean |
| --- | --- | --- |
| Ledger verify | Local chain/idempotency intact | External anchor, broker truth |
| Pilot doctor | Shadow declaration + local checks | System-wide broker disconnect |
| Capsule | Transport + digests + author signature | Identity, skill, compliance |
| Registry admit/reject | Offline reviewed claim analysis | Live inventory, trade auth |
| Preflight allowed | Proposal matched charter inputs | Hard gateway over the broker |
| Dossier V2 | See `runbook://status/dossier` | Completed buyer product / safety grade |

---

## Package scripts

| Root script | Action |
| --- | --- |
| `pnpm mcp:build` | TypeScript build of `@runbook/mcp` |
| `pnpm mcp:test` | Package vitest suite |
| `pnpm mcp:golden` | Golden journey contract test only |
| `pnpm smoke:mcp` | Build + full MCP tests |
| `pnpm smoke:elite` | `@runbook/shadow-lab` tests + full `@runbook/mcp` tests |
| `pnpm demo:frontier` | Build + `golden-journey` CLI |
| `pnpm demo:elite` | Build shadow-lab + MCP, run recursive elite demo receipt |
| `pnpm demo:tournament` | Build + `shadow-tournament` multi-charter Pareto CLI |

---

## What this package does not do

- No network capture as an MCP tool
- No Robinhood proxy, credentials, or sandbox launcher tools
- No Pre-Capital Dossier full 31-case product runner as MCP (architecture slice status only)
- No composite “agent is safe” score

For dossier design honesty, read `runbook://status/dossier`.
