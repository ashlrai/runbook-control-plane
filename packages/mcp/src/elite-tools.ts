/**
 * Elite wave tools: surface lock, process tick, pack import, process capsule seal,
 * drift sentinel, clone-challenge, dual check-diff, gateway quorum demo.
 * Process evidence only — not trading performance, not hard broker gateway.
 */

import { webcrypto } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { evaluateProposal } from "@runbook/engine/policy";
import { tradeProposalSchema } from "@runbook/engine/schema";
import {
  finalizeProofCapsule,
  prepareProofCapsule,
  type CapsulePayloadMember,
} from "@runbook/capsule-author";
import {
  applyChallengeMutation,
  buildCloneChallengeReceipt,
  buildDualCheckDiff,
  buildInventoryPinPreset,
  buildProcessCapsulePayloads,
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  parseSessionEvidencePack,
  processCapsuleExperimentId,
  resolveCharterDualEval,
  resolveProcessTick,
  sessionFromEvidencePack,
  SessionPackImportError,
  ToolsListParseError,
  type ChallengeMutationId,
  type InventoryPinPreset,
} from "@runbook/session";
import { WEAK_STARTER_POLICY } from "@runbook/shadow-lab";
import * as z from "zod/v4";
import { runDriftSentinel } from "./drift-sentinel.js";
import { runGatewayQuorumDemo } from "./gateway-demo.js";
import type { OfflineToolsOptions } from "./offline-tools.js";
import { withToolErrors } from "./protocol.js";
import {
  appendSessionNote,
  resolveSessionId,
  resolveSessionStore,
} from "./session-context.js";
import { buildSurfaceLockReceipt } from "./surface-lock.js";

const CHALLENGE_MUTATION_IDS = [
  "lower-max-order-notional",
  "require-approval",
  "deny-gme",
  "equities-only",
  "tighter-drawdown",
] as const satisfies readonly ChallengeMutationId[];

const offlineAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const mutatingAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const sessionIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/);

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getStore(options?: OfflineToolsOptions) {
  return resolveSessionStore(options);
}

