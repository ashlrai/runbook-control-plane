/** Static discovery content embedded for dist portability (no runtime repo reads). */

export const BOUNDARY_MD = `# Runbook product boundary

Runbook is a **local, broker-neutral** policy recorder and advisory workbench for financial agents.

## Hard rules

1. **No brokerage credentials.** Never put API keys, OAuth tokens, passwords, or card numbers in tool arguments, notes, env values meant for logs, or the ledger.
2. **No order execution.** Runbook never places, routes, previews, or cancels broker orders. It has no \`place_*\` or \`cancel_*\` tools.
3. **Advisory only.** \`allowed: true\` means the submitted proposal passed the recorded charter checks. It does **not** mean an account-wide control prevented other actions.
4. **Approvals are caller-asserted.** An agent can claim \`actor.type: "human"\`. That is **not** authenticated human authority. Execution evidence always reports \`humanAuthorityEstablished: false\` and \`authorizationEstablished: false\`.
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

Read \`runbook://docs/tool-contract\` and \`runbook://docs/assurance\` next. Prefer prompt \`runbook_shadow_pilot\` for day-1 workflow.
`;

export const AGENTIC_CONTRACT_MD = `# Robinhood Agentic Trading — research contract summary

**Status:** Independent technical research map (not a live inventory, not an API schema dump).
**Verified baseline:** July 21–22, 2026 from official Robinhood US documentation.
**Runbook affiliation:** None. Not endorsed by Robinhood.

## Why this exists

Robinhood publishes tool names and short descriptions for Agentic Trading. Inventories drift (45 → 50 tools observed). Capability names alone do not reveal schemas, approval enforcement, or runtime availability. Runbook keeps a **dated research map** so agents fail closed on unreviewed change rather than improvising.

This resource is **not** live \`tools/list\` from Robinhood. Never treat it as authorization to connect, trade, or claim GA availability.

## Connection facts (from official materials)

- Trading MCP endpoint documented as Streamable HTTP at \`https://agent.robinhood.com/mcp/trading\`.
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

Order mutations of concern: \`place_equity_order\`, \`cancel_equity_order\`, \`place_option_order\`, \`cancel_option_order\`.

July 21 drift additions vs prior 45-tool snapshot: \`get_financials\`, \`get_equity_price_book\`, \`get_equity_tax_lots\`, \`get_option_historicals\`, \`get_scanner_filter_specs\`.

## Runbook implications

1. First pilot is **broker-disconnected shadow mode** (see \`runbook://examples/shadow-pilot.manifest\`).
2. Runbook never receives credentials and never exposes place/cancel tools.
3. A future connected phase needs runtime inventory capture, least-privilege review, and fail-closed admission—not prompt allowlists alone.
4. Banking MCP documents virtual-card detail retrieval as credential release; model separately from ordinary observation. Runbook does not handle card data.

## Primary sources (read officially; re-check before live phases)

- Agentic Trading overview / trading-with-your-agent support pages
- Robinhood Customer Agreement §29 (API Package personal use / Licensee Product)
- July 1, 2026 product announcement (crypto Agentic Accounts described as coming soon)

For offline capability analysis of frozen fixtures, use capability-registry tools when available; do not invent runtime inventory from this document.
`;

export const ASSURANCE_JSON = `{
  "schemaVersion": "runbook.assurance-vocabulary.v1",
  "compositeScore": false,
  "compositeScoreProhibited": true,
  "axes": [
    {
      "id": "ledger",
      "assurance": "local-tamper-evidence-only",
      "passMeans": "Sequence, idempotency keys, and SHA-256 chain verify for the local JSONL ledger.",
      "doesNotMean": ["external-anchor", "broker-truth", "immutable-history", "authorization"]
    },
    {
      "id": "pilot-doctor",
      "assurance": "local-attestation-and-ledger-only",
      "passMeans": "Shadow manifest, FS privacy, zero-capital charter, and local pairing checks passed.",
      "doesNotMean": ["system-wide-broker-disconnect", "execution-control", "human-authentication"]
    },
    {
      "id": "capsule",
      "assurance": "self-asserted-author-key-integrity",
      "passMeans": "Draft v1 transport, membership digests, embedded public key, and author signature verify.",
      "doesNotMean": ["author-identity", "independent-time", "broker-issuance", "investment-skill", "compliance"]
    },
    {
      "id": "capability-registry",
      "assurance": "offline-reviewed-claim-analysis",
      "passMeans": "Snapshot/diff/admission evaluated against reviewed claim bytes and policy.",
      "doesNotMean": ["runtime-inventory", "trade-authorization", "durable-registry-head-mutation"]
    },
    {
      "id": "public-auth-metadata",
      "assurance": "offline-fixture-or-operator-capture-analysis",
      "passMeans": "Exact-host OAuth discovery document digests and semantic projections analyzed offline.",
      "doesNotMean": ["token-access", "registration", "MCP-session", "least-privilege-proof"]
    },
    {
      "id": "preflight",
      "assurance": "advisory-caller-supplied-state",
      "passMeans": "Proposal fields satisfied the active charter's deterministic checks.",
      "doesNotMean": ["hard-gateway", "broker-enforcement", "authoritative-account-state"]
    },
    {
      "id": "execution-evidence",
      "assurance": "caller-owned-observation-only",
      "passMeans": "Imported fill is bound to local proposal/preflight records with honest authority flags.",
      "doesNotMean": ["brokerTruthEstablished", "humanAuthorityEstablished", "authorizationEstablished"]
    },
    {
      "id": "shadow-curriculum",
      "assurance": "synthetic-curriculum-process-quality-only",
      "passMeans": "Declared RiskPolicy process quality measured against a closed synthetic scenario set.",
      "doesNotMean": ["trading-performance", "capital-allocation", "broker-enforcement", "market-regimes"]
    },
    {
      "id": "agent-process-eval",
      "assurance": "process-observation-only",
      "passMeans": "Local experiment events satisfy elite process axes (charter, preflight, approval discipline).",
      "doesNotMean": ["pnl", "trading-skill", "authenticated-human-authority", "broker-truth"]
    }
  ],
  "limitationsAlwaysPresent": [
    "no-broker-credentials",
    "no-order-execution",
    "no-composite-safety-score",
    "advisory-not-hard-gate"
  ]
}
`;

