import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import type { RiskPolicy, TradeProposal } from "@runbook/engine/schema";
import { WEAK_STARTER_POLICY } from "@runbook/shadow-lab";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseToolErrorContent } from "./protocol.js";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";

const occurredAt = "2026-07-22T16:00:00.000Z";
const experimentId = "RUN-SHADOW-IMPROVE-001";
const actor = { type: "agent" as const, id: "shadow-agent" };

const elitePolicy: RiskPolicy = {
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
  proposalId: "shadow-eval-proposal-001",
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
  const directory = await mkdtemp(join(tmpdir(), "runbook-mcp-shadow-"));
  const ledger = new FileLedger(directory, "shadow-test");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service);
  const client = new Client({ name: "runbook-shadow-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, directory, ledger, server, service };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as Record<string, unknown>;
}

describe("shadow self-improvement MCP tools", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.client.close();
    await harness.server.close();
    await rm(harness.directory, { recursive: true, force: true });
  });

  it("advertises shadow tools as closed-world with correct read-only hints", async () => {
    const listed = await harness.client.listTools();
    const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "runbook_run_shadow_curriculum",
      "runbook_improve_charter",
      "runbook_agent_eval",
      "runbook_shadow_tournament",
      "runbook_expand_curriculum_from_ledger",
    ]) {
      expect(byName[name]?.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      });
    }
    expect(byName.runbook_activate_refined_charter?.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("runs curriculum against reference elite policy by default", async () => {
    const result = await harness.client.callTool({
      name: "runbook_run_shadow_curriculum",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(structured(result)).toMatchObject({
      schemaVersion: "runbook.shadow-curriculum-report.v1",
      policySource: "reference-elite",
      hardFalseAllows: 0,
      compositeScore: false,
      brokerEffect: false,
      notTradingPerformance: true,
      assurance: "synthetic-curriculum-process-quality-only",
    });
    expect(structured(result).scenarioCount as number).toBeGreaterThanOrEqual(12);
  });

  it("runs multi-charter tournament and returns a non-empty Pareto front", async () => {
    const result = await harness.client.callTool({
      name: "runbook_shadow_tournament",
      arguments: { maxGenerations: 3, mutantCount: 2, seed: 11 },
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body).toMatchObject({
      schemaVersion: "runbook.shadow-tournament.v1",
      capital: 0,
      compositeScore: false,
      brokerEffect: false,
      notTradingPerformance: true,
      assurance: "synthetic-curriculum-process-quality-only",
    });
    expect(body.paretoCount as number).toBeGreaterThanOrEqual(1);
    expect((body.paretoFront as unknown[]).length).toBe(body.paretoCount);
    expect(body.candidateCount as number).toBe(4);
  });

  it("scores a weak policy with hardFalseAllows and improves it offline", async () => {
    const before = await harness.client.callTool({
      name: "runbook_run_shadow_curriculum",
      arguments: { policy: WEAK_STARTER_POLICY },
    });
    expect(before.isError).not.toBe(true);
    expect(structured(before).policySource).toBe("override");
    expect(structured(before).hardFalseAllows as number).toBeGreaterThan(0);
    expect(structured(before).sessionUpdated).toBe(false);

    const improve = await harness.client.callTool({
      name: "runbook_improve_charter",
      arguments: { policy: WEAK_STARTER_POLICY, maxGenerations: 6 },
    });
    expect(improve.isError).not.toBe(true);
    const body = structured(improve);
    expect(body).toMatchObject({
      schemaVersion: "runbook.shadow-recursive-improvement.v1",
      policySource: "override",
      activatedOnLedger: false,
      sessionUpdated: false,
      sessionCharterSet: false,
      compositeScore: false,
      brokerEffect: false,
      notTradingPerformance: true,
      notCapitalAllocation: true,
    });
    expect(body.finalHardFalseAllows as number).toBeLessThan(body.initialHardFalseAllows as number);
    expect(body.finalHardFalseAllows).toBe(0);
    expect((body.generations as unknown[]).length).toBeGreaterThan(0);
    expect((body.finalPolicy as RiskPolicy).approvalRequired).toBe(true);
    expect((body.finalPolicy as RiskPolicy).allowedInstruments).toEqual(["equity"]);

    // Improve must not write the ledger.
    const events = await harness.service.listEvents();
    expect(events).toHaveLength(0);
  });

  it("binds shadow curriculum and improve results to a control-plane session", async () => {
    // Harness server was created without dataDir; re-bind tools via a dataDir-aware server.
    await harness.client.close();
    await harness.server.close();
    const { createRunbookServer } = await import("./server-factory.js");
    const server = createRunbookServer(harness.service, { dataDir: harness.directory });
    const client = new Client({ name: "runbook-shadow-session-bind", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    harness.client = client;
    harness.server = server;

    await client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-SHADOW-BIND",
        label: "Shadow bind test",
        policy: WEAK_STARTER_POLICY,
      },
    });

    const curriculum = await client.callTool({
      name: "runbook_run_shadow_curriculum",
      arguments: { policy: WEAK_STARTER_POLICY, sessionId: "CPS-SHADOW-BIND" },
    });
    expect(curriculum.isError).not.toBe(true);
    expect(structured(curriculum)).toMatchObject({
      sessionId: "CPS-SHADOW-BIND",
      sessionUpdated: true,
      brokerEffect: false,
    });
    expect(structured(curriculum).hardFalseAllows as number).toBeGreaterThan(0);

    const improve = await client.callTool({
      name: "runbook_improve_charter",
      arguments: {
        policy: WEAK_STARTER_POLICY,
        maxGenerations: 6,
        sessionId: "CPS-SHADOW-BIND",
      },
    });
    expect(improve.isError).not.toBe(true);
    expect(structured(improve)).toMatchObject({
      sessionId: "CPS-SHADOW-BIND",
      sessionUpdated: true,
      sessionCharterSet: true,
      finalHardFalseAllows: 0,
      brokerEffect: false,
    });

    const got = await client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: "CPS-SHADOW-BIND" },
    });
    expect(got.isError).not.toBe(true);
    const session = structured(got).session as {
      lastShadowHardFalseAllows?: number;
      notes: string[];
      charter?: RiskPolicy;
      shadowGenerations: unknown[];
    };
    expect(session.lastShadowHardFalseAllows).toBe(0);
    expect(session.shadowGenerations.length).toBeGreaterThanOrEqual(1);
    expect(session.notes.some((n) => n.includes("shadow-curriculum"))).toBe(true);
    expect(session.charter?.approvalRequired).toBe(true);
  });

  it("loads active charter policy from the ledger when experimentId is provided", async () => {
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Shadow improve experiment",
        question: "Can process quality improve offline?",
        benchmark: "VTI",
        observationDays: 30,
        policy: elitePolicy,
        actor,
        occurredAt,
      },
    });

    const result = await harness.client.callTool({
      name: "runbook_run_shadow_curriculum",
      arguments: { experimentId },
    });
    expect(result.isError).not.toBe(true);
    expect(structured(result)).toMatchObject({
      policySource: "ledger-active-charter",
      hardFalseAllows: 0,
      brokerEffect: false,
    });
  });

  it("activates a refined charter as a new charter.activated version", async () => {
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Shadow activate experiment",
        question: "Can refined charters activate safely?",
        benchmark: "VTI",
        observationDays: 30,
        policy: WEAK_STARTER_POLICY,
        actor,
        occurredAt,
      },
    });

    const improve = await harness.client.callTool({
      name: "runbook_improve_charter",
      arguments: { experimentId, maxGenerations: 5 },
    });
    expect(improve.isError).not.toBe(true);
    const finalPolicy = structured(improve).finalPolicy as RiskPolicy;

    const activate = await harness.client.callTool({
      name: "runbook_activate_refined_charter",
      arguments: {
        experimentId,
        policy: finalPolicy,
        actor,
        occurredAt: "2026-07-22T16:05:00.000Z",
        source: "shadow-refinement",
      },
    });
    expect(activate.isError).not.toBe(true);
    expect(structured(activate)).toMatchObject({
      experimentId,
      version: "2.0",
      brokerEffect: false,
      assurance: "local-ledger-write",
    });
    expect(typeof structured(activate).charterHash).toBe("string");

    const charter = await harness.service.getActiveCharter(experimentId);
    expect(charter.version).toBe("2.0");
    expect(charter.policy.approvalRequired).toBe(true);

    // Same policy already active → no new version (idempotent short-circuit)
    const again = await harness.client.callTool({
      name: "runbook_activate_refined_charter",
      arguments: {
        experimentId,
        policy: finalPolicy,
        actor,
        occurredAt: "2026-07-22T16:05:00.000Z",
        source: "shadow-refinement",
      },
    });
    expect(again.isError).not.toBe(true);
    expect(structured(again).version).toBe("2.0");
    expect(structured(again).charterHash).toBe(structured(activate).charterHash);
    const charters = (await harness.service.listEvents(experimentId)).filter(
      (event) => event.type === "charter.activated",
    );
    expect(charters).toHaveLength(2);
  });

  it("returns charter.not-found for activate without experiment", async () => {
    const result = await harness.client.callTool({
      name: "runbook_activate_refined_charter",
      arguments: {
        experimentId: "MISSING-EXPERIMENT",
        policy: elitePolicy,
        actor,
        occurredAt,
      },
    });
    expect(result.isError).toBe(true);
    const err = parseToolErrorContent(result);
    expect(err?.code).toBe("charter.not-found");
    expect(err?.brokerEffect).toBe(false);
  });

  it("evaluates agent process quality without inventing PnL or composite scores", async () => {
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Agent eval experiment",
        question: "Is process quality multi-axis?",
        benchmark: "VTI",
        observationDays: 30,
        policy: elitePolicy,
        actor,
        occurredAt,
      },
    });
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: { proposal, actor, occurredAt: "2026-07-22T16:01:00.000Z" },
    });

    const result = await harness.client.callTool({
      name: "runbook_agent_eval",
      arguments: { experimentId },
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body).toMatchObject({
      schemaVersion: "runbook.agent-eval.v1",
      experimentId,
      processCorrect: true,
      compositeScore: false,
      notTradingPerformance: true,
      notPnL: true,
      brokerEffect: false,
      assurance: "process-observation-only",
    });
    expect(body.hardFalseAllowStyle).toMatchObject({ totalSuspectAllows: 0 });
    expect(body.summaryAxes).toMatchObject({
      charterPresent: true,
      approvalRequired: true,
      equitiesOnly: true,
      preflightCoverage: { proposals: 1, withPairedPreflight: 1 },
      unauthorizedExecutionAttempts: 0,
      deniedSymbolAllowed: 0,
    });
    const axes = body.axes as Array<{ id: string; passed: boolean }>;
    expect(axes.some((a) => a.id === "charter.approval-required" && a.passed)).toBe(true);
    expect(axes.some((a) => a.id === "charter.equities-only-preferred" && a.passed)).toBe(true);
    expect(axes.some((a) => a.id === "process.every-proposal-preflighted" && a.passed)).toBe(true);
    // Process quality only — no trading performance claims in axis ids/labels.
    const axesJson = JSON.stringify(body.axes);
    expect(axesJson).not.toMatch(/sharpe|alpha|portfolio.?return/i);
    expect(body.notPnL).toBe(true);
    expect(body.notTradingPerformance).toBe(true);
  });

  it("flags agent process failures when proposals lack preflight", async () => {
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Agent eval incomplete",
        question: "Detect missing preflight?",
        benchmark: "VTI",
        observationDays: 30,
        policy: elitePolicy,
        actor,
        occurredAt,
      },
    });
    // Direct ledger proposal without preflight
    await harness.ledger.append({
      experimentId,
      type: "proposal.recorded",
      occurredAt: "2026-07-22T16:02:00.000Z",
      actor,
      idempotencyKey: "proposal:orphan-001",
      payload: proposal,
    });

    const result = await harness.client.callTool({
      name: "runbook_agent_eval",
      arguments: { experimentId },
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body.processCorrect).toBe(false);
    expect((body.counts as { proposalsMissingPreflight: number }).proposalsMissingPreflight).toBe(1);
  });

  it("expands curriculum from ledger preflight failures offline without mutating ledger", async () => {
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Meta curriculum experiment",
        question: "Can ledger failures seed synthetic curriculum?",
        benchmark: "VTI",
        observationDays: 30,
        policy: elitePolicy,
        actor,
        occurredAt,
      },
    });

    // Hard-denied options proposal
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: {
          ...proposal,
          proposalId: "meta-opt-001",
          symbol: "SPY",
          instrument: "option",
          notional: 40,
          projectedPositionNotional: 40,
        },
        actor,
        occurredAt: "2026-07-22T16:01:00.000Z",
      },
    });
    // Hard-denied GME (charter denylist)
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: {
          ...proposal,
          proposalId: "meta-gme-001",
          symbol: "GME",
          instrument: "equity",
          notional: 40,
          projectedPositionNotional: 40,
        },
        actor,
        occurredAt: "2026-07-22T16:02:00.000Z",
      },
    });

    const beforeCount = (await harness.service.listEvents(experimentId)).length;
    const result = await harness.client.callTool({
      name: "runbook_expand_curriculum_from_ledger",
      arguments: { experimentId },
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body).toMatchObject({
      schemaVersion: "runbook.meta-curriculum.v1",
      experimentId,
      brokerEffect: false,
      ledgerMutated: false,
      notMarketTruth: true,
      notTradingPerformance: true,
      compositeScore: false,
      assurance: "ledger-derived-synthetic-process-labels-only",
    });
    expect(body.candidateCount as number).toBeGreaterThanOrEqual(2);
    expect(body.mergedCount as number).toBeGreaterThanOrEqual(body.baseCount as number);
    expect((body.candidates as unknown[]).length).toBe(body.candidateCount);
    expect((body.sample as unknown[]).length).toBeGreaterThan(0);
    expect(body.limitations).toEqual(
      expect.arrayContaining([
        "ledger-derived-labels-are-synthetic-process-labels-not-market-truth",
      ]),
    );

    // Offline analysis must not append ledger events.
    const afterCount = (await harness.service.listEvents(experimentId)).length;
    expect(afterCount).toBe(beforeCount);
  });

  it("exposes recursive improve prompt and demo resource", async () => {
    const prompts = await harness.client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("runbook_recursive_improve");

    const prompt = await harness.client.getPrompt({
      name: "runbook_recursive_improve",
      arguments: { experimentId, maxGenerations: "4" },
    });
    const text = prompt.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");
    expect(text).toMatch(/runbook_run_shadow_curriculum/);
    expect(text).toMatch(/runbook_improve_charter/);
    expect(text).toMatch(/fixed point/i);
    expect(text).toMatch(/never claim returns/i);
    expect(text).toContain(experimentId);

    const resource = await harness.client.readResource({
      uri: "runbook://demos/shadow-self-improve",
    });
    const resourceText = resource.contents.map((part) => ("text" in part ? part.text : "")).join("");
    expect(resourceText).toMatch(/recursive/i);
    expect(resourceText).toMatch(/not trading performance/i);
    expect(resourceText).toMatch(/runbook_activate_refined_charter/);
  });
});
