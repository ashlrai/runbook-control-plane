/**
 * End-to-end control-plane session spine story.
 *
 * 1. Create session with weak charter
 * 2. Pin public-docs inventory
 * 3. Shadow-improve to hardFalseAllows == 0
 * 4. Record shadow + set charter on session
 * 5. Create experiment bound to session
 * 6. agent_eval
 * 7. Export session pack
 * 8. Human SUCCESS banner
 *
 * Process evidence only — not trading performance, capital 0, brokerEffect false.
 */

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateProposal } from "@runbook/engine/policy";
import { FileLedger } from "@runbook/engine/ledger";
import {
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  parseToolsListJsonText,
  SessionStore,
  defaultSessionRoot,
  charterDigest,
} from "@runbook/session";
import { WEAK_STARTER_POLICY, runRecursiveImprovement } from "@runbook/shadow-lab";
import { RunbookService } from "./service.js";
import { evaluateAgentProcess } from "./shadow-tools.js";
import { TOOL_NAMES } from "./surface.js";
import { writeActiveSession } from "./session-context.js";

const SAMPLE_TOOLS_LIST = fileURLToPath(
  new URL("../examples/sample-tools-list.json", import.meta.url),
);

export const CONTROL_PLANE_STORY_SCHEMA = "runbook.control-plane-story.v1" as const;

export type ControlPlaneStoryReceipt = {
  schemaVersion: typeof CONTROL_PLANE_STORY_SCHEMA;
  sessionId: string;
  experimentId: string;
  initialHardFalseAllows: number;
  finalHardFalseAllows: number;
  finalHardFalseDenies: number;
  fixedPoint: boolean;
  inventoryToolCount: number;
  inventoryImportOk: boolean;
  inventoryUnknownCount: number;
  preflightSessionBinding: string;
  experimentBound: boolean;
  agentEvalProcessCorrect: boolean;
  packSchemaVersion: string;
  toolCount: number;
  dataDir: string;
  capitalAtRisk: 0;
  brokerEffect: false;
  compositeScore: false;
  notTradingPerformance: true;
  success: boolean;
  errors: string[];
};

export type ControlPlaneStoryOptions = Readonly<{
  dataDir?: string;
  keepTempDir?: boolean;
  sessionId?: string;
  experimentId?: string;
  maxGenerations?: number;
}>;

export type ControlPlaneStoryResult = Readonly<{
  receipt: ControlPlaneStoryReceipt;
  dataDir: string;
  tempDirCreated: boolean;
  exitCode: 0 | 1;
  banner: string;
}>;

const SUCCESS_BANNER = [
  "",
  "╔══════════════════════════════════════════════════════════════╗",
  "║  SUCCESS — control-plane session spine story complete        ║",
  "║  session + inventory pin + shadow HFA=0 + experiment + pack  ║",
  "║  process evidence only · brokerEffect false · capital 0       ║",
  "╚══════════════════════════════════════════════════════════════╝",
  "",
].join("\n");