export const TOOL_CONTRACT_JSON = `{
  "schemaVersion": "runbook.tool-contract.v1",
  "serverName": "runbook",
  "serverVersion": "0.3.0",
  "brokerExecutionTools": [],
  "enforcementDefault": "advisory",
  "tools": [
    {
      "name": "runbook_list_surface",
      "effect": "closed-surface-inventory",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-discovery-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_create_experiment",
      "effect": "records-experiment-and-charter",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-ledger-write",
      "openWorldHint": false
    },
    {
      "name": "runbook_preflight_trade",
      "effect": "records-proposal-and-advisory-checks",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "advisory-caller-supplied-state",
      "openWorldHint": false
    },
    {
      "name": "runbook_record_approval",
      "effect": "records-caller-asserted-human-decision",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "caller-owned-observation-only",
      "openWorldHint": false,
      "notes": "Actor type human is required but unauthenticated."
    },
    {
      "name": "runbook_record_execution",
      "effect": "imports-owner-controlled-fill-data",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "caller-owned-observation-only",
      "openWorldHint": false,
      "alwaysFalse": [
        "brokerTruthEstablished",
        "humanAuthorityEstablished",
        "authorizationEstablished"
      ]
    },
    {
      "name": "runbook_list_events",
      "effect": "reads-local-ledger",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-ledger-read",
      "openWorldHint": false
    },
    {
      "name": "runbook_verify_ledger",
      "effect": "verifies-hash-chain",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-tamper-evidence-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_verify_capsule",
      "effect": "offline-capsule-verify",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "self-asserted-author-key-integrity",
      "openWorldHint": false
    },
    {
      "name": "runbook_verify_capability_snapshot",
      "effect": "offline-snapshot-verify",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "offline-reviewed-claim-analysis",
      "openWorldHint": false
    },
    {
      "name": "runbook_diff_capabilities",
      "effect": "offline-capability-diff",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "offline-reviewed-claim-analysis",
      "openWorldHint": false
    },
    {
      "name": "runbook_admit_capabilities",
      "effect": "offline-capability-admission-analysis",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "offline-reviewed-claim-analysis",
      "openWorldHint": false,
      "notes": "Does not mutate a durable registry head or grant broker permission."
    },
    {
      "name": "runbook_inspect_public_auth_metadata",
      "effect": "offline-public-auth-parse",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "offline-fixture-or-operator-capture-analysis",
      "openWorldHint": false
    },
    {
      "name": "runbook_pilot_doctor",
      "effect": "shadow-pilot-readiness-check",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-attestation-and-ledger-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_export_public_snapshot",
      "effect": "metadata-only-public-export",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-ledger-read",
      "openWorldHint": false
    },
    {
      "name": "runbook_run_shadow_curriculum",
      "effect": "synthetic-curriculum-process-eval",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "synthetic-curriculum-process-quality-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_improve_charter",
      "effect": "offline-recursive-charter-refinement",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "synthetic-curriculum-process-quality-only",
      "openWorldHint": false,
      "notes": "Does not activate refined policy on the ledger."
    },
    {
      "name": "runbook_shadow_tournament",
      "effect": "multi-charter-pareto-process-search",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "synthetic-curriculum-process-quality-only",
      "openWorldHint": false,
      "notes": "Pareto front on hardFalseAllows then hardFalseDenies. Not trading performance."
    },
    {
      "name": "runbook_activate_refined_charter",
      "effect": "records-new-charter-activated",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-ledger-write",
      "openWorldHint": false
    },
    {
      "name": "runbook_agent_eval",
      "effect": "local-ledger-process-quality-eval",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "process-observation-only",
      "openWorldHint": false,
      "notes": "Not trading performance or PnL."
    },
    {
      "name": "runbook_expand_curriculum_from_ledger",
      "effect": "ledger-derived-synthetic-curriculum-candidates",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "ledger-derived-synthetic-process-labels-only",
      "openWorldHint": false,
      "notes": "Does not mutate the ledger. Labels are synthetic process labels, not market truth."
    },
    {
      "name": "runbook_session_create",
      "effect": "local-control-plane-session-create",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-session-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_session_use",
      "effect": "local-active-session-marker",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-session-only",
      "openWorldHint": false,
      "notes": "Writes active-session.json marker only. Not broker authorization."
    },
    {
      "name": "runbook_session_get",
      "effect": "local-control-plane-session-read",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-session-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_session_export",
      "effect": "local-session-evidence-pack-export",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-control-plane-export-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_session_set_charter",
      "effect": "local-session-charter-bind",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-session-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_session_pin_inventory",
      "effect": "local-session-inventory-pin",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-session-only",
      "openWorldHint": false,
      "notes": "Default public-docs 50-tool pin; optional operator-declared names. Not runtime confirmation."
    },
    {
      "name": "runbook_session_check_inventory",
      "effect": "local-session-inventory-check",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-session-only",
      "openWorldHint": false,
      "notes": "Fail-closed by session.inventoryEnforcement when pin is present."
    },
    {
      "name": "runbook_session_bind_experiment",
      "effect": "local-session-experiment-bind",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-session-only",
      "openWorldHint": false,
      "notes": "Binds local ledger experimentId (optional head hash). Not brokerage account linkage."
    },
    {
      "name": "runbook_session_attach_dossier",
      "effect": "local-session-dossier-attachment",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "architecture-evidence-not-certification",
      "openWorldHint": false
    },
    {
      "name": "runbook_session_record_shadow",
      "effect": "local-session-shadow-metrics",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "synthetic-curriculum-process-quality-only",
      "openWorldHint": false
    },
    {
      "name": "runbook_approval_create_signed",
      "effect": "local-device-key-signed-approval-intent",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": false,
      "assurance": "local-device-key-attestation-only",
      "openWorldHint": false,
      "notes": "Ephemeral keypair; private key not persisted. Not broker authorization."
    },
    {
      "name": "runbook_approval_verify",
      "effect": "local-device-key-approval-verify",
      "brokerEffect": false,
      "idempotent": true,
      "readOnly": true,
      "assurance": "local-device-key-attestation-only",
      "openWorldHint": false,
      "alwaysFalse": [
        "humanAuthorityEstablished",
        "authorizationEstablished"
      ]
    }
  ],
  "discoveryResources": [
    "runbook://docs/boundary",
    "runbook://docs/tool-contract",
    "runbook://docs/robinhood-agentic-contract",
    "runbook://docs/assurance",
    "runbook://schemas/shadow-pilot-manifest",
    "runbook://examples/shadow-pilot.manifest",
    "runbook://examples/equity-only-charter-policy",
    "runbook://fixtures/catalog",
    "runbook://demos/capability-drift",
    "runbook://demos/public-auth-offline",
    "runbook://demos/capsule-golden",
    "runbook://demos/shadow-pilot",
    "runbook://demos/shadow-self-improve",
    "runbook://playbooks/recursive-elite-process",
    "runbook://playbooks/control-plane-session",
    "runbook://status/dossier",
    "runbook://docs/control-plane-session",
    "runbook://ledger/verification"
  ],
  "recommendedPrompts": [
    "runbook_explain_boundary",
    "runbook_shadow_pilot",
    "runbook_preflight_review",
    "runbook_verify_artifact",
    "runbook_offline_frontier_demo",
    "runbook_recursive_improve",
    "runbook_elite_recursive_loop",
    "runbook_control_plane_session",
    "runbook_control_plane_full"
  ]
}`;

