// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { charterDigest, controlPlaneSessionSchema, sessionEvidencePackSchema } from "@runbook/session";
import {
  BROWSER_SESSION_STORAGE_KEY,
  BrowserSessionStore,
  browserSessionStore,
  buildDossierStatusSnapshotAttachment,
  buildInventoryPinPreset,
  buildPublicDocsInventoryPin,
  browserCharterDigest,
  checkObservedToolsAgainstPin,
  demoCharterDualEval,
  elitePolicy,
  importToolsListAgainstPin,
  parseSessionIdQuery,
  parseToolsListJson,
  parseToolsListJsonText,
  pinPresetToRegistryHandoffSession,
  pinPresetToSession,
  refineCharterIntoSession,
  REGISTRY_PIN_HANDOFF_LABEL,
  resolveSessionCharterSeed,
  ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES,
  SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
  SAMPLE_TOOLS_LIST_JSON,
  shadowLabHrefForSession,
  shadowTrendFromSession,
  ToolsListParseError,
  weakPolicy,
  writeShadowLoopToSession,
} from "./control-plane-session";
import { DOSSIER_COUNTS } from "./dossier-status-data";
import { evaluateCurriculum, runRefinementLoop } from "./shadow-lab-browser";

describe("control-plane-session browser adapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("matches package charterDigest for elite and weak policies", async () => {
    const elite = elitePolicy();
    const weak = weakPolicy();
    expect(await browserCharterDigest(elite)).toBe(charterDigest(elite));
    expect(await browserCharterDigest(weak)).toBe(charterDigest(weak));
  });

  it("creates, pins inventory, fail-closes on unknown tool, attaches dossier, exports pack", async () => {
    const store = new BrowserSessionStore();
    const session = await store.create({
      sessionId: "CPS-WEB-TEST-001",
      label: "Browser integration",
      charterSeed: "elite",
    });

    expect(session.schemaVersion).toBe("runbook.control-plane-session.v1");
    expect(session.capitalAtRisk).toBe(0);
    expect(session.brokerEffect).toBe(false);
    expect(session.compositeScore).toBe(false);
    expect(session.charterDigest).toBe(charterDigest(elitePolicy()));
    expect(controlPlaneSessionSchema.parse(session).sessionId).toBe("CPS-WEB-TEST-001");

    const pin = await buildPublicDocsInventoryPin({
      createdAt: "2026-07-23T00:00:00.000Z",
      pinId: "pin-test-1",
    });
    expect(pin.tools).toHaveLength(50);
    expect(ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES).toHaveLength(50);
    await store.setInventoryPin("CPS-WEB-TEST-001", pin);

    const ok = await checkObservedToolsAgainstPin(
      pin,
      [...ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES],
      "fail-closed",
    );
    expect(ok.ok).toBe(true);
    expect(ok.unknownTools).toEqual([]);

    const bad = await checkObservedToolsAgainstPin(
      pin,
      SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
      "fail-closed",
    );
    expect(bad.ok).toBe(false);
    expect(bad.unknownTools).toContain("place_crypto_order_unknown");
    expect(bad.brokerEffect).toBe(false);
    expect(bad.compositeScore).toBe(false);

    await store.recordShadowGeneration("CPS-WEB-TEST-001", {
      generation: 1,
      hardFalseAllows: 0,
      hardFalseDenies: 0,
      recordedAt: "2026-07-23T00:01:00.000Z",
    });

    await store.attachDossier(
      "CPS-WEB-TEST-001",
      buildDossierStatusSnapshotAttachment({ attachedAt: "2026-07-23T00:02:00.000Z" }),
    );

    const pack = await store.exportPack("CPS-WEB-TEST-001");
    expect(sessionEvidencePackSchema.parse(pack).schemaVersion).toBe(
      "runbook.session-evidence-pack.v1",
    );
    expect(pack.session.inventoryPin?.tools).toHaveLength(50);
    expect(pack.session.dossierAttachments).toHaveLength(1);
    expect(pack.session.dossierAttachments[0]?.processBridgedCount).toBe(
      DOSSIER_COUNTS.processBridged,
    );
    expect(pack.session.dossierAttachments[0]?.honestLabel).toBe(
      "architecture-evidence-not-certification",
    );
    expect(pack.notTradingPerformance).toBe(true);
    expect(pack.brokerEffect).toBe(false);
    expect(pack.compositeScore).toBe(false);

    const raw = localStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain("CPS-WEB-TEST-001");
    expect(store.list()).toHaveLength(1);
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
    expect(() =>
      parseToolsListJson({ tools: Array.from({ length: 201 }, (_, i) => `t${i}`) }),
    ).toThrow(ToolsListParseError);
    expect(() => parseToolsListJsonText("https://example.com/tools.json")).toThrow(
      ToolsListParseError,
    );
    expect(parseToolsListJsonText('["get_accounts"]')).toEqual({
      toolNames: ["get_accounts"],
      format: "string-array",
    });
  });

  it("demoCharterDualEval process-denies options under fail-closed elite session", async () => {
    const session = await browserSessionStore.create({
      label: "Dual-eval unit",
      charterSeed: "elite",
      charterBindingEnforcement: "fail-closed",
    });
    const result = demoCharterDualEval(session);
    expect(result.ledgerAllowed).toBe(true);
    expect(result.sessionPolicyAllowed).toBe(false);
    expect(result.sessionCharterBinding).toBe("mismatch-session-denies");
    expect(result.allowed).toBe(false);
    expect(result.processDeniedBySession).toBe(true);
    expect(result.brokerEffect).toBe(false);
    expect(result.compositeScore).toBe(false);

    await browserSessionStore.setCharterBindingEnforcement(session.sessionId, "warn");
    const warned = demoCharterDualEval(browserSessionStore.read(session.sessionId));
    expect(warned.allowed).toBe(true);
    expect(warned.processDeniedBySession).toBe(false);
    expect(warned.sessionCharterBinding).toBe("mismatch-session-denies");
  });

  it("buildInventoryPinPreset filters effect classes and pinPresetToSession hands off", async () => {
    const full = await buildInventoryPinPreset("public-docs-full");
    expect(full.tools).toHaveLength(50);
    const observation = await buildInventoryPinPreset("observation-only");
    expect(observation.tools.every((t) => t.effectClass === "observation")).toBe(true);
    expect(observation.tools.some((t) => t.name === "place_equity_order")).toBe(false);
    expect(observation.limitations).toContain("preset:observation-only");
    const noCap = await buildInventoryPinPreset("no-capital-order-mutation");
    expect(noCap.tools.every((t) => t.effectClass !== "capital-order-mutation")).toBe(true);
    expect(noCap.tools.some((t) => t.effectClass === "order-review")).toBe(true);
    expect(noCap.tools.length).toBeLessThan(50);

    const handoff = await pinPresetToRegistryHandoffSession("observation-only");
    expect(handoff.created).toBe(true);
    expect(handoff.session.label).toBe(REGISTRY_PIN_HANDOFF_LABEL);
    expect(handoff.toolCount).toBe(observation.tools.length);
    expect(handoff.session.inventoryPin?.tools).toHaveLength(observation.tools.length);

    const again = await pinPresetToSession(handoff.session.sessionId, "public-docs-full");
    expect(again.created).toBe(false);
    expect(again.toolCount).toBe(50);
    expect(again.session.inventoryPin?.tools).toHaveLength(50);
  });

  it("importToolsListAgainstPin fail-closes sample tools/list with place_crypto_order_unknown", async () => {
    const pin = await buildPublicDocsInventoryPin({
      createdAt: "2026-07-23T00:00:00.000Z",
      pinId: "pin-import-1",
    });
    const sample = parseToolsListJsonText(SAMPLE_TOOLS_LIST_JSON);
    expect(sample.format).toBe("mcp-tools-list");
    expect(sample.toolNames).toContain("place_crypto_order_unknown");
    expect(sample.toolNames).toContain("get_accounts");

    const result = await importToolsListAgainstPin({
      toolsJsonText: SAMPLE_TOOLS_LIST_JSON,
      pin,
      inventoryEnforcement: "fail-closed",
    });
    expect(result.ok).toBe(false);
    expect(result.unknownTools).toEqual(["place_crypto_order_unknown"]);
    expect(result.toolCount).toBe(sample.toolNames.length);
    expect(result.parseFormat).toBe("mcp-tools-list");
    expect(result.source).toBe("runtime-snapshot-paste");
    expect(result.brokerEffect).toBe(false);
    expect(result.compositeScore).toBe(false);
    expect(result.message).toMatch(/Fail-closed/i);
  });

  it("persists multiple sessions and selects latest list order", async () => {
    const store = new BrowserSessionStore();
    await store.create({
      sessionId: "CPS-A",
      label: "First",
      charterSeed: "weak",
      createdAt: "2026-07-23T00:00:00.000Z",
    });
    await store.create({
      sessionId: "CPS-B",
      label: "Second",
      charterSeed: "elite",
      createdAt: "2026-07-23T01:00:00.000Z",
    });
    // Touch A so it becomes most recently updated.
    await store.setInventoryEnforcement("CPS-A", "warn");
    const list = store.list();
    expect(list.map((s) => s.sessionId)).toEqual(["CPS-A", "CPS-B"]);
  });
});

