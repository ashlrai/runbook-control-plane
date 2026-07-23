/**
 * Golden shadow-pilot journey: freezes the agent UX contract for day-1 offline pilot.
 * Shared implementation lives in golden-journey.ts (also used by CLI).
 */
import { describe, expect, it } from "vitest";
import { GOLDEN_JOURNEY_RECEIPT_SCHEMA, runGoldenJourney } from "./golden-journey.js";
import { STATIC_RESOURCE_URIS } from "./resources.js";
import { TOOL_NAMES } from "./surface.js";

describe("golden shadow-pilot journey", () => {
  it("runs discover → create → preflight → hard-stop → verify → doctor → offline demos", async () => {
    const result = await runGoldenJourney();
    const { receipt } = result;

    expect(receipt.schemaVersion).toBe(GOLDEN_JOURNEY_RECEIPT_SCHEMA);
    expect(result.exitCode).toBe(0);
    expect(receipt.success).toBe(true);
    expect(receipt.errors).toEqual([]);
    expect(receipt.experimentId).toBe("RUN-SHADOW-001");
    expect(receipt.eventCount).toBe(4);
    expect(receipt.ledgerValid).toBe(true);
    expect(receipt.pilotDoctorReady).toBe(true);
    expect(receipt.hardStopObserved).toBe(true);
    expect(receipt.brokerExecutionTools).toEqual([]);
    expect(receipt.compositeScore).toBe(false);
    expect(receipt.offlineDemos).toMatchObject({
      capabilityDriftMaterialChanges: 5,
      riskCorrectionOutcome: "reject",
      capsuleValid: true,
      capsuleTamperedValid: false,
      publicAuthProfileValid: true,
    });
    expect(receipt.toolCount).toBeGreaterThanOrEqual(TOOL_NAMES.length);
    expect(STATIC_RESOURCE_URIS).toContain("runbook://fixtures/catalog");
    expect(STATIC_RESOURCE_URIS).toContain("runbook://demos/shadow-pilot");
    expect(STATIC_RESOURCE_URIS).toContain("runbook://status/dossier");
  });
});
