import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { evaluateProposal } from "@runbook/engine/policy";
import { policyCheckSchema, riskPolicySchema, tradeProposalSchema } from "@runbook/engine/schema";
import { charterDigest, resolveCharterDualEval } from "@runbook/session";
import { registerOfflineTools, type OfflineToolsOptions } from "./offline-tools.js";
import { registerRunbookPrompts } from "./prompts.js";
import { withToolErrors } from "./protocol.js";
import { registerRunbookResources } from "./resources.js";
import { RunbookService } from "./service.js";
import {
  appendSessionNote,
  resolveSessionId,
  resolveSessionStore,
  withSession,
} from "./session-context.js";
import { registerSessionTools } from "./session-tools.js";
import { registerShadowTools } from "./shadow-tools.js";
import { buildSurfaceInventory, SERVER_NAME, SERVER_VERSION } from "./surface.js";

const actorShape = {
  type: z.enum(["human", "agent", "system", "broker-import"]),
  id: z.string().trim().min(1).max(120),
};

const eventOutputSchema = z.object({
  schemaVersion: z.literal("runbook.ledger.v1"),
  sequence: z.number().int().positive(),
  eventId: z.string(),
  experimentId: z.string(),
  type: z.string(),
  occurredAt: z.string(),
  recordedAt: z.string(),
  actor: z.object(actorShape),
  idempotencyKey: z.string(),
  payload: z.record(z.string(), z.unknown()),
  previousHash: z.string(),
  hash: z.string(),
});

const executionEvidenceOutputSchema = z.object({
  status: z.enum(["control-evidence-consistent", "policy-violation", "evidence-ambiguous"]),
  codes: z.array(z.string()),
  charterHash: z.string().nullable(),
  proposalHash: z.string().nullable(),
  preflightHash: z.string().nullable(),
  approvalHash: z.string().nullable(),
  scope: z.literal("caller-owned-observation-only"),
  brokerTruthEstablished: z.literal(false),
  humanAuthorityEstablished: z.literal(false),
  authorizationEstablished: z.literal(false),
});

function eventPayloadEvidence(event: { payload: Record<string, unknown> }) {
  return event.payload.evidence as Record<string, unknown>;
}

