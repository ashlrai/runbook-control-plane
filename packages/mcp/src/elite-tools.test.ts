import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import type { RiskPolicy } from "@runbook/engine/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";
import { TOOL_NAMES } from "./surface.js";

const SAMPLE_TOOLS_LIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../examples/sample-tools-list.json",
);

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

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-mcp-elite-"));
  const ledger = new FileLedger(directory, "elite-test");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service, { dataDir: directory });
  const client = new Client({ name: "runbook-elite-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, directory, ledger, server, service };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as Record<string, unknown>;
}

describe("elite wave MCP tools", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.client.close();
    await harness.server.close();
    await rm(harness.directory, { recursive: true, force: true });
  });

  it("surface lock receipt toolCount matches TOOL_NAMES length, hasPlaceOrCancel false, version 0.4.3", async () => {
    const result = await harness.client.callTool({
      name: "runbook_surface_lock_receipt",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body).toMatchObject({
      schemaVersion: "runbook.surface-lock-receipt.v1",
      serverName: "runbook",
      serverVersion: "0.4.3",
      toolCount: TOOL_NAMES.length,
      hasPlaceOrCancelTools: false,
      openWorldHint: false,
      brokerEffect: false,
      compositeScore: false,
    });
    expect(body.brokerExecutionTools).toEqual([]);
    expect(String(body.toolSetSha256)).toHaveLength(64);
    expect(TOOL_NAMES.length).toBe(42);
    expect(TOOL_NAMES).toContain("runbook_session_attach_surface_lock");
    expect(TOOL_NAMES).toContain("runbook_gateway_quorum_demo");
  });

  it("attach_surface_lock attaches operator-note with toolSetSha256 evidenceRef", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-ATTACH-LOCK-001",
        label: "Attach surface lock test",
      },
    });

    const lock = await harness.client.callTool({
      name: "runbook_surface_lock_receipt",
      arguments: {},
    });
    expect(lock.isError).not.toBe(true);
    const lockBody = structured(lock);
    const toolSetSha256 = String(lockBody.toolSetSha256);

    const attached = await harness.client.callTool({
      name: "runbook_session_attach_surface_lock",
      arguments: { sessionId: "CPS-ATTACH-LOCK-001" },
    });
    expect(attached.isError).not.toBe(true);
    const body = structured(attached);
    expect(body).toMatchObject({
      schemaVersion: "runbook.session-attach-surface-lock.v1",
      sessionId: "CPS-ATTACH-LOCK-001",
      toolCount: TOOL_NAMES.length,
      serverVersion: "0.4.3",
      toolSetSha256,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(Number(body.attachmentCount)).toBeGreaterThanOrEqual(1);
    expect(typeof body.attachmentId).toBe("string");
    expect(String(body.message).length).toBeGreaterThan(8);

    const got = await harness.client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: "CPS-ATTACH-LOCK-001" },
    });
    expect(got.isError).not.toBe(true);
    const session = structured(got).session as {
      dossierAttachments?: Array<{
        kind: string;
        summary: string;
        evidenceRef?: string;
        attachmentId: string;
      }>;
      notes?: string[];
    };
    const attachments = session.dossierAttachments ?? [];
    const note = attachments.find((a) => a.attachmentId === body.attachmentId);
    expect(note).toBeDefined();
    expect(note?.kind).toBe("operator-note");
    expect(note?.evidenceRef).toBe(toolSetSha256);
    expect(note?.summary).toContain(`toolCount=${TOOL_NAMES.length}`);
    expect(note?.summary).toContain("version=0.4.3");
    expect(note?.summary).toContain(toolSetSha256);
    expect(session.notes?.some((n) => n.includes("attach_surface_lock"))).toBe(true);
  });

  it("process_tick stop on unknown tool with fail-closed pin", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-TICK-001",
        label: "Process tick fail-closed",
        inventoryEnforcement: "fail-closed",
      },
    });
    await harness.client.callTool({
      name: "runbook_session_pin_inventory",
      arguments: { sessionId: "CPS-TICK-001", pinPreset: "public-docs-full" },
    });

    const tick = await harness.client.callTool({
      name: "runbook_process_tick",
      arguments: {
        sessionId: "CPS-TICK-001",
        observedToolNames: ["get_accounts", "place_crypto_order_unknown"],
      },
    });
    expect(tick.isError).not.toBe(true);
    expect(structured(tick)).toMatchObject({
      schemaVersion: "runbook.process-tick.v1",
      recommendation: "stop",
      inventoryOk: false,
      processDeniedBySession: false,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
      sessionId: "CPS-TICK-001",
    });
    expect(structured(tick).inventoryUnknownTools as string[]).toContain(
      "place_crypto_order_unknown",
    );
  });

  it("drift_sentinel fail-closed on sample with place_crypto_order_unknown", async () => {
    const toolsListJson = await readFile(SAMPLE_TOOLS_LIST_PATH, "utf8");

    const result = await harness.client.callTool({
      name: "runbook_drift_sentinel",
      arguments: {
        toolsListJson,
        usePublicDocsPin: true,
        enforcement: "fail-closed",
      },
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body).toMatchObject({
      schemaVersion: "runbook.drift-sentinel-receipt.v1",
      ok: false,
      brokerEffect: false,
      compositeScore: false,
    });
    expect(body.unknownTools as string[]).toContain("place_crypto_order_unknown");
  });

  it("session seal capsule returns capsuleId + archiveBase64 (session with charter)", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-SEAL-001",
        label: "Seal capsule test",
        policy: elitePolicy,
      },
    });
    await harness.client.callTool({
      name: "runbook_session_pin_inventory",
      arguments: {
        sessionId: "CPS-SEAL-001",
        pinPreset: "observation-only",
      },
    });

    const sealed = await harness.client.callTool({
      name: "runbook_session_seal_capsule",
      arguments: { sessionId: "CPS-SEAL-001" },
    });
    expect(sealed.isError).not.toBe(true);
    const body = structured(sealed);
    expect(body).toMatchObject({
      schemaVersion: "runbook.session-seal-capsule.v1",
      dataClass: "synthetic",
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(typeof body.capsuleId).toBe("string");
    expect(String(body.capsuleId).length).toBeGreaterThan(8);
    expect(typeof body.archiveBase64).toBe("string");
    expect(String(body.archiveBase64).length).toBeGreaterThan(32);
    expect(String(body.archiveSha256)).toHaveLength(64);
    expect(String(body.experimentId)).toMatch(/^CPS-SEAL-/);
  });

  it("clone challenge creates child session with mutated charter", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-CLONE-PARENT",
        label: "Clone challenge parent",
        policy: elitePolicy,
      },
    });

    const cloned = await harness.client.callTool({
      name: "runbook_session_clone_challenge",
      arguments: {
        sessionId: "CPS-CLONE-PARENT",
        mutationId: "lower-max-order-notional",
      },
    });
    expect(cloned.isError).not.toBe(true);
    const body = structured(cloned);
    expect(body).toMatchObject({
      schemaVersion: "runbook.clone-challenge.v1",
      parentSessionId: "CPS-CLONE-PARENT",
      mutationId: "lower-max-order-notional",
      notTradingPerformance: true,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(typeof body.childSessionId).toBe("string");
    expect(String(body.childSessionId)).not.toBe("CPS-CLONE-PARENT");
    expect(String(body.parentCharterDigest)).toHaveLength(64);

    const childGet = await harness.client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: String(body.childSessionId) },
    });
    expect(childGet.isError).not.toBe(true);
    const childBody = structured(childGet);
    const session = childBody.session as {
      charter?: { maxOrderNotional?: number };
      notes?: string[];
    };
    // Parent maxOrderNotional 125 → floor(125 * 0.75) = 93
    expect(session.charter?.maxOrderNotional).toBe(93);
    expect(session.notes?.some((n) => n.includes("cloned_from") && n.includes("CPS-CLONE-PARENT"))).toBe(
      true,
    );

    const parentGet = await harness.client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: "CPS-CLONE-PARENT" },
    });
    const parentSession = (structured(parentGet).session as { notes?: string[] }).notes ?? [];
    expect(parentSession.some((n) => n.includes("clone_challenge") && n.includes(String(body.childSessionId)))).toBe(
      true,
    );
  });

  it("dual_check_diff reports session vs weak ledger disagreement on options", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-DUAL-DIFF",
        label: "Dual check-diff",
        policy: elitePolicy,
        charterBindingEnforcement: "fail-closed",
      },
    });

    const diff = await harness.client.callTool({
      name: "runbook_dual_check_diff",
      arguments: {
        sessionId: "CPS-DUAL-DIFF",
        ledgerPolicySource: "weak",
        proposal: {
          proposalId: "dual-opt",
          experimentId: "RUN-DUAL",
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
      },
    });
    expect(diff.isError).not.toBe(true);
    const body = structured(diff);
    expect(body).toMatchObject({
      schemaVersion: "runbook.dual-check-diff.v1",
      processDeniedBySession: true,
      processAllowed: false,
      brokerEffect: false,
      compositeScore: false,
      notTradingPerformance: true,
    });
    expect(Number(body.disagreementCount)).toBeGreaterThanOrEqual(1);
    expect(String(body.sessionCharterBinding)).toMatch(/mismatch|denied/);
  });

  it("gateway_quorum_demo runs authorize/deny/replay with honesty flags", async () => {
    const result = await harness.client.callTool({
      name: "runbook_gateway_quorum_demo",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body).toMatchObject({
      schemaVersion: "runbook.gateway-quorum-demo.v1",
      actionType: "policy.activate",
      humanAuthorityEstablished: false,
      authorizationEstablished: false,
      brokerEffect: false,
      notBrokerOrderSubmission: true,
      localPolicyTheaterOnly: true,
    });
    const scenarios = body.scenarios as Array<{
      id: string;
      decision: string;
      authorizationConditionsSatisfied: boolean;
      checks: Array<{ code: string; passed: boolean }>;
    }>;
    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((s) => s.id)).toEqual(["authorize", "deny", "replay"]);
    expect(scenarios.find((s) => s.id === "authorize")).toMatchObject({
      decision: "authorize",
      authorizationConditionsSatisfied: true,
    });
    expect(scenarios.find((s) => s.id === "deny")).toMatchObject({
      decision: "deny",
      authorizationConditionsSatisfied: false,
    });
    expect(scenarios.find((s) => s.id === "replay")).toMatchObject({
      decision: "replay",
      authorizationConditionsSatisfied: false,
    });
    for (const scenario of scenarios) {
      expect(scenario.checks.length).toBeGreaterThan(0);
      expect(scenario.checks.every((c) => typeof c.code === "string" && typeof c.passed === "boolean")).toBe(
        true,
      );
    }
    expect(String(body.note)).toMatch(/theater|policy/i);
  });
});

