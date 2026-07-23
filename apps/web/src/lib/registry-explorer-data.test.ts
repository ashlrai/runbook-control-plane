import { describe, expect, it } from "vitest";
import {
  ASSURANCE_LADDER,
  BANKING_CAPABILITIES,
  BANKING_CREDENTIAL_RELEASE_CALLOUT,
  countMutationClasses,
  DRIFT_ADDED_TOOLS,
  DRIFT_THEATER_STEPS,
  FIXTURE_SUMMARIES,
  TRADING_GROUPS,
  TRADING_TOOL_COUNT,
  toolsMatching,
} from "./registry-explorer-data";

describe("registry explorer static data", () => {
  it("embeds exactly 50 trading tools with documented drift additions", () => {
    expect(TRADING_TOOL_COUNT).toBe(50);
    expect(DRIFT_ADDED_TOOLS).toHaveLength(5);

    const names = TRADING_GROUPS.flatMap((group) => group.tools.map((tool) => tool.name));
    expect(new Set(names).size).toBe(50);
    for (const name of DRIFT_ADDED_TOOLS) {
      expect(names).toContain(name);
      const tool = TRADING_GROUPS.flatMap((g) => g.tools).find((t) => t.name === name);
      expect(tool?.addedIn50).toBe(true);
    }
  });

  it("models banking credential release without inventing MCP tool names", () => {
    expect(BANKING_CAPABILITIES).toHaveLength(3);
    expect(BANKING_CAPABILITIES.every((cap) => cap.providerToolName === null)).toBe(true);
    expect(
      BANKING_CAPABILITIES.some((cap) => cap.effect === "credential-release"),
    ).toBe(true);
  });

  it("pins frozen fixture hashes and reject language for the risk correction", () => {
    const risk = FIXTURE_SUMMARIES.find((fixture) => fixture.id === "trading-50-risk-correction");
    expect(risk?.sha256).toBe(
      "ae158cf5d9f26b4c005f931c291831e4ab42658d69c96b01b64ca6a4be6bc346",
    );
    expect(risk?.outcomeLanguage).toMatch(/Reject/i);
  });

  it("filters tools without inventing names", () => {
    const capital = toolsMatching("capital-order-mutation", "");
    const capitalNames = capital.flatMap((g) => g.tools.map((t) => t.name));
    expect(capitalNames.sort()).toEqual(
      [
        "cancel_equity_order",
        "cancel_option_order",
        "place_equity_order",
        "place_option_order",
      ].sort(),
    );
    expect(countMutationClasses(capital)["capital-order-mutation"]).toBe(4);
  });

  it("exposes assurance ladder and stepped drift theater narrative", () => {
    expect(ASSURANCE_LADDER).toHaveLength(3);
    expect(ASSURANCE_LADDER.some((r) => r.id === "not-runtime")).toBe(true);
    expect(DRIFT_THEATER_STEPS).toHaveLength(4);
    expect(DRIFT_THEATER_STEPS[0]?.toolCount).toBe(45);
    expect(DRIFT_THEATER_STEPS[2]?.toolCount).toBe(50);
    expect(BANKING_CREDENTIAL_RELEASE_CALLOUT.title).toMatch(/not spend authority/i);
  });
});