export const CONTROL_PLANE_SESSION_MD = `# Control plane session

Local **process / evidence** spine shared across MCP, shadow-lab, and dossier attachments.

## What it is

- Session JSON under \`RUNBOOK_DATA_DIR/sessions\` (or default \`~/.runbook/sessions\`)
- Optional advisory charter + \`charterDigest\`
- Inventory pin (default: public-docs 50-tool research projection) and fail-closed check
- Shadow generation metrics and dossier attachments (architecture evidence)
- Device-key signed approval *intent* helpers (local attestation only)
- Optional bind to a local ledger \`experimentId\` (not broker account linkage)

## What it is not

- Not a hard broker gateway
- Not trading performance or capital allocation
- Not composite safety certification
- Device-key signatures do **not** establish broker authorization or authenticated legal human identity
- Never stores brokerage credentials or card numbers

## Tool map

| Tool | Role |
| --- | --- |
| \`runbook_session_create\` | Create session (label, optional policy / sessionId) |
| \`runbook_session_use\` | Mark active session (local marker only) |
| \`runbook_session_get\` | Read session |
| \`runbook_session_export\` | Evidence pack export |
| \`runbook_session_set_charter\` | Bind advisory policy + digest |
| \`runbook_session_pin_inventory\` | Default public-docs pin or custom tool names |
| \`runbook_session_check_inventory\` | Observed tools vs pin (\`session.inventoryEnforcement\`) |
| \`runbook_session_bind_experiment\` | Bind local ledger experimentId (+ optional head hash) |
| \`runbook_session_attach_dossier\` | Attach architecture evidence note |
| \`runbook_session_record_shadow\` | Record hardFalseAllows / hardFalseDenies |
| \`runbook_approval_create_signed\` | Ephemeral Ed25519 sign; private key not persisted |
| \`runbook_approval_verify\` | Verify intent with public SPKI base64 |

## Full journey playbook

Ambitious end-to-end spine: resource \`runbook://playbooks/control-plane-session\` + prompt \`runbook_control_plane_full\`.

Shorter day-1 session-only path: prompt \`runbook_control_plane_session\`.

Always restate \`brokerEffect: false\`, \`capitalAtRisk: 0\`, and no composite score.

Read \`runbook://docs/boundary\` before mutating tools.
`;

