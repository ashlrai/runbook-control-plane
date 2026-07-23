import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyChallengeMutation,
  buildCloneChallengeReceipt,
  buildDualCheckDiff,
  buildInventoryPinPreset,
  buildProcessCapsulePayloads,
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  charterDigest,
  createCallerAssertedApproval,
  generateApprovalKeyPair,
  parseSessionEvidencePack,
  parseToolsListJson,
  parseToolsListJsonText,
  resolveCharterDualEval,
  resolveProcessTick,
  ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES,
  sessionFromEvidencePack,
  SessionPackImportError,
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

  it("processTicks defaults to empty array on create", async () => {
    dir = await mkdtemp(join(tmpdir(), "runbook-session-ticks-default-"));
    const store = new SessionStore({ rootDir: dir });
    const session = await store.create({
      sessionId: "CPS-TICKS-DEFAULT",
      label: "Process ticks default",
    });
    expect(session.processTicks).toEqual([]);
  });

  it("recordProcessTick appends and rings at max 64", async () => {
    dir = await mkdtemp(join(tmpdir(), "runbook-session-ticks-ring-"));
    const store = new SessionStore({ rootDir: dir });
    await store.create({
      sessionId: "CPS-TICKS-RING",
      label: "Process ticks ring buffer",
    });

    const base = {
      recommendation: "proceed" as const,
      inventoryOk: true,
      inventoryUnknownTools: [] as string[],
      sessionCharterBinding: "not-evaluated",
      processDeniedBySession: false,
      observedToolCount: 1,
      message: "Inventory within pin.",
    };

    for (let i = 0; i < 70; i += 1) {
      await store.recordProcessTick("CPS-TICKS-RING", {
        ...base,
        recommendation: i % 3 === 0 ? "stop" : i % 3 === 1 ? "warn" : "proceed",
        message: `tick-${i}`,
        recordedAt: new Date(Date.UTC(2026, 6, 23, 0, 0, i)).toISOString(),
      });
    }

    const session = await store.read("CPS-TICKS-RING");
    expect(session.processTicks).toHaveLength(64);
    expect(session.processTicks[0]?.message).toBe("tick-6");
    expect(session.processTicks[63]?.message).toBe("tick-69");
    expect(session.processTicks.every((t) => typeof t.recordedAt === "string")).toBe(true);
  });

  it("resolveProcessTick stops on inventory fail", () => {
    const pin = buildPublicDocsInventoryPin({ createdAt: "2026-07-23T00:00:00.000Z" });
    const inventory = checkObservedToolsAgainstPin(
      pin,
      ["get_accounts", "place_crypto_order_unknown"],
      "fail-closed",
    );
    expect(inventory.ok).toBe(false);

    const tick = resolveProcessTick({ inventory });
    expect(tick).toMatchObject({
      schemaVersion: "runbook.process-tick.v1",
      recommendation: "stop",
      inventoryOk: false,
      processDeniedBySession: false,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(tick.inventoryUnknownTools).toContain("place_crypto_order_unknown");
    expect(tick.message).toMatch(/Inventory fail-closed/i);
  });

  it("resolveProcessTick stops on fail-closed dual deny", () => {
    const pin = buildPublicDocsInventoryPin({ createdAt: "2026-07-23T00:00:00.000Z" });
    const inventory = checkObservedToolsAgainstPin(pin, ["get_accounts"], "fail-closed");
    expect(inventory.ok).toBe(true);

    const dualEval = resolveCharterDualEval({
      ledgerAllowed: true,
      sessionPresent: true,
      sessionHasCharter: true,
      sessionAllowed: false,
      enforcement: "fail-closed",
    });
    expect(dualEval.processDeniedBySession).toBe(true);

    const tick = resolveProcessTick({ inventory, dualEval });
    expect(tick).toMatchObject({
      recommendation: "stop",
      inventoryOk: true,
      processDeniedBySession: true,
      sessionCharterBinding: "mismatch-session-denies",
      ledgerAllowed: true,
      processAllowed: false,
      charterBindingEnforcement: "fail-closed",
      brokerEffect: false,
      capitalAtRisk: 0,
    });
    expect(tick.message).toMatch(/fail-closed|process deny/i);
  });

  it("buildInventoryPinPreset observation-only has no capital-order-mutation", () => {
    const pin = buildInventoryPinPreset("observation-only", {
      createdAt: "2026-07-23T00:00:00.000Z",
    });
    expect(pin.tools.length).toBeGreaterThan(0);
    expect(pin.tools.every((t) => t.effectClass === "observation")).toBe(true);
    expect(pin.tools.some((t) => t.effectClass === "capital-order-mutation")).toBe(false);
    expect(pin.tools.some((t) => t.name.startsWith("place_") || t.name.startsWith("cancel_"))).toBe(
      false,
    );
    expect(pin.limitations).toContain("preset:observation-only");
    expect(pin.toolSetSha256).toHaveLength(64);

    const noCap = buildInventoryPinPreset("no-capital-order-mutation", {
      createdAt: "2026-07-23T00:00:00.000Z",
    });
    expect(noCap.tools.every((t) => t.effectClass !== "capital-order-mutation")).toBe(true);
  });

  it("parseSessionEvidencePack + sessionFromEvidencePack round-trip local packs", async () => {
    dir = await mkdtemp(join(tmpdir(), "runbook-session-pack-"));
    const store = new SessionStore({ rootDir: dir });
    await store.create({
      sessionId: "CPS-PACK-001",
      label: "Pack import test",
      charter: elitePolicy,
    });
    const exported = await store.exportPack("CPS-PACK-001");

    const pack = parseSessionEvidencePack(JSON.stringify(exported));
    expect(pack.schemaVersion).toBe("runbook.session-evidence-pack.v1");
    expect(pack.session.sessionId).toBe("CPS-PACK-001");
    expect(pack.notTradingPerformance).toBe(true);
    expect(pack.brokerEffect).toBe(false);

    const session = sessionFromEvidencePack(pack, { sessionId: "CPS-PACK-REKEY" });
    expect(session.sessionId).toBe("CPS-PACK-REKEY");
    expect(session.label).toBe("Pack import test");
    expect(session.charterDigest).toBe(charterDigest(elitePolicy));

    expect(() => parseSessionEvidencePack("https://example.com/pack.json")).toThrow(
      SessionPackImportError,
    );
    expect(() => parseSessionEvidencePack("{not-json")).toThrow(SessionPackImportError);
    expect(() => parseSessionEvidencePack({ schemaVersion: "nope" })).toThrow(SessionPackImportError);
  });

  it("buildProcessCapsulePayloads has required paths sorted", async () => {
    dir = await mkdtemp(join(tmpdir(), "runbook-session-capsule-"));
    const store = new SessionStore({ rootDir: dir });
    await store.create({
      sessionId: "CPS-CAP-001",
      label: "Capsule payloads",
      charter: elitePolicy,
    });
    const pack = await store.exportPack("CPS-CAP-001");
    const drafts = buildProcessCapsulePayloads(pack);
    const paths = drafts.map((d) => d.path);
    expect(paths).toEqual([
      "payload/charter.json",
      "payload/claims.json",
      "payload/disclosures.json",
      "payload/events.ndjson",
      "payload/report.html",
      "payload/session-evidence-pack.json",
    ]);
    expect([...paths].sort()).toEqual(paths);
    expect(drafts.every((d) => d.bytes.byteLength > 0)).toBe(true);
  });

  it("applyChallengeMutation equities-only and deny-gme", () => {
    const multiInstrument = {
      ...elitePolicy,
      allowedInstruments: ["equity" as const, "option" as const, "crypto" as const],
      deniedSymbols: [] as string[],
    };

    const equitiesOnly = applyChallengeMutation(multiInstrument, "equities-only");
    expect(equitiesOnly.allowedInstruments).toEqual(["equity"]);
    expect(equitiesOnly.deniedSymbols).toEqual([]);

    const denyGme = applyChallengeMutation(multiInstrument, "deny-gme");
    expect(denyGme.deniedSymbols.map((s) => s.toUpperCase())).toContain("GME");
    expect(denyGme.allowedInstruments).toEqual(["equity", "option", "crypto"]);

    // Idempotent when GME is already denied.
    const again = applyChallengeMutation(
      { ...elitePolicy, deniedSymbols: ["GME"] },
      "deny-gme",
    );
    expect(again.deniedSymbols.filter((s) => s.toUpperCase() === "GME")).toHaveLength(1);
  });

  it("buildCloneChallengeReceipt schema", () => {
    const receipt = buildCloneChallengeReceipt({
      parentSessionId: "CPS-PARENT",
      parentCharterDigest: "a".repeat(64),
      childSessionId: "CPS-CHILD",
      mutationId: "deny-gme",
    });
    expect(receipt).toMatchObject({
      schemaVersion: "runbook.clone-challenge.v1",
      parentSessionId: "CPS-PARENT",
      parentCharterDigest: "a".repeat(64),
      childSessionId: "CPS-CHILD",
      mutationId: "deny-gme",
      mutationLabel: "Deny GME",
      notTradingPerformance: true,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(receipt.note).toMatch(/process fork/i);
    expect(receipt.note).toMatch(/not a safer strategy/i);
  });

  it("buildDualCheckDiff: weak ledger allows option, elite session denies under fail-closed", () => {
    const weakLedger = {
      capitalBudget: 10_000,
      cashReserve: 100,
      maxPositionPercent: 90,
      maxOrderNotional: 9_000,
      maxDrawdownPercent: 50,
      maxDailyTrades: 100,
      allowedInstruments: ["equity" as const, "option" as const, "crypto" as const],
      allowedSymbols: [] as string[],
      deniedSymbols: [] as string[],
      approvalRequired: false,
    };
    const optionProposal = {
      proposalId: "prop-opt-dual",
      experimentId: "RUN-DUAL-001",
      symbol: "SPY",
      instrument: "option" as const,
      side: "buy" as const,
      notional: 50,
      projectedPositionNotional: 50,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 0.5,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 1,
    };

    const report = buildDualCheckDiff({
      ledgerPolicy: weakLedger,
      sessionPolicy: elitePolicy,
      proposal: optionProposal,
      enforcement: "fail-closed",
    });

    expect(report.schemaVersion).toBe("runbook.dual-check-diff.v1");
    expect(report.ledgerAllowed).toBe(true);
    expect(report.sessionAllowed).toBe(false);
    expect(report.disagreementCount).toBeGreaterThanOrEqual(1);
    expect(report.checks.some((c) => c.agreement === "ledger-only")).toBe(true);
    expect(report.processDeniedBySession).toBe(true);
    expect(report.processAllowed).toBe(false);
    expect(report.charterBindingEnforcement).toBe("fail-closed");
    expect(report.brokerEffect).toBe(false);
    expect(report.compositeScore).toBe(false);
    expect(report.notTradingPerformance).toBe(true);
  });
});
