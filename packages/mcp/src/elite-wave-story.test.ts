import { describe, expect, it } from "vitest";
import { runEliteWaveStory } from "./elite-wave-story.js";
import { TOOL_NAMES } from "./surface.js";

describe("elite-wave-story", () => {
  it("runs control-plane + surface lock + process_tick stop + dual_check + clone + attach + gateway + seal to SUCCESS", async () => {
    const result = await runEliteWaveStory({ keepTempDir: false });
    expect(result.exitCode).toBe(0);
    expect(result.receipt.success).toBe(true);
    expect(result.receipt.errors).toEqual([]);
    expect(result.receipt.schemaVersion).toBe("runbook.elite-wave-story.v1");
    expect(result.receipt.controlPlaneSuccess).toBe(true);
    expect(result.receipt.toolCount).toBe(TOOL_NAMES.length);
    expect(result.receipt.surfaceLock.toolCount).toBe(TOOL_NAMES.length);
    expect(result.receipt.surfaceLock.serverVersion).toBe("0.4.4");
    expect(result.receipt.surfaceLock.hasPlaceOrCancelTools).toBe(false);
    expect(result.receipt.surfaceLock.toolSetSha256).toHaveLength(64);
    expect(result.receipt.processTick.recommendation).toBe("stop");
    expect(result.receipt.processTick.inventoryOk).toBe(false);
    expect(result.receipt.processTick.inventoryUnknownTools).toContain("place_crypto_order_unknown");

    expect(result.receipt.dualCheck).toBeDefined();
    expect(result.receipt.dualCheck!.disagreementCount).toBeGreaterThanOrEqual(1);
    expect(result.receipt.dualCheck!.processDeniedBySession).toBe(true);
    expect(result.receipt.dualCheck!.sessionCharterBinding.length).toBeGreaterThan(0);

    expect(result.receipt.clone).toBeDefined();
    expect(result.receipt.clone!.childSessionId.length).toBeGreaterThan(4);
    expect(result.receipt.clone!.childSessionId).not.toBe(result.receipt.sessionId);
    expect(["equities-only", "deny-gme"]).toContain(result.receipt.clone!.mutationId);

    expect(result.receipt.surfaceLockAttached).toBeDefined();
    expect(result.receipt.surfaceLockAttached!.attachmentId.length).toBeGreaterThan(4);
    expect(result.receipt.surfaceLockAttached!.toolSetSha256).toBe(
      result.receipt.surfaceLock.toolSetSha256,
    );
    expect(result.receipt.surfaceLockAttached!.toolCount).toBe(TOOL_NAMES.length);

    expect(result.receipt.gateway).toBeDefined();
    expect(result.receipt.gateway!.actionType).toBe("policy.activate");
    expect(result.receipt.gateway!.humanAuthorityEstablished).toBe(false);
    expect(result.receipt.gateway!.authorizationEstablished).toBe(false);
    expect(result.receipt.gateway!.brokerEffect).toBe(false);
    expect(result.receipt.gateway!.decisions.map((d) => d.id)).toEqual([
      "authorize",
      "deny",
      "replay",
    ]);
    expect(result.receipt.gateway!.decisions.map((d) => d.decision)).toEqual([
      "authorize",
      "deny",
      "replay",
    ]);

    expect(result.receipt.seal).not.toBeNull();
    expect(result.receipt.seal?.capsuleId.length).toBeGreaterThan(8);
    expect(result.receipt.seal?.archiveSha256).toHaveLength(64);
    expect(result.receipt.brokerEffect).toBe(false);
    expect(result.receipt.compositeScore).toBe(false);
    expect(result.receipt.capitalAtRisk).toBe(0);
    expect(result.banner).toMatch(/SUCCESS/);
    expect(result.banner).toMatch(/dual_check/);
    expect(result.banner).toMatch(/clone/);
    expect(result.banner).toMatch(/gateway/);
  }, 60_000);
});
