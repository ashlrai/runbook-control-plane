/**
 * Static MCP cockpit catalog for the web surface.
 * Mirrors packages/mcp closed inventory (surface.ts / tool-contract):
 * 1 discovery + 6 ledger + 7 offline + 6 shadow + 13 session = 33 tools.
 * No network, no credentials, brokerEffect always false.
 */

export type McpToolRow = {
  name: string;
  effect: string;
  assurance: string;
  lane: "discovery" | "ledger" | "offline" | "shadow" | "session";
  readOnly: boolean;
};

export const MCP_INSTALL_COMMAND = `pnpm setup:elite
# or: pnpm install && pnpm --filter @runbook/mcp build
codex mcp add runbook -- node "$PWD/packages/mcp/dist/server.js"
codex mcp list`;

export const MCP_PILOT_DOCTOR_COMMAND = `export RUNBOOK_SHADOW_DATA_DIR="$HOME/.runbook-shadow-pilot"
pnpm --filter @runbook/mcp build
node packages/mcp/dist/cli.js pilot-doctor \\
  packages/mcp/examples/shadow-pilot.manifest.json \\
  --data-dir "$RUNBOOK_SHADOW_DATA_DIR" \\
  --ledger-id shadow-pilot \\
  --workspace-root "$PWD"`;

/**
 * Operator docs for the cockpit.
 * Prefer packages/mcp/OPERATOR_GUIDE.md when present; otherwise README sections.
 * Resolved at module load via a static path check constant — keep in sync with
 * whether OPERATOR_GUIDE.md exists in packages/mcp/.
 */
export const MCP_OPERATOR_GUIDE_PATH = "packages/mcp/OPERATOR_GUIDE.md";
/** True when packages/mcp/OPERATOR_GUIDE.md is present (keep in sync with disk). */
export const MCP_OPERATOR_GUIDE_EXISTS = true;

export const MCP_OPERATOR_DOCS = MCP_OPERATOR_GUIDE_EXISTS
  ? {
      path: MCP_OPERATOR_GUIDE_PATH,
      label: "Operator guide",
      sections: [] as readonly { anchor: string; title: string }[],
    }
  : {
      path: "packages/mcp/README.md",
      label: "MCP README (operator sections)",
      sections: [
        { anchor: "agent-quickstart-5-minutes", title: "Agent quickstart (5 minutes)" },
        { anchor: "safety-boundary", title: "Safety boundary" },
        { anchor: "full-tool-table-33", title: "Full tool table (33)" },
        { anchor: "offline-shadow-pilot-doctor", title: "Offline shadow-pilot doctor" },
      ] as const,
    };

