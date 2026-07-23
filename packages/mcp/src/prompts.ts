import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

const BOUNDARY_REMINDER = [
  "Do not configure or authenticate Robinhood Trading MCP (or any brokerage MCP) for this workflow.",
  "Do not request, log, or store brokerage credentials or card numbers.",
  "Caller-asserted actor.type human is NOT authenticated human authority.",
  "Do not invent a composite safety score or claim the agent is certified safe.",
  "Preflight allowed means advisory charter match only; it does not hard-gate the broker.",
].join(" ");

export const PROMPT_NAMES = [
  "runbook_explain_boundary",
  "runbook_shadow_pilot",
  "runbook_preflight_review",
  "runbook_verify_artifact",
  "runbook_offline_frontier_demo",
  "runbook_recursive_improve",
  "runbook_elite_recursive_loop",
  "runbook_control_plane_session",
  "runbook_control_plane_full",
  "runbook_process_supervisor",
] as const;

export function registerRunbookPrompts(server: McpServer): void {
  server.registerPrompt(
    "runbook_explain_boundary",
    {
      title: "Explain Runbook boundary",
      description: "Force a correct restatement of Runbook's safety boundary before any mutating tools.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Read resource runbook://docs/boundary and runbook://docs/assurance.",
              "Then restate, in your own words:",
              "1) what Runbook records,",
              "2) what it never does (credentials, trades, Social automation, composite scores),",
              "3) why shadow pilots stay broker-disconnected,",
              "4) why approval events are evidence-ambiguous rather than human authentication.",
              "Do not call mutating tools until you complete the restatement.",
              BOUNDARY_REMINDER,
            ].join(" "),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "runbook_shadow_pilot",
    {
      title: "Shadow pilot day-1 workflow",
      description: "Broker-disconnected shadow pilot: create experiment, preflight once, stop, verify. No approval/execution required for day-1 readiness evidence.",
      argsSchema: {
        experimentId: z.string().trim().min(1).max(120).optional(),
      },
    },
    async ({ experimentId }) => {
      const id = experimentId?.trim() || "RUN-SHADOW-001";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Run a broker-disconnected shadow pilot for experiment ${id}.`,
                "Step 0: Read runbook://docs/boundary, runbook://examples/shadow-pilot.manifest, and runbook://examples/equity-only-charter-policy.",
                "Step 1: Call runbook_create_experiment with the equity-only policy (approvalRequired true, equities only). Use a synthetic/agent actor if recording agent work.",
                "Step 2: Call runbook_preflight_trade with a synthetic equity proposal that matches the charter (e.g. VTI buy within budget). Caller-supplied position/drawdown/trade-count fields are required inputs, not broker truth.",
                "Step 3: HARD STOP. Do not call runbook_record_approval or runbook_record_execution for day-1 shadow evidence unless the human operator explicitly requests it.",
                "Step 4: Call runbook_verify_ledger and confirm valid chain + expected event count.",
                "Step 5: If runbook_pilot_doctor is available, run it against the shadow manifest and report ready + assurance. If only CLI exists, tell the human the pilot-doctor command without inventing success.",
                "Throughout: never configure Robinhood MCP, never place orders, never invent a safety score.",
                BOUNDARY_REMINDER,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "runbook_preflight_review",
    {
      title: "Review a preflight result",
      description: "Explain each policy check for a proposal and restate advisory enforcement.",
      argsSchema: {
        experimentId: z.string().trim().min(1).max(120),
        proposalId: z.string().trim().min(1).max(120),
      },
    },
    async ({ experimentId, proposalId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Review preflight evidence for experiment ${experimentId}, proposal ${proposalId}.`,
              "Use runbook_list_events (filtered to the experiment) to load proposal.recorded and preflight.recorded events.",
              "Explain each deterministic policy check: what was evaluated, pass/fail, and why.",
              "Restate that enforcement is advisory and that a direct broker tool can bypass Runbook.",
              "If approval is present, state that actor.type human is caller-asserted and humanAuthorityEstablished remains false.",
              "Do not recommend live capital deployment. Do not produce a composite score.",
              BOUNDARY_REMINDER,
            ].join(" "),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "runbook_verify_artifact",
    {
      title: "Verify an offline artifact",
      description: "Route to the correct offline verification path and limitation language.",
      argsSchema: {
        kind: z.enum(["capsule", "ledger", "registry", "public-auth"]),
      },
    },
    async ({ kind }) => {
      const guidance: Record<string, string> = {
        capsule:
          "Use runbook_verify_capsule (or CLI verify-capsule) on a local .runbook path or closed fixtureId. Valid means integrity relative to the self-asserted author key. Quote capsule limitations: not identity, not broker issuance, not skill.",
        ledger:
          "Use runbook_verify_ledger or resource runbook://ledger/verification. Assurance is local-tamper-evidence-only. Anyone who can rewrite the entire file can recompute the chain.",
        registry:
          "Use offline capability snapshot/diff/admit tools with closed fixtureIds or owned local paths. Admit/quarantine/reject are analysis outcomes, not trade authorization. Prefer the 45→50 drift and risk-correction reject demos.",
        "public-auth":
          "Use offline public-auth inspect tools on fixtures only. Never register, authorize, token, or call discovered MCP URIs. Scope labels are opaque, not least-privilege proofs.",
      };
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Verify a ${kind} artifact using Runbook's offline surfaces.`,
                guidance[kind],
                "Read runbook://docs/assurance before summarizing results.",
                "Never upgrade the result into a composite safety score or production authorization.",
                BOUNDARY_REMINDER,
              ].join(" "),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "runbook_offline_frontier_demo",
    {
      title: "Offline frontier demo walkthrough",
      description:
        "Walk through capability 45→50 drift, risk-correction reject, capsule pair, public-auth fixture, then restate limitations. No broker, no credentials.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Run the Runbook offline frontier demo end-to-end using closed fixtures only.",
              "Step 0: Read runbook://docs/boundary, runbook://docs/assurance, runbook://fixtures/catalog, and runbook://demos/capability-drift.",
              "Optional: call runbook_list_surface once and confirm brokerExecutionTools is [] and openWorldHint is false.",
              "Step 1: Diff capabilities — call runbook_diff_capabilities with baselineFixtureId registry.trading-45 and candidateFixtureId registry.trading-50. Expect materialChangeCount 5. Summarize that this is offline claim analysis, not live tools/list.",
              "Step 2: Admit risk-correction reject — call runbook_admit_capabilities with baselineFixtureId registry.trading-50, candidateFixtureId registry.trading-50-risk-correction, policyFixtureId registry.policy.public-docs-review-required, and evaluatedAtDeclared 2026-07-22T07:10:00Z. Expect outcome reject and doesNotGrantBrokerPermission true.",
              "Step 3: Capsule pair — call runbook_verify_capsule with fixtureId capsule.minimal-root (valid true) and capsule.minimal-tampered (valid false, not isError). Quote self-asserted author key limitations.",
              "Step 4: Public-auth fixture — call runbook_inspect_public_auth_metadata with fixtureId public-auth.trading-authorization-server. Never register, authorize, token, or call discovered MCP URIs.",
              "Step 5: Restate limitations out loud: no credentials, no order execution, no composite safety score, advisory not hard-gate, admit/reject is not trade authorization, capsule valid is not identity or skill, public-auth parse is not least-privilege proof, dossier V2 is architecture-slice status only (runbook://status/dossier).",
              "Do not call place_* tools, do not configure Robinhood MCP, do not invent a green safety grade.",
              BOUNDARY_REMINDER,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "runbook_recursive_improve",
    {
      title: "Recursive shadow charter improvement",
      description:
        "Curriculum → improve → re-eval → stop at fixed point. Never connect broker; never claim returns. Activate only with explicit human request.",
      argsSchema: {
        experimentId: z.string().trim().min(1).max(120).optional(),
        maxGenerations: z.string().trim().min(1).max(2).optional(),
      },
    },
    async ({ experimentId, maxGenerations }) => {
      const id = experimentId?.trim() || undefined;
      const gens = maxGenerations?.trim() || "3";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Run recursive shadow self-improvement for Capital Constitution process quality.",
                "Read runbook://demos/shadow-self-improve, runbook://docs/boundary, and runbook://docs/assurance first.",
                id
                  ? `Prefer experiment ${id}: load active charter from the ledger when calling curriculum/improve tools.`
                  : "No experimentId: evaluate/improve against an explicit policy override or the reference elite policy.",
                "Loop:",
                `1) runbook_run_shadow_curriculum (policy override and/or experimentId). Report multi-axis metrics only — never invent a composite safety score.`,
                `2) runbook_improve_charter with maxGenerations=${gens} (1–8). Capture generations[], finalPolicy, before/after hardFalseAllows.`,
                "3) runbook_run_shadow_curriculum again on finalPolicy (policy override). If hardFalseAllows did not improve and fixedPoint is true, STOP.",
                "4) Optional: runbook_agent_eval on a local experiment ledger for process axes (not PnL).",
                "5) Do NOT call runbook_activate_refined_charter unless the human operator explicitly requests ledger activation.",
                "Hard rules: never configure Robinhood or any brokerage MCP; never place/cancel orders; never claim returns, alpha, or trading skill; never invent a composite score.",
                "Stop when fixed point is reached or generation budget is exhausted. Report limitations from tool outputs verbatim.",
                BOUNDARY_REMINDER,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "runbook_elite_recursive_loop",
    {
      title: "Elite recursive self-improvement loop",
      description:
        "Full 10-step elite loop bound to runbook://playbooks/recursive-elite-process: surface → weak curriculum → improve to fixed point → optional Pareto → experiment + clean/denied preflights → agent_eval → expand → re-improve. Never broker; never returns claims.",
      argsSchema: {
        experimentId: z.string().trim().min(1).max(120).optional(),
        maxGenerations: z.string().trim().min(1).max(2).optional(),
        runTournament: z.enum(["true", "false"]).optional(),
      },
    },
    async ({ experimentId, maxGenerations, runTournament }) => {
      const id = experimentId?.trim() || "RUN-ELITE-LOOP-001";
      const gens = maxGenerations?.trim() || "8";
      const tournament = (runTournament?.trim() || "true") === "true";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Execute the elite recursive self-improvement loop for Capital Constitution process quality.",
                "Read runbook://playbooks/recursive-elite-process first, then runbook://docs/boundary and runbook://docs/assurance.",
                "Follow all 10 steps in the playbook. Multi-axis metrics only — never invent a composite safety or skill score.",
                "",
                "1) runbook_list_surface — confirm brokerExecutionTools is [], openWorldHint false, shadow tools present, and no place_*/cancel_* tools.",
                "2) runbook_run_shadow_curriculum on a weak policy override (or active charter if one exists). Expect hardFalseAllows > 0 for the weak path.",
                `3) runbook_improve_charter with maxGenerations=${gens} (1–8). Capture generations[], finalPolicy, finalHardFalseAllows (target 0), fixedPoint.`,
                tournament
                  ? "4) Optional tournament: runbook_shadow_tournament (e.g. maxGenerations 3, mutantCount 2, seed 7). Report Pareto front schema only — pick process-quality policy, not returns."
                  : "4) Skip tournament unless the operator requests it.",
                `5) runbook_create_experiment for experimentId ${id} using the refined finalPolicy as the initial charter (approvalRequired true, equities preferred). If swapping an existing experiment, runbook_activate_refined_charter only with explicit human request.`,
                "6) Synthetic preflights: one clean charter-matching equity (e.g. VTI) and at least one denied path (denylisted symbol and/or disallowed instrument). Caller-supplied account fields are not broker truth. No approval/execution required for this evidence.",
                "7) runbook_agent_eval — expect processCorrect true; process axes only; not PnL.",
                "8) runbook_expand_curriculum_from_ledger — synthetic process labels only; ledgerMutated false.",
                "9) If new candidates or residual defects, re-run improve/curriculum; stop at fixed point or budget.",
                "10) Final report: NEVER broker, NEVER returns/alpha/skill claims. Quote limitations from tool outputs. brokerEffect must remain false.",
                BOUNDARY_REMINDER,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "runbook_control_plane_session",
    {
      title: "Control plane session workflow",
      description:
        "Create a local control-plane session, pin inventory, optional shadow/dossier evidence, optional device-key signed approval intent. Never broker; never credentials; no composite score.",
      argsSchema: {
        sessionId: z.string().trim().min(1).max(120).optional(),
        label: z.string().trim().min(1).max(200).optional(),
      },
    },
    async ({ sessionId, label }) => {
      const id = sessionId?.trim() || "CPS-DEMO-001";
      const sessionLabel = label?.trim() || "Control plane demo";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Run a local control-plane session evidence workflow (process only).",
                "Read runbook://docs/control-plane-session, runbook://docs/boundary, and runbook://docs/assurance first.",
                `Preferred sessionId: ${id}. Label: ${sessionLabel}.`,
                "Steps:",
                `1) runbook_session_create with label and optional equity-only policy (sessionId ${id} if free).`,
                "2) runbook_session_pin_inventory (default public-docs 50-tool pin) — report toolCount and toolSetSha256.",
                "3) runbook_session_check_inventory with a subset of pinned names (expect ok true) and once with an unknown tool (expect fail-closed ok false).",
                "4) Optional: runbook_session_record_shadow with generation metrics (hardFalseAllows/hardFalseDenies).",
                "5) Optional: runbook_session_attach_dossier with a status-snapshot summary (architecture evidence, not certification).",
                "6) Optional demo attestation: runbook_approval_create_signed (ephemeral key; private key not persisted) then runbook_approval_verify with returned publicKeySpkiBase64.",
                "7) runbook_session_export for the evidence pack.",
                "Hard rules: never configure brokerage MCP; never place/cancel orders; never invent a composite safety score; never claim broker authorization from device-key signatures.",
                "Restate: humanAuthorityEstablished and authorizationEstablished remain false; capitalAtRisk is 0; brokerEffect is false.",
                BOUNDARY_REMINDER,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "runbook_control_plane_full",
    {
      title: "Control plane full journey",
      description:
        "Full 10-step control-plane journey bound to runbook://playbooks/control-plane-session: create → pin → check → improve → record shadow → create experiment → bind → signed approval → dossier → export. Never broker; never returns claims; no composite score.",
      argsSchema: {
        sessionId: z.string().trim().min(1).max(120).optional(),
        experimentId: z.string().trim().min(1).max(120).optional(),
        label: z.string().trim().min(1).max(200).optional(),
        maxGenerations: z.string().trim().min(1).max(2).optional(),
      },
    },
    async ({ sessionId, experimentId, label, maxGenerations }) => {
      const id = sessionId?.trim() || "CPS-FULL-001";
      const expId = experimentId?.trim() || "RUN-CPS-FULL-001";
      const sessionLabel = label?.trim() || "Control plane full journey";
      const gens = maxGenerations?.trim() || "4";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Execute the full control-plane session journey for process / evidence only.",
                "Read runbook://playbooks/control-plane-session first, then runbook://docs/boundary, runbook://docs/assurance, and runbook://status/dossier.",
                "Follow all 10 steps in the playbook. Multi-axis metrics only — never invent a composite safety or skill score.",
                `Preferred sessionId: ${id}. Preferred experimentId: ${expId}. Label: ${sessionLabel}.`,
                "",
                `1) runbook_session_create — sessionId ${id}, equity-only policy (approvalRequired true), label as given.`,
                "2) runbook_session_pin_inventory — default public-docs 50-tool pin; report toolCount and toolSetSha256. Not runtime confirmation; not broker permission.",
                "3) runbook_session_check_inventory — subset of pinned names expect ok true; once with unknown tool expect fail-closed ok false.",
                `4) runbook_improve_charter with maxGenerations=${gens} (1–8) on the equity/session policy (or weak override). Capture finalPolicy and hardFalseAllows. Optional: runbook_session_set_charter with finalPolicy (session only — not ledger activation).`,
                "5) runbook_session_record_shadow with generation metrics from improve (hardFalseAllows / hardFalseDenies).",
                `6) runbook_create_experiment for experimentId ${expId} using refined finalPolicy (or equity-only) as initial charter. Local ledger only; synthetic/agent actor preferred.`,
                `7) runbook_session_bind_experiment — bind session ${id} to experiment ${expId} (optional ledger head hash after runbook_verify_ledger). Local id linkage only — not brokerage account binding.`,
                "8) Signed approval demo: runbook_approval_create_signed (ephemeral key; privateKeyPersisted false) then runbook_approval_verify. humanAuthorityEstablished and authorizationEstablished remain false — never claim broker authorization.",
                "9) runbook_session_attach_dossier with architecture status-snapshot summary (not certification).",
                "10) runbook_session_export — evidence pack only. Final report: NEVER broker, NEVER returns/alpha/skill claims, NEVER composite score. capitalAtRisk 0; brokerEffect false.",
                BOUNDARY_REMINDER,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "runbook_process_supervisor",
    {
      title: "Process supervisor (tick before external tools)",
      description:
        "Mid-flight process heartbeat: pin inventory, surface lock, process_tick with observed tools and optional proposal. proceed|warn|stop is process-layer only — not a hard broker gateway.",
      argsSchema: {
        sessionId: z.string().trim().min(1).max(120).optional(),
      },
    },
    async ({ sessionId }) => {
      const id = sessionId?.trim() || undefined;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Act as a process supervisor for a financial agent workflow using Runbook only.",
                "Read runbook://docs/boundary and runbook://docs/assurance first.",
                id
                  ? `Use control-plane session ${id} (or create/use it if missing).`
                  : "Create a control-plane session with charterBindingEnforcement fail-closed and inventoryEnforcement fail-closed, then runbook_session_use.",
                "1) runbook_surface_lock_receipt — confirm closed inventory, no place_*/cancel_*, brokerExecutionTools [].",
                "2) runbook_session_pin_inventory (or least-privilege via drift sentinel pinPreset observation-only / no-capital-order-mutation).",
                "3) Before any external/broker-adjacent tool names, call runbook_process_tick with observedToolNames (the tools you intend to call) and optional proposal.",
                "4) If recommendation is stop — do not proceed; report inventory unknown tools and dual-eval binding.",
                "5) If warn — surface the risk; continue only if the human operator accepts process risk.",
                "6) If proceed — continue process work; still never place/cancel via Runbook (there are no place tools).",
                "7) Optional: runbook_drift_sentinel on a local tools/list paste; runbook_session_seal_capsule when the session is ready for portable evidence.",
                "Hard rules: never configure brokerage MCP here; never invent composite scores or returns; process-layer only — host may still bypass Runbook.",
                BOUNDARY_REMINDER,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
