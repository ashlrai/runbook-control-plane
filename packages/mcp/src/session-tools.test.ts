import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import type { RiskPolicy } from "@runbook/engine/schema";
import { ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES } from "@runbook/session";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";

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

const SESSION_TOOL_NAMES = [
  "runbook_session_create",
  "runbook_session_use",
  "runbook_session_get",
  "runbook_session_export",
  "runbook_session_set_charter",
  "runbook_session_pin_inventory",
  "runbook_session_check_inventory",
  "runbook_session_import_tools_list",
  "runbook_session_bind_experiment",
  "runbook_session_attach_dossier",
  "runbook_session_record_shadow",
  "runbook_approval_create_signed",
  "runbook_approval_verify",
] as const;

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-mcp-session-"));
  const ledger = new FileLedger(directory, "session-test");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service, { dataDir: directory });
  const client = new Client({ name: "runbook-session-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, directory, ledger, server, service };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as Record<string, unknown>;
}

describe("control plane session MCP tools", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.client.close();
    await harness.server.close();
    await rm(harness.directory, { recursive: true, force: true });
  });

  it("advertises session tools as closed-world offline local tools", async () => {
    const listed = await harness.client.listTools();
    const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));

    for (const name of SESSION_TOOL_NAMES) {
      expect(byName[name]).toBeDefined();
      expect(byName[name]?.annotations?.openWorldHint).toBe(false);
      expect(byName[name]?.annotations?.destructiveHint).toBe(false);
    }

    expect(byName.runbook_session_get?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(byName.runbook_session_create?.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
    });
    expect(byName.runbook_approval_verify?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });

    const surface = await harness.client.callTool({
      name: "runbook_list_surface",
      arguments: {},
    });
    expect(surface.isError).not.toBe(true);
    const body = structured(surface);
    expect(body.serverVersion).toBe("0.3.1");
    expect(body.brokerExecutionTools).toEqual([]);
    const tools = body.tools as Array<{ name: string; offline: boolean; openWorldHint: boolean }>;
    expect(tools).toHaveLength(33);
    for (const name of SESSION_TOOL_NAMES) {
      const entry = tools.find((t) => t.name === name);
      expect(entry?.offline).toBe(true);
      expect(entry?.openWorldHint).toBe(false);
    }
  });

  it("imports local tools/list JSON and fail-closes on unknown tool", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: { sessionId: "CPS-IMPORT-001", label: "Import tools list" },
    });
    await harness.client.callTool({
      name: "runbook_session_pin_inventory",
      arguments: { sessionId: "CPS-IMPORT-001" },
    });

    const fromPath = await harness.client.callTool({
      name: "runbook_session_import_tools_list",
      arguments: {
        sessionId: "CPS-IMPORT-001",
        path: SAMPLE_TOOLS_LIST_PATH,
      },
    });
    expect(fromPath.isError).not.toBe(true);
    const body = structured(fromPath);
    expect(body).toMatchObject({
      schemaVersion: "runbook.session-import-tools-list.v1",
      ok: false,
      enforcement: "fail-closed",
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
      inputSource: "path",
      source: "runtime-snapshot-file",
      parseFormat: "mcp-tools-list",
      toolCount: 11,
    });
    expect(body.unknownTools as string[]).toContain("place_crypto_order_unknown");
    expect(body.sampleNames as string[]).toContain("get_accounts");
    expect(String(body.inputSha256)).toHaveLength(64);
    expect(body.limitations as string[]).toContain("runtime-snapshot-file (operator provided)");

    const fromJson = await harness.client.callTool({
      name: "runbook_session_import_tools_list",
      arguments: {
        sessionId: "CPS-IMPORT-001",
        toolsJson: JSON.stringify({ tools: ["get_accounts", "get_portfolio"] }),
      },
    });
    expect(fromJson.isError).not.toBe(true);
    expect(structured(fromJson)).toMatchObject({
      ok: true,
      toolCount: 2,
      inputSource: "toolsJson",
      parseFormat: "named-string-array",
      brokerEffect: false,
    });

    // Prefer path when both path and toolsJson are provided.
    const preferPath = await harness.client.callTool({
      name: "runbook_session_import_tools_list",
      arguments: {
        sessionId: "CPS-IMPORT-001",
        path: SAMPLE_TOOLS_LIST_PATH,
        toolsJson: JSON.stringify({ tools: ["get_accounts"] }),
      },
    });
    expect(preferPath.isError).not.toBe(true);
    expect(structured(preferPath)).toMatchObject({
      inputSource: "path",
      toolCount: 11,
      ok: false,
    });

    const refuseUrl = await harness.client.callTool({
      name: "runbook_session_import_tools_list",
      arguments: {
        sessionId: "CPS-IMPORT-001",
        path: "https://example.com/tools.json",
      },
    });
    expect(refuseUrl.isError).toBe(true);

    // Active-session resolution when sessionId omitted.
    await harness.client.callTool({
      name: "runbook_session_use",
      arguments: { sessionId: "CPS-IMPORT-001" },
    });
    const viaActive = await harness.client.callTool({
      name: "runbook_session_import_tools_list",
      arguments: {
        toolsJson: JSON.stringify(["get_accounts"]),
      },
    });
    expect(viaActive.isError).not.toBe(true);
    expect(structured(viaActive)).toMatchObject({
      sessionId: "CPS-IMPORT-001",
      ok: true,
      toolCount: 1,
      parseFormat: "string-array",
      brokerEffect: false,
    });

    const got = await harness.client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: "CPS-IMPORT-001" },
    });
    const session = structured(got).session as { notes?: string[] };
    expect(session.notes?.some((n) => n.includes("runtime-snapshot-file (operator provided)"))).toBe(
      true,
    );
  });

  it("creates, pins, checks, attaches, and exports a session", async () => {
    const created = await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-MCP-001",
        label: "Session MCP test",
        policy: elitePolicy,
        experimentId: "RUN-SESSION-001",
      },
    });
    expect(created.isError).not.toBe(true);
    expect(structured(created)).toMatchObject({
      schemaVersion: "runbook.session-create.v1",
      sessionId: "CPS-MCP-001",
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(String(structured(created).rootDir)).toContain("sessions");

    const pinned = await harness.client.callTool({
      name: "runbook_session_pin_inventory",
      arguments: { sessionId: "CPS-MCP-001" },
    });
    expect(pinned.isError).not.toBe(true);
    expect(structured(pinned)).toMatchObject({
      schemaVersion: "runbook.session-pin-inventory.v1",
      toolCount: 50,
      brokerEffect: false,
    });
    expect(String(structured(pinned).toolSetSha256)).toHaveLength(64);

    const okCheck = await harness.client.callTool({
      name: "runbook_session_check_inventory",
      arguments: {
        sessionId: "CPS-MCP-001",
        observedToolNames: ["get_accounts", "get_portfolio", "get_equity_quotes"],
      },
    });
    expect(okCheck.isError).not.toBe(true);
    expect(structured(okCheck)).toMatchObject({
      schemaVersion: "runbook.inventory-check.v1",
      ok: true,
      enforcement: "fail-closed",
      brokerEffect: false,
      compositeScore: false,
    });

    const failCheck = await harness.client.callTool({
      name: "runbook_session_check_inventory",
      arguments: {
        sessionId: "CPS-MCP-001",
        observedToolNames: [
          ...ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES.slice(0, 3),
          "place_crypto_order_unknown",
        ],
      },
    });
    expect(failCheck.isError).not.toBe(true);
    expect(structured(failCheck)).toMatchObject({
      ok: false,
      enforcement: "fail-closed",
      brokerEffect: false,
    });
    expect(structured(failCheck).unknownTools as string[]).toContain("place_crypto_order_unknown");

    const shadow = await harness.client.callTool({
      name: "runbook_session_record_shadow",
      arguments: {
        sessionId: "CPS-MCP-001",
        generation: 1,
        hardFalseAllows: 0,
        hardFalseDenies: 2,
      },
    });
    expect(shadow.isError).not.toBe(true);
    expect(structured(shadow)).toMatchObject({
      schemaVersion: "runbook.session-record-shadow.v1",
      lastShadowHardFalseAllows: 0,
      lastShadowHardFalseDenies: 2,
      brokerEffect: false,
      compositeScore: false,
    });

    const dossier = await harness.client.callTool({
      name: "runbook_session_attach_dossier",
      arguments: {
        sessionId: "CPS-MCP-001",
        summary: "Five process-bridged cases documented; not certification.",
        scenarioIds: ["finance-000-allowed-calibration"],
        processBridgedCount: 5,
      },
    });
    expect(dossier.isError).not.toBe(true);
    expect(structured(dossier)).toMatchObject({
      schemaVersion: "runbook.session-attach-dossier.v1",
      attachmentCount: 1,
      brokerEffect: false,
    });

    const got = await harness.client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: "CPS-MCP-001" },
    });
    expect(got.isError).not.toBe(true);
    const session = structured(got).session as Record<string, unknown>;
    expect(session.sessionId).toBe("CPS-MCP-001");
    expect(session.capitalAtRisk).toBe(0);

    const exported = await harness.client.callTool({
      name: "runbook_session_export",
      arguments: { sessionId: "CPS-MCP-001" },
    });
    expect(exported.isError).not.toBe(true);
    expect(structured(exported)).toMatchObject({
      schemaVersion: "runbook.session-export.v1",
      brokerEffect: false,
      compositeScore: false,
      notTradingPerformance: true,
    });
    const pack = structured(exported).pack as Record<string, unknown>;
    expect(pack.schemaVersion).toBe("runbook.session-evidence-pack.v1");
  });

  it("supports custom inventory pin and set_charter", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: { sessionId: "CPS-CUSTOM-001", label: "Custom pin session" },
    });

    const charter = await harness.client.callTool({
      name: "runbook_session_set_charter",
      arguments: { sessionId: "CPS-CUSTOM-001", policy: elitePolicy },
    });
    expect(charter.isError).not.toBe(true);
    expect(String(structured(charter).charterDigest)).toHaveLength(64);

    const pin = await harness.client.callTool({
      name: "runbook_session_pin_inventory",
      arguments: {
        sessionId: "CPS-CUSTOM-001",
        toolNames: ["get_accounts", "get_portfolio"],
        label: "Tiny operator pin",
      },
    });
    expect(pin.isError).not.toBe(true);
    expect(structured(pin).toolCount).toBe(2);

    const check = await harness.client.callTool({
      name: "runbook_session_check_inventory",
      arguments: {
        sessionId: "CPS-CUSTOM-001",
        observedToolNames: ["get_accounts", "place_equity_order"],
      },
    });
    expect(structured(check).ok).toBe(false);
    expect(structured(check).unknownTools as string[]).toContain("place_equity_order");
  });

  it("creates ephemeral signed approval and verifies with public SPKI", async () => {
    const digestA = "a".repeat(64);
    const digestB = "b".repeat(64);

    const created = await harness.client.callTool({
      name: "runbook_approval_create_signed",
      arguments: {
        sessionId: "CPS-APPR-001",
        experimentId: "RUN-1",
        proposalId: "prop-1",
        proposalDigest: digestA,
        charterDigest: digestB,
        approved: true,
        decidedAt: "2026-07-23T12:00:00.000Z",
      },
    });
    expect(created.isError).not.toBe(true);
    const body = structured(created);
    expect(body).toMatchObject({
      schemaVersion: "runbook.approval-create-signed.v1",
      privateKeyPersisted: false,
      humanAuthorityEstablished: false,
      authorizationEstablished: false,
      brokerEffect: false,
      assurance: "local-device-key-attestation-only",
    });
    expect(String(body.publicKeySpkiBase64).length).toBeGreaterThan(20);
    expect(String(body.publicKeyFingerprint)).toHaveLength(64);

    const intent = body.intent as Record<string, unknown>;
    expect(intent.authority).toBe("device-key-signed");
    expect(intent.signatureBase64).toBeTruthy();

    const verified = await harness.client.callTool({
      name: "runbook_approval_verify",
      arguments: {
        intent,
        publicKeySpkiBase64: body.publicKeySpkiBase64,
      },
    });
    expect(verified.isError).not.toBe(true);
    expect(structured(verified)).toMatchObject({
      schemaVersion: "runbook.approval-verify.v1",
      valid: true,
      humanAuthorityEstablished: false,
      authorizationEstablished: false,
      brokerEffect: false,
    });

    // Tampered proposal digest must not verify.
    const tampered = {
      ...intent,
      proposalDigest: "c".repeat(64),
    };
    const bad = await harness.client.callTool({
      name: "runbook_approval_verify",
      arguments: {
        intent: tampered,
        publicKeySpkiBase64: body.publicKeySpkiBase64,
      },
    });
    expect(bad.isError).not.toBe(true);
    expect(structured(bad).valid).toBe(false);
  });

  it("advertises control-plane session resource and prompt", async () => {
    const resource = await harness.client.readResource({
      uri: "runbook://docs/control-plane-session",
    });
    const text = resource.contents.map((part) => ("text" in part ? part.text : "")).join("");
    expect(text).toMatch(/control plane session/i);
    expect(text).toMatch(/runbook_session_create/);
    expect(text).toMatch(/not a hard broker gateway/i);
    expect(text).toMatch(/device-key/i);

    const prompt = await harness.client.getPrompt({
      name: "runbook_control_plane_session",
      arguments: { sessionId: "CPS-PROMPT-001" },
    });
    const promptText = prompt.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");
    expect(promptText).toContain("CPS-PROMPT-001");
    expect(promptText).toMatch(/runbook_session_pin_inventory/);
    expect(promptText).toMatch(/composite safety score/i);
    expect(promptText).toMatch(/broker authorization/i);
  });

  it("advertises full control-plane playbook resource and prompt", async () => {
    const playbook = await harness.client.readResource({
      uri: "runbook://playbooks/control-plane-session",
    });
    const text = playbook.contents.map((part) => ("text" in part ? part.text : "")).join("");
    expect(text).toMatch(/full journey/i);
    expect(text).toMatch(/runbook_session_bind_experiment/);
    expect(text).toMatch(/runbook_improve_charter/);
    expect(text).toMatch(/NEVER broker/i);
    expect(text).toMatch(/runbook_control_plane_full/);

    const prompt = await harness.client.getPrompt({
      name: "runbook_control_plane_full",
      arguments: { sessionId: "CPS-FULL-PROMPT", experimentId: "RUN-FULL-PROMPT" },
    });
    const promptText = prompt.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");
    expect(promptText).toContain("CPS-FULL-PROMPT");
    expect(promptText).toContain("RUN-FULL-PROMPT");
    expect(promptText).toContain("runbook://playbooks/control-plane-session");
    expect(promptText).toMatch(/runbook_session_bind_experiment/);
    expect(promptText).toMatch(/NEVER returns/i);
  });

  it("binds a local experiment id onto a session", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: { sessionId: "CPS-BIND-001", label: "Bind test" },
    });

    const bound = await harness.client.callTool({
      name: "runbook_session_bind_experiment",
      arguments: {
        sessionId: "CPS-BIND-001",
        experimentId: "RUN-BIND-001",
        ledgerHeadHash: "d".repeat(64),
      },
    });
    expect(bound.isError).not.toBe(true);
    expect(structured(bound)).toMatchObject({
      schemaVersion: "runbook.session-bind-experiment.v1",
      sessionId: "CPS-BIND-001",
      experimentId: "RUN-BIND-001",
      ledgerHeadHash: "d".repeat(64),
      brokerEffect: false,
      capitalAtRisk: 0,
    });
  });

  it("runbook_session_use writes active-session marker", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: { sessionId: "CPS-USE-001", label: "Use marker session" },
    });

    const used = await harness.client.callTool({
      name: "runbook_session_use",
      arguments: { sessionId: "CPS-USE-001" },
    });
    expect(used.isError).not.toBe(true);
    expect(structured(used)).toMatchObject({
      schemaVersion: "runbook.session-use.v1",
      sessionId: "CPS-USE-001",
      active: true,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(String(structured(used).markerPath)).toContain("active-session.json");
  });

  it("create_experiment binds optional sessionId via session spine", async () => {
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: { sessionId: "CPS-CREATE-BIND", label: "Create bind" },
    });

    const created = await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId: "RUN-CREATE-BIND",
        name: "Session-bound experiment",
        question: "Does create_experiment bind the session?",
        benchmark: "VTI",
        observationDays: 1,
        policy: elitePolicy,
        actor: { type: "agent", id: "session-bind-agent" },
        occurredAt: "2026-07-22T22:00:00.000Z",
        sessionId: "CPS-CREATE-BIND",
      },
    });
    expect(created.isError).not.toBe(true);
    expect(structured(created)).toMatchObject({
      experimentId: "RUN-CREATE-BIND",
      sessionId: "CPS-CREATE-BIND",
      sessionBound: true,
      brokerEffect: false,
      enforcement: "advisory",
    });

    const got = await harness.client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: "CPS-CREATE-BIND" },
    });
    const session = structured(got).session as { experimentId?: string; ledgerHeadHash?: string };
    expect(session.experimentId).toBe("RUN-CREATE-BIND");
    expect(session.ledgerHeadHash).toHaveLength(64);
  });

  it("binds preflight to the session charter and flags ledger/session mismatch", async () => {
    await harness.client.listTools();
    await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId: "CPS-PREFLIGHT-001",
        label: "Preflight binding",
        policy: elitePolicy,
      },
    });
    await harness.client.callTool({
      name: "runbook_session_use",
      arguments: { sessionId: "CPS-PREFLIGHT-001" },
    });

    // Ledger experiment uses a weaker options-allowing policy; session keeps elite.
    const weakPolicy: RiskPolicy = {
      ...elitePolicy,
      allowedInstruments: ["equity", "option"],
      allowedSymbols: [],
      deniedSymbols: [],
      maxOrderNotional: 500,
      capitalBudget: 1_000,
      cashReserve: 100,
    };
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId: "RUN-PREFLIGHT-BIND",
        name: "Mismatch probe",
        question: "Does session charter dual-eval surface mismatch?",
        benchmark: "VTI",
        observationDays: 1,
        policy: weakPolicy,
        actor: { type: "agent", id: "preflight-bind" },
        occurredAt: "2026-07-23T01:00:00.000Z",
        sessionId: "CPS-PREFLIGHT-001",
      },
    });

    const clean = await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: {
          proposalId: "pf-vti",
          experimentId: "RUN-PREFLIGHT-BIND",
          symbol: "VTI",
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
        actor: { type: "agent", id: "preflight-bind" },
        occurredAt: "2026-07-23T01:01:00.000Z",
        sessionId: "CPS-PREFLIGHT-001",
      },
    });
    expect(clean.isError).not.toBe(true);
    expect(structured(clean)).toMatchObject({
      allowed: true,
      enforcement: "advisory",
      sessionId: "CPS-PREFLIGHT-001",
      sessionPolicyAllowed: true,
      sessionCharterBinding: "matched-allowed",
      brokerEffect: false,
    });
    expect(String(structured(clean).sessionCharterDigest)).toHaveLength(64);

    // Options allowed by weak ledger charter; elite session charter denies.
    const optionProbe = await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal: {
          proposalId: "pf-opt",
          experimentId: "RUN-PREFLIGHT-BIND",
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
        actor: { type: "agent", id: "preflight-bind" },
        occurredAt: "2026-07-23T01:02:00.000Z",
        sessionId: "CPS-PREFLIGHT-001",
      },
    });
    expect(optionProbe.isError).not.toBe(true);
    expect(structured(optionProbe)).toMatchObject({
      allowed: true,
      sessionPolicyAllowed: false,
      sessionCharterBinding: "mismatch-session-denies",
      brokerEffect: false,
    });
    expect(String(structured(optionProbe).warning)).toMatch(/Session charter would DENY/i);

    const got = await harness.client.callTool({
      name: "runbook_session_get",
      arguments: { sessionId: "CPS-PREFLIGHT-001" },
    });
    const notes = (structured(got).session as { notes?: string[] }).notes ?? [];
    expect(notes.some((n) => n.includes("preflight pf-opt") && n.includes("mismatch-session-denies"))).toBe(
      true,
    );
  });
});
