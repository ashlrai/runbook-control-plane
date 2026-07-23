import { describe, expect, it } from "vitest";
import { runEliteWaveStory } from "./elite-wave-story.js";
import { TOOL_NAMES } from "./surface.js";

describe("elite-wave-story", () => {
  it("runs control-plane + surface lock + process_tick stop + seal to SUCCESS", async () => {
    const result = await runEliteWaveStory({ keepTempDir: false });
    expect(result.exitCode).toBe(0);
    expect(result.receipt.success).toBe(true);
    expect(result.receipt.errors).toEqual([]);
    expect(result.receipt.schemaVersion).toBe("runbook.elite-wave-story.v1");
    expect(result.receipt.controlPlaneSuccess).toBe(true);
    expect(result.receipt.toolCount).toBe(TOOL_NAMES.length);
    expect(result.receipt.surfaceLock.toolCount).toBe(TOOL_NAMES.length);
    expect(result.receipt.surfaceLock.serverVersion).toBe("0.4.2");
    expect(result.receipt.surfaceLock.hasPlaceOrCancelTools).toBe(false);
    expect(result.receipt.surfaceLock.toolSetSha256).toHaveLength(64);
    expect(result.receipt.processTick.recommendation).toBe("stop");
    expect(result.receipt.processTick.inventoryOk).toBe(false);
    expect(result.receipt.processTick.inventoryUnknownTools).toContain("place_crypto_order_unknown");
    expect(result.receipt.seal).not.toBeNull();
    expect(result.receipt.seal?.capsuleId.length).toBeGreaterThan(8);
    expect(result.receipt.seal?.archiveSha256).toHaveLength(64);
    expect(result.receipt.brokerEffect).toBe(false);
    expect(result.receipt.compositeScore).toBe(false);
    expect(result.receipt.capitalAtRisk).toBe(0);
    expect(result.banner).toMatch(/SUCCESS/);
  }, 60_000);
});
