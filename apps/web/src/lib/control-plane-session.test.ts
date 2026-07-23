// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { charterDigest, controlPlaneSessionSchema, sessionEvidencePackSchema } from "@runbook/session";
import {
  BROWSER_SESSION_STORAGE_KEY,
  BrowserSessionStore,
  buildDossierStatusSnapshotAttachment,
  buildPublicDocsInventoryPin,
  browserCharterDigest,
  checkObservedToolsAgainstPin,
  elitePolicy,
  ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES,
  SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
  weakPolicy,
} from "./control-plane-session";
import { DOSSIER_COUNTS } from "./dossier-status-data";

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
