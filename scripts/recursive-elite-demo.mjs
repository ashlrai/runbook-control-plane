#!/usr/bin/env node
/**
 * End-to-end recursive elite shadow process demo.
 *
 * 1. Start from weak policy (options+crypto, no denylist, high notional)
 * 2. Run curriculum → hardFalseAllows > 0
 * 3. Recursive improve to fixed point
 * 4. Show hardFalseAllows == 0
 * 5. Create MCP service ledger experiment with refined policy + synthetic preflights
 * 6. agent-eval report
 * 7. Exit 0 with runbook.recursive-elite-demo.v1 summary receipt
 *
 * Honest scope: process quality only — not trading performance, not capital allocation.
 * brokerEffect: false throughout.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

async function loadDeps() {
  const shadowLabEntry = require.resolve("@runbook/shadow-lab", {
    paths: [join(REPO_ROOT, "packages/mcp"), join(REPO_ROOT, "packages/shadow-lab")],
  });
  const shadowLab = await import(pathToFileURL(shadowLabEntry).href);

  const engineLedgerPath = require.resolve("@runbook/engine/ledger", {
    paths: [join(REPO_ROOT, "packages/mcp")],
  });
  const { FileLedger } = await import(pathToFileURL(engineLedgerPath).href);

  const servicePath = join(REPO_ROOT, "packages/mcp/dist/service.js");
  const shadowToolsPath = join(REPO_ROOT, "packages/mcp/dist/shadow-tools.js");
  const { RunbookService } = await import(pathToFileURL(servicePath).href);
  const { evaluateAgentProcess } = await import(pathToFileURL(shadowToolsPath).href);

  return { ...shadowLab, FileLedger, RunbookService, evaluateAgentProcess };
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

async function main() {
  let deps;
  try {
    deps = await loadDeps();
  } catch (error) {
    fail(
      `Failed to load built packages. Run: pnpm --filter @runbook/shadow-lab build && pnpm mcp:build (${
        error instanceof Error ? error.message : error
      })`,
    );
  }

  const {
    WEAK_STARTER_POLICY,
    evaluateCharter,
    runRecursiveImprovement,
    FileLedger,
    RunbookService,
    evaluateAgentProcess,
  } = deps;

  const dataDir = await mkdtemp(join(tmpdir(), "runbook-elite-demo-"));
  const experimentId = "RUN-ELITE-DEMO-001";
  const actor = { type: "agent", id: "recursive-elite-demo" };
  const occurredAt = "2026-07-22T18:00:00.000Z";

  try {
    // 1–2. Weak policy curriculum
    const weakCurriculum = evaluateCharter(WEAK_STARTER_POLICY);
    if (!(weakCurriculum.metrics.hardFalseAllows > 0)) {
      fail("Expected weak policy hardFalseAllows > 0 (process quality curriculum).");
    }

    // 3–4. Recursive improve to fixed point
    const improve = runRecursiveImprovement(WEAK_STARTER_POLICY, 8);
    const eliteCurriculum = evaluateCharter(improve.finalPolicy);
    if (eliteCurriculum.metrics.hardFalseAllows !== 0) {
      fail(
        `Expected refined policy hardFalseAllows == 0, got ${eliteCurriculum.metrics.hardFalseAllows}.`,
      );
    }

    // 5. Ledger experiment with refined policy + synthetic preflights
    const ledger = new FileLedger(dataDir, "elite-demo");
    const service = new RunbookService(ledger);

    await service.createExperiment({
      experimentId,
      name: "Recursive Elite Shadow Demo",
      question: "Does recursive policy improve eliminate curriculum hard false allows?",
      benchmark: "VTI",
      observationDays: 30,
      policy: improve.finalPolicy,
      actor,
      occurredAt,
    });

    await service.preflight(
      {
        proposalId: "elite-demo-allowed-001",
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
        evidenceSourceCount: 2,
      },
      actor,
      "2026-07-22T18:01:00.000Z",
    );

    await service.preflight(
      {
        proposalId: "elite-demo-denied-gme-001",
        experimentId,
        symbol: "GME",
        instrument: "equity",
        side: "buy",
        notional: 50,
        projectedPositionNotional: 50,
        dailyTradesAfter: 1,
        currentDrawdownPercent: 0.5,
        hasThesis: true,
        hasInvalidation: true,
        evidenceSourceCount: 2,
      },
      actor,
      "2026-07-22T18:02:00.000Z",
    );

    await service.preflight(
      {
        proposalId: "elite-demo-denied-option-001",
        experimentId,
        symbol: "SPY",
        instrument: "option",
        side: "buy",
        notional: 50,
        projectedPositionNotional: 50,
        dailyTradesAfter: 1,
        currentDrawdownPercent: 0.5,
        hasThesis: true,
        hasInvalidation: true,
        evidenceSourceCount: 2,
      },
      actor,
      "2026-07-22T18:03:00.000Z",
    );

    const verification = await service.verify();
    if (!verification.valid) {
      fail(`Ledger verification failed: ${verification.errors.join("; ")}`);
    }

    // 6. agent-eval
    const events = await service.listEvents(experimentId);
    const agentEval = evaluateAgentProcess(experimentId, events);

    if (agentEval.schemaVersion !== "runbook.agent-eval.v1") {
      fail("agent-eval schema mismatch.");
    }
    if (agentEval.brokerEffect !== false) fail("agent-eval must report brokerEffect false.");
    if (agentEval.compositeScore !== false) fail("agent-eval must not invent a composite score.");
    if (agentEval.notTradingPerformance !== true) {
      fail("agent-eval must declare notTradingPerformance.");
    }
    if (!agentEval.processCorrect) {
      fail(`agent-eval processCorrect false: ${JSON.stringify(agentEval.axes)}`);
    }

    // 7. Summary receipt
    const receipt = {
      schemaVersion: "runbook.recursive-elite-demo.v1",
      success: true,
      experimentId,
      dataDir,
      weakCurriculum: {
        hardFalseAllows: weakCurriculum.metrics.hardFalseAllows,
        hardFalseDenies: weakCurriculum.metrics.hardFalseDenies,
        scenarioCount: weakCurriculum.scenarioCount,
      },
      improve: {
        generationCount: improve.generationCount,
        terminatedReason: improve.terminatedReason,
        hardFalseAllowsInitial: improve.initialMetrics.hardFalseAllows,
        hardFalseAllowsFinal: improve.finalMetrics.hardFalseAllows,
        hardFalseDeniesFinal: improve.finalMetrics.hardFalseDenies,
        rationaleCodes: [
          ...new Set(improve.generations.flatMap((gen) => gen.rationaleCodes)),
        ],
      },
      eliteCurriculum: {
        hardFalseAllows: eliteCurriculum.metrics.hardFalseAllows,
        hardFalseDenies: eliteCurriculum.metrics.hardFalseDenies,
        scenarioCount: eliteCurriculum.scenarioCount,
      },
      finalPolicy: improve.finalPolicy,
      ledger: {
        valid: verification.valid,
        eventCount: verification.eventCount,
      },
      agentEval,
      claims: {
        processQuality: true,
        tradingPerformance: false,
        capitalAllocation: false,
      },
      brokerEffect: false,
      compositeScore: false,
      assurance: "process-observation-only",
      notes: [
        "Demonstrates recursive process-quality improvement of a shadow risk policy.",
        "Not trading performance.",
        "Not capital allocation.",
        "No broker side effects (brokerEffect: false).",
      ],
    };

    await writeFile(join(dataDir, "recursive-elite-demo.receipt.json"), JSON.stringify(receipt, null, 2), {
      mode: 0o600,
    });

    console.log(JSON.stringify(receipt, null, 2));
    console.log("");
    console.log("================================================================================");
    console.log(" RECURSIVE ELITE DEMO — SUCCESS");
    console.log("================================================================================");
    console.log(
      ` hardFalseAllows: ${receipt.improve.hardFalseAllowsInitial} → ${receipt.improve.hardFalseAllowsFinal} | processCorrect: ${agentEval.processCorrect}`,
    );
    console.log(
      ` generations: ${receipt.improve.generationCount} | terminated: ${receipt.improve.terminatedReason} | ledger.valid: ${receipt.ledger.valid}`,
    );
    console.log(
      " brokerEffect: false | compositeScore: false | claims: process quality only (not trading / not capital)",
    );
    console.log(` schema: ${receipt.schemaVersion}`);
    console.log("================================================================================");
    process.exitCode = 0;
  } finally {
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "recursive-elite-demo failed.");
  process.exit(1);
});
