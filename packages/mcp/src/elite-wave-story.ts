/**
 * Elite wave demo story: control-plane spine + surface lock + process tick + seal.
 *
 * Extends control-plane-story success with:
 * 1. buildSurfaceLockReceipt
 * 2. process_tick-style inventory check with an unknown tool (expect stop)
 * 3. seal process capsule (synthetic)
 *
 * Process evidence only — brokerEffect false, capital 0, not trading performance.
 */

import { webcrypto } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  buildProcessCapsulePayloads,
  checkObservedToolsAgainstPin,
  processCapsuleExperimentId,
  resolveProcessTick,
  SessionStore,
  defaultSessionRoot,
} from "@runbook/session";
import {
  finalizeProofCapsule,
  prepareProofCapsule,
  type CapsulePayloadMember,
} from "@runbook/capsule-author";
import { runControlPlaneStory, type ControlPlaneStoryOptions } from "./control-plane-story.js";
import { TOOL_NAMES } from "./surface.js";
import { buildSurfaceLockReceipt } from "./surface-lock.js";

export const ELITE_WAVE_STORY_SCHEMA = "runbook.elite-wave-story.v1" as const;

export type EliteWaveStoryReceipt = {
  schemaVersion: typeof ELITE_WAVE_STORY_SCHEMA;
  controlPlaneSuccess: boolean;
  sessionId: string;
  experimentId: string;
  toolCount: number;
  surfaceLock: {
    toolCount: number;
    serverVersion: string;
    toolSetSha256: string;
    hasPlaceOrCancelTools: false;
  };
  processTick: {
    recommendation: "proceed" | "warn" | "stop";
    inventoryOk: boolean;
    inventoryUnknownTools: string[];
  };
  seal: {
    capsuleId: string;
    archiveSha256: string;
    experimentId: string;
  } | null;
  capitalAtRisk: 0;
  brokerEffect: false;
  compositeScore: false;
  notTradingPerformance: true;
  success: boolean;
  errors: string[];
  dataDir: string;
};

export type EliteWaveStoryOptions = ControlPlaneStoryOptions & {
  /** Skip expensive process capsule seal (default: seal). */
  skipSeal?: boolean;
};

export type EliteWaveStoryResult = Readonly<{
  receipt: EliteWaveStoryReceipt;
  dataDir: string;
  tempDirCreated: boolean;
  exitCode: 0 | 1;
  banner: string;
}>;

const SUCCESS_BANNER = [
  "",
  "╔══════════════════════════════════════════════════════════════╗",
  "║  SUCCESS — elite-wave story complete                         ║",
  "║  control-plane + surface lock + process_tick stop + seal      ║",
  "║  process evidence only · brokerEffect false · capital 0       ║",
  "╚══════════════════════════════════════════════════════════════╝",
  "",
].join("\n");

