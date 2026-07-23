import { describe, expect, it } from "vitest";
import {
  demoProposal,
  evaluateProposal,
  importEventSchema,
  masonPolicy,
  processScore,
} from "./runbook";

describe("deterministic preflight", () => {
  it("passes a complete proposal inside the mandate", () => {
    const checks = evaluateProposal(masonPolicy, demoProposal);

    expect(checks.checks).toHaveLength(10);
    expect(checks.allowed).toBe(true);
    expect(checks.checks.every((check) => check.passed)).toBe(true);
    expect(processScore(checks.checks, 3, 3)).toBe(100);
  });

  it("blocks disallowed instruments and oversized positions", () => {
    const checks = evaluateProposal(masonPolicy, {
      ...demoProposal,
      instrument: "option",
      notional: 250,
      projectedPositionNotional: 250,
    });

    expect(checks.allowed).toBe(false);
    expect(checks.checks.find((check) => check.label === "Instrument permitted")?.passed).toBe(false);
    expect(checks.checks.find((check) => check.label === "Inside position cap")?.passed).toBe(false);
  });

  it("blocks incomplete decision records", () => {
    const checks = evaluateProposal(masonPolicy, {
      ...demoProposal,
      hasInvalidation: false,
    });

    expect(checks.allowed).toBe(false);
    expect(checks.checks.find((check) => check.label === "Decision record complete")?.passed).toBe(false);
  });
});

describe("owned-data import schema", () => {
  it("accepts a versioned broker event without credentials", () => {
    const parsed = importEventSchema.parse({
      schemaVersion: "runbook.event.v1",
      source: "robinhood-mcp",
      recordedAt: "2026-07-21T14:42:00.000Z",
      accountAlias: "Mason Agentic",
      event: {
        type: "fill",
        symbol: "VTI",
        side: "buy",
        quantity: 0.31,
        notional: 100,
      },
    });

    expect(parsed.event.symbol).toBe("VTI");
  });

  it("rejects an unknown source", () => {
    expect(() =>
      importEventSchema.parse({
        schemaVersion: "runbook.event.v1",
        source: "social-scraper",
        recordedAt: "2026-07-21T14:42:00.000Z",
        accountAlias: "test",
        event: { type: "fill", symbol: "VTI" },
      }),
    ).toThrow();
  });
});
