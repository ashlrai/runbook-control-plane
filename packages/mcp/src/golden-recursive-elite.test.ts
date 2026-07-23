/**
 * Golden recursive elite loop — freezes the full self-improvement protocol:
 * inventory → weak curriculum → improve to fixed point → optional tournament →
 * experiment + clean/denied preflights → agent_eval processCorrect → expand →
 * re-improve if candidates. Never place_*; never returns claims.
 *
 * Protocol-level (InMemory MCP client), same style as golden-shadow-pilot / shadow-tools.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import type { RiskPolicy } from "@runbook/engine/schema";
import { WEAK_STARTER_POLICY } from "@runbook/shadow-lab";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROMPT_NAMES } from "./prompts.js";
import { STATIC_RESOURCE_URIS } from "./resources.js";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";
import { TOOL_NAMES } from "./surface.js";

const PLAYBOOK_URI = "runbook://playbooks/recursive-elite-process";
const ELITE_PROMPT = "runbook_elite_recursive_loop";
const experimentId = "RUN-ELITE-GOLDEN-001";
const actor = { type: "agent" as const, id: "elite-golden-agent" };
const occurredAt = "2026-07-22T19:00:00.000Z";

const SHADOW_TOOL_NAMES = [
  "runbook_run_shadow_curriculum",
  "runbook_improve_charter",
  "runbook_shadow_tournament",
  "runbook_activate_refined_charter",
  "runbook_agent_eval",
  "runbook_expand_curriculum_from_ledger",
] as const;

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-mcp-elite-golden-"));
  const ledger = new FileLedger(directory, "elite-golden");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service);
  const client = new Client({ name: "runbook-elite-golden", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, directory, server, service };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as Record<string, unknown>;
}

describe("golden recursive elite loop", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.client.close();
    await harness.server.close();
    await rm(harness.directory, { recursive: true, force: true });
  });

  it("freezes the full self-improvement loop (process quality only)", async () => {
    // --- 1. list_surface / inventory: shadow tools present; no place_* ---
    const listed = await harness.client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([...SHADOW_TOOL_NAMES]));
    expect(toolNames).toEqual(expect.arrayContaining([...TOOL_NAMES]));
    expect(toolNames.some((name) => name.startsWith("place_"))).toBe(false);
    expect(toolNames.some((name) => name.startsWith("cancel_"))).toBe(false);
    expect(listed.tools.every((tool) => tool.annotations?.openWorldHint === false)).toBe(true);

    const surface = await harness.client.callTool({
      name: "runbook_list_surface",
      arguments: {},
    });
    expect(surface.isError).not.toBe(true);
    expect(structured(surface)).toMatchObject({
      schemaVersion: "runbook.surface-inventory.v1",
      brokerExecutionTools: [],
      openWorldHint: false,
    });
    expect(structured(surface).resourceUris as string[]).toContain(PLAYBOOK_URI);
    expect(structured(surface).prompts as string[]).toContain(ELITE_PROMPT);

    // Discovery: playbook resource + elite prompt
    const resources = await harness.client.listResources();
    const resourceUris = resources.resources.map((r) => r.uri);
    expect(resourceUris).toContain(PLAYBOOK_URI);
    expect(STATIC_RESOURCE_URIS).toContain(PLAYBOOK_URI);

    const playbook = await harness.client.readResource({ uri: PLAYBOOK_URI });
    const playbookText = playbook.contents
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
    expect(playbookText).toMatch(/list_surface/i);
    expect(playbookText).toMatch(/improve_charter/i);
    expect(playbookText).toMatch(/agent_eval/i);
    expect(playbookText).toMatch(/expand_curriculum_from_ledger/i);
    expect(playbookText).toMatch(/NEVER broker/i);
    expect(playbookText).toMatch(/NEVER returns claims/i);
    expect(playbookText).not.toMatch(/place_equity_order/);

    const prompts = await harness.client.listPrompts();
    const promptNames = prompts.prompts.map((p) => p.name);
    expect(promptNames).toContain(ELITE_PROMPT);
    expect(PROMPT_NAMES).toContain(ELITE_PROMPT);

    const elitePrompt = await harness.client.getPrompt({
      name: ELITE_PROMPT,
      arguments: { experimentId, maxGenerations: "8", runTournament: "true" },
    });
    const promptText = elitePrompt.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");
    expect(promptText).toContain(PLAYBOOK_URI);
    expect(promptText).toMatch(/runbook_run_shadow_curriculum/);
    expect(promptText).toMatch(/runbook_improve_charter/);
    expect(promptText).toMatch(/runbook_agent_eval/);
    expect(promptText).toMatch(/NEVER broker/i);
    expect(promptText).toMatch(/NEVER returns/i);
    expect(promptText).toContain(experimentId);

    // --- 2. Curriculum on weak policy → HFA > 0 ---
    const weakCurriculum = await harness.client.callTool({
      name: "runbook_run_shadow_curriculum",
      arguments: { policy: WEAK_STARTER_POLICY },
    });
    expect(weakCurriculum.isError).not.toBe(true);
    expect(structured(weakCurriculum)).toMatchObject({
      schemaVersion: "runbook.shadow-curriculum-report.v1",
      policySource: "override",
      compositeScore: false,
      brokerEffect: false,
      notTradingPerformance: true,
      assurance: "synthetic-curriculum-process-quality-only",
    });
    const weakHfa = structured(weakCurriculum).hardFalseAllows as number;
    expect(weakHfa).toBeGreaterThan(0);

    // --- 3. improve_charter → final HFA = 0 ---
    const improve = await harness.client.callTool({
      name: "runbook_improve_charter",
      arguments: { policy: WEAK_STARTER_POLICY, maxGenerations: 8 },
    });
    expect(improve.isError).not.toBe(true);
    const improveBody = structured(improve);
    expect(improveBody).toMatchObject({
      schemaVersion: "runbook.shadow-recursive-improvement.v1",
      policySource: "override",
      activatedOnLedger: false,
      compositeScore: false,
      brokerEffect: false,
      notTradingPerformance: true,
      notCapitalAllocation: true,
    });
    expect(improveBody.initialHardFalseAllows as number).toBe(weakHfa);
    expect(improveBody.finalHardFalseAllows).toBe(0);
    expect((improveBody.generations as unknown[]).length).toBeGreaterThan(0);

    const finalPolicy = improveBody.finalPolicy as RiskPolicy;
    expect(finalPolicy.approvalRequired).toBe(true);
    expect(finalPolicy.allowedInstruments).toEqual(["equity"]);

    // Re-eval refined policy (fixed-point check)
    const eliteCurriculum = await harness.client.callTool({
      name: "runbook_run_shadow_curriculum",
      arguments: { policy: finalPolicy },
    });
    expect(eliteCurriculum.isError).not.toBe(true);
    expect(structured(eliteCurriculum).hardFalseAllows).toBe(0);

    // Improve must not write ledger before create
    expect(await harness.service.listEvents()).toHaveLength(0);

    // --- 4. Optional tournament returns schema ---
    const tournament = await harness.client.callTool({
      name: "runbook_shadow_tournament",
      arguments: { maxGenerations: 3, mutantCount: 2, seed: 7 },
    });
    expect(tournament.isError).not.toBe(true);
    const tournamentBody = structured(tournament);
    expect(tournamentBody).toMatchObject({
      schemaVersion: "runbook.shadow-tournament.v1",
      capital: 0,
      compositeScore: false,
      brokerEffect: false,
      notTradingPerformance: true,
      assurance: "synthetic-curriculum-process-quality-only",
    });
    expect(tournamentBody.paretoCount as number).toBeGreaterThanOrEqual(1);
    expect((tournamentBody.paretoFront as unknown[]).length).toBe(tournamentBody.paretoCount);

    // --- 5. Create experiment with refined policy ---
    const created = await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Golden recursive elite loop",
        question: "Does the elite recursive loop freeze processCorrect on refined charter?",
        benchmark: "VTI",
        observationDays: 30,
        policy: finalPolicy,
        actor,
        occurredAt,
      },
    });
    expect(created.isError).not.toBe(true);

    // --- 6. Synthetic preflights: clean + denied ---
    const clean = await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: {
          proposalId: "elite-golden-clean-001",
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
        },
        actor,
        occurredAt: "2026-07-22T19:01:00.000Z",
      },
    });
    expect(clean.isError).not.toBe(true);
    expect(structured(clean).allowed).toBe(true);

    const deniedSymbol = await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: {
          proposalId: "elite-golden-denied-gme-001",
          experimentId,
          symbol: "GME",
          instrument: "equity",
          side: "buy",
          notional: 50,
          projectedPositionNotional: 50,
          dailyTradesAfter: 1,
          currentDrawdownPercent: 0.5,
          hasThesis: true,
          hasInvalidation: true,
          evidenceSourceCount: 2,
        },
        actor,
        occurredAt: "2026-07-22T19:02:00.000Z",
      },
    });
    expect(deniedSymbol.isError).not.toBe(true);
    expect(structured(deniedSymbol).allowed).toBe(false);

    const deniedInstrument = await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: {
          proposalId: "elite-golden-denied-option-001",
          experimentId,
          symbol: "SPY",
          instrument: "option",
          side: "buy",
          notional: 50,
          projectedPositionNotional: 50,
          dailyTradesAfter: 1,
          currentDrawdownPercent: 0.5,
          hasThesis: true,
          hasInvalidation: true,
          evidenceSourceCount: 2,
        },
        actor,
        occurredAt: "2026-07-22T19:03:00.000Z",
      },
    });
    expect(deniedInstrument.isError).not.toBe(true);
    expect(structured(deniedInstrument).allowed).toBe(false);

    // --- 7. agent_eval processCorrect true ---
    const agentEval = await harness.client.callTool({
      name: "runbook_agent_eval",
      arguments: { experimentId },
    });
    expect(agentEval.isError).not.toBe(true);
    const evalBody = structured(agentEval);
    expect(evalBody).toMatchObject({
      schemaVersion: "runbook.agent-eval.v1",
      experimentId,
      processCorrect: true,
      compositeScore: false,
      notTradingPerformance: true,
      notPnL: true,
      brokerEffect: false,
      assurance: "process-observation-only",
    });
    expect(evalBody.hardFalseAllowStyle).toMatchObject({ totalSuspectAllows: 0 });
    expect(evalBody.summaryAxes).toMatchObject({
      charterPresent: true,
      approvalRequired: true,
      equitiesOnly: true,
      unauthorizedExecutionAttempts: 0,
      deniedSymbolAllowed: 0,
    });
    const axesJson = JSON.stringify(evalBody.axes);
    expect(axesJson).not.toMatch(/sharpe|alpha|portfolio.?return|pnl/i);

    // --- 8. expand_curriculum_from_ledger (does not mutate) ---
    const beforeExpand = (await harness.service.listEvents(experimentId)).length;
    const expand = await harness.client.callTool({
      name: "runbook_expand_curriculum_from_ledger",
      arguments: { experimentId },
    });
    expect(expand.isError).not.toBe(true);
    const expandBody = structured(expand);
    expect(expandBody).toMatchObject({
      schemaVersion: "runbook.meta-curriculum.v1",
      experimentId,
      brokerEffect: false,
      ledgerMutated: false,
      notMarketTruth: true,
      notTradingPerformance: true,
      compositeScore: false,
      assurance: "ledger-derived-synthetic-process-labels-only",
    });
    expect(expandBody.candidateCount as number).toBeGreaterThanOrEqual(1);
    expect((await harness.service.listEvents(experimentId)).length).toBe(beforeExpand);

    // --- 9. Re-improve if new candidates (ledger charter; still HFA 0) ---
    if ((expandBody.candidateCount as number) > 0) {
      const reImprove = await harness.client.callTool({
        name: "runbook_improve_charter",
        arguments: { experimentId, maxGenerations: 4 },
      });
      expect(reImprove.isError).not.toBe(true);
      expect(structured(reImprove)).toMatchObject({
        schemaVersion: "runbook.shadow-recursive-improvement.v1",
        policySource: "ledger-active-charter",
        finalHardFalseAllows: 0,
        activatedOnLedger: false,
        brokerEffect: false,
        notTradingPerformance: true,
      });
    }

    // --- 10. NEVER broker / never returns: inventory + claim flags ---
    expect(structured(surface).brokerExecutionTools).toEqual([]);
    expect(toolNames.some((name) => /place_|cancel_/.test(name))).toBe(false);
    expect(evalBody.notTradingPerformance).toBe(true);
    expect(evalBody.notPnL).toBe(true);
    expect(evalBody.compositeScore).toBe(false);
    expect(improveBody.notCapitalAllocation).toBe(true);
  });
});
