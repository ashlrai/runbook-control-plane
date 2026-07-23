import { describe, expect, it } from "vitest";
import {
  GATEWAY_THEATER_LABEL,
  GATEWAY_THEATER_LIMITATIONS,
  GATEWAY_THEATER_SCENARIOS,
  getGatewayTheaterScenario,
  runGatewayTheaterSigningDemo,
} from "./gateway-theater-demo";

describe("gateway theater demo fixtures", () => {
  it("exposes authorize, deny, and replay scenarios with honesty rails", () => {
    expect(GATEWAY_THEATER_SCENARIOS.map((s) => s.id).sort()).toEqual([
      "authorize-quorum",
      "deny-missing-role",
      "replay-prior-use",
    ].sort());

    const authorize = getGatewayTheaterScenario("authorize-quorum");
    expect(authorize.decision).toBe("authorize");
    expect(authorize.authorizationConditionsSatisfied).toBe(true);
    expect(authorize.checks.every((c) => c.passed)).toBe(true);
    expect(authorize.honesty.join(" ")).toContain(GATEWAY_THEATER_LABEL);

    const deny = getGatewayTheaterScenario("deny-missing-role");
    expect(deny.decision).toBe("deny");
    expect(deny.authorizationConditionsSatisfied).toBe(false);
    expect(deny.checks.some((c) => c.code === "approval.roles-met" && !c.passed)).toBe(true);

    const replay = getGatewayTheaterScenario("replay-prior-use");
    expect(replay.decision).toBe("replay");
    expect(replay.authorizationConditionsSatisfied).toBe(false);
    expect(replay.honesty.join(" ")).toMatch(/never submit again/i);

    expect(GATEWAY_THEATER_LIMITATIONS).toContain("full-crypto-evaluation-is-mcp-cli");
    expect(GATEWAY_THEATER_LIMITATIONS).toContain("no-mayExecute-authority");
  });

  it("runs Web Crypto owner+risk signing demo when available", async () => {
    if (typeof globalThis.crypto?.subtle === "undefined") {
      expect(true).toBe(true);
      return;
    }

    const demo = await runGatewayTheaterSigningDemo();
    expect(demo.roles).toHaveLength(2);
    expect(demo.roles.map((r) => r.role).sort()).toEqual(["owner", "risk"]);
    expect(demo.allSignaturesValid).toBe(true);
    expect(demo.theaterLabel).toBe(GATEWAY_THEATER_LABEL);
    expect(demo.signaturesBase64.owner.length).toBeGreaterThan(20);
    expect(demo.signaturesBase64.risk.length).toBeGreaterThan(20);
    expect(demo.limitations).toContain("not-broker-issued");
  });
});