describe("Session ↔ Shadow Lab binding helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("builds deep-link href and parses sessionId query (fail-closed on junk)", () => {
    expect(shadowLabHrefForSession("CPS-ABC-001")).toBe(
      "/shadow-lab?sessionId=CPS-ABC-001",
    );
    expect(parseSessionIdQuery("?sessionId=CPS-ABC-001")).toBe("CPS-ABC-001");
    expect(parseSessionIdQuery("sessionId=CPS-ABC-001")).toBe("CPS-ABC-001");
    expect(parseSessionIdQuery(new URLSearchParams("sessionId=CPS-ABC-001"))).toBe(
      "CPS-ABC-001",
    );
    expect(parseSessionIdQuery("?other=1")).toBeNull();
    expect(parseSessionIdQuery("?sessionId=")).toBeNull();
    expect(parseSessionIdQuery("?sessionId=bad id with spaces")).toBeNull();
    expect(parseSessionIdQuery(null)).toBeNull();
    expect(parseSessionIdQuery(undefined)).toBeNull();
  });

  it("resolves charter seed from session or weak fallback", () => {
    const withCharter = resolveSessionCharterSeed({ charter: elitePolicy() });
    expect(withCharter.usedWeakFallback).toBe(false);
    expect(withCharter.seed.capitalBudget).toBe(elitePolicy().capitalBudget);

    const noCharter = resolveSessionCharterSeed({});
    expect(noCharter.usedWeakFallback).toBe(true);
    expect(noCharter.seed.capitalBudget).toBe(weakPolicy().capitalBudget);

    const missing = resolveSessionCharterSeed(null);
    expect(missing.usedWeakFallback).toBe(true);
  });

  it("maps shadow trend points from session generations", async () => {
    const store = new BrowserSessionStore();
    await store.create({
      sessionId: "CPS-TREND",
      label: "Trend",
      charterSeed: "weak",
    });
    await store.recordShadowGeneration("CPS-TREND", {
      generation: 1,
      hardFalseAllows: 4,
      hardFalseDenies: 1,
      recordedAt: "2026-07-23T00:00:00.000Z",
    });
    await store.recordShadowGeneration("CPS-TREND", {
      generation: 2,
      hardFalseAllows: 0,
      hardFalseDenies: 0,
      recordedAt: "2026-07-23T00:01:00.000Z",
    });
    const trend = shadowTrendFromSession(store.read("CPS-TREND"));
    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({
      generation: 1,
      hardFalseAllows: 4,
      hardFalseDenies: 1,
    });
    expect(trend[1]?.hardFalseAllows).toBe(0);
  });

  it("writeShadowLoopToSession sets charter and records generations", async () => {
    const store = new BrowserSessionStore();
    await store.create({
      sessionId: "CPS-WRITE",
      label: "Write back",
      charterSeed: "weak",
    });

    const seed = weakPolicy();
    expect(evaluateCurriculum(seed).metrics.hardFalseAllows).toBeGreaterThan(0);

    const history = runRefinementLoop({
      seed,
      maxGenerations: 4,
      untilFixedPoint: true,
    });
    const final = history[history.length - 1]!;
    expect(final.metrics.hardFalseAllows).toBe(0);

    const result = await writeShadowLoopToSession({
      sessionId: "CPS-WRITE",
      history,
      store,
    });

    expect(result.charterUpdated).toBe(true);
    expect(result.generationsRecorded).toBeGreaterThan(0);
    expect(result.finalHardFalseAllows).toBe(0);
    expect(result.finalHardFalseDenies).toBe(0);
    expect(result.session.charterDigest).toBe(charterDigest(final.policy));
    expect(result.session.lastShadowHardFalseAllows).toBe(0);
    expect(result.session.shadowGenerations.length).toBe(result.generationsRecorded);
    expect(result.session.shadowGenerations[0]?.generation).toBe(1);
  });

  it("refineCharterIntoSession runs loop on weak seed when charter missing", async () => {
    const store = new BrowserSessionStore();
    await store.create({
      sessionId: "CPS-REFINE-NONE",
      label: "No charter",
      charterSeed: "none",
    });
    expect(store.read("CPS-REFINE-NONE").charter).toBeUndefined();

    const result = await refineCharterIntoSession({
      sessionId: "CPS-REFINE-NONE",
      store,
      maxGenerations: 4,
    });

    expect(result.usedWeakFallback).toBe(true);
    expect(result.charterUpdated).toBe(true);
    expect(result.session.charter).toBeDefined();
    expect(result.finalHardFalseAllows).toBe(0);
    expect(result.session.shadowGenerations.length).toBeGreaterThan(0);
    expect(result.history.length).toBeGreaterThan(0);
  });

  it("refineCharterIntoSession continues generation numbering across runs", async () => {
    const store = new BrowserSessionStore();
    await store.create({
      sessionId: "CPS-REFINE-2",
      label: "Rerun",
      charterSeed: "weak",
    });

    const first = await refineCharterIntoSession({
      sessionId: "CPS-REFINE-2",
      store,
      maxGenerations: 4,
    });
    expect(first.usedWeakFallback).toBe(false);
    const firstCount = first.session.shadowGenerations.length;
    expect(firstCount).toBeGreaterThan(0);

    // Second run on now-clean elite-ish charter still records a seed summary point.
    const second = await refineCharterIntoSession({
      sessionId: "CPS-REFINE-2",
      store,
      maxGenerations: 2,
    });
    expect(second.session.shadowGenerations.length).toBeGreaterThan(firstCount);
    const gens = second.session.shadowGenerations.map((g) => g.generation);
    expect(gens).toEqual([...gens].sort((a, b) => a - b));
    expect(new Set(gens).size).toBe(gens.length);
  });
});
