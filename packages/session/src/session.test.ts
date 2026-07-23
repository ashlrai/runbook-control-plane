import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  charterDigest,
  createCallerAssertedApproval,
  generateApprovalKeyPair,
  parseToolsListJson,
  parseToolsListJsonText,
  resolveCharterDualEval,
  ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES,
  SessionStore,
  signApprovalIntent,
  ToolsListParseError,
  verifySignedApprovalIntent,
} from "./index.js";

const elitePolicy = {
  capitalBudget: 500,
  cashReserve: 125,
  maxPositionPercent: 25,
  maxOrderNotional: 125,
  maxDrawdownPercent: 8,
  maxDailyTrades: 2,
  allowedInstruments: ["equity" as const],
  allowedSymbols: ["VTI", "BND"],
  deniedSymbols: ["GME"],
  approvalRequired: true,
};

describe("@runbook/session", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("creates, updates, and exports a control plane session", async () => {
    dir = await mkdtemp(join(tmpdir(), "runbook-session-"));
    const store = new SessionStore({ rootDir: dir });
    const session = await store.create({
      sessionId: "CPS-TEST-001",
      label: "Elite integration test",
      charter: elitePolicy,
      experimentId: "RUN-001",
    });

    expect(session.schemaVersion).toBe("runbook.control-plane-session.v1");
    expect(session.capitalAtRisk).toBe(0);
    expect(session.brokerEffect).toBe(false);
    expect(session.compositeScore).toBe(false);
    expect(session.charterDigest).toBe(charterDigest(elitePolicy));

    const pin = buildPublicDocsInventoryPin({ createdAt: "2026-07-23T00:00:00.000Z" });
    expect(pin.tools).toHaveLength(50);
    await store.setInventoryPin("CPS-TEST-001", pin);

    await store.recordShadowGeneration("CPS-TEST-001", {
      generation: 1,
      hardFalseAllows: 0,
      hardFalseDenies: 0,
      recordedAt: "2026-07-23T00:01:00.000Z",
    });

    await store.attachDossier("CPS-TEST-001", {
      kind: "status-snapshot",
      scenarioIds: ["finance-000-allowed-calibration"],
      summary: "Five process-bridged cases documented; not certification.",
      processBridgedCount: 5,
    });

    const pack = await store.exportPack("CPS-TEST-001");
    expect(pack.schemaVersion).toBe("runbook.session-evidence-pack.v1");
    expect(pack.session.inventoryPin?.toolSetSha256).toHaveLength(64);
    expect(pack.session.dossierAttachments).toHaveLength(1);
    expect(pack.notTradingPerformance).toBe(true);
  });

  it("resolveCharterDualEval warn reports mismatch without process deny", () => {
    const warn = resolveCharterDualEval({
      ledgerAllowed: true,
      sessionPresent: true,
      sessionHasCharter: true,
      sessionAllowed: false,
      enforcement: "warn",
    });
    expect(warn).toMatchObject({
      sessionCharterBinding: "mismatch-session-denies",
      ledgerAllowed: true,
      allowed: true,
      processDeniedBySession: false,
      charterBindingEnforcement: "warn",
    });
    expect(warn.warningSuffix).toMatch(/would DENY/i);

    const failClosed = resolveCharterDualEval({
      ledgerAllowed: true,
      sessionPresent: true,
      sessionHasCharter: true,
      sessionAllowed: false,
      enforcement: "fail-closed",
    });
    expect(failClosed).toMatchObject({
      sessionCharterBinding: "mismatch-session-denies",
      ledgerAllowed: true,
      allowed: false,
      processDeniedBySession: true,
      charterBindingEnforcement: "fail-closed",
    });
    expect(failClosed.warningSuffix).toMatch(/fail-closed process deny/i);

    const missing = resolveCharterDualEval({
      ledgerAllowed: true,
      sessionPresent: true,
      sessionHasCharter: false,
      enforcement: "fail-closed",
    });
    expect(missing).toMatchObject({
      sessionCharterBinding: "no-session-charter",
      allowed: false,
      processDeniedBySession: true,
    });
  });

  it("persists charterBindingEnforcement on create and update", async () => {
    dir = await mkdtemp(join(tmpdir(), "runbook-session-cbe-"));
    const store = new SessionStore({ rootDir: dir });
    const session = await store.create({
      sessionId: "CPS-CBE-001",
      label: "Charter binding enforcement",
      charterBindingEnforcement: "fail-closed",
    });
    expect(session.charterBindingEnforcement).toBe("fail-closed");
    const updated = await store.setCharterBindingEnforcement("CPS-CBE-001", "warn");
    expect(updated.charterBindingEnforcement).toBe("warn");
  });

  it("fail-closes on unknown observed tools when pin is enforced", () => {
    const pin = buildPublicDocsInventoryPin({ createdAt: "2026-07-23T00:00:00.000Z" });
    const ok = checkObservedToolsAgainstPin(pin, [...ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES], "fail-closed");
    expect(ok.ok).toBe(true);
    expect(ok.unknownTools).toEqual([]);

    const bad = checkObservedToolsAgainstPin(
      pin,
      [...ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES, "place_crypto_order_unknown"],
      "fail-closed",
    );
    expect(bad.ok).toBe(false);
    expect(bad.unknownTools).toContain("place_crypto_order_unknown");
    expect(bad.brokerEffect).toBe(false);
    expect(bad.compositeScore).toBe(false);

    const warn = checkObservedToolsAgainstPin(
      pin,
      [...ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES, "place_crypto_order_unknown"],
      "warn",
    );
    expect(warn.ok).toBe(true);
    expect(warn.unknownTools).toHaveLength(1);
  });

  it("parseToolsListJson accepts MCP tools/list, string-array, and plain array forms", () => {
    const mcp = parseToolsListJson({
      tools: [{ name: "get_portfolio" }, { name: "get_accounts" }, { name: "get_accounts" }],
    });
    expect(mcp.format).toBe("mcp-tools-list");
    expect(mcp.toolNames).toEqual(["get_accounts", "get_portfolio"]);

    const named = parseToolsListJson({ tools: ["get_portfolio", "get_accounts"] });
    expect(named.format).toBe("named-string-array");
    expect(named.toolNames).toEqual(["get_accounts", "get_portfolio"]);

    const plain = parseToolsListJson(["get_equity_quotes", "get_accounts"]);
    expect(plain.format).toBe("string-array");
    expect(plain.toolNames).toEqual(["get_accounts", "get_equity_quotes"]);

    expect(() => parseToolsListJson({ tools: [{ description: "no name" }] })).toThrow(
      ToolsListParseError,
    );
    expect(() => parseToolsListJson({ tools: ["x".repeat(161)] })).toThrow(ToolsListParseError);
    expect(() => parseToolsListJson({ tools: Array.from({ length: 201 }, (_, i) => `t${i}`) })).toThrow(
      ToolsListParseError,
    );
    expect(() => parseToolsListJsonText("https://example.com/tools.json")).toThrow(ToolsListParseError);
    expect(parseToolsListJsonText('["get_accounts"]')).toEqual({
      toolNames: ["get_accounts"],
      format: "string-array",
    });
  });

  it("signs and verifies device-key approval as local attestation only", () => {
    const keys = generateApprovalKeyPair();
    const unsigned = createCallerAssertedApproval({
      approvalId: "appr-1",
      sessionId: "CPS-1",
      experimentId: "RUN-1",
      proposalId: "prop-1",
      proposalDigest: "a".repeat(64),
      charterDigest: "b".repeat(64),
      approved: true,
      decidedAt: "2026-07-23T12:00:00.000Z",
    });
    expect(unsigned.authority).toBe("caller-asserted-unauthenticated");
    expect(unsigned.humanAuthorityEstablished).toBe(false);

    const signed = signApprovalIntent(unsigned, keys.privateKeyPkcs8Der, keys.publicKeySpkiDer);
    expect(signed.authority).toBe("device-key-signed");
    expect(signed.signatureBase64).toBeTruthy();

    const verified = verifySignedApprovalIntent(signed, keys.publicKeySpkiDer);
    expect(verified.valid).toBe(true);
    expect(verified.authorizationEstablished).toBe(false);
    expect(verified.humanAuthorityEstablished).toBe(false);

    const wrongKey = generateApprovalKeyPair();
    const bad = verifySignedApprovalIntent(signed, wrongKey.publicKeySpkiDer);
    expect(bad.valid).toBe(false);
  });
});
