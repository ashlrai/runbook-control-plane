/**
 * First-run package fixtures under packages/mcp/examples/.
 * Ensures weak/elite policies parse and match @runbook/shadow-lab exports,
 * and sample-ledger-events has proposal+preflight pairs for meta-curriculum.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { riskPolicySchema } from "@runbook/engine/schema";
import {
  REFERENCE_ELITE_POLICY,
  WEAK_STARTER_POLICY,
  extractCurriculumCandidatesFromEvents,
  type MinimalLedgerEvent,
} from "@runbook/shadow-lab";

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../examples");

function readJson(name: string): unknown {
  const raw = readFileSync(join(EXAMPLES_DIR, name), "utf8");
  return JSON.parse(raw) as unknown;
}

function sha256File(name: string): string {
  const raw = readFileSync(join(EXAMPLES_DIR, name));
  return createHash("sha256").update(raw).digest("hex");
}

describe("packages/mcp/examples first-run fixtures", () => {
  it("ships the required first-run example JSON fixtures", () => {
    const names = new Set(readdirSync(EXAMPLES_DIR));
    for (const required of [
      "shadow-pilot.manifest.json",
      "weak-policy.json",
      "elite-policy.json",
      "sample-ledger-events.json",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("weak-policy.json exports WEAK_STARTER and parses as RiskPolicy", () => {
    const parsed = riskPolicySchema.parse(readJson("weak-policy.json"));
    expect(parsed).toEqual(WEAK_STARTER_POLICY);
    expect(sha256File("weak-policy.json")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("elite-policy.json exports REFERENCE_ELITE and parses as RiskPolicy", () => {
    const parsed = riskPolicySchema.parse(readJson("elite-policy.json"));
    expect(parsed).toEqual(REFERENCE_ELITE_POLICY);
    expect(sha256File("elite-policy.json")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sample-ledger-events.json has proposal+preflight pairs for meta-curriculum", () => {
    const events = readJson("sample-ledger-events.json") as MinimalLedgerEvent[];
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(6);

    const proposals = events.filter((e) => e.type === "proposal.recorded");
    const preflights = events.filter((e) => e.type === "preflight.completed");
    expect(proposals.length).toBeGreaterThanOrEqual(3);
    expect(preflights.length).toBe(proposals.length);

    const candidates = extractCurriculumCandidatesFromEvents(events);
    // Hard-deny pairs (BBBY, QQQ option, oversize) yield ledger-derived candidates.
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.every((c) => c.shouldAllow === false)).toBe(true);
    expect(candidates.every((c) => c.source === "ledger-derived")).toBe(true);
    expect(sha256File("sample-ledger-events.json")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("shadow-pilot.manifest.json remains disconnected zero-capital", () => {
    const manifest = readJson("shadow-pilot.manifest.json") as {
      schemaVersion: string;
      mode: string;
      brokerageConnection: string;
      capitalAtRisk: number;
    };
    expect(manifest.schemaVersion).toBe("runbook.shadow-pilot.v1");
    expect(manifest.mode).toBe("shadow");
    expect(manifest.brokerageConnection).toBe("disconnected");
    expect(manifest.capitalAtRisk).toBe(0);
  });
});