export const PLAYBOOK_CONTROL_PLANE_SESSION_MD = `# Control plane session — full journey playbook

**URI:** \`runbook://playbooks/control-plane-session\`  
**Mode:** local control-plane session + optional shadow improve + local ledger experiment. **No network. No broker. No live capital.**  
**Claim level:** process / evidence spine only — **never** trading performance, alpha, PnL, returns, or broker authorization.

This playbook freezes the **full control-plane session journey** an ambitious agent should run. Follow steps in order. Multi-axis metrics only; never invent a composite safety or skill score.

## Hard rules (NEVER)

1. **NEVER broker** — do not configure Robinhood Trading MCP (or any brokerage MCP); do not call \`place_*\` / \`cancel_*\` (they are not on this surface); do not request credentials or card numbers.
2. **NEVER returns claims** — do not claim returns, alpha, sharpe, skill, capital allocation quality, or “the agent is profitable.”
3. **NEVER composite score** — keep ledger, curriculum, inventory, dossier, and approval axes separate.
4. **NEVER upgrade device-key signatures** — signed approval intent is **local attestation only**. \`humanAuthorityEstablished\` and \`authorizationEstablished\` remain **false**.
5. **Inventory pin is research projection** — default public-docs 50-tool pin is **not** runtime \`tools/list\` confirmation and **not** broker permission.
6. **Dossier attachments are architecture evidence** — not certification, not a buyer product pass, not a green safety grade.

## Linked surfaces

| Kind | Name / URI |
| --- | --- |
| Prompt (full) | \`runbook_control_plane_full\` |
| Prompt (shorter) | \`runbook_control_plane_session\` |
| Docs sibling | \`runbook://docs/control-plane-session\` |
| Boundary | \`runbook://docs/boundary\`, \`runbook://docs/assurance\` |
| Equity policy | \`runbook://examples/equity-only-charter-policy\` |
| Dossier honesty | \`runbook://status/dossier\` |
| Session tools | \`runbook_session_create\`, \`runbook_session_pin_inventory\`, \`runbook_session_check_inventory\`, \`runbook_session_set_charter\`, \`runbook_session_record_shadow\`, \`runbook_session_bind_experiment\`, \`runbook_session_attach_dossier\`, \`runbook_session_export\`, \`runbook_session_get\` |
| Shadow | \`runbook_improve_charter\` (optional curriculum first) |
| Ledger | \`runbook_create_experiment\` |
| Approval | \`runbook_approval_create_signed\`, \`runbook_approval_verify\` |
| Package | \`@runbook/session\` |

## Full journey (10 steps)

### 1. session create

- Call \`runbook_session_create\` with a human-readable \`label\` and preferred \`sessionId\` (e.g. \`CPS-FULL-001\`).
- Prefer equity-only \`policy\` from \`runbook://examples/equity-only-charter-policy\` (\`approvalRequired: true\`, equities only).
- Expect schema \`runbook.session-create.v1\`, \`brokerEffect: false\`, \`capitalAtRisk: 0\`, \`compositeScore: false\`.
- Optional: pass a planned \`experimentId\` up front; the full journey still **binds** after ledger create.

### 2. pin inventory

- Call \`runbook_session_pin_inventory\` (default: public-docs 50-tool research pin).
- Report \`toolCount\` and \`toolSetSha256\`.
- Restate: not runtime confirmation; not broker authorization.

### 3. check inventory

- Call \`runbook_session_check_inventory\` with a **subset of pinned** names → expect \`ok: true\` under fail-closed enforcement.
- Call once with an **unknown** tool name (e.g. invent \`place_crypto_order_unknown\`) → expect \`ok: false\`, unknown listed.
- Do **not** treat a clean check as permission to place trades.

### 4. improve charter

- Call \`runbook_improve_charter\` with the session/equity policy (or a weak starter override) and \`maxGenerations\` 1–8.
- Capture \`finalPolicy\`, \`finalHardFalseAllows\` (elite target 0), \`fixedPoint\`, \`activatedOnLedger: false\`.
- Optionally set the refined policy on the session via \`runbook_session_set_charter\` (session charter only — **not** ledger activation).
- Restate: synthetic process quality only; not trading performance; not capital allocation.

### 5. record shadow

- Call \`runbook_session_record_shadow\` with generation metrics from improve/curriculum (\`hardFalseAllows\`, \`hardFalseDenies\`).
- Schema \`runbook.session-record-shadow.v1\`. Multi-axis only — no composite score.

### 6. create experiment

- Call \`runbook_create_experiment\` with the refined (or equity-only) policy as the initial local ledger charter.
- Local ledger write only; advisory; does **not** place trades.
- Prefer synthetic/agent actor for agent work.

### 7. bind

- Call \`runbook_session_bind_experiment\` with the sessionId and the new ledger \`experimentId\`.
- Optional: include current ledger head hash if you just verified the chain (\`runbook_verify_ledger\`) — still local-only binding.
- Binding is **session ↔ local experiment id**, not a brokerage account or live session.

### 8. signed approval demo

- Call \`runbook_approval_create_signed\` with sessionId, experimentId, proposalId, proposalDigest, charterDigest, \`approved: true\`.
- Expect ephemeral key: \`privateKeyPersisted: false\`, \`humanAuthorityEstablished: false\`, \`authorizationEstablished: false\`, \`assurance: local-device-key-attestation-only\`.
- Call \`runbook_approval_verify\` with returned \`intent\` + \`publicKeySpkiBase64\` → \`valid: true\` still does **not** establish broker authorization.
- Never claim the signature is a hard trade gate.

### 9. attach dossier

- Call \`runbook_session_attach_dossier\` with a short status-snapshot summary (architecture evidence).
- Read \`runbook://status/dossier\` and restate: architecture-slice status only — not a completed buyer product or safety grade.

### 10. export pack

- Call \`runbook_session_export\` → schema \`runbook.session-export.v1\`, pack \`runbook.session-evidence-pack.v1\`.
- Confirm pack carries \`brokerEffect: false\`, \`compositeScore: false\`, \`notTradingPerformance: true\`, \`assurance: local-control-plane-export-only\`.
- Final report: process evidence only. **NEVER broker. NEVER returns claims. NEVER composite score.**

## Expected golden signals (protocol freeze)

| Step | Signal |
| --- | --- |
| Create | \`runbook.session-create.v1\`, \`capitalAtRisk: 0\` |
| Pin | \`toolCount: 50\` (default public-docs) or operator-declared count; 64-char \`toolSetSha256\` |
| Check | subset \`ok: true\`; unknown tool \`ok: false\` fail-closed |
| Improve | \`finalHardFalseAllows\` reduced / target 0; \`brokerEffect: false\` |
| Shadow | lastShadow metrics recorded on session |
| Experiment | local ledger charter activated for experimentId |
| Bind | session.experimentId matches ledger experiment |
| Approval | create + verify; authority flags stay false |
| Dossier | attachmentCount ≥ 1; honest architecture label |
| Export | evidence pack; not trading performance |

## Limitations (always restate)

- local-session-only / advisory-not-hard-gateway
- not-trading-performance / not-capital-allocation
- no-composite-safety-score / no-broker-execution / no-credential-handling
- inventory pin not runtime-confirmed unless source says so
- device-key-signed is local attestation only — not broker authorization
- dossier attachments are architecture-evidence-not-certification
- experiment bind is local id linkage only — not brokerage account binding
`;

