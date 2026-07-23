/**
 * CLI smoke for shadow-curriculum, shadow-improve, agent-eval.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FileLedger } from "@runbook/engine/ledger";
import { REFERENCE_ELITE_POLICY } from "@runbook/shadow-lab";
import { RunbookService } from "./service.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("shadow lab CLI smoke", () => {
  it("shadow-curriculum prints process-quality JSON with hardFalseAllows", async () => {
    const result = await runCli(["shadow-curriculum"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const receipt = JSON.parse(result.stdout) as {
      schemaVersion: string;
      hardFalseAllows: number;
      brokerEffect: boolean;
      compositeScore: boolean;
      claims: { tradingPerformance: boolean; capitalAllocation: boolean };
      assurance: string;
    };
    expect(receipt.schemaVersion).toBe("runbook.shadow-curriculum.v1");
    expect(receipt.hardFalseAllows).toBeGreaterThan(0);
    expect(receipt.brokerEffect).toBe(false);
    expect(receipt.compositeScore).toBe(false);
    expect(receipt.claims.tradingPerformance).toBe(false);
    expect(receipt.claims.capitalAllocation).toBe(false);
    expect(receipt.assurance).toBe("process-observation-only");
  });

  it("shadow-improve reaches hardFalseAllowsFinal == 0", async () => {
    const result = await runCli(["shadow-improve", "--generations", "8"]);
    expect(result.code).toBe(0);
    const receipt = JSON.parse(result.stdout) as {
      schemaVersion: string;
      fixedPoint: boolean;
      hardFalseAllowsFinal: number;
      hardFalseAllowsInitial: number;
      claims: { tradingPerformance: boolean; capitalAllocation: boolean };
      brokerEffect: boolean;
    };
    expect(receipt.schemaVersion).toBe("runbook.shadow-improve.v1");
    expect(receipt.hardFalseAllowsInitial).toBeGreaterThan(0);
    expect(receipt.hardFalseAllowsFinal).toBe(0);
    expect(receipt.fixedPoint).toBe(true);
    expect(receipt.brokerEffect).toBe(false);
    expect(receipt.claims.tradingPerformance).toBe(false);
    expect(receipt.claims.capitalAllocation).toBe(false);
  });

  it("shadow-tournament prints Pareto front JSON", async () => {
    const result = await runCli([
      "shadow-tournament",
      "--generations",
      "3",
      "--mutants",
      "2",
      "--seed",
      "5",
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const receipt = JSON.parse(result.stdout) as {
      schemaVersion: string;
      paretoCount: number;
      candidateCount: number;
      capital: number;
      brokerEffect: boolean;
      compositeScore: boolean;
      claims: { tradingPerformance: boolean; capitalAllocation: boolean };
    };
    expect(receipt.schemaVersion).toBe("runbook.shadow-tournament.v1");
    expect(receipt.paretoCount).toBeGreaterThanOrEqual(1);
    expect(receipt.candidateCount).toBe(4);
    expect(receipt.capital).toBe(0);
    expect(receipt.brokerEffect).toBe(false);
    expect(receipt.compositeScore).toBe(false);
    expect(receipt.claims.tradingPerformance).toBe(false);
    expect(receipt.claims.capitalAllocation).toBe(false);
  });

  it("agent-eval prints runbook.agent-eval.v1 from a ledger", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "runbook-cli-eval-"));
    tempDirs.push(dataDir);
    const service = new RunbookService(new FileLedger(dataDir, "events"));
    const experimentId = "RUN-CLI-EVAL-001";
    await service.createExperiment({
      experimentId,
      name: "CLI eval",
      question: "smoke?",
      benchmark: "VTI",
      observationDays: 1,
      policy: REFERENCE_ELITE_POLICY,
      actor: { type: "agent", id: "cli-smoke" },
      occurredAt: "2026-07-22T15:00:00.000Z",
    });
    await service.preflight(
      {
        proposalId: "cli-p1",
        experimentId,
        symbol: "VTI",
        instrument: "equity",
        side: "buy",
        notional: 100,
        projectedPositionNotional: 100,
        dailyTradesAfter: 1,
        currentDrawdownPercent: 0.5,
        hasThesis: true,
        hasInvalidation: true,
        evidenceSourceCount: 1,
      },
      { type: "agent", id: "cli-smoke" },
      "2026-07-22T15:01:00.000Z",
    );

    const result = await runCli([
      "agent-eval",
      "--experiment",
      experimentId,
      "--data-dir",
      dataDir,
      "--ledger-id",
      "events",
    ]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: string;
      brokerEffect: boolean;
      compositeScore: boolean;
      processCorrect: boolean;
      assurance: string;
      claims: { processQuality: boolean; tradingPerformance: boolean };
      processObservation: string;
      summaryAxes: {
        charterPresent: boolean;
        approvalRequired: boolean;
        equitiesOnly: boolean;
        preflightCoverage: { proposals: number; withPairedPreflight: number };
        unauthorizedExecutionAttempts: number;
        deniedSymbolAllowed: number;
      };
    };
    expect(report.schemaVersion).toBe("runbook.agent-eval.v1");
    expect(report.brokerEffect).toBe(false);
    expect(report.compositeScore).toBe(false);
    expect(report.processCorrect).toBe(true);
    expect(report.assurance).toBe("process-observation-only");
    expect(report.claims.processQuality).toBe(true);
    expect(report.claims.tradingPerformance).toBe(false);
    expect(report.processObservation).toBe("process-observation-only");
    expect(report.summaryAxes).toMatchObject({
      charterPresent: true,
      approvalRequired: true,
      equitiesOnly: true,
      preflightCoverage: { proposals: 1, withPairedPreflight: 1 },
      unauthorizedExecutionAttempts: 0,
      deniedSymbolAllowed: 0,
    });
  });
});
