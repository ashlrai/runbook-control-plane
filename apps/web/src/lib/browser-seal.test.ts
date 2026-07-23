// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { browserSessionStore } from "./control-plane-session";
import { evidencePackFromSession, sealSessionProcessCapsule } from "./browser-seal";

describe("browser process capsule seal", () => {
  it("builds an evidence pack mirror of exportPack schema", async () => {
    const session = await browserSessionStore.create({
      label: "Seal pack mirror",
      charterSeed: "elite",
    });
    const pack = evidencePackFromSession(session);
    expect(pack.schemaVersion).toBe("runbook.session-evidence-pack.v1");
    expect(pack.brokerEffect).toBe(false);
    expect(pack.compositeScore).toBe(false);
    expect(pack.notTradingPerformance).toBe(true);
    expect(pack.assurance).toBe("local-control-plane-export-only");
    expect(pack.session.sessionId).toBe(session.sessionId);
    browserSessionStore.delete(session.sessionId);
  });

  it("seals a synthetic .runbook with Web Crypto when available", async () => {
    if (typeof globalThis.crypto?.subtle === "undefined") {
      expect(true).toBe(true);
      return;
    }

    const session = await browserSessionStore.create({
      label: "Seal crypto",
      charterSeed: "elite",
    });

    const sealed = await sealSessionProcessCapsule(session, {
      createdAt: "2026-07-23T12:00:00Z",
    });

    expect(sealed.capsuleId).toMatch(/^[a-f0-9]{64}$/);
    expect(sealed.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sealed.archiveBytes.byteLength).toBeGreaterThan(100);
    expect(sealed.blob.type).toContain("runbook");
    expect(sealed.filename).toContain(session.sessionId);
    expect(sealed.filename.endsWith(".runbook")).toBe(true);
    expect(sealed.experimentId).toMatch(/^CPS-SEAL-/);
    expect(sealed.authorKeyId.startsWith("sha256:")).toBe(true);
    expect(sealed.limitations).toContain("self-asserted-author-key-integrity-only");
    expect(sealed.limitations).toContain("not-broker-issued");
    expect(sealed.limitations).toContain("not-identity-proof");

    browserSessionStore.delete(session.sessionId);
  });
});