export const DEMO_CAPABILITY_DRIFT_MD = `# Demo playbook: capability drift (45 → 50) + risk-correction reject

**Mode:** offline, closed fixtures only. No network. No broker. No credentials.

## Goals

1. Diff published Trading MCP inventory growth from 45 → 50 tools.
2. Show that a risk-correction candidate is **rejected** under the public-docs review policy.
3. Restate that admit/quarantine/reject are **analysis outcomes**, not trade authorization.

## Steps

1. Read \`runbook://docs/boundary\` and \`runbook://docs/assurance\`.
2. Optional: \`runbook_list_surface\` for closed inventory.
3. Diff:
   - \`runbook_diff_capabilities\`
   - \`baselineFixtureId\`: \`registry.trading-45\`
   - \`candidateFixtureId\`: \`registry.trading-50\`
   - Expect \`materialChangeCount: 5\` (the five published additions).
4. Admit / reject demo:
   - \`runbook_admit_capabilities\`
   - \`baselineFixtureId\`: \`registry.trading-50\`
   - \`candidateFixtureId\`: \`registry.trading-50-risk-correction\`
   - \`policyFixtureId\`: \`registry.policy.public-docs-review-required\`
   - \`evaluatedAtDeclared\`: any RFC-3339 timestamp you own (e.g. \`2026-07-22T07:10:00Z\`)
   - Expect \`outcome: "reject"\` and \`doesNotGrantBrokerPermission: true\`.
5. Restate limitations: not runtime inventory, not broker permission, not a composite safety score.

## Tools

- \`runbook_diff_capabilities\`
- \`runbook_admit_capabilities\`
- \`runbook_verify_capability_snapshot\` (optional single-snapshot check)

## Fixture IDs

See \`runbook://fixtures/catalog\`.
`;

export const DEMO_PUBLIC_AUTH_OFFLINE_MD = `# Demo playbook: offline public OAuth metadata

**Mode:** offline fixture parse only. Never register, authorize, token, or open discovered MCP URIs.

## Goals

1. Parse a frozen Robinhood public OAuth discovery body.
2. Report profile validity, findings, and semantic digests.
3. Refuse to treat scope labels as least-privilege proofs.

## Steps

1. Read \`runbook://docs/assurance\` (public-auth-metadata axis).
2. Call \`runbook_inspect_public_auth_metadata\` with one of:
   - \`public-auth.trading-authorization-server\`
   - \`public-auth.trading-protected-resource\`
   - \`public-auth.banking-authorization-server\`
   - \`public-auth.banking-protected-resource\`
3. Confirm \`brokerEffect: false\` and limitations include no registration/token/MCP session claims.
4. Do **not** call any URI found in the body.

## Tools

- \`runbook_inspect_public_auth_metadata\`

## Fixture IDs

See \`runbook://fixtures/catalog\` entries with kind \`public-auth-raw\`.
`;

export const DEMO_CAPSULE_GOLDEN_MD = `# Demo playbook: valid vs tampered proof capsule

**Mode:** offline capsule verify. Integrity relative to the self-asserted author key only.

## Goals

1. Verify a valid minimal synthetic capsule.
2. Verify a payload-tampered capsule returns \`valid: false\` without \`isError\`.
3. Quote capsule limitations (not identity, not broker issuance, not skill).

## Steps

1. Read \`runbook://docs/assurance\` (capsule axis).
2. \`runbook_verify_capsule\` with \`fixtureId: "capsule.minimal-root"\` → expect \`valid: true\`.
3. \`runbook_verify_capsule\` with \`fixtureId: "capsule.minimal-tampered"\` → expect \`valid: false\`.
4. Restate: valid means draft v1 transport, digests, embedded public key, and author signature verify.

## Tools

- \`runbook_verify_capsule\`

## Fixture IDs

- \`capsule.minimal-root\`
- \`capsule.minimal-tampered\`
`;

