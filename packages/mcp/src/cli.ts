#!/usr/bin/env node

import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { FileLedger } from "@runbook/engine/ledger";
import { riskPolicySchema, type RiskPolicy } from "@runbook/engine/schema";
import {
  WEAK_STARTER_POLICY,
  evaluateCharter,
  runRecursiveImprovement,
  runShadowTournament,
} from "@runbook/shadow-lab";
import { runCapsuleVerificationCommand } from "./capsule-command.js";
import { runCheckpointVerificationCommand } from "./checkpoint-command.js";
import { runControlPlaneStory } from "./control-plane-story.js";
import { runGoldenJourney } from "./golden-journey.js";
import { diagnoseShadowPilot, shadowPilotManifestSchema } from "./pilot-doctor.js";
import { buildPublicSnapshot } from "./public-snapshot.js";
import { RunbookService } from "./service.js";
import { evaluateAgentProcess } from "./shadow-tools.js";

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function usage() {
  return [
    "Runbook local ledger CLI",
    "",
    "Usage:",
    "  runbook verify [--data-dir ABSOLUTE_PATH] [--ledger-id ID]",
    "  runbook export-public EXPERIMENT_ID [--data-dir ABSOLUTE_PATH] [--ledger-id ID]",
    "  runbook pilot-doctor MANIFEST_PATH [--data-dir ABSOLUTE_PATH] [--ledger-id ID] [--workspace-root ABSOLUTE_PATH]",
    "  runbook golden-journey [--data-dir ABSOLUTE_PATH] [--workspace-root ABSOLUTE_PATH] [--keep-temp]",
    "  runbook control-plane-story [--data-dir ABSOLUTE_PATH] [--keep-temp] [--session-id ID] [--experiment-id ID]",
    "  runbook shadow-curriculum [--policy path.json]",
    "  runbook shadow-improve [--policy path.json] [--generations N]",
    "  runbook shadow-tournament [--generations N] [--mutants N] [--seed N]",
    "  runbook agent-eval --experiment RUN-ID --data-dir DIR [--ledger-id ID]",
    "  runbook verify-checkpoint ENVELOPE_JSON STATEMENT_JSON PUBLIC_KEY_DER",
    "  runbook verify-capsule CAPSULE.runbook",
    "",
    "Public exports contain event metadata only. They exclude payloads, actors, idempotency keys, and broker IDs.",
    "pilot-doctor is offline and never connects to a broker. Its result is local readiness evidence, not enforcement.",
    "golden-journey runs the protocol-level shadow pilot + offline demos and prints runbook.golden-journey-receipt.v1.",
    "control-plane-story runs session spine: weak charter → pin inventory → shadow improve HFA=0 → bind experiment → agent-eval → export pack.",
    "shadow-curriculum scores hardFalseAllows for process quality only (not trading performance).",
    "shadow-improve recursively repairs policy toward a process-quality fixed point (not capital allocation).",
    "shadow-tournament runs multi-charter Pareto search on hardFalseAllows vs hardFalseDenies (process only).",
    "agent-eval emits runbook.agent-eval.v1 axes from a local ledger experiment (process quality only).",
    "verify-checkpoint reads exact local bytes and verifies only an Ed25519 SPKI public key. It never signs or connects to a broker.",
    "verify-capsule reads one bounded local file, emits a deterministic receipt, and never extracts, renders, uploads, or executes a member.",
  ].join("\n");
}

