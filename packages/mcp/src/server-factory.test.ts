import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import { evaluateProposal } from "@runbook/engine/policy";
import type { RiskPolicy, TradeProposal } from "@runbook/engine/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROMPT_NAMES } from "./prompts.js";
import { parseToolErrorContent } from "./protocol.js";
import { STATIC_RESOURCE_URIS } from "./resources.js";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";
import { TOOL_NAMES } from "./surface.js";

const occurredAt = "2026-07-21T14:00:00.000Z";
const approvalExpiresAt = "2026-07-21T15:00:00.000Z";
const experimentId = "RUN-MCP-001";
const actor = { type: "human" as const, id: "mason" };
const nonHumanActorTypes = ["agent", "system", "broker-import"] as const;

const policy: RiskPolicy = {
  capitalBudget: 500,
  cashReserve: 125,
  maxPositionPercent: 25,
  maxOrderNotional: 125,
  maxDrawdownPercent: 8,
  maxDailyTrades: 2,
  allowedInstruments: ["equity"],
  allowedSymbols: ["VTI", "BND"],
  deniedSymbols: ["GME"],
  approvalRequired: true,
};

const proposal: TradeProposal = {
  proposalId: "proposal-001",
  experimentId,
  symbol: "VTI",
  instrument: "equity",
  side: "buy",
  notional: 100,
  projectedPositionNotional: 100,
  dailyTradesAfter: 1,
  currentDrawdownPercent: 0.5,
  hasThesis: true,
  hasInvalidation: true,
  evidenceSourceCount: 2,
};

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-mcp-"));
  const ledger = new FileLedger(directory, "protocol-test");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service);
  const client = new Client({ name: "runbook-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, directory, ledger, server, service };
}

async function createExperiment(client: Client) {
  return client.callTool({
    name: "runbook_create_experiment",
    arguments: {
      experimentId,
      name: "Small Account Agentic Arena",
      question: "Can a bounded agentic workflow beat its benchmark?",
      benchmark: "VTI",
      observationDays: 90,
      policy,
      actor,
      occurredAt,
    },
  });
}

describe("Runbook MCP protocol", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.client.close();
    await harness.server.close();
    await rm(harness.directory, { recursive: true, force: true });
  });

  it("advertises the local Runbook tools with object schemas", async () => {
    const listed = await harness.client.listTools();
    const names = listed.tools.map((tool) => tool.name);

    // Closed surface must match surface.ts TOOL_NAMES exactly (registration set equality).
    // listTools order follows server registration, not discovery inventory order.
    expect(names).toHaveLength(TOOL_NAMES.length);
    expect([...names].sort()).toEqual([...TOOL_NAMES].sort());
    expect(names).toEqual(expect.arrayContaining([
      "runbook_list_surface",
      "runbook_create_experiment",
      "runbook_preflight_trade",
      "runbook_record_approval",
      "runbook_record_execution",
      "runbook_list_events",
      "runbook_verify_ledger",
      "runbook_run_shadow_curriculum",
      "runbook_improve_charter",
      "runbook_activate_refined_charter",
      "runbook_agent_eval",
    ]));
    // Closed surface: ledger + offline + shadow tools + list_surface (see surface.ts TOOL_NAMES).
    expect(names.filter((name) => name.startsWith("runbook_")).length).toBe(TOOL_NAMES.length);
    expect(names).toEqual(expect.arrayContaining([
      "runbook_shadow_tournament",
      "runbook_expand_curriculum_from_ledger",
    ]));
    expect(listed.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
    expect(listed.tools.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
    expect(listed.tools.every((tool) => tool.annotations?.openWorldHint === false)).toBe(true);
    expect(listed.tools.find((tool) => tool.name === "runbook_list_events")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(listed.tools.find((tool) => tool.name === "runbook_record_approval")).toMatchObject({
      title: "Record Caller-Asserted Approval",
      inputSchema: {
        properties: {
          actor: {
            properties: { type: { const: "human" } },
          },
        },
      },
    });
  });

  it("returns a closed surface inventory from runbook_list_surface", async () => {
    await harness.client.listTools();
    const result = await harness.client.callTool({
      name: "runbook_list_surface",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      schemaVersion: "runbook.surface-inventory.v1",
      serverName: "runbook",
      serverVersion: "0.4.3",
      brokerExecutionTools: [],
      openWorldHint: false,
    });
    const body = result.structuredContent as {
      tools: Array<{ name: string; openWorldHint: boolean; offline: boolean }>;
      resourceUris: string[];
      prompts: string[];
    };
    // Exact closed inventory — must stay in lockstep with server-factory registration.
    expect(body.tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(body.tools.every((t) => t.openWorldHint === false)).toBe(true);
    expect(body.resourceUris).toEqual([...STATIC_RESOURCE_URIS]);
    expect(body.prompts).toEqual([...PROMPT_NAMES]);
    expect(body.tools.find((t) => t.name === "runbook_list_surface")?.offline).toBe(true);
    expect(body.tools.find((t) => t.name === "runbook_activate_refined_charter")?.offline).toBe(false);
  });

  it("advertises discovery resources with boundary and assurance content", async () => {
    const listed = await harness.client.listResources();
    const uris = listed.resources.map((resource) => resource.uri);

    expect(uris).toHaveLength(STATIC_RESOURCE_URIS.length);
    expect([...uris].sort()).toEqual([...STATIC_RESOURCE_URIS].sort());
    expect(uris).toEqual(expect.arrayContaining([
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
      "runbook://ledger/verification",
    ]));

    const boundary = await harness.client.readResource({ uri: "runbook://docs/boundary" });
    const boundaryText = boundary.contents.map((part) => ("text" in part ? part.text : "")).join("");
    expect(boundaryText).toMatch(/advisory/i);
    expect(boundaryText).toMatch(/credential/i);
    expect(boundaryText).toMatch(/composite safety score/i);
    expect(boundaryText).not.toMatch(/place_equity_order/);

    const assurance = await harness.client.readResource({ uri: "runbook://docs/assurance" });
    const assuranceText = assurance.contents.map((part) => ("text" in part ? part.text : "")).join("");
    expect(assuranceText).toContain("compositeScoreProhibited");
    expect(assuranceText).toContain("local-tamper-evidence-only");

    const catalog = await harness.client.readResource({ uri: "runbook://fixtures/catalog" });
    const catalogText = catalog.contents.map((part) => ("text" in part ? part.text : "")).join("");
    expect(catalogText).toContain("runbook.fixture-catalog.v1");
    expect(catalogText).toContain("registry.trading-45");
    expect(catalogText).toContain("2a414ea97e02d0732cbf03a3809486b5141977ca07311fe792787c4418b2b408");

    const dossier = await harness.client.readResource({ uri: "runbook://status/dossier" });
    const dossierText = dossier.contents.map((part) => ("text" in part ? part.text : "")).join("");
    expect(dossierText).toMatch(/architecture/i);
    expect(dossierText).toMatch(/no composite safety score/i);
    expect(dossierText).toMatch(/completed buyer product/i);
  });

  it("advertises agent workflow prompts with hard boundary language", async () => {
    const listed = await harness.client.listPrompts();
    const promptNames = listed.prompts.map((prompt) => prompt.name);
    expect(promptNames).toHaveLength(PROMPT_NAMES.length);
    expect([...promptNames].sort()).toEqual([...PROMPT_NAMES].sort());
    expect(promptNames).toEqual(expect.arrayContaining([
      "runbook_explain_boundary",
      "runbook_shadow_pilot",
      "runbook_preflight_review",
      "runbook_verify_artifact",
      "runbook_offline_frontier_demo",
      "runbook_recursive_improve",
      "runbook_elite_recursive_loop",
      "runbook_control_plane_session",
      "runbook_control_plane_full",
    ]));

    const shadow = await harness.client.getPrompt({
      name: "runbook_shadow_pilot",
      arguments: { experimentId: "RUN-SHADOW-001" },
    });
    const text = shadow.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");
    expect(text).toMatch(/HARD STOP/i);
    expect(text).toMatch(/Robinhood/i);
    expect(text).toMatch(/composite safety score/i);
    expect(text).toContain("RUN-SHADOW-001");

    const frontier = await harness.client.getPrompt({ name: "runbook_offline_frontier_demo" });
    const frontierText = frontier.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");
    expect(frontierText).toMatch(/registry\.trading-45/);
    expect(frontierText).toMatch(/risk-correction/);
    expect(frontierText).toMatch(/capsule\.minimal-root/);
    expect(frontierText).toMatch(/public-auth\.trading-authorization-server/);
    expect(frontierText).toMatch(/limitations/i);
  });

  it("runs the owned-data workflow through Client.callTool and returns validated structured output", async () => {
    // listTools also caches output schemas for Client.callTool validation.
    await harness.client.listTools();

    const created = await createExperiment(harness.client);
    expect(created.isError).not.toBe(true);
    expect(created.structuredContent).toMatchObject({
      experimentId,
      enforcement: "advisory",
    });

    const preflight = await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: { proposal, actor, occurredAt },
    });
    expect(preflight.isError).not.toBe(true);
    expect(preflight.structuredContent).toMatchObject({
      allowed: true,
      enforcement: "advisory",
    });
    expect((preflight.structuredContent as { checks: unknown[] }).checks).toHaveLength(10);

    const approval = await harness.client.callTool({
      name: "runbook_record_approval",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        approved: true,
        reason: "Reviewed against the active charter.",
        actor,
        occurredAt,
        expiresAt: approvalExpiresAt,
        idempotencyKey: "approval:proposal-001:mason",
      },
    });
    expect(approval.isError).not.toBe(true);
    expect(approval.structuredContent).toMatchObject({
      brokerEffect: false,
      event: { type: "approval.recorded" },
    });

    const executionImport = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        source: "manual",
        brokerEventId: "owned-fill-001",
        symbol: "VTI",
        side: "buy",
        notional: 100,
        actor: { type: "broker-import", id: "manual-import" },
        occurredAt,
      },
    });
    expect(executionImport.isError).not.toBe(true);
    expect(executionImport.structuredContent).toMatchObject({
      brokerEffect: false,
      event: { type: "execution.recorded" },
      evidence: {
        status: "evidence-ambiguous",
        codes: ["human-authority-unverified"],
        scope: "caller-owned-observation-only",
        brokerTruthEstablished: false,
        humanAuthorityEstablished: false,
        authorizationEstablished: false,
      },
    });

    const events = await harness.client.callTool({
      name: "runbook_list_events",
      arguments: { experimentId },
    });
    expect(events.isError).not.toBe(true);
    expect((events.structuredContent as { events: unknown[] }).events).toHaveLength(6);

    const verification = await harness.client.callTool({
      name: "runbook_verify_ledger",
      arguments: {},
    });
    expect(verification.isError).not.toBe(true);
    expect(verification.structuredContent).toMatchObject({
      valid: true,
      eventCount: 6,
      errors: [],
      assurance: "local-tamper-evidence-only",
    });
  });

  it.each(nonHumanActorTypes)(
    "rejects a %s approval actor at the direct service boundary without appending a decision",
    async (type) => {
      await harness.service.createExperiment({
        experimentId,
        name: "Direct service approval boundary",
        question: "Can a non-human caller manufacture approval?",
        benchmark: "VTI",
        observationDays: 30,
        policy,
        actor,
        occurredAt,
      });
      await harness.service.preflight(proposal, actor, "2026-07-21T14:01:00.000Z");

      await expect(harness.service.recordApproval({
        experimentId,
        proposalId: proposal.proposalId,
        approved: true,
        reason: "Hostile direct-service assertion.",
        actor: { type, id: `hostile-${type}` },
        occurredAt: "2026-07-21T14:02:00.000Z",
        expiresAt: approvalExpiresAt,
        idempotencyKey: `approval:${proposal.proposalId}:hostile-${type}`,
      } as unknown as Parameters<RunbookService["recordApproval"]>[0])).rejects.toThrow(
        "Only a caller-asserted human actor can record an approval decision.",
      );

      const events = await harness.service.listEvents(experimentId);
      expect(events).toHaveLength(4);
      expect(events.some((event) => event.type === "approval.recorded")).toBe(false);
    },
  );

  it.each(nonHumanActorTypes)(
    "rejects a %s approval actor through the complete MCP protocol without writing an event",
    async (type) => {
      await harness.client.listTools();
      await createExperiment(harness.client);
      await harness.client.callTool({
        name: "runbook_preflight_trade",
        arguments: { proposal, actor, occurredAt: "2026-07-21T14:01:00.000Z" },
      });

      const attemptedApproval = await harness.client.callTool({
        name: "runbook_record_approval",
        arguments: {
          experimentId,
          proposalId: proposal.proposalId,
          approved: true,
          reason: "Hostile MCP actor assertion.",
          actor: { type, id: `hostile-${type}` },
          occurredAt: "2026-07-21T14:02:00.000Z",
          expiresAt: approvalExpiresAt,
          idempotencyKey: `approval:${proposal.proposalId}:mcp-${type}`,
        },
      });

      expect(attemptedApproval.isError).toBe(true);
      const events = await harness.service.listEvents(experimentId);
      expect(events).toHaveLength(4);
      expect(events.some((event) => event.type === "approval.recorded")).toBe(false);
    },
  );

  it.each(nonHumanActorTypes)(
    "fails closed on a legacy %s approval during direct-service execution assessment and preserves the observation",
    async (type) => {
      await harness.service.createExperiment({
        experimentId,
        name: "Legacy approval evidence boundary",
        question: "Can legacy non-human approval evidence authorize an execution?",
        benchmark: "VTI",
        observationDays: 30,
        policy,
        actor,
        occurredAt,
      });
      const preflight = await harness.service.preflight(proposal, actor, "2026-07-21T14:01:00.000Z");
      await harness.ledger.append({
        experimentId,
        type: "approval.recorded",
        occurredAt: "2026-07-21T14:02:00.000Z",
        actor: { type, id: `legacy-${type}` },
        idempotencyKey: `approval:${proposal.proposalId}:legacy-${type}`,
        payload: {
          proposalId: proposal.proposalId,
          approved: true,
          reason: "Legacy non-human approval fixture.",
          preflightHash: preflight.preflightEvent.hash,
          expiresAt: approvalExpiresAt,
        },
      });

      const execution = await harness.service.recordExecution({
        experimentId,
        proposalId: proposal.proposalId,
        source: "manual",
        brokerEventId: `legacy-direct-${type}`,
        symbol: "VTI",
        side: "buy",
        notional: 100,
        actor: { type: "broker-import", id: "manual-import" },
        occurredAt: "2026-07-21T14:03:00.000Z",
      });
      const evidence = execution.payload.evidence as {
        status: string;
        codes: string[];
        approvalHash: string | null;
        humanAuthorityEstablished: boolean;
        authorizationEstablished: boolean;
      };

      expect(evidence).toMatchObject({
        status: "policy-violation",
        codes: expect.arrayContaining(["approval-actor-not-human", "approval-missing"]),
        approvalHash: null,
        humanAuthorityEstablished: false,
        authorizationEstablished: false,
      });
      const events = await harness.service.listEvents(experimentId);
      expect(events).toHaveLength(6);
      expect(events.at(-1)).toMatchObject({
        type: "execution.recorded",
        payload: { brokerEventId: `legacy-direct-${type}` },
      });
    },
  );

  it.each(nonHumanActorTypes)(
    "returns a policy violation for a legacy %s approval through MCP and still records the execution observation",
    async (type) => {
      await harness.client.listTools();
      await createExperiment(harness.client);
      const preflightResult = await harness.client.callTool({
        name: "runbook_preflight_trade",
        arguments: { proposal, actor, occurredAt: "2026-07-21T14:01:00.000Z" },
      });
      const preflightHash = (preflightResult.structuredContent as { preflightHash: string }).preflightHash;
      await harness.ledger.append({
        experimentId,
        type: "approval.recorded",
        occurredAt: "2026-07-21T14:02:00.000Z",
        actor: { type, id: `legacy-mcp-${type}` },
        idempotencyKey: `approval:${proposal.proposalId}:legacy-mcp-${type}`,
        payload: {
          proposalId: proposal.proposalId,
          approved: true,
          reason: "Legacy MCP protocol fixture.",
          preflightHash,
          expiresAt: approvalExpiresAt,
        },
      });

      const execution = await harness.client.callTool({
        name: "runbook_record_execution",
        arguments: {
          experimentId,
          proposalId: proposal.proposalId,
          source: "manual",
          brokerEventId: `legacy-mcp-${type}`,
          symbol: "VTI",
          side: "buy",
          notional: 100,
          actor: { type: "broker-import", id: "manual-import" },
          occurredAt: "2026-07-21T14:03:00.000Z",
        },
      });

      expect(execution.isError).not.toBe(true);
      expect(execution.structuredContent).toMatchObject({
        event: { type: "execution.recorded" },
        evidence: {
          status: "policy-violation",
          codes: expect.arrayContaining(["approval-actor-not-human", "approval-missing"]),
          approvalHash: null,
          humanAuthorityEstablished: false,
          authorizationEstablished: false,
        },
      });
      expect(await harness.service.listEvents(experimentId)).toHaveLength(6);
    },
  );

  it("uses control-evidence-consistent only when approval is not required and never claims authorization", async () => {
    await harness.client.listTools();
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "No-approval synthetic control path",
        question: "Are the caller-owned control records internally consistent?",
        benchmark: "VTI",
        observationDays: 30,
        policy: { ...policy, approvalRequired: false },
        actor,
        occurredAt,
      },
    });
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: { proposal, actor, occurredAt: "2026-07-21T14:01:00.000Z" },
    });

    const execution = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        source: "manual",
        brokerEventId: "no-approval-required",
        symbol: "VTI",
        side: "buy",
        notional: 100,
        actor: { type: "broker-import", id: "manual-import" },
        occurredAt: "2026-07-21T14:02:00.000Z",
      },
    });

    expect(execution.isError).not.toBe(true);
    expect(execution.structuredContent).toMatchObject({
      evidence: {
        status: "control-evidence-consistent",
        codes: [],
        humanAuthorityEstablished: false,
        authorizationEstablished: false,
        brokerTruthEstablished: false,
      },
    });
  });

  it("appends unexplained caller-observed executions with a stable ambiguous assessment", async () => {
    await harness.client.listTools();

    const execution = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: {
        experimentId,
        proposalId: "unexplained-proposal",
        source: "manual",
        brokerEventId: "unexplained-fill",
        symbol: "VTI",
        side: "buy",
        notional: 25,
        actor: { type: "broker-import", id: "manual-import" },
        occurredAt,
      },
    });

    expect(execution.isError).not.toBe(true);
    const structured = execution.structuredContent as {
      event: { payload: { evidence: unknown } };
      evidence: { status: string; codes: string[] };
    };
    expect(structured.evidence).toMatchObject({
      status: "evidence-ambiguous",
      codes: expect.arrayContaining(["charter-missing", "preflight-missing", "proposal-missing"]),
    });
    expect(structured.event.payload.evidence).toEqual(structured.evidence);

    const events = await harness.service.listEvents(experimentId);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("execution.recorded");
  });

  it("appends policy-violating executions and lets a later denial veto prior approval", async () => {
    await harness.client.listTools();
    await createExperiment(harness.client);
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: { proposal, actor, occurredAt: "2026-07-21T14:01:00.000Z" },
    });
    await harness.client.callTool({
      name: "runbook_record_approval",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        approved: true,
        reason: "Initial approval.",
        actor,
        occurredAt: "2026-07-21T14:02:00.000Z",
        expiresAt: approvalExpiresAt,
        idempotencyKey: "approval:proposal-001:initial",
      },
    });
    await harness.client.callTool({
      name: "runbook_record_approval",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        approved: false,
        reason: "Approval withdrawn before execution.",
        actor,
        occurredAt: "2026-07-21T14:03:00.000Z",
        idempotencyKey: "approval:proposal-001:veto",
      },
    });

    const execution = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        source: "manual",
        brokerEventId: "vetoed-fill",
        symbol: "BND",
        side: "buy",
        notional: 100,
        actor: { type: "broker-import", id: "manual-import" },
        occurredAt: "2026-07-21T14:04:00.000Z",
      },
    });

    expect(execution.isError).not.toBe(true);
    expect(execution.structuredContent).toMatchObject({
      evidence: {
        status: "policy-violation",
        codes: expect.arrayContaining(["approval-denied", "execution-binding-mismatch"]),
      },
    });
    expect(await harness.service.listEvents(experimentId)).toHaveLength(7);
  });

  it("fails closed on charter drift, causal timestamp reversal, and exact-time expiry", async () => {
    await harness.client.listTools();
    await createExperiment(harness.client);
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: { proposal, actor, occurredAt: "2026-07-21T14:01:00.000Z" },
    });
    await harness.client.callTool({
      name: "runbook_record_approval",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        approved: true,
        reason: "Timestamp-hostile approval.",
        actor,
        occurredAt: "2026-07-21T13:59:00.000Z",
        expiresAt: "2026-07-21T14:05:00.000Z",
        idempotencyKey: "approval:proposal-001:time-hostile",
      },
    });
    await harness.ledger.append({
      experimentId,
      type: "charter.activated",
      occurredAt: "2026-07-21T14:03:00.000Z",
      actor,
      idempotencyKey: "charter:RUN-MCP-001:v2",
      payload: { version: "2.0", policy: { ...policy, maxOrderNotional: 110 } },
    });

    const execution = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        source: "manual",
        brokerEventId: "drifted-fill",
        symbol: "VTI",
        side: "buy",
        notional: 100,
        actor: { type: "broker-import", id: "manual-import" },
        occurredAt: "2026-07-21T14:05:00.000Z",
      },
    });

    expect(execution.isError).not.toBe(true);
    expect(execution.structuredContent).toMatchObject({
      evidence: {
        status: "policy-violation",
        codes: expect.arrayContaining([
          "approval-before-preflight",
          "approval-expired",
          "policy-changed-after-preflight",
        ]),
      },
    });
    expect(await harness.service.listEvents(experimentId)).toHaveLength(7);
  });

  it("marks conflicting source claims ambiguous without dropping either observation", async () => {
    await harness.client.listTools();
    await createExperiment(harness.client);
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: { proposal, actor, occurredAt },
    });
    await harness.client.callTool({
      name: "runbook_record_approval",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        approved: true,
        reason: "Approved for source-conflict test.",
        actor,
        occurredAt,
        expiresAt: approvalExpiresAt,
        idempotencyKey: "approval:proposal-001:source-conflict",
      },
    });
    const executionArguments = {
      experimentId,
      proposalId: proposal.proposalId,
      brokerEventId: "same-broker-event",
      symbol: "VTI",
      side: "buy",
      notional: 100,
      actor: { type: "broker-import", id: "owned-import" },
    } as const;
    const first = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: { ...executionArguments, source: "manual", occurredAt: "2026-07-21T14:01:00.000Z" },
    });
    const second = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: { ...executionArguments, source: "robinhood-csv", occurredAt: "2026-07-21T14:02:00.000Z" },
    });

    expect(first.structuredContent).toMatchObject({
      evidence: {
        status: "evidence-ambiguous",
        codes: ["human-authority-unverified"],
        humanAuthorityEstablished: false,
        authorizationEstablished: false,
      },
    });
    expect(second.structuredContent).toMatchObject({
      evidence: {
        status: "evidence-ambiguous",
        codes: ["execution-source-ambiguous", "human-authority-unverified"],
      },
    });
    expect(await harness.service.listEvents(experimentId)).toHaveLength(7);
  });

  it.each([
    {
      label: "missing legacy proposal binding",
      proposalHash: undefined,
      status: "evidence-ambiguous",
      code: "preflight-proposal-binding-missing",
    },
    {
      label: "mismatched proposal binding",
      proposalHash: "0".repeat(64),
      status: "policy-violation",
      code: "preflight-proposal-binding-mismatch",
    },
  ])("fails closed for $label while preserving the execution record", async ({ proposalHash, status, code }) => {
    await harness.client.listTools();
    await createExperiment(harness.client);
    const charter = (await harness.service.listEvents(experimentId)).find((event) => event.type === "charter.activated");
    expect(charter).toBeDefined();
    const proposalRecord = await harness.ledger.append({
      experimentId,
      type: "proposal.recorded",
      occurredAt: "2026-07-21T14:01:00.000Z",
      actor,
      idempotencyKey: "proposal:proposal-001:hostile-fixture",
      payload: proposal,
    });
    const preflight = await harness.ledger.append({
      experimentId,
      type: "preflight.completed",
      occurredAt: "2026-07-21T14:02:00.000Z",
      actor: { type: "system", id: "hostile-policy-fixture" },
      idempotencyKey: "preflight:proposal-001:hostile-fixture",
      payload: {
        proposalId: proposal.proposalId,
        result: evaluateProposal(policy, proposal),
        charterHash: charter?.hash ?? "",
        ...(proposalHash === undefined ? {} : { proposalHash }),
      },
    });
    await harness.ledger.append({
      experimentId,
      type: "approval.recorded",
      occurredAt: "2026-07-21T14:03:00.000Z",
      actor,
      idempotencyKey: "approval:proposal-001:hostile-fixture",
      payload: {
        proposalId: proposal.proposalId,
        approved: true,
        reason: "Hostile exact-binding fixture.",
        preflightHash: preflight.event.hash,
        expiresAt: approvalExpiresAt,
      },
    });

    const execution = await harness.client.callTool({
      name: "runbook_record_execution",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        source: "manual",
        brokerEventId: `binding-${status}`,
        symbol: "VTI",
        side: "buy",
        notional: 100,
        actor: { type: "broker-import", id: "manual-import" },
        occurredAt: "2026-07-21T14:04:00.000Z",
      },
    });

    expect(execution.isError).not.toBe(true);
    expect(execution.structuredContent).toMatchObject({
      evidence: { status, codes: expect.arrayContaining([code]) },
    });
    expect((execution.structuredContent as { evidence: { proposalHash: string | null } }).evidence.proposalHash)
      .toBe(proposalRecord.event.hash);
    expect(await harness.service.listEvents(experimentId)).toHaveLength(6);
  });

  it("never echoes caller identifiers or raw local errors through MCP tool failures", async () => {
    await harness.client.listTools();
    const privateMarker = "private-caller-marker-9462";

    const failure = await harness.client.callTool({
      name: "runbook_record_approval",
      arguments: {
        experimentId,
        proposalId: privateMarker,
        approved: false,
        reason: "No preflight exists.",
        actor,
        occurredAt,
        idempotencyKey: "approval:missing-preflight",
      },
    });

    expect(failure.isError).toBe(true);
    expect(failure.content[0]).toEqual({
      type: "text",
      text: "Approval rejected: no matching preflight evidence exists.",
    });
    expect(parseToolErrorContent(failure as { content?: Array<{ type: string; text?: string }> })).toMatchObject({
      schemaVersion: "runbook.mcp-error.v1",
      code: "preflight.not-found",
      brokerEffect: false,
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toContain(privateMarker);
    expect(await harness.service.listEvents()).toHaveLength(0);

    harness.service.verify = async () => ({
      valid: false,
      eventCount: 0,
      headHash: "0".repeat(64),
      errors: [`/Users/private/path/${privateMarker} raw-verifier-detail`],
    });
    const invalidVerification = await harness.client.callTool({
      name: "runbook_verify_ledger",
      arguments: {},
    });
    expect(invalidVerification.isError).not.toBe(true);
    expect(invalidVerification.structuredContent).toMatchObject({
      valid: false,
      errors: ["ledger-verification-failed"],
    });
    expect(JSON.stringify(invalidVerification)).not.toContain(privateMarker);

    harness.service.verify = async () => {
      throw new Error(`/Users/private/path/${privateMarker} raw-internal-detail`);
    };
    const internalFailure = await harness.client.callTool({
      name: "runbook_verify_ledger",
      arguments: {},
    });
    expect(internalFailure.isError).toBe(true);
    expect(internalFailure.content[0]).toEqual({
      type: "text",
      text: "Runbook tool failed safely. Review local server logs.",
    });
    expect(parseToolErrorContent(internalFailure as { content?: Array<{ type: string; text?: string }> })).toMatchObject({
      schemaVersion: "runbook.mcp-error.v1",
      code: "tool.failed-safely",
      brokerEffect: false,
    });
    expect(JSON.stringify(internalFailure)).not.toContain(privateMarker);
  });

  it("returns input validation failures as MCP tool errors without writing events", async () => {
    await harness.client.listTools();

    const invalid = await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Invalid experiment",
        question: "Should not be written",
        benchmark: "VTI",
        observationDays: 0,
        policy,
        actor,
        occurredAt,
      },
    });

    expect(invalid.isError).toBe(true);
    expect(invalid.content).toEqual([
      expect.objectContaining({ type: "text" }),
    ]);

    const verification = await harness.client.callTool({
      name: "runbook_verify_ledger",
      arguments: {},
    });
    expect(verification.structuredContent).toMatchObject({
      valid: true,
      eventCount: 0,
    });
  });

  it("surfaces a rejected approval as an MCP tool error", async () => {
    await harness.client.listTools();
    await createExperiment(harness.client);

    const deniedPreflight = await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: { ...proposal, symbol: "GME" },
        actor,
        occurredAt,
      },
    });
    expect(deniedPreflight.structuredContent).toMatchObject({ allowed: false });

    const approval = await harness.client.callTool({
      name: "runbook_record_approval",
      arguments: {
        experimentId,
        proposalId: proposal.proposalId,
        approved: true,
        reason: "Attempted override",
        actor,
        occurredAt,
        idempotencyKey: "approval:proposal-001:override",
      },
    });

    expect(approval.isError).toBe(true);
    expect(approval.structuredContent).toBeUndefined();
    expect(approval.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("failed a hard policy control"),
      }),
    );
    expect(parseToolErrorContent(approval as { content?: Array<{ type: string; text?: string }> })).toMatchObject({
      code: "approval.hard-control-failed",
      brokerEffect: false,
    });
  });
});