export function registerEliteTools(server: McpServer, options?: OfflineToolsOptions): void {
  server.registerTool(
    "runbook_surface_lock_receipt",
    {
      title: "Surface Lock Receipt",
      description:
        "Emit a closed-surface attestation receipt: digests TOOL_NAMES, server version, empty brokerExecutionTools, openWorldHint false. Attests Runbook inventory only — not that the host has no other MCPs. brokerEffect false.",
      inputSchema: {},
      outputSchema: {
        schemaVersion: z.literal("runbook.surface-lock-receipt.v1"),
        serverName: z.string(),
        serverVersion: z.string(),
        toolCount: z.number().int(),
        toolSetSha256: z.string(),
        brokerExecutionTools: z.array(z.string()).max(0),
        openWorldHint: z.literal(false),
        hasPlaceOrCancelTools: z.literal(false),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        limitations: z.array(z.string()),
        message: z.string(),
        receipt: z.record(z.string(), z.unknown()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async () => {
      const receipt = buildSurfaceLockReceipt();
      return {
        schemaVersion: "runbook.surface-lock-receipt.v1" as const,
        serverName: receipt.serverName,
        serverVersion: receipt.serverVersion,
        toolCount: receipt.toolCount,
        toolSetSha256: receipt.toolSetSha256,
        brokerExecutionTools: [] as [],
        openWorldHint: false as const,
        hasPlaceOrCancelTools: false as const,
        brokerEffect: false as const,
        compositeScore: false as const,
        limitations: [...receipt.limitations],
        message: receipt.message,
        receipt: jsonSafe(receipt),
      };
    }),
  );

  server.registerTool(
    "runbook_process_tick",
    {
      title: "Process Supervisor Tick",
      description:
        "Mid-flight process heartbeat: check observedToolNames against session inventory pin and optionally dual-eval a proposal against session charter. Returns proceed|warn|stop for process-layer only — not a hard broker gateway. Host may still call other tools.",
      inputSchema: {
        sessionId: sessionIdSchema.optional(),
        observedToolNames: z.array(z.string().trim().min(1).max(160)).max(200),
        proposal: tradeProposalSchema.optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.process-tick.v1"),
        recommendation: z.enum(["proceed", "warn", "stop"]),
        inventoryOk: z.boolean(),
        inventoryUnknownTools: z.array(z.string()),
        sessionCharterBinding: z.string(),
        processDeniedBySession: z.boolean(),
        message: z.string(),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        capitalAtRisk: z.literal(0),
        limitations: z.array(z.string()),
        sessionId: z.string().optional(),
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const sessionId = await resolveSessionId(input.sessionId, options);
      if (sessionId === undefined) {
        throw new Error("No sessionId provided and no active session marker or RUNBOOK_SESSION_ID.");
      }
      const store = getStore(options);
      const session = await store.read(sessionId);
      const inventory = checkObservedToolsAgainstPin(
        session.inventoryPin,
        input.observedToolNames,
        session.inventoryEnforcement ?? "fail-closed",
      );
      let dual;
      if (input.proposal !== undefined) {
        if (session.charter === undefined) {
          dual = resolveCharterDualEval({
            ledgerAllowed: true,
            sessionPresent: true,
            sessionHasCharter: false,
            enforcement: session.charterBindingEnforcement ?? "warn",
          });
        } else {
          const sessionEval = evaluateProposal(session.charter, input.proposal);
          // Process tick: session charter is the process gate; ledgerAllowed=true means
          // an unconstrained ledger twin would admit (highlight process deny when session denies).
          dual = resolveCharterDualEval({
            ledgerAllowed: true,
            sessionPresent: true,
            sessionHasCharter: true,
            sessionAllowed: sessionEval.allowed,
            enforcement: session.charterBindingEnforcement ?? "warn",
          });
        }
      }

      const tick = resolveProcessTick({ inventory, ...(dual !== undefined ? { dualEval: dual } : {}) });
      await appendSessionNote(
        store,
        sessionId,
        `process_tick recommendation=${tick.recommendation} inventoryOk=${String(tick.inventoryOk)} binding=${tick.sessionCharterBinding}`,
      );
      return {
        ...tick,
        limitations: [...tick.limitations],
        sessionId,
      };
    }),
  );

  server.registerTool(
    "runbook_session_import_pack",
    {
      title: "Import Session Evidence Pack",
      description:
        "Import a local runbook.session-evidence-pack.v1 JSON string into the session store (optional new sessionId). Local paste only — refuses URL bodies. Process evidence only; brokerEffect false.",
      inputSchema: {
        packJson: z.string().trim().min(2).max(2_000_000),
        sessionId: sessionIdSchema.optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-import-pack.v1"),
        sessionId: z.string(),
        label: z.string(),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        capitalAtRisk: z.literal(0),
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      try {
        const pack = parseSessionEvidencePack(input.packJson);
        const session = sessionFromEvidencePack(pack, {
          ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        });
        const store = getStore(options);
        await store.write(session);
        return {
          schemaVersion: "runbook.session-import-pack.v1" as const,
          sessionId: session.sessionId,
          label: session.label,
          brokerEffect: false as const,
          compositeScore: false as const,
          capitalAtRisk: 0 as const,
        };
      } catch (error) {
        if (error instanceof SessionPackImportError) {
          throw new Error(error.message);
        }
        throw error;
      }
    }),
  );

  server.registerTool(
    "runbook_session_seal_capsule",
    {
      title: "Seal Process Capsule",
      description:
        "Seal a control-plane session into a synthetic Proof Capsule (.runbook) with ephemeral Ed25519 local attestation. Process claims only — not trading performance, not broker-issued, not identity. Returns base64 archive bytes + capsuleId. Verify with runbook_verify_capsule or /verify.",
      inputSchema: {
        sessionId: sessionIdSchema.optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-seal-capsule.v1"),
        capsuleId: z.string(),
        authorKeyId: z.string(),
        archiveSha256: z.string(),
        archiveBase64: z.string(),
        experimentId: z.string(),
        dataClass: z.literal("synthetic"),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        capitalAtRisk: z.literal(0),
        limitations: z.array(z.string()),
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const sessionId = await resolveSessionId(input.sessionId, options);
      if (sessionId === undefined) {
        throw new Error("No sessionId provided and no active session marker or RUNBOOK_SESSION_ID.");
      }
      const store = getStore(options);
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
      const experimentId = processCapsuleExperimentId(sessionId);
      const prepared = await prepareProofCapsule(
        {
          checkpointSequence: 1,
          createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          dataClass: "synthetic",
          eventChain: { eventCount: 0, headHash: "0".repeat(64) },
          experimentId,
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
      await appendSessionNote(
        store,
        sessionId,
        `sealed process capsule capsuleId=${authored.capsuleId} archiveSha256=${authored.archiveSha256}`,
      );
      return {
        schemaVersion: "runbook.session-seal-capsule.v1" as const,
        capsuleId: authored.capsuleId,
        authorKeyId: authored.authorKeyId,
        archiveSha256: authored.archiveSha256,
        archiveBase64: Buffer.from(authored.archiveBytes).toString("base64"),
        experimentId,
        dataClass: "synthetic" as const,
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        limitations: [
          "self-asserted-author-key-integrity-only",
          "ephemeral-key-not-persisted",
          "not-broker-issued",
          "not-trading-performance",
          "not-identity-proof",
          "advisory-not-hard-gateway",
        ],
      };
    }),
  );

  server.registerTool(
    "runbook_drift_sentinel",
    {
      title: "Drift Sentinel",
      description:
        "Compose tools/list JSON parse + inventory pin fail-closed check into a drift-sentinel receipt. Optionally uses active session pin. Process evidence only — not live broker inventory truth.",
      inputSchema: {
        toolsListJson: z.string().trim().min(2).max(500_000),
        sessionId: sessionIdSchema.optional(),
        usePublicDocsPin: z.boolean().optional(),
        pinPreset: z
          .enum(["public-docs-full", "observation-only", "no-capital-order-mutation"])
          .optional(),
        enforcement: z.enum(["off", "warn", "fail-closed"]).optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.drift-sentinel-receipt.v1"),
        ok: z.boolean(),
        unknownTools: z.array(z.string()),
        capitalOrderMutationInObserved: z.array(z.string()),
        message: z.string(),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        receipt: z.record(z.string(), z.unknown()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async (input) => {
      try {
        let pin = undefined as ReturnType<typeof buildPublicDocsInventoryPin> | undefined;
        let enforcement: "off" | "warn" | "fail-closed" = input.enforcement ?? "fail-closed";
        const sessionId = await resolveSessionId(input.sessionId, options);
        if (sessionId !== undefined) {
          const session = await getStore(options).read(sessionId);
          pin = session.inventoryPin;
          enforcement = input.enforcement ?? session.inventoryEnforcement ?? "fail-closed";
        }
        if (pin === undefined || input.usePublicDocsPin === true || input.pinPreset !== undefined) {
          const preset = (input.pinPreset ?? "public-docs-full") as InventoryPinPreset;
          pin = buildInventoryPinPreset(preset);
        }
        const receipt = runDriftSentinel({
          pin,
          toolsListJsonText: input.toolsListJson,
          enforcement,
        });
        if (sessionId !== undefined) {
          await appendSessionNote(
            getStore(options),
            sessionId,
            `drift_sentinel ok=${String(receipt.ok)} unknown=${receipt.unknownTools.join(",")}`,
          );
        }
        return {
          schemaVersion: "runbook.drift-sentinel-receipt.v1" as const,
          ok: receipt.ok,
          unknownTools: receipt.unknownTools,
          capitalOrderMutationInObserved: receipt.capitalOrderMutationInObserved,
          message: receipt.message,
          brokerEffect: false as const,
          compositeScore: false as const,
          receipt: jsonSafe(receipt),
        };
      } catch (error) {
        if (error instanceof ToolsListParseError) {
          throw new Error(error.message);
        }
        throw error;
      }
    }),
  );

  server.registerTool(
    "runbook_session_clone_challenge",
    {
      title: "Clone Session Challenge Fork",
      description:
        "Fork a control-plane session charter with one process-rule mutation (lower notional, require approval, deny GME, equities-only, tighter drawdown). Creates a child session with digest lineage notes. Process experiment only — not a safer strategy or returns claim. brokerEffect false.",
      inputSchema: {
        sessionId: sessionIdSchema.optional(),
        mutationId: z.enum(CHALLENGE_MUTATION_IDS),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.clone-challenge.v1"),
        parentSessionId: z.string(),
        parentCharterDigest: z.string().nullable(),
        childSessionId: z.string(),
        mutationId: z.enum(CHALLENGE_MUTATION_IDS),
        mutationLabel: z.string(),
        notTradingPerformance: z.literal(true),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        capitalAtRisk: z.literal(0),
        note: z.string(),
        receipt: z.record(z.string(), z.unknown()),
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const parentSessionId = await resolveSessionId(input.sessionId, options);
      if (parentSessionId === undefined) {
        throw new Error("No sessionId provided and no active session marker or RUNBOOK_SESSION_ID.");
      }
      const store = getStore(options);
      const parent = await store.read(parentSessionId);
      if (parent.charter === undefined) {
        throw new Error(
          "Parent session has no charter; set a charter before clone-challenge (process fork requires a baseline policy).",
        );
      }
      const mutationId = input.mutationId as ChallengeMutationId;
      const childCharter = applyChallengeMutation(parent.charter, mutationId);
      const parentCharterDigest = parent.charterDigest ?? null;
      const child = await store.create({
        label: `Challenge ${mutationId} ← ${parentSessionId}`.slice(0, 200),
        charter: childCharter,
        ...(parent.inventoryPin !== undefined ? { inventoryPin: parent.inventoryPin } : {}),
        inventoryEnforcement: parent.inventoryEnforcement,
        charterBindingEnforcement: parent.charterBindingEnforcement,
      });
      await appendSessionNote(
        store,
        parentSessionId,
        `clone_challenge child=${child.sessionId} mutation=${mutationId} parentDigest=${parentCharterDigest ?? "none"}`,
      );
      await appendSessionNote(
        store,
        child.sessionId,
        `cloned_from parent=${parentSessionId} mutation=${mutationId} parentDigest=${parentCharterDigest ?? "none"}`,
      );
      const receipt = buildCloneChallengeReceipt({
        parentSessionId,
        parentCharterDigest,
        childSessionId: child.sessionId,
        mutationId,
      });
      return {
        ...receipt,
        receipt: jsonSafe(receipt),
      };
    }),
  );

  server.registerTool(
    "runbook_dual_check_diff",
    {
      title: "Dual Check Diff Theater",
      description:
        "Evaluate the same proposal under a ledger-side charter (session charter if present as both, or WEAK_STARTER when ledgerPolicySource=weak) vs the active session charter. Returns check-by-check agreement rows for mandate fidelity theater. Process layer only — not capital risk grade, not a hard broker gateway.",
      inputSchema: {
        sessionId: sessionIdSchema.optional(),
        proposal: tradeProposalSchema,
        ledgerPolicySource: z.enum(["session", "weak"]).optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.dual-check-diff.v1"),
        ledgerAllowed: z.boolean(),
        sessionAllowed: z.boolean().nullable(),
        processAllowed: z.boolean(),
        processDeniedBySession: z.boolean(),
        sessionCharterBinding: z.string(),
        disagreementCount: z.number().int(),
        message: z.string(),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        notTradingPerformance: z.literal(true),
        report: z.record(z.string(), z.unknown()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async (input) => {
      const sessionId = await resolveSessionId(input.sessionId, options);
      if (sessionId === undefined) {
        throw new Error("No sessionId provided and no active session marker or RUNBOOK_SESSION_ID.");
      }
      const store = getStore(options);
      const session = await store.read(sessionId);
      if (session.charter === undefined) {
        throw new Error("Session has no charter for dual check-diff.");
      }
      const ledgerSource = input.ledgerPolicySource ?? "weak";
      const ledgerPolicy =
        ledgerSource === "session" ? session.charter : WEAK_STARTER_POLICY;
      const report = buildDualCheckDiff({
        ledgerPolicy,
        sessionPolicy: session.charter,
        proposal: input.proposal,
        enforcement: session.charterBindingEnforcement ?? "warn",
      });
      await appendSessionNote(
        store,
        sessionId,
        `dual_check_diff binding=${report.sessionCharterBinding} disagreements=${report.disagreementCount} ledgerSource=${ledgerSource}`,
      );
      return {
        schemaVersion: "runbook.dual-check-diff.v1" as const,
        ledgerAllowed: report.ledgerAllowed,
        sessionAllowed: report.sessionAllowed,
        processAllowed: report.processAllowed,
        processDeniedBySession: report.processDeniedBySession,
        sessionCharterBinding: report.sessionCharterBinding,
        disagreementCount: report.disagreementCount,
        message: report.message,
        brokerEffect: false as const,
        compositeScore: false as const,
        notTradingPerformance: true as const,
        report: jsonSafe(report),
      };
    }),
  );

  server.registerTool(
    "runbook_session_attach_surface_lock",
    {
      title: "Attach Surface Lock to Session",
      description:
        "Build a closed-surface lock receipt and attach it to a control-plane session as a dossier operator-note (toolCount, version, toolSetSha256, message). evidenceRef is toolSetSha256. Attests Runbook inventory only — not host MCP exclusivity. Process evidence; brokerEffect false.",
      inputSchema: {
        sessionId: sessionIdSchema.optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-attach-surface-lock.v1"),
        sessionId: z.string(),
        attachmentCount: z.number().int().nonnegative(),
        attachmentId: z.string(),
        toolCount: z.number().int(),
        serverVersion: z.string(),
        toolSetSha256: z.string(),
        message: z.string(),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        capitalAtRisk: z.literal(0),
        receipt: z.record(z.string(), z.unknown()),
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const sessionId = await resolveSessionId(input.sessionId, options);
      if (sessionId === undefined) {
        throw new Error("No sessionId provided and no active session marker or RUNBOOK_SESSION_ID.");
      }
      const receipt = buildSurfaceLockReceipt();
      const summary =
        `toolCount=${receipt.toolCount} · version=${receipt.serverVersion} · toolSetSha256=${receipt.toolSetSha256} · ${receipt.message}`.slice(
          0,
          1_000,
        );
      const store = getStore(options);
      const session = await store.attachDossier(sessionId, {
        kind: "operator-note",
        scenarioIds: [],
        summary,
        evidenceRef: receipt.toolSetSha256,
        honestLabel: "architecture-evidence-not-certification",
      });
      const attachment = session.dossierAttachments[session.dossierAttachments.length - 1];
      if (attachment === undefined) {
        throw new Error("Surface lock attachment missing after dossier attach.");
      }
      await appendSessionNote(
        store,
        sessionId,
        `attach_surface_lock toolCount=${receipt.toolCount} version=${receipt.serverVersion} sha=${receipt.toolSetSha256}`,
      );
      return {
        schemaVersion: "runbook.session-attach-surface-lock.v1" as const,
        sessionId: session.sessionId,
        attachmentCount: session.dossierAttachments.length,
        attachmentId: attachment.attachmentId,
        toolCount: receipt.toolCount,
        serverVersion: receipt.serverVersion,
        toolSetSha256: receipt.toolSetSha256,
        message: receipt.message,
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        receipt: jsonSafe(receipt),
      };
    }),
  );

  server.registerTool(
    "runbook_gateway_quorum_demo",
    {
      title: "Gateway Quorum Demo (Local Theater)",
      description:
        "In-process multi-party authorization theater using ephemeral Ed25519 keys: authorize (2-role quorum), deny (missing risk), and replay (prior fingerprint). actionType is policy.activate — not broker order submission. Local policy theater only; humanAuthorityEstablished and authorizationEstablished always false; brokerEffect false.",
      inputSchema: {},
      outputSchema: {
        schemaVersion: z.literal("runbook.gateway-quorum-demo.v1"),
        actionType: z.literal("policy.activate"),
        scenarios: z.array(
          z.object({
            id: z.enum(["authorize", "deny", "replay"]),
            decision: z.enum(["authorize", "deny", "replay"]),
            authorizationConditionsSatisfied: z.boolean(),
            checks: z.array(
              z.object({
                code: z.string(),
                passed: z.boolean(),
              }),
            ),
          }),
        ),
        humanAuthorityEstablished: z.literal(false),
        authorizationEstablished: z.literal(false),
        brokerEffect: z.literal(false),
        notBrokerOrderSubmission: z.literal(true),
        localPolicyTheaterOnly: z.literal(true),
        note: z.string(),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async () => runGatewayQuorumDemo()),
  );
}