async function loadPolicy(path: string | undefined, fallback: RiskPolicy): Promise<RiskPolicy> {
  if (path === undefined) return riskPolicySchema.parse(fallback);
  const absolute = resolve(path);
  const raw = JSON.parse(await readFile(absolute, "utf8")) as unknown;
  return riskPolicySchema.parse(raw);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "verify-checkpoint") {
    const commandResult = await runCheckpointVerificationCommand(args.slice(1));
    process.exitCode = commandResult.exitCode;
    return;
  }

  if (command === "verify-capsule") {
    try {
      const commandResult = await runCapsuleVerificationCommand(args.slice(1));
      process.exitCode = commandResult.exitCode;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Capsule input could not be read.");
      process.exitCode = 2;
    }
    return;
  }

  if (command === "golden-journey") {
    const dataDir = option(args, "--data-dir");
    const workspaceRoot = option(args, "--workspace-root");
    const keepTemp = args.includes("--keep-temp");
    const result = await runGoldenJourney({
      ...(dataDir !== undefined ? { dataDir } : {}),
      ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      keepTempDir: keepTemp,
    });
    console.log(JSON.stringify(result.receipt, null, 2));
    process.exitCode = result.exitCode;
    return;
  }

  if (command === "control-plane-story") {
    const dataDir = option(args, "--data-dir");
    const sessionId = option(args, "--session-id");
    const experimentId = option(args, "--experiment-id");
    const keepTemp = args.includes("--keep-temp");
    const result = await runControlPlaneStory({
      ...(dataDir !== undefined ? { dataDir } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(experimentId !== undefined ? { experimentId } : {}),
      keepTempDir: keepTemp,
    });
    console.log(JSON.stringify(result.receipt, null, 2));
    if (result.banner) {
      console.log(result.banner);
    }
    process.exitCode = result.exitCode;
    return;
  }

  if (command === "shadow-curriculum") {
    const policyPath = option(args, "--policy");
    const policy = await loadPolicy(policyPath, WEAK_STARTER_POLICY);
    const report = evaluateCharter(policy);
    const receipt = {
      schemaVersion: "runbook.shadow-curriculum.v1" as const,
      curriculumReportSchema: report.schemaVersion,
      policy,
      hardFalseAllows: report.metrics.hardFalseAllows,
      hardFalseDenies: report.metrics.hardFalseDenies,
      trueAllows: report.metrics.trueAllows,
      trueDenies: report.metrics.trueDenies,
      advisoryGaps: report.metrics.advisoryGaps,
      scenarioCount: report.scenarioCount,
      tagCoverage: report.tagCoverage,
      scenarios: report.scenarios,
      claims: {
        processQuality: true as const,
        tradingPerformance: false as const,
        capitalAllocation: false as const,
      },
      brokerEffect: false as const,
      compositeScore: false as const,
      assurance: "process-observation-only" as const,
      note: report.note,
    };
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = 0;
    return;
  }

  if (command === "shadow-improve") {
    const policyPath = option(args, "--policy");
    const generationsRaw = option(args, "--generations");
    const generations = generationsRaw === undefined ? 8 : Number(generationsRaw);
    if (!Number.isInteger(generations) || generations < 1 || generations > 100) {
      throw new Error("shadow-improve --generations must be an integer from 1 to 100.");
    }
    const policy = await loadPolicy(policyPath, WEAK_STARTER_POLICY);
    const result = runRecursiveImprovement(policy, generations);
    const fixedPoint =
      result.terminatedReason === "fixed-point" && result.finalMetrics.hardFalseAllows === 0;
    const receipt = {
      schemaVersion: "runbook.shadow-improve.v1" as const,
      improvementSchema: result.schemaVersion,
      initialPolicy: result.initialPolicy,
      finalPolicy: result.finalPolicy,
      generationCount: result.generationCount,
      maxGenerations: result.maxGenerations,
      terminatedReason: result.terminatedReason,
      fixedPoint,
      hardFalseAllowsInitial: result.initialMetrics.hardFalseAllows,
      hardFalseAllowsFinal: result.finalMetrics.hardFalseAllows,
      hardFalseDeniesInitial: result.initialMetrics.hardFalseDenies,
      hardFalseDeniesFinal: result.finalMetrics.hardFalseDenies,
      generations: result.generations.map((gen) => ({
        generation: gen.generation,
        hardFalseAllowsBefore: gen.metricsBefore.hardFalseAllows,
        hardFalseAllowsAfter: gen.metricsAfter.hardFalseAllows,
        rationaleCodes: gen.rationaleCodes,
        deltas: gen.deltas,
        fixedPoint: gen.fixedPoint,
      })),
      claims: {
        processQuality: true as const,
        tradingPerformance: false as const,
        capitalAllocation: false as const,
      },
      brokerEffect: false as const,
      compositeScore: false as const,
      assurance: "process-observation-only" as const,
      note: result.note,
    };
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = fixedPoint ? 0 : 2;
    return;
  }

  if (command === "shadow-tournament") {
    const generationsRaw = option(args, "--generations");
    const mutantsRaw = option(args, "--mutants");
    const seedRaw = option(args, "--seed");
    const generations = generationsRaw === undefined ? 4 : Number(generationsRaw);
    const mutants = mutantsRaw === undefined ? 6 : Number(mutantsRaw);
    const seed = seedRaw === undefined ? 1 : Number(seedRaw);
    if (!Number.isInteger(generations) || generations < 1 || generations > 20) {
      throw new Error("shadow-tournament --generations must be an integer from 1 to 20.");
    }
    if (!Number.isInteger(mutants) || mutants < 0 || mutants > 50) {
      throw new Error("shadow-tournament --mutants must be an integer from 0 to 50.");
    }
    if (!Number.isInteger(seed)) {
      throw new Error("shadow-tournament --seed must be an integer.");
    }
    const result = runShadowTournament({
      maxGenerations: generations,
      mutantCount: mutants,
      seed,
    });
    const receipt = {
      schemaVersion: "runbook.shadow-tournament.v1" as const,
      maxGenerations: result.maxGenerations,
      mutantCount: result.mutantCount,
      seed: result.seed,
      candidateCount: result.candidateCount,
      paretoCount: result.paretoCount,
      paretoFront: result.paretoFront.map((candidate) => ({
        id: candidate.id,
        seedKind: candidate.seedKind,
        hardFalseAllows: candidate.hardFalseAllows,
        hardFalseDenies: candidate.hardFalseDenies,
        processCorrect: candidate.processCorrect,
        lineage: candidate.lineage,
        finalPolicy: candidate.finalPolicy,
      })),
      candidates: result.candidates.map((candidate) => ({
        id: candidate.id,
        seedKind: candidate.seedKind,
        hardFalseAllows: candidate.hardFalseAllows,
        hardFalseDenies: candidate.hardFalseDenies,
        processCorrect: candidate.processCorrect,
        initialHardFalseAllows: candidate.initialHardFalseAllows,
        initialHardFalseDenies: candidate.initialHardFalseDenies,
        onParetoFront: candidate.onParetoFront,
        lineage: candidate.lineage,
        finalPolicy: candidate.finalPolicy,
      })),
      claims: {
        processQuality: true as const,
        tradingPerformance: false as const,
        capitalAllocation: false as const,
      },
      capital: 0 as const,
      brokerEffect: false as const,
      compositeScore: false as const,
      notTradingPerformance: true as const,
      assurance: "synthetic-curriculum-process-quality-only" as const,
      note: result.note,
    };
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = 0;
    return;
  }

  if (command === "agent-eval") {
    const experimentId = option(args, "--experiment");
    const dataDir = option(args, "--data-dir");
    if (!experimentId || experimentId.startsWith("--")) {
      throw new Error("agent-eval requires --experiment RUN-ID.");
    }
    if (!dataDir || dataDir.startsWith("--")) {
      throw new Error("agent-eval requires --data-dir DIR (absolute).");
    }
    if (!isAbsolute(dataDir)) throw new Error("agent-eval --data-dir must be absolute.");
    const ledgerId = option(args, "--ledger-id") ?? process.env.RUNBOOK_LEDGER_ID ?? "events";
    const service = new RunbookService(new FileLedger(dataDir, ledgerId));
    const events = await service.listEvents(experimentId);
    const report = evaluateAgentProcess(experimentId, events);
    // CLI receipt keeps honest process-quality language; axes remain multi-field (never one grade).
    const receipt = {
      ...report,
      claims: {
        processQuality: true as const,
        tradingPerformance: false as const,
        capitalAllocation: false as const,
      },
      // Align wording with process-observation-only without erasing the local-ledger detail.
      processObservation: "process-observation-only" as const,
    };
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = 0;
    return;
  }

  const rootDir = option(args, "--data-dir") ?? process.env.RUNBOOK_DATA_DIR ?? join(homedir(), ".runbook");
  if (!isAbsolute(rootDir)) throw new Error("Runbook data directory must be absolute.");
  const ledgerId = option(args, "--ledger-id") ?? process.env.RUNBOOK_LEDGER_ID ?? "events";
  const service = new RunbookService(new FileLedger(rootDir, ledgerId));

  if (command === "verify") {
    const verification = await service.verify();
    console.log(JSON.stringify({ ...verification, assurance: "local-tamper-evidence-only" }, null, 2));
    if (!verification.valid) process.exitCode = 2;
    return;
  }

  if (command === "export-public") {
    const experimentId = args[1];
    if (!experimentId || experimentId.startsWith("--")) throw new Error("export-public requires an experiment ID.");
    console.log(JSON.stringify(await buildPublicSnapshot(service, experimentId), null, 2));
    return;
  }

  if (command === "pilot-doctor") {
    const manifestPath = args[1];
    if (!manifestPath || manifestPath.startsWith("--")) throw new Error("pilot-doctor requires a manifest path.");
    const workspaceRoot = option(args, "--workspace-root") ?? process.cwd();
    if (!isAbsolute(workspaceRoot)) throw new Error("Runbook workspace root must be absolute.");
    const manifest = shadowPilotManifestSchema.parse(JSON.parse(await readFile(resolve(manifestPath), "utf8")));
    const report = await diagnoseShadowPilot({ manifest, service, dataDir: rootDir, workspaceRoot });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 2;
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Runbook CLI failed.");
  process.exit(1);
});