export async function runEliteWaveStory(
  options: EliteWaveStoryOptions = {},
): Promise<EliteWaveStoryResult> {
  const errors: string[] = [];
  const skipSeal = options.skipSeal === true;

  // Keep control-plane temp dir until elite steps finish; we own cleanup when we created it.
  const cps = await runControlPlaneStory({
    ...options,
    keepTempDir: true,
  });

  const sessionId = cps.receipt.sessionId;
  const experimentId = cps.receipt.experimentId;
  const directory = cps.dataDir;
  const tempDirCreated = cps.tempDirCreated;

  const receipt: EliteWaveStoryReceipt = {
    schemaVersion: ELITE_WAVE_STORY_SCHEMA,
    controlPlaneSuccess: cps.receipt.success,
    sessionId,
    experimentId,
    toolCount: TOOL_NAMES.length,
    surfaceLock: {
      toolCount: 0,
      serverVersion: "",
      toolSetSha256: "",
      hasPlaceOrCancelTools: false,
    },
    processTick: {
      recommendation: "proceed",
      inventoryOk: true,
      inventoryUnknownTools: [],
    },
    seal: null,
    capitalAtRisk: 0,
    brokerEffect: false,
    compositeScore: false,
    notTradingPerformance: true,
    success: false,
    errors: [],
    dataDir: directory,
  };

  if (!cps.receipt.success) {
    errors.push(...cps.receipt.errors);
    errors.push("control-plane-story-failed");
  }

  try {
    // 1. Surface lock
    const lock = buildSurfaceLockReceipt();
    receipt.surfaceLock = {
      toolCount: lock.toolCount,
      serverVersion: lock.serverVersion,
      toolSetSha256: lock.toolSetSha256,
      hasPlaceOrCancelTools: lock.hasPlaceOrCancelTools,
    };
    if (lock.toolCount !== TOOL_NAMES.length) {
      errors.push(`surface-lock-tool-count:${lock.toolCount}:expected=${TOOL_NAMES.length}`);
    }
    if (lock.hasPlaceOrCancelTools) {
      errors.push("surface-lock-place-or-cancel");
    }
    if (lock.brokerEffect !== false) {
      errors.push("surface-lock-broker-effect");
    }

    // 2. Process tick inventory check with unknown tool (expect stop under fail-closed)
    const store = new SessionStore({ rootDir: defaultSessionRoot(directory) });
    const session = await store.read(sessionId);
    const inventory = checkObservedToolsAgainstPin(
      session.inventoryPin,
      ["get_accounts", "place_crypto_order_unknown"],
      session.inventoryEnforcement ?? "fail-closed",
    );
    const tick = resolveProcessTick({ inventory });
    receipt.processTick = {
      recommendation: tick.recommendation,
      inventoryOk: tick.inventoryOk,
      inventoryUnknownTools: [...tick.inventoryUnknownTools],
    };
    if (tick.recommendation !== "stop") {
      errors.push(`process-tick-expected-stop:${tick.recommendation}`);
    }
    if (tick.inventoryOk) {
      errors.push("process-tick-expected-inventory-fail");
    }
    if (!tick.inventoryUnknownTools.includes("place_crypto_order_unknown")) {
      errors.push("process-tick-missing-unknown-tool");
    }
    if (tick.brokerEffect !== false || tick.compositeScore !== false || tick.capitalAtRisk !== 0) {
      errors.push("process-tick-claims-violation");
    }

    // 3. Optional seal capsule
    if (!skipSeal) {
      const pack = await store.exportPack(sessionId);
      const drafts = buildProcessCapsulePayloads(pack);
      const payloads: CapsulePayloadMember[] = drafts.map((d) => ({
        path: d.path,
        role: d.role,
        mediaType: d.mediaType,
        bytes: d.bytes,
      }));
      const subtle = webcrypto.subtle as unknown as SubtleCrypto;
      const pair = await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
      const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
      const sealExperimentId = processCapsuleExperimentId(sessionId);
      const prepared = await prepareProofCapsule(
        {
          checkpointSequence: 1,
          createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          dataClass: "synthetic",
          eventChain: { eventCount: 0, headHash: "0".repeat(64) },
          experimentId: sealExperimentId,
          lineage: { relation: "root", parents: [] },
          payloads,
          publicKeySpkiDer: spki,
        },
        { subtle },
      );
      const signingBytes = new Uint8Array(prepared.signingBytes);
      const signature = new Uint8Array(
        await subtle.sign({ name: "Ed25519" }, pair.privateKey, signingBytes),
      );
      const authored = await finalizeProofCapsule(prepared, signature, { subtle });
      receipt.seal = {
        capsuleId: authored.capsuleId,
        archiveSha256: authored.archiveSha256,
        experimentId: sealExperimentId,
      };
      if (!authored.capsuleId || authored.capsuleId.length < 8) {
        errors.push("seal-capsule-id-invalid");
      }
      if (!authored.archiveSha256 || authored.archiveSha256.length !== 64) {
        errors.push("seal-archive-sha256-invalid");
      }
    }

    receipt.errors = errors;
    receipt.success = errors.length === 0;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "elite-wave-story-failed");
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