export const DEMO_SHADOW_PILOT_MD = `# Demo playbook: day-1 shadow pilot SOP

**Mode:** broker-disconnected. Zero capital. Synthetic data. Hard stop before approval/execution.

## Goals

1. Record an equity-only experiment + charter.
2. Preflight one synthetic proposal.
3. **Hard stop** — no \`runbook_record_approval\` / \`runbook_record_execution\` for day-1 evidence.
4. Verify the local ledger and run pilot-doctor.
5. Optionally continue with offline frontier demos (diff / admit / capsule / public-auth).

## Linked surfaces

| Kind | Name / URI |
| --- | --- |
| Prompt | \`runbook_shadow_pilot\` |
| Resource | \`runbook://examples/shadow-pilot.manifest\` |
| Resource | \`runbook://examples/equity-only-charter-policy\` |
| Resource | \`runbook://docs/boundary\` |
| Tools | \`runbook_create_experiment\`, \`runbook_preflight_trade\`, \`runbook_verify_ledger\`, \`runbook_pilot_doctor\` |
| CLI | \`node packages/mcp/dist/cli.js golden-journey\` |
| Prompt | \`runbook_offline_frontier_demo\` (after hard stop) |

## Steps (agent)

0. Read boundary + example manifest + equity policy.
1. \`runbook_create_experiment\` with equity-only policy (\`approvalRequired: true\`).
2. \`runbook_preflight_trade\` with a charter-matching synthetic equity proposal (e.g. VTI).
3. **HARD STOP.**
4. \`runbook_verify_ledger\` — expect valid chain and 4 events (experiment, charter, proposal, preflight).
5. Write a shadow manifest (\`runbook.shadow-pilot.v1\`) and call \`runbook_pilot_doctor\`.
6. Optional offline demos; never invent a composite safety score.

## Operator CLI

\`\`\`bash
pnpm mcp:build
node packages/mcp/dist/cli.js golden-journey
# or: pnpm demo:frontier
\`\`\`

Prints \`runbook.golden-journey-receipt.v1\` JSON; exit 0 on success.
`;

export const DEMO_SHADOW_SELF_IMPROVE_MD = `# Demo playbook: recursive shadow self-improvement

**Mode:** offline synthetic curriculum only. No network. No broker. No live capital. Process quality — **not** returns.

## Goals

1. Measure a charter against the closed shadow curriculum (multi-axis; no composite score).
2. Run deterministic recursive refinement until fixed point or generation cap.
3. Optionally re-eval and/or score a local experiment ledger for process axes.
4. Activate a refined charter on the ledger **only** with an explicit operator request.

## What this is not

- Not trading performance, PnL, alpha, or skill grading
- Not broker enforcement or hard gating of place/cancel tools
- Not automatic ledger mutation from improve (activation is a separate tool)

## Linked surfaces

| Kind | Name / URI |
| --- | --- |
| Prompt | \`runbook_recursive_improve\` |
| Tools | \`runbook_run_shadow_curriculum\`, \`runbook_improve_charter\`, \`runbook_activate_refined_charter\`, \`runbook_agent_eval\`, \`runbook_expand_curriculum_from_ledger\` |
| Package | \`@runbook/shadow-lab\` |
| Resource | \`runbook://docs/boundary\` |
| Resource | \`runbook://examples/equity-only-charter-policy\` |
| Elite loop | \`runbook://playbooks/recursive-elite-process\` + prompt \`runbook_elite_recursive_loop\` |

## Steps (agent)

0. Read boundary + this playbook. Confirm \`brokerExecutionTools: []\` via \`runbook_list_surface\`.
1. \`runbook_run_shadow_curriculum\` — optional \`policy\` override; or \`experimentId\` to load active ledger charter; else reference elite policy.
2. \`runbook_improve_charter\` with \`maxGenerations\` 1–8 (default 3). Inspect \`generations\`, \`finalPolicy\`, before/after \`hardFalseAllows\`.
3. Re-run curriculum on \`finalPolicy\` as a policy override. Stop when \`fixedPoint\` / no further reduction.
4. Optional: \`runbook_agent_eval\` for a local experiment (process axes only).
5. Optional: \`runbook_expand_curriculum_from_ledger\` to derive synthetic deny candidates from preflight failures (process labels only; does not mutate ledger).
6. **Do not** call \`runbook_activate_refined_charter\` unless the human explicitly requests activation.

## Limitations (always restate)

- synthetic-curriculum-not-market-regimes
- not-trading-performance / not-capital-allocation
- not-broker-enforcement
- no-composite-safety-or-skill-score
- advisory-only local ledger writes if activated
`;