export function createRunbookServer(service: RunbookService, options?: OfflineToolsOptions) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerRunbookResources(server, service);
  registerRunbookPrompts(server);
  registerOfflineTools(server, service, options);
  registerShadowTools(server, service, options);
  registerSessionTools(server, options);

  server.registerTool(
    "runbook_list_surface",
    {
      title: "List Runbook Surface",
      description:
        "Return the closed inventory of tool names, resource URIs, and prompt names plus server version. brokerExecutionTools is always empty; openWorldHint is false for all tools. Prefer this over multiple list calls for agent self-discovery.",
      inputSchema: {},
      outputSchema: {
        schemaVersion: z.literal("runbook.surface-inventory.v1"),
        serverName: z.literal("runbook"),
        serverVersion: z.string(),
        tools: z.array(
          z.object({
            name: z.string(),
            openWorldHint: z.literal(false),
            offline: z.boolean(),
          }),
        ),
        resourceUris: z.array(z.string()),
        prompts: z.array(z.string()),
        brokerExecutionTools: z.array(z.string()).max(0),
        openWorldHint: z.literal(false),
        notes: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolErrors(async () => buildSurfaceInventory()),
  );

  server.registerTool(
    "runbook_create_experiment",
    {
      title: "Create Runbook Experiment",
      description:
        "Create a local experiment and activate its first deterministic risk charter. Records owned local data only; never opens or funds a brokerage account. Optional sessionId (or active session via RUNBOOK_SESSION_ID / active-session.json) binds the experiment to the control-plane session spine. Read runbook://docs/boundary before first use. Does not place trades or accept credentials.",
      inputSchema: {
        experimentId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/),
        name: z.string().trim().min(1).max(120),
        question: z.string().trim().min(1).max(500),
        benchmark: z.string().trim().min(1).max(20),
        observationDays: z.number().int().positive().max(3_650),
        policy: riskPolicySchema,
        actor: z.object(actorShape),
        occurredAt: z.iso.datetime(),
        sessionId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/)
          .optional(),
      },
      outputSchema: {
        experimentId: z.string(),
        experimentHash: z.string(),
        charterHash: z.string(),
        enforcement: z.literal("advisory"),
        sessionId: z.string().optional(),
        sessionBound: z.boolean(),
        brokerEffect: z.literal(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolErrors(async (input) => {
      const created = await service.createExperiment(input);
      const sessionId = await resolveSessionId(input.sessionId, options);
      const store = resolveSessionStore(options);
      let sessionBound = false;
      await withSession(sessionId, store, async (id, s) => {
        await s.bindExperiment(id, input.experimentId, created.charter.hash);
        sessionBound = true;
      });
      return {
        experimentId: input.experimentId,
        experimentHash: created.experiment.hash,
        charterHash: created.charter.hash,
        enforcement: "advisory" as const,
        ...(sessionId !== undefined ? { sessionId } : {}),
        sessionBound,
        brokerEffect: false as const,
      };
    }),
  );

  server.registerTool(
    "runbook_preflight_trade",
    {
      title: "Preflight Trade Proposal",
      description:
        "Record and evaluate a proposed trade against the active local (ledger) charter. When a control-plane session is active (sessionId arg, RUNBOOK_SESSION_ID, or active-session.json), dual-evaluates the session charter and reports sessionCharterBinding. Session charterBindingEnforcement: off | warn (default) | fail-closed — fail-closed sets process allowed=false when the session charter denies (or is missing), while ledgerAllowed still reflects the experiment charter; still not a hard broker gateway. Does not place, route, preview, or approve a broker order. Account state fields are caller-supplied. See runbook://docs/assurance and runbook://playbooks/control-plane-session.",
      inputSchema: {
        proposal: tradeProposalSchema,
        actor: z.object(actorShape),
        occurredAt: z.iso.datetime(),
        sessionId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/)
          .optional(),
      },
      outputSchema: {
        allowed: z.boolean(),
        ledgerAllowed: z.boolean(),
        enforcement: z.literal("advisory"),
        checks: z.array(policyCheckSchema),
        proposalHash: z.string(),
        preflightHash: z.string(),
        warning: z.string(),
        sessionId: z.string().optional(),
        sessionCharterDigest: z.string().optional(),
        sessionPolicyAllowed: z.boolean().optional(),
        sessionCharterBinding: z.enum([
          "no-session",
          "no-session-charter",
          "matched-allowed",
          "matched-denied",
          "mismatch-session-denies",
          "mismatch-session-allows",
        ]),
        charterBindingEnforcement: z.enum(["off", "warn", "fail-closed"]),
        processDeniedBySession: z.boolean(),
        brokerEffect: z.literal(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolErrors(async ({ proposal, actor, occurredAt, sessionId: sessionIdArg }) => {
      const preflight = await service.preflight(proposal, actor, occurredAt);
      const sessionId = await resolveSessionId(sessionIdArg, options);
      const store = resolveSessionStore(options);

      let sessionCharterDigest: string | undefined;
      let dual = resolveCharterDualEval({
        ledgerAllowed: preflight.result.allowed,
        sessionPresent: false,
        sessionHasCharter: false,
        enforcement: "warn",
      });

      if (sessionId !== undefined) {
        const session = await store.read(sessionId);
        const enforcement = session.charterBindingEnforcement ?? "warn";
        if (session.charter === undefined) {
          dual = resolveCharterDualEval({
            ledgerAllowed: preflight.result.allowed,
            sessionPresent: true,
            sessionHasCharter: false,
            enforcement,
          });
        } else {
          sessionCharterDigest = session.charterDigest ?? charterDigest(session.charter);
          const sessionEval = evaluateProposal(session.charter, proposal);
          dual = resolveCharterDualEval({
            ledgerAllowed: preflight.result.allowed,
            sessionPresent: true,
            sessionHasCharter: true,
            sessionAllowed: sessionEval.allowed,
            enforcement,
          });
          await appendSessionNote(
            store,
            sessionId,
            `preflight ${proposal.proposalId}: ledgerAllowed=${dual.ledgerAllowed} sessionAllowed=${sessionEval.allowed} binding=${dual.sessionCharterBinding} enforcement=${enforcement} processAllowed=${dual.allowed}`,
          );
        }
      }

      return {
        ...preflight.result,
        // Process-layer effective allow (may process-deny under fail-closed session charter).
        allowed: dual.allowed,
        ledgerAllowed: dual.ledgerAllowed,
        proposalHash: preflight.proposalEvent.hash,
        preflightHash: preflight.preflightEvent.hash,
        warning:
          "Runbook preflight is advisory. It does not prevent direct use of a broker tool." +
          dual.warningSuffix,
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(sessionCharterDigest !== undefined ? { sessionCharterDigest } : {}),
        ...(dual.sessionPolicyAllowed !== undefined
          ? { sessionPolicyAllowed: dual.sessionPolicyAllowed }
          : {}),
        sessionCharterBinding: dual.sessionCharterBinding,
        charterBindingEnforcement: dual.charterBindingEnforcement,
        processDeniedBySession: dual.processDeniedBySession,
        brokerEffect: false as const,
      };
    }),
  );

  server.registerTool(
    "runbook_record_approval",
    {
      title: "Record Caller-Asserted Approval",
      description:
        "Record a caller-asserted human approval or rejection for a preflighted proposal. Does not authenticate human authority or approve an order at a broker. Agents can claim actor.type human; evidence remains unauthenticated.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120),
        proposalId: z.string().trim().min(1).max(120),
        approved: z.boolean(),
        reason: z.string().trim().min(1).max(1_000),
        actor: z.object({ type: z.literal("human"), id: actorShape.id }),
        occurredAt: z.iso.datetime(),
        expiresAt: z.iso.datetime().optional(),
        idempotencyKey: z.string().trim().min(1).max(200),
      },
      outputSchema: {
        event: eventOutputSchema,
        brokerEffect: z.literal(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolErrors(async (input) => ({ event: await service.recordApproval(input), brokerEffect: false })),
  );

  server.registerTool(
    "runbook_record_execution",
    {
      title: "Record Owned Execution Data",
      description:
        "Import a fill or execution record from data the account owner already controls. Cannot place a trade, establish human authority, or establish authorization. Evidence flags always report brokerTruthEstablished/humanAuthorityEstablished/authorizationEstablished false.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120),
        proposalId: z.string().trim().min(1).max(120),
        source: z.enum(["robinhood-mcp", "robinhood-csv", "manual", "alpaca-paper"]),
        brokerEventId: z.string().trim().min(1).max(160),
        symbol: z.string().trim().min(1).max(20),
        side: z.enum(["buy", "sell"]),
        quantity: z.number().finite().nonnegative().optional(),
        notional: z.number().finite().nonnegative().optional(),
        actor: z.object(actorShape),
        occurredAt: z.iso.datetime(),
        note: z.string().trim().max(2_000).optional(),
      },
      outputSchema: {
        event: eventOutputSchema,
        brokerEffect: z.literal(false),
        evidence: executionEvidenceOutputSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolErrors(async (input) => {
      const event = await service.recordExecution(input);
      return { event, brokerEffect: false, evidence: eventPayloadEvidence(event) };
    }),
  );

  server.registerTool(
    "runbook_list_events",
    {
      title: "List Runbook Events",
      description:
        "Read the local decision ledger, optionally filtered to one experiment. Returns full local payloads to the MCP client; treat as private. Does not contact any broker.",
      inputSchema: { experimentId: z.string().trim().min(1).max(120).optional() },
      outputSchema: { events: z.array(eventOutputSchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolErrors(async ({ experimentId }) => ({ events: await service.listEvents(experimentId) })),
  );

  server.registerTool(
    "runbook_verify_ledger",
    {
      title: "Verify Runbook Ledger",
      description:
        "Verify the local hash chain, sequences, and idempotency keys. A valid local chain is tamper-evident, not externally anchored or immutable. Also available as resource runbook://ledger/verification.",
      inputSchema: {},
      outputSchema: {
        valid: z.boolean(),
        eventCount: z.number().int().nonnegative(),
        headHash: z.string(),
        errors: z.array(z.string()),
        assurance: z.literal("local-tamper-evidence-only"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolErrors(async () => {
      const verification = await service.verify();
      return {
        ...verification,
        errors: verification.valid ? [] : ["ledger-verification-failed"],
        assurance: "local-tamper-evidence-only",
      };
    }),
  );

  return server;
}
