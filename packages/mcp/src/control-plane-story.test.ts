import { describe, expect, it } from "vitest";
import { runControlPlaneStory } from "./control-plane-story.js";
import { TOOL_NAMES } from "./surface.js";

describe("control-plane-story", () => {
  it("runs the full session spine story to SUCCESS", async () => {
    const result = await runControlPlaneStory({ keepTempDir: false });
    expect(result.exitCode).toBe(0);
    expect(result.receipt.success).toBe(true);
    expect(result.receipt.errors).toEqual([]);
    expect(result.receipt.schemaVersion).toBe("runbook.control-plane-story.v1");
    expect(result.receipt.finalHardFalseAllows).toBe(0);
    expect(result.receipt.initialHardFalseAllows).toBeGreaterThan(0);
    expect(result.receipt.fixedPoint).toBe(true);
    expect(result.receipt.inventoryToolCount).toBe(50);
    expect(result.receipt.experimentBound).toBe(true);
    expect(result.receipt.agentEvalProcessCorrect).toBe(true);
    expect(result.receipt.packSchemaVersion).toBe("runbook.session-evidence-pack.v1");
    expect(result.receipt.brokerEffect).toBe(false);
    expect(result.receipt.compositeScore).toBe(false);
    expect(result.receipt.capitalAtRisk).toBe(0);
    expect(result.receipt.toolCount).toBe(TOOL_NAMES.length);
    expect(result.banner).toMatch(/SUCCESS/);
  });
});