export const MCP_TOOLS: readonly McpToolRow[] = [
  {
    name: "runbook_list_surface",
    effect: "Closed inventory of tools, resources, prompts",
    assurance: "local-discovery-only",
    lane: "discovery",
    readOnly: true,
  },
  {
    name: "runbook_create_experiment",
    effect: "Records experiment + charter v1",
    assurance: "local-ledger-write",
    lane: "ledger",
    readOnly: false,
  },
  {
    name: "runbook_preflight_trade",
    effect: "Records proposal + advisory checks",
    assurance: "advisory-caller-supplied-state",
    lane: "ledger",
    readOnly: false,
  },
  {
    name: "runbook_record_approval",
    effect: "Caller-asserted human decision (unauthenticated)",
    assurance: "caller-owned-observation-only",
    lane: "ledger",
    readOnly: false,
  },
  {
    name: "runbook_record_execution",
    effect: "Imports owner-controlled fill data",
    assurance: "caller-owned-observation-only",
    lane: "ledger",
    readOnly: false,
  },
  {
    name: "runbook_list_events",
    effect: "Reads local ledger events",
    assurance: "local-ledger-read",
    lane: "ledger",
    readOnly: true,
  },
  {
    name: "runbook_verify_ledger",
    effect: "Verifies sequence, idempotency, hash chain",
    assurance: "local-tamper-evidence-only",
    lane: "ledger",
    readOnly: true,
  },
  {
    name: "runbook_verify_capsule",
    effect: "Offline capsule verify",
    assurance: "self-asserted-author-key-integrity",
    lane: "offline",
    readOnly: true,
  },
  {
    name: "runbook_verify_capability_snapshot",
    effect: "Offline snapshot verify",
    assurance: "offline-reviewed-claim-analysis",
    lane: "offline",
    readOnly: true,
  },
  {
    name: "runbook_diff_capabilities",
    effect: "Offline capability diff",
    assurance: "offline-reviewed-claim-analysis",
    lane: "offline",
    readOnly: true,
  },
  {
    name: "runbook_admit_capabilities",
    effect: "Offline admission analysis (no head mutation)",
    assurance: "offline-reviewed-claim-analysis",
    lane: "offline",
    readOnly: true,
  },
  {
    name: "runbook_inspect_public_auth_metadata",
    effect: "Offline public-auth parse",
    assurance: "offline-fixture-or-operator-capture-analysis",
    lane: "offline",
    readOnly: true,
  },
  {
    name: "runbook_pilot_doctor",
    effect: "Shadow pilot readiness check",
    assurance: "local-attestation-and-ledger-only",
    lane: "offline",
    readOnly: true,
  },
  {
    name: "runbook_export_public_snapshot",
    effect: "Metadata-only public export",
    assurance: "local-ledger-read",
    lane: "offline",
    readOnly: true,
  },
  {
    name: "runbook_run_shadow_curriculum",
    effect: "Multi-axis synthetic curriculum report",
    assurance: "synthetic-curriculum-process-quality-only",
    lane: "shadow",
    readOnly: true,
  },
  {
    name: "runbook_improve_charter",
    effect: "Recursive offline refinement (no ledger write)",
    assurance: "synthetic-curriculum-process-quality-only",
    lane: "shadow",
    readOnly: true,
  },
  {
    name: "runbook_shadow_tournament",
    effect: "Multi-charter Pareto front (weak + elite + mutants)",
    assurance: "synthetic-curriculum-process-quality-only",
    lane: "shadow",
    readOnly: true,
  },
  {
    name: "runbook_activate_refined_charter",
    effect: "Explicit charter.activated append",
    assurance: "local-ledger-write",
    lane: "shadow",
    readOnly: false,
  },
  {
    name: "runbook_agent_eval",
    effect: "Local ledger process axes (not trading performance)",
    assurance: "process-observation-only",
    lane: "shadow",
    readOnly: true,
  },
  {
    name: "runbook_expand_curriculum_from_ledger",
    effect: "Ledger-derived synthetic deny scenarios",
    assurance: "ledger-derived-synthetic-process-labels-only",
    lane: "shadow",
    readOnly: true,
  },
  {
    name: "runbook_session_create",
    effect: "Create local control-plane session",
    assurance: "local-session-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_session_use",
    effect: "Mark active session (local marker only)",
    assurance: "local-session-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_session_get",
    effect: "Read control-plane session by id",
    assurance: "local-session-only",
    lane: "session",
    readOnly: true,
  },
  {
    name: "runbook_session_export",
    effect: "Export session evidence pack",
    assurance: "local-control-plane-export-only",
    lane: "session",
    readOnly: true,
  },
  {
    name: "runbook_session_set_charter",
    effect: "Bind advisory charter + digest",
    assurance: "local-session-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_session_pin_inventory",
    effect: "Pin admitted tool inventory",
    assurance: "local-session-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_session_check_inventory",
    effect: "Fail-closed observed tools vs pin",
    assurance: "local-session-only",
    lane: "session",
    readOnly: true,
  },
  {
    name: "runbook_session_import_tools_list",
    effect: "Import local tools/list JSON and check vs pin",
    assurance: "local-session-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_session_bind_experiment",
    effect: "Bind local ledger experimentId (+ optional head hash)",
    assurance: "local-session-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_session_attach_dossier",
    effect: "Attach architecture dossier evidence",
    assurance: "architecture-evidence-not-certification",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_session_record_shadow",
    effect: "Record shadow hardFalse metrics",
    assurance: "synthetic-curriculum-process-quality-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_approval_create_signed",
    effect: "Ephemeral Ed25519 approval intent",
    assurance: "local-device-key-attestation-only",
    lane: "session",
    readOnly: false,
  },
  {
    name: "runbook_approval_verify",
    effect: "Verify signed approval intent",
    assurance: "local-device-key-attestation-only",
    lane: "session",
    readOnly: true,
  },
] as const;

export const MCP_TOOL_COUNT = MCP_TOOLS.length;

