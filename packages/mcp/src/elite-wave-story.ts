/**
 * Elite wave demo story: control-plane spine + surface lock + process tick +
 * dual_check_diff + clone-challenge + surface lock attach + gateway quorum + seal.
 *
 * Extends control-plane-story success with:
 * 1. buildSurfaceLockReceipt
 * 2. process_tick-style inventory check with an unknown tool (expect stop)
 * 3. dual_check_diff: weak ledger vs elite session on option SPY (expect deny)
 * 4. clone-challenge: equities-only or deny-gme child session fork
 * 5. attach surface lock as dossier operator-note
 * 6. gateway quorum demo (authorize/deny/replay local theater)
 * 7. seal process capsule (synthetic)
 *
 * Process evidence only — brokerEffect false, capital 0, not trading performance.
 */

import { webcrypto } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  applyChallengeMutation,
  buildDualCheckDiff,
  buildProcessCapsulePayloads,
  buildProcessHealthReport,
  checkObservedToolsAgainstPin,
  processCapsuleExperimentId,
  resolveProcessTick,
  SessionStore,
  defaultSessionRoot,
  type ChallengeMutationId,
} from "@runbook/session";
import { WEAK_STARTER_POLICY } from "@runbook/shadow-lab";
import {
  finalizeProofCapsule,
  prepareProofCapsule,
  type CapsulePayloadMember,
} from "@runbook/capsule-author";
import { runControlPlaneStory, type ControlPlaneStoryOptions } from "./control-plane-story.js";
import { runGatewayQuorumDemo } from "./gateway-demo.js";
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
  processHealth?: {
    processClean: boolean;
    stopCount: number;
    tickCount: number;
  };
  dualCheck?: {
    disagreementCount: number;
    processDeniedBySession: boolean;
    sessionCharterBinding: string;
  };
  clone?: {
    childSessionId: string;
    mutationId: ChallengeMutationId;
  };
  surfaceLockAttached?: {
    attachmentId: string;
    toolSetSha256: string;
    toolCount: number;
  };
  gateway?: {
    actionType: "policy.activate";
    decisions: Array<{ id: "authorize" | "deny" | "replay"; decision: string }>;
    humanAuthorityEstablished: false;
    authorizationEstablished: false;
    brokerEffect: false;
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
  "║  lock + tick + dual_check + clone + attach + gateway + seal   ║",
  "║  process evidence only · brokerEffect false · capital 0       ║",
  "╚══════════════════════════════════════════════════════════════╝",
  "",
].join("\n");

const OPTION_SPY_PROPOSAL = {
  proposalId: "elite-wave-opt-spy",
  experimentId: "RUN-ELITE-WAVE-DUAL",
  symbol: "SPY",
  instrument: "option" as const,
  side: "buy" as const,
  notional: 50,
  projectedPositionNotional: 50,
  dailyTradesAfter: 1,
  currentDrawdownPercent: 0.5,
  hasThesis: true,
  hasInvalidation: true,
  evidenceSourceCount: 1,
};

