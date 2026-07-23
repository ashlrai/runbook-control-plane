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

  it("surface lock receipt toolCount matches TOOL_NAMES length, hasPlaceOrCancel false, version 0.4.0", async () => {
    const result = await harness.client.callTool({
      name: "runbook_surface_lock_receipt",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const body = structured(result);
    expect(body).toMatchObject({
      schemaVersion: "runbook.surface-lock-receipt.v1",
      serverName: "runbook",
      serverVersion: "0.4.0",
      toolCount: TOOL_NAMES.length,
      hasPlaceOrCancelTools: false,
      openWorldHint: false,
      brokerEffect: false,
      compositeScore: false,
    });
    expect(body.brokerExecutionTools).toEqual([]);
    expect(String(body.toolSetSha256)).toHaveLength(64);
    expect(TOOL_NAMES.length).toBe(38);
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
});