export const PLAYBOOK_RECURSIVE_ELITE_MD = `# Elite recursive agent playbook

**URI:** \`runbook://playbooks/recursive-elite-process\`  
**Mode:** offline synthetic curriculum + local ledger only. **No network. No broker. No live capital.**  
**Claim level:** process control quality only — **never** trading performance, alpha, PnL, or returns.

This playbook freezes the **full self-improvement loop** an elite agent should run against Runbook shadow tools. Follow every step in order. Report multi-axis metrics only; never invent a composite safety or skill score.

## Hard rules (NEVER)

1. **NEVER broker** — do not configure Robinhood Trading MCP (or any brokerage MCP); do not call \`place_*\` / \`cancel_*\` (they are not on this surface); do not request credentials or card numbers.
2. **NEVER returns claims** — do not claim returns, alpha, sharpe, skill, capital allocation quality, or “the agent is profitable.”
3. **NEVER composite score** — keep ledger, curriculum, agent-eval, tournament, and pilot-doctor axes separate.
4. **Activation is explicit** — \`runbook_improve_charter\` and tournaments never auto-write the ledger. Only create/activate tools mutate local records when you intentionally call them.

## Linked surfaces

| Kind | Name / URI |
| --- | --- |
| Prompt | \`runbook_elite_recursive_loop\` |
| Prompt (shorter) | \`runbook_recursive_improve\` |
| Demo sibling | \`runbook://demos/shadow-self-improve\` |
| Boundary | \`runbook://docs/boundary\`, \`runbook://docs/assurance\` |
| Tools | \`runbook_list_surface\`, \`runbook_run_shadow_curriculum\`, \`runbook_improve_charter\`, \`runbook_shadow_tournament\`, \`runbook_create_experiment\`, \`runbook_activate_refined_charter\`, \`runbook_preflight_trade\`, \`runbook_agent_eval\`, \`runbook_expand_curriculum_from_ledger\` |
| Package | \`@runbook/shadow-lab\` |
| Operator demo | \`pnpm demo:recursive\` (alias of \`demo:elite\`) |

## Full loop (10 steps)

### 1. list_surface / read boundary

- Call \`runbook_list_surface\` once.
- Confirm \`brokerExecutionTools: []\`, every tool \`openWorldHint: false\`, and shadow tools are present.
- Read \`runbook://docs/boundary\` and \`runbook://docs/assurance\`.
- Assert inventory has **no** \`place_*\` / \`cancel_*\` tools.

### 2. Shadow curriculum on weak or active charter

- Prefer a **weak** policy override (options+crypto allowed, empty denylist, high notional, \`approvalRequired: false\`) to demonstrate process defects, **or** load the active ledger charter via \`experimentId\`.
- Call \`runbook_run_shadow_curriculum\` with that policy / experiment.
- Expect multi-axis report (\`hardFalseAllows\`, \`hardFalseDenies\`, true allows/denies, advisory gaps).
- For the weak starter path: expect \`hardFalseAllows > 0\`.
- Restate: synthetic scenarios only — not market data.

### 3. improve_charter to fixed point

- Call \`runbook_improve_charter\` with the same weak/active policy and \`maxGenerations\` 1–8 (elite default often 6–8).
- Inspect \`generations[]\`, \`finalPolicy\`, \`initialHardFalseAllows\` → \`finalHardFalseAllows\`, \`fixedPoint\` / \`terminatedReason\`.
- Elite target: \`finalHardFalseAllows === 0\` and typically \`fixedPoint: true\`.
- Confirm \`activatedOnLedger: false\` and \`brokerEffect: false\`.

### 4. Optional tournament pick Pareto

- Optional: \`runbook_shadow_tournament\` (\`maxGenerations\`, \`mutantCount\`, \`seed\`).
- Schema \`runbook.shadow-tournament.v1\`: non-empty \`paretoFront\`, \`capital: 0\`, \`compositeScore: false\`.
- Pick a Pareto candidate policy for process quality (min hardFalseAllows, then hardFalseDenies) — **not** for returns.

### 5. Create experiment + activate refined charter

- \`runbook_create_experiment\` with the **refined** \`finalPolicy\` (or Pareto pick) as the initial charter — this records experiment + first \`charter.activated\`.
- If an experiment already exists and you are swapping policy: call \`runbook_activate_refined_charter\` **only** with explicit operator intent.
- Local ledger write only; advisory; does not place trades.

### 6. Synthetic preflights for clean + denied

- \`runbook_preflight_trade\` on a **clean** charter-matching equity (e.g. VTI within budget) → expect allowed under refined policy.
- \`runbook_preflight_trade\` on at least one **denied** path (denylisted symbol and/or disallowed instrument such as option/crypto) → expect denied / hard stop axes.
- Caller-supplied position, drawdown, trade-count fields are **not** broker truth.
- Day-1 elite evidence does **not** require approval/execution events.

### 7. agent_eval processCorrect

- Call \`runbook_agent_eval\` for the experiment.
- Expect schema \`runbook.agent-eval.v1\`, \`processCorrect: true\`, \`compositeScore: false\`, \`notTradingPerformance: true\`, \`notPnL: true\`, \`brokerEffect: false\`.
- Multi-axis only (charter present, approvalRequired, equities-only preferred, preflight coverage, no unauthorized execution, no suspect allows).

### 8. expand_curriculum_from_ledger

- Call \`runbook_expand_curriculum_from_ledger\` for the experiment.
- Schema \`runbook.meta-curriculum.v1\`: candidates are **synthetic process labels**, not market truth.
- Confirm \`ledgerMutated: false\` and \`brokerEffect: false\`.

### 9. Re-improve if new candidates

- If \`candidateCount > 0\` or process defects remain, optionally re-run \`runbook_improve_charter\` / curriculum on the active refined policy (or a policy that absorbs meta-curriculum insights via offline analysis).
- Stop at fixed point or generation budget. Do not claim the curriculum “learned the market.”

### 10. NEVER broker, NEVER returns claims

- Final report: process metrics only (\`hardFalseAllows\`, agent-eval axes, tournament Pareto if used).
- Explicitly state: not trading performance; not capital allocation; no composite score; no broker side effects.
- Do not configure a brokerage MCP; do not invent place/cancel success.

## Expected golden signals (protocol freeze)

| Step | Signal |
| --- | --- |
| Inventory | Shadow tools listed; no \`place_*\` |
| Weak curriculum | \`hardFalseAllows > 0\` |
| Improve | \`finalHardFalseAllows === 0\` |
| Tournament (opt) | \`runbook.shadow-tournament.v1\`, \`paretoCount >= 1\` |
| Agent eval | \`processCorrect: true\` |
| Expand | \`ledgerMutated: false\` |

## Operator CLI

\`\`\`bash
pnpm demo:recursive   # or pnpm demo:elite
# → runbook.recursive-elite-demo.v1 receipt on stdout
\`\`\`

## Limitations (always restate)

- synthetic-curriculum-not-market-regimes
- not-trading-performance / not-capital-allocation / not-pnl
- not-broker-enforcement / advisory-only
- no-composite-safety-or-skill-score
- improve does not auto-activate; activation is explicit local ledger write only
`;