export async function runControlPlaneStory(
  options: ControlPlaneStoryOptions = {},
): Promise<ControlPlaneStoryResult> {
  const errors: string[] = [];
  let tempDirCreated = false;
  let directory: string;

  if (options.dataDir !== undefined && options.dataDir.length > 0) {
    if (!isAbsolute(options.dataDir)) {
      throw new Error("control-plane-story --data-dir must be absolute.");
    }
    directory = resolve(options.dataDir);
  } else {
    directory = await mkdtemp(join(tmpdir(), "runbook-cps-story-"));
    tempDirCreated = true;
  }

  await chmod(directory, 0o700).catch(() => {
    // Best-effort private dir.
  });

  const sessionId = options.sessionId ?? "CPS-STORY-001";
  const experimentId = options.experimentId ?? "RUN-CPS-STORY-001";
  const maxGenerations = options.maxGenerations ?? 8;
  const actor = { type: "agent" as const, id: "control-plane-story" };
  const occurredAt = "2026-07-22T20:00:00.000Z";

  const receipt: ControlPlaneStoryReceipt = {
    schemaVersion: CONTROL_PLANE_STORY_SCHEMA,
    sessionId,
    experimentId,
    initialHardFalseAllows: -1,
    finalHardFalseAllows: -1,
    finalHardFalseDenies: -1,
    fixedPoint: false,
    inventoryToolCount: 0,
    inventoryImportOk: false,
    inventoryUnknownCount: -1,
    preflightSessionBinding: "unset",
    experimentBound: false,
    agentEvalProcessCorrect: false,
    packSchemaVersion: "",
    toolCount: TOOL_NAMES.length,
    dataDir: directory,
    capitalAtRisk: 0,
    brokerEffect: false,
    compositeScore: false,
    notTradingPerformance: true,
    success: false,
    errors: [],
  };

  try {
    const store = new SessionStore({ rootDir: defaultSessionRoot(directory) });
    const service = new RunbookService(new FileLedger(directory, "control-plane-story"));

    // 1. Session with weak charter
    const session = await store.create({
      sessionId,
      label: "Control plane story (weak charter)",
      charter: WEAK_STARTER_POLICY,
      inventoryEnforcement: "fail-closed",
    });
    if (session.sessionId !== sessionId) {
      errors.push("session-id-mismatch");
    }
    await writeActiveSession(directory, sessionId);

    // 2. Pin inventory
    const pin = buildPublicDocsInventoryPin({ label: "Story public-docs pin" });
    await store.setInventoryPin(sessionId, pin);
    receipt.inventoryToolCount = pin.tools.length;
    if (pin.tools.length < 1) errors.push("inventory-pin-empty");

    // 2b. Import operator tools/list snapshot (local file only) — expect unknown tool fail-closed
    try {
      const toolsRaw = await readFile(SAMPLE_TOOLS_LIST, "utf8");
      const parsed = parseToolsListJsonText(toolsRaw);
      const check = checkObservedToolsAgainstPin(pin, parsed.toolNames, "fail-closed");
      receipt.inventoryImportOk = check.ok === false && check.unknownTools.length > 0;
      receipt.inventoryUnknownCount = check.unknownTools.length;
      if (check.unknownTools.length < 1) {
        errors.push("inventory-import-expected-unknown-tool");
      }
      if (check.brokerEffect !== false) errors.push("inventory-import-broker-effect");
    } catch (error) {
      errors.push(
        `inventory-import-failed:${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    // 3. Shadow improve to HFA 0
    const improve = runRecursiveImprovement(WEAK_STARTER_POLICY, maxGenerations);
    receipt.initialHardFalseAllows = improve.initialMetrics.hardFalseAllows;
    receipt.finalHardFalseAllows = improve.finalMetrics.hardFalseAllows;
    receipt.finalHardFalseDenies = improve.finalMetrics.hardFalseDenies;
    receipt.fixedPoint =
      improve.terminatedReason === "fixed-point" && improve.finalMetrics.hardFalseAllows === 0;
    if (improve.finalMetrics.hardFalseAllows !== 0) {
      errors.push(`shadow-hfa-not-zero:${improve.finalMetrics.hardFalseAllows}`);
    }
    if (improve.initialMetrics.hardFalseAllows <= 0) {
      errors.push("weak-starter-expected-hfa-gt-0");
    }

    // 4. Record shadow + set improved charter on session
    const gen = Math.max(1, improve.generationCount);
    await store.recordShadowGeneration(sessionId, {
      generation: gen,
      hardFalseAllows: improve.finalMetrics.hardFalseAllows,
      hardFalseDenies: improve.finalMetrics.hardFalseDenies,
    });
    await store.setCharter(sessionId, improve.finalPolicy);

    // 5. Create experiment bound to session
    const created = await service.createExperiment({
      experimentId,
      name: "Control plane story experiment",
      question: "Does the session spine bind shadow-improved charter to a local experiment?",
      benchmark: "SPY",
      observationDays: 1,
      policy: improve.finalPolicy,
      actor,
      occurredAt,
    });
    await store.bindExperiment(sessionId, experimentId, created.charter.hash);
    const bound = await store.read(sessionId);
    receipt.experimentBound = bound.experimentId === experimentId;
    if (!receipt.experimentBound) errors.push("experiment-not-bound");

    // 5b. Preflight against ledger + session charter binding (advisory dual eval)
    const cleanProposal = {
      proposalId: "story-vti-001",
      experimentId,
      symbol: "VTI",
      instrument: "equity" as const,
      side: "buy" as const,
      notional: 50,
      projectedPositionNotional: 50,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 0.5,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    };
    const preflight = await service.preflight(cleanProposal, actor, "2026-07-22T20:05:00.000Z");
    const sessionAfter = await store.read(sessionId);
    if (sessionAfter.charter === undefined) {
      errors.push("session-charter-missing-for-preflight");
      receipt.preflightSessionBinding = "no-session-charter";
    } else {
      const sessionAllowed = evaluateProposal(sessionAfter.charter, cleanProposal).allowed;
      const digest = sessionAfter.charterDigest ?? charterDigest(sessionAfter.charter);
      if (sessionAllowed === preflight.result.allowed) {
        receipt.preflightSessionBinding = sessionAllowed ? "matched-allowed" : "matched-denied";
      } else {
        receipt.preflightSessionBinding = sessionAllowed
          ? "mismatch-session-allows"
          : "mismatch-session-denies";
        errors.push(`preflight-session-mismatch:${receipt.preflightSessionBinding}`);
      }
      if (digest.length !== 64) errors.push("session-charter-digest-invalid");
      if (!preflight.result.allowed) errors.push("clean-preflight-expected-allowed");
    }

    // 6. agent_eval
    const events = await service.listEvents(experimentId);
    const evalReport = evaluateAgentProcess(experimentId, events);
    receipt.agentEvalProcessCorrect = evalReport.processCorrect;
    if (!evalReport.processCorrect) {
      const failed = evalReport.axes.filter((a) => !a.passed).map((a) => a.id);
      errors.push(`agent-eval-failed:${failed.join(",")}`);
    }
    if (evalReport.brokerEffect !== false || evalReport.compositeScore !== false) {
      errors.push("agent-eval-claims-violation");
    }

    // 7. Export pack
    const pack = await store.exportPack(sessionId);
    receipt.packSchemaVersion = pack.schemaVersion;
    if (pack.schemaVersion !== "runbook.session-evidence-pack.v1") {
      errors.push("pack-schema-mismatch");
    }
    if (pack.brokerEffect !== false || pack.compositeScore !== false) {
      errors.push("pack-claims-violation");
    }
    if (pack.session.lastShadowHardFalseAllows !== 0) {
      errors.push("pack-last-hfa-not-zero");
    }

    receipt.errors = errors;
    receipt.success = errors.length === 0;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "control-plane-story-failed");
    receipt.errors = errors;
    receipt.success = false;
  } finally {
    if (tempDirCreated && !options.keepTempDir) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    receipt,
    dataDir: directory,
    tempDirCreated,
    exitCode: receipt.success ? 0 : 1,
    banner: receipt.success ? SUCCESS_BANNER : "",
  };
}