export const GOLDEN_JOURNEY_STEPS = [
  {
    id: "boundary",
    label: "Read the boundary",
    detail: "Load runbook://docs/boundary (or prompt runbook_explain_boundary). No credentials. No trades. Advisory only.",
    toolHint: "runbook://docs/boundary",
  },
  {
    id: "create",
    label: "Create equity-only experiment",
    detail: "runbook_create_experiment with approvalRequired true and instruments limited to equity.",
    toolHint: "runbook_create_experiment",
  },
  {
    id: "preflight",
    label: "Preflight a synthetic proposal",
    detail: "runbook_preflight_trade with caller-supplied position, drawdown, and trade-count fields — not broker truth.",
    toolHint: "runbook_preflight_trade",
  },
  {
    id: "hard-stop",
    label: "Hard stop (day-1 shadow)",
    detail: "Do not call runbook_record_approval or runbook_record_execution unless the human operator explicitly requests it.",
    toolHint: "HARD STOP",
  },
  {
    id: "verify",
    label: "Verify the ledger",
    detail: "runbook_verify_ledger — local tamper evidence only. Anyone who rewrites the whole file can recompute the chain.",
    toolHint: "runbook_verify_ledger",
  },
  {
    id: "doctor",
    label: "Run pilot-doctor",
    detail: "Offline readiness. Assurance is local-attestation-and-ledger-only — not system-wide broker absence.",
    toolHint: "runbook_pilot_doctor",
  },
] as const;

export const FIXTURE_DEMO_CARDS = [
  {
    id: "diff-45-50",
    title: "Diff 45 → 50",
    outcome: "Documentation delta · five observation tools",
    detail:
      "Compare registry.trading-45 vs registry.trading-50 via runbook_diff_capabilities. Exercises fail-closed drift — not a historical runtime claim.",
    toolCall: {
      name: "runbook_diff_capabilities",
      arguments: {
        leftFixtureId: "registry.trading-45",
        rightFixtureId: "registry.trading-50",
      },
    },
  },
  {
    id: "reject-risk",
    title: "Reject risk-correction",
    outcome: "Reject · unknownRiskDecision: reject",
    detail:
      "Admit registry.trading-50-risk-correction against the public-docs-review-required policy. Active head does not advance.",
    toolCall: {
      name: "runbook_admit_capabilities",
      arguments: {
        snapshotFixtureId: "registry.trading-50-risk-correction",
        policyFixtureId: "registry.policy.public-docs-review-required",
      },
    },
  },
  {
    id: "capsule-twin",
    title: "Capsule twin",
    outcome: "Valid root · invalid tampered twin",
    detail:
      "Verify capsule.minimal-root (valid) then capsule.minimal-tampered (payload tamper). Integrity relative to self-asserted author key only.",
    toolCall: {
      name: "runbook_verify_capsule",
      arguments: {
        fixtureId: "capsule.minimal-root",
      },
    },
  },
] as const;

export const EXAMPLE_PREFLIGHT_TOOL_CALL = {
  name: "runbook_preflight_trade",
  arguments: {
    experimentId: "RUN-SHADOW-001",
    proposalId: "proposal-vti-001",
    symbol: "VTI",
    instrument: "equity",
    side: "buy",
    notional: 100,
    projectedPositionNotional: 100,
    dailyTradesAfter: 1,
    currentDrawdownPercent: 0.6,
    hasThesis: true,
    hasInvalidation: true,
    evidenceSourceCount: 2,
    idempotencyKey: "preflight-vti-001",
  },
} as const;

export const DISCOVERY_RESOURCES = [
  { uri: "runbook://docs/boundary", detail: "Hard safety boundary: no credentials, no trades, advisory only." },
  { uri: "runbook://docs/tool-contract", detail: "Machine-readable tool effects and brokerEffect flags." },
  { uri: "runbook://docs/assurance", detail: "Separate assurance axes. Composite scores prohibited." },
  { uri: "runbook://docs/robinhood-agentic-contract", detail: "Dated public-doc research map. Not live inventory." },
  { uri: "runbook://schemas/shadow-pilot-manifest", detail: "Strict shadow-pilot.v1 manifest schema." },
  { uri: "runbook://examples/shadow-pilot.manifest", detail: "Disconnected zero-capital example." },
  { uri: "runbook://examples/equity-only-charter-policy", detail: "Equity-only charter policy sample." },
  { uri: "runbook://ledger/verification", detail: "Current local ledger verification summary." },
] as const;