export const STATUS_DOSSIER_MD = `# Runbook Pre-Capital Dossier — honest V2 status

**As of:** 2026-07-22  
**Audience:** agents and operators using this MCP companion  
**Claim level:** architecture / semantic foundation only — **not** a completed buyer product

## What exists

- Normative V2 design profile for the Pre-Capital Control Dossier (31 cases: 1 calibration + 30 hostile).
- Semantic foundations and process-bridge / harness slices for runner-observed evidence paths.
- Separate result axes: coverage vs control status; no composite safety score.
- Offline registry, capsule, public-auth, and shadow-pilot surfaces in **this** MCP package for local demos.

## What this MCP package does **not** claim

- Full 31-case buyer-facing dossier execution as a single MCP tool.
- Production authorization, certification, audit opinion, or provider attestation.
- Live Robinhood inventory, credentials, capital, card numbers, or sandbox launchers as MCP tools.
- That pilot-doctor readiness or capsule validity implies dossier completeness.

## Architecture slice only

The dossier product promise is decision support **before** credentials or capital: bind reviewed adapter + public configuration, evaluate calibration + hostile cases, replay evidence, emit scenario-level gap register and remediation delta.

Until a complete, operator-reviewed V2 runner is productized, treat dossier language as **design status**, not a green pass. Prefer:

1. Shadow pilot day-1 evidence (\`runbook_shadow_pilot\`, \`golden-journey\`)
2. Offline capability / capsule / public-auth demos
3. Multi-axis assurance vocabulary (\`runbook://docs/assurance\`)

## Never collapse

| Axis | Pass means | Does not mean |
| --- | --- | --- |
| Ledger | Local chain intact | External immutability |
| Pilot doctor | Local shadow declaration ready | System-wide broker disconnect |
| Capsule | Self-asserted author integrity | Identity / skill / compliance |
| Registry admit | Offline claim analysis | Trade authorization |
| Dossier (future) | Scenario evidence under profile | Generic “agent is safe” grade |

Read \`runbook://docs/boundary\` before mutating tools.
`;

export const EQUITY_POLICY_JSON = `{
  "capitalBudget": 500,
  "cashReserve": 125,
  "maxPositionPercent": 25,
  "maxOrderNotional": 125,
  "maxDrawdownPercent": 8,
  "maxDailyTrades": 2,
  "allowedInstruments": ["equity"],
  "allowedSymbols": ["VTI", "BND"],
  "deniedSymbols": ["GME"],
  "approvalRequired": true
}
`;

export const SHADOW_MANIFEST_JSON = `{
  "schemaVersion": "runbook.shadow-pilot.v1",
  "experimentId": "RUN-SHADOW-001",
  "mode": "shadow",
  "brokerageConnection": "disconnected",
  "dataSource": "synthetic",
  "orderExecution": "disabled",
  "capitalAtRisk": 0,
  "publication": "manual-human-reviewed",
  "operatorAttestations": {
    "noBrokerCredentials": true,
    "noBrokerOrderTools": true,
    "noLiveExecutionImports": true,
    "noAutomatedPublishing": true
  }
}
`;

export const SHADOW_MANIFEST_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "runbook.shadow-pilot.v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "experimentId",
    "mode",
    "brokerageConnection",
    "dataSource",
    "orderExecution",
    "capitalAtRisk",
    "publication",
    "operatorAttestations"
  ],
  "properties": {
    "schemaVersion": { "const": "runbook.shadow-pilot.v1" },
    "experimentId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$"
    },
    "mode": { "const": "shadow" },
    "brokerageConnection": { "const": "disconnected" },
    "dataSource": { "enum": ["synthetic", "manually-entered-owned-data"] },
    "orderExecution": { "const": "disabled" },
    "capitalAtRisk": { "const": 0 },
    "publication": { "const": "manual-human-reviewed" },
    "operatorAttestations": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "noBrokerCredentials",
        "noBrokerOrderTools",
        "noLiveExecutionImports",
        "noAutomatedPublishing"
      ],
      "properties": {
        "noBrokerCredentials": { "const": true },
        "noBrokerOrderTools": { "const": true },
        "noLiveExecutionImports": { "const": true },
        "noAutomatedPublishing": { "const": true }
      }
    }
  }
}
`;