function pickCloneMutation(allowedInstruments: readonly string[]): ChallengeMutationId {
  // Prefer equities-only when options/crypto remain; otherwise deny-gme (idempotent).
  if (allowedInstruments.some((i) => i !== "equity")) {
    return "equities-only";
  }
  return "deny-gme";
}

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
    await store.recordProcessTick(sessionId, {
      recommendation: tick.recommendation,
      inventoryOk: tick.inventoryOk,
      inventoryUnknownTools: [...tick.inventoryUnknownTools],
      sessionCharterBinding: tick.sessionCharterBinding,
      processDeniedBySession: tick.processDeniedBySession,
      observedToolCount: 2,
      message: tick.message,
    });
    {
      const afterTick = await store.read(sessionId);
      const health = buildProcessHealthReport(afterTick);
      receipt.processHealth = {
        processClean: health.processClean,
        stopCount: health.stopCount,
        tickCount: health.tickCount,
      };
      if (health.tickCount < 1) {
        errors.push("process-health-expected-ticks");
      }
      if (health.stopCount < 1) {
        errors.push("process-health-expected-stop-count");
      }
      if (health.processClean) {
        errors.push("process-health-expected-not-clean-after-stop");
      }
    }

    // 3. dual_check_diff: weak ledger vs elite session charter on option SPY (fail-closed)
    if (session.charter === undefined) {
      errors.push("dual-check-session-charter-missing");
    } else {
      const dual = buildDualCheckDiff({
        ledgerPolicy: WEAK_STARTER_POLICY,
        sessionPolicy: session.charter,
        proposal: { ...OPTION_SPY_PROPOSAL, experimentId },
        enforcement: "fail-closed",
      });
      receipt.dualCheck = {
        disagreementCount: dual.disagreementCount,
        processDeniedBySession: dual.processDeniedBySession,
        sessionCharterBinding: dual.sessionCharterBinding,
      };
      if (dual.disagreementCount < 1) {
        errors.push("dual-check-expected-disagreement");
      }
      if (!dual.processDeniedBySession) {
        errors.push("dual-check-expected-process-denied-by-session");
      }
      if (dual.brokerEffect !== false || dual.compositeScore !== false) {
        errors.push("dual-check-claims-violation");
      }
    }

    // 4. Clone-challenge: one-rule process fork into a child session
    if (session.charter === undefined) {
      errors.push("clone-challenge-session-charter-missing");
    } else {
      const mutationId = pickCloneMutation(session.charter.allowedInstruments);
      const childCharter = applyChallengeMutation(session.charter, mutationId);
      const child = await store.create({
        label: `Elite-wave challenge ${mutationId} ← ${sessionId}`.slice(0, 200),
        charter: childCharter,
        ...(session.inventoryPin !== undefined ? { inventoryPin: session.inventoryPin } : {}),
        inventoryEnforcement: session.inventoryEnforcement,
        charterBindingEnforcement: session.charterBindingEnforcement,
      });
      receipt.clone = {
        childSessionId: child.sessionId,
        mutationId,
      };
      if (!child.sessionId || child.sessionId === sessionId) {
        errors.push("clone-challenge-child-id-invalid");
      }
      if (child.charter === undefined) {
        errors.push("clone-challenge-child-charter-missing");
      }
    }

    // 5. Attach surface lock receipt to session as dossier operator-note
    {
      const summary =
        `toolCount=${lock.toolCount} · version=${lock.serverVersion} · toolSetSha256=${lock.toolSetSha256} · ${lock.message}`.slice(
          0,
          1_000,
        );
      const attached = await store.attachDossier(sessionId, {
        kind: "operator-note",
        scenarioIds: [],
        summary,
        evidenceRef: lock.toolSetSha256,
        honestLabel: "architecture-evidence-not-certification",
      });
      const attachment = attached.dossierAttachments[attached.dossierAttachments.length - 1];
      if (attachment === undefined) {
        errors.push("surface-lock-attach-missing");
      } else {
        receipt.surfaceLockAttached = {
          attachmentId: attachment.attachmentId,
          toolSetSha256: lock.toolSetSha256,
          toolCount: lock.toolCount,
        };
        if (attachment.evidenceRef !== lock.toolSetSha256) {
          errors.push("surface-lock-attach-evidence-mismatch");
        }
      }
    }

    // 6. Gateway quorum demo (local policy theater — not broker order submission)
    {
      const gateway = runGatewayQuorumDemo();
      receipt.gateway = {
        actionType: gateway.actionType,
        decisions: gateway.scenarios.map((s) => ({ id: s.id, decision: s.decision })),
        humanAuthorityEstablished: false,
        authorizationEstablished: false,
        brokerEffect: false,
      };
      const byId = new Map(gateway.scenarios.map((s) => [s.id, s]));
      if (byId.get("authorize")?.decision !== "authorize") {
        errors.push("gateway-authorize-expected");
      }
      if (byId.get("deny")?.decision !== "deny") {
        errors.push("gateway-deny-expected");
      }
      if (byId.get("replay")?.decision !== "replay") {
        errors.push("gateway-replay-expected");
      }
      if (gateway.humanAuthorityEstablished !== false || gateway.authorizationEstablished !== false) {
        errors.push("gateway-honesty-flags");
      }
      if (gateway.brokerEffect !== false) {
        errors.push("gateway-broker-effect");
      }
    }

    // 7. Optional seal capsule
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
