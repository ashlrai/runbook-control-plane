/**
 * Control Plane Session MCP tools — local session spine, inventory pin, signed approval intent.
 * Depends on @runbook/session. No broker, no credentials, no composite score.
 */

import { isAbsolute, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { riskPolicySchema } from "@runbook/engine/schema";
import {
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  createCallerAssertedApproval,
  defaultSessionRoot,
  generateApprovalKeyPair,
  inventoryPinSchema,
  newId,
  SessionStore,
  signApprovalIntent,
  signedApprovalIntentSchema,
  toolSetSha256FromEntries,
  verifySignedApprovalIntent,
  type InventoryPin,
  type InventoryToolEntry,
} from "@runbook/session";
import * as z from "zod/v4";
import type { OfflineToolsOptions } from "./offline-tools.js";
import { withToolErrors } from "./protocol.js";

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

const SESSION_LIMITATIONS = [
  "local-session-only",
  "advisory-not-hard-gateway",
  "not-trading-performance",
  "not-capital-allocation",
  "no-composite-safety-score",
  "no-broker-execution",
  "no-credential-handling",
] as const;

const APPROVAL_LIMITATIONS = [
  "not-broker-authorization",
  "device-key-signed-is-local-attestation-only",
  "caller-asserted-is-not-authenticated-human",
  "local-attestation-not-identity-proof",
  "ephemeral-key-private-material-not-persisted",
] as const;

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveSessionRoot(options?: OfflineToolsOptions): string {
  if (options?.dataDir !== undefined && options.dataDir.length > 0) {
    if (!isAbsolute(options.dataDir)) {
      throw new Error("path.invalid");
    }
    return defaultSessionRoot(resolve(options.dataDir));
  }
  const fromEnv = process.env.RUNBOOK_DATA_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    if (!isAbsolute(fromEnv)) {
      throw new Error("path.invalid");
    }
    return defaultSessionRoot(resolve(fromEnv));
  }
  return defaultSessionRoot();
}

function getStore(options?: OfflineToolsOptions): SessionStore {
  return new SessionStore({ rootDir: resolveSessionRoot(options) });
}

function buildOperatorInventoryPin(toolNames: readonly string[]): InventoryPin {
  const tools: InventoryToolEntry[] = [...new Set(toolNames.map((n) => n.trim()).filter(Boolean))]
    .sort()
    .map((name) => ({
      name,
      source: "operator-declared" as const,
      effectClass: "unknown" as const,
    }));
  return inventoryPinSchema.parse({
    schemaVersion: "runbook.inventory-pin.v1",
    pinId: newId("pin"),
    createdAt: new Date().toISOString(),
    label: "Operator-declared inventory pin",
    provider: "operator-declared",
    tools,
    toolSetSha256: toolSetSha256FromEntries(tools),
    admitted: true,
    limitations: [
      "operator-declared-not-runtime-confirmed",
      "not-broker-authorization",
      "fail-closed-on-unknown-tools-when-enforced",
    ],
  });
}

const sessionIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/);

const sessionOutputFields = {
  session: z.record(z.string(), z.unknown()),
  brokerEffect: z.literal(false),
  compositeScore: z.literal(false),
  capitalAtRisk: z.literal(0),
  limitations: z.array(z.string()),
} as const;

export function registerSessionTools(server: McpServer, options?: OfflineToolsOptions): void {
  server.registerTool(
    "runbook_session_create",
    {
      title: "Create Control Plane Session",
      description:
        "Create a local control-plane session record (charter digest, inventory pin, shadow/dossier evidence). Stored under RUNBOOK_DATA_DIR/sessions or defaultSessionRoot. Process evidence only — not trading performance, not a hard broker gateway, no credentials.",
      inputSchema: {
        label: z.string().trim().min(1).max(200),
        policy: riskPolicySchema.optional(),
        sessionId: sessionIdSchema.optional(),
        experimentId: z.string().trim().min(1).max(120).optional(),
        inventoryEnforcement: z.enum(["off", "warn", "fail-closed"]).optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-create.v1"),
        sessionId: z.string(),
        rootDir: z.string(),
        ...sessionOutputFields,
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const store = getStore(options);
      const session = await store.create({
        label: input.label,
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.policy !== undefined ? { charter: input.policy } : {}),
        ...(input.experimentId !== undefined ? { experimentId: input.experimentId } : {}),
        ...(input.inventoryEnforcement !== undefined
          ? { inventoryEnforcement: input.inventoryEnforcement }
          : {}),
      });
      return {
        schemaVersion: "runbook.session-create.v1" as const,
        sessionId: session.sessionId,
        rootDir: store.rootDir,
        session: jsonSafe(session),
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        limitations: [...SESSION_LIMITATIONS],
      };
    }),
  );

  server.registerTool(
    "runbook_session_get",
    {
      title: "Get Control Plane Session",
      description:
        "Read a local control-plane session by sessionId. Local filesystem only; brokerEffect false.",
      inputSchema: {
        sessionId: sessionIdSchema,
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-get.v1"),
        ...sessionOutputFields,
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async ({ sessionId }) => {
      const store = getStore(options);
      const session = await store.read(sessionId);
      return {
        schemaVersion: "runbook.session-get.v1" as const,
        session: jsonSafe(session),
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        limitations: [...SESSION_LIMITATIONS],
      };
    }),
  );

  server.registerTool(
    "runbook_session_export",
    {
      title: "Export Control Plane Session Evidence Pack",
      description:
        "Export a local session evidence pack (session + assurance labels). Local-control-plane-export-only; not trading performance; no composite score.",
      inputSchema: {
        sessionId: sessionIdSchema,
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-export.v1"),
        pack: z.record(z.string(), z.unknown()),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        notTradingPerformance: z.literal(true),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async ({ sessionId }) => {
      const store = getStore(options);
      const pack = await store.exportPack(sessionId);
      return {
        schemaVersion: "runbook.session-export.v1" as const,
        pack: jsonSafe(pack),
        brokerEffect: false as const,
        compositeScore: false as const,
        notTradingPerformance: true as const,
        limitations: [...SESSION_LIMITATIONS, "local-control-plane-export-only"],
      };
    }),
  );

  server.registerTool(
    "runbook_session_set_charter",
    {
      title: "Set Session Charter",
      description:
        "Attach or replace the advisory RiskPolicy charter on a control-plane session and recompute charterDigest. Does not activate a ledger charter or authorize trades.",
      inputSchema: {
        sessionId: sessionIdSchema,
        policy: riskPolicySchema,
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-set-charter.v1"),
        sessionId: z.string(),
        charterDigest: z.string(),
        ...sessionOutputFields,
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async ({ sessionId, policy }) => {
      const store = getStore(options);
      const session = await store.setCharter(sessionId, policy);
      return {
        schemaVersion: "runbook.session-set-charter.v1" as const,
        sessionId: session.sessionId,
        charterDigest: session.charterDigest as string,
        session: jsonSafe(session),
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        limitations: [...SESSION_LIMITATIONS],
      };
    }),
  );

  server.registerTool(
    "runbook_session_pin_inventory",
    {
      title: "Pin Session Inventory",
      description:
        "Pin an admitted tool inventory on a session. Default: public-docs 50-tool Robinhood Trading research pin via buildPublicDocsInventoryPin. Optional toolNames builds an operator-declared pin. Not runtime confirmation; not broker authorization.",
      inputSchema: {
        sessionId: sessionIdSchema,
        toolNames: z.array(z.string().trim().min(1).max(160)).min(1).max(200).optional(),
        label: z.string().trim().min(1).max(200).optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-pin-inventory.v1"),
        sessionId: z.string(),
        pin: z.record(z.string(), z.unknown()),
        toolCount: z.number().int().nonnegative(),
        toolSetSha256: z.string(),
        ...sessionOutputFields,
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async ({ sessionId, toolNames, label }) => {
      const store = getStore(options);
      const pin =
        toolNames !== undefined && toolNames.length > 0
          ? (() => {
              const custom = buildOperatorInventoryPin(toolNames);
              return label !== undefined ? inventoryPinSchema.parse({ ...custom, label }) : custom;
            })()
          : buildPublicDocsInventoryPin(label !== undefined ? { label } : undefined);
      const session = await store.setInventoryPin(sessionId, pin);
      return {
        schemaVersion: "runbook.session-pin-inventory.v1" as const,
        sessionId: session.sessionId,
        pin: jsonSafe(pin),
        toolCount: pin.tools.length,
        toolSetSha256: pin.toolSetSha256,
        session: jsonSafe(session),
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        limitations: [...SESSION_LIMITATIONS, "not-runtime-confirmed-unless-source-is-runtime-snapshot"],
      };
    }),
  );

  server.registerTool(
    "runbook_session_check_inventory",
    {
      title: "Check Observed Tools Against Session Pin",
      description:
        "Fail-closed (by default via session.inventoryEnforcement) inventory check of observedToolNames against the session pin. Unknown tools fail when enforcement is fail-closed. brokerEffect false; not broker authorization.",
      inputSchema: {
        sessionId: sessionIdSchema,
        observedToolNames: z.array(z.string().trim().min(1).max(160)).max(200),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.inventory-check.v1"),
        ok: z.boolean(),
        enforcement: z.enum(["off", "warn", "fail-closed"]),
        unknownTools: z.array(z.string()),
        missingPinnedTools: z.array(z.string()),
        extraTools: z.array(z.string()),
        pinToolSetSha256: z.string().nullable(),
        observedToolSetSha256: z.string(),
        brokerEffect: z.literal(false),
        compositeScore: z.literal(false),
        message: z.string(),
        sessionId: z.string(),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async ({ sessionId, observedToolNames }) => {
      const store = getStore(options);
      const session = await store.read(sessionId);
      const check = checkObservedToolsAgainstPin(
        session.inventoryPin,
        observedToolNames,
        session.inventoryEnforcement,
      );
      return {
        ...check,
        sessionId,
        limitations: [...SESSION_LIMITATIONS, "fail-closed-on-unknown-tools-when-enforced"],
      };
    }),
  );

  server.registerTool(
    "runbook_session_attach_dossier",
    {
      title: "Attach Dossier Evidence to Session",
      description:
        "Attach a dossier evidence note (status snapshot / process-bridged ref / gap draft / operator note) to a session. Architecture evidence, not certification. Never embed credentials.",
      inputSchema: {
        sessionId: sessionIdSchema,
        summary: z.string().trim().min(1).max(1_000),
        kind: z
          .enum([
            "process-bridged-receipt-ref",
            "status-snapshot",
            "gap-register-draft",
            "operator-note",
          ])
          .optional(),
        scenarioIds: z.array(z.string().trim().min(1).max(120)).max(64).optional(),
        processBridgedCount: z.number().int().nonnegative().optional(),
        evidenceRef: z.string().trim().min(1).max(500).optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-attach-dossier.v1"),
        sessionId: z.string(),
        attachmentCount: z.number().int().nonnegative(),
        ...sessionOutputFields,
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const store = getStore(options);
      const session = await store.attachDossier(input.sessionId, {
        kind: input.kind ?? "status-snapshot",
        summary: input.summary,
        scenarioIds: input.scenarioIds ?? [],
        ...(input.processBridgedCount !== undefined
          ? { processBridgedCount: input.processBridgedCount }
          : {}),
        ...(input.evidenceRef !== undefined ? { evidenceRef: input.evidenceRef } : {}),
        honestLabel: "architecture-evidence-not-certification",
      });
      return {
        schemaVersion: "runbook.session-attach-dossier.v1" as const,
        sessionId: session.sessionId,
        attachmentCount: session.dossierAttachments.length,
        session: jsonSafe(session),
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        limitations: [...SESSION_LIMITATIONS, "architecture-evidence-not-certification"],
      };
    }),
  );

  server.registerTool(
    "runbook_session_record_shadow",
    {
      title: "Record Shadow Generation Metrics on Session",
      description:
        "Record synthetic shadow-generation hardFalseAllows / hardFalseDenies on a session for process evidence. Not trading performance; no composite score.",
      inputSchema: {
        sessionId: sessionIdSchema,
        generation: z.number().int().positive(),
        hardFalseAllows: z.number().int().nonnegative(),
        hardFalseDenies: z.number().int().nonnegative(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.session-record-shadow.v1"),
        sessionId: z.string(),
        lastShadowHardFalseAllows: z.number().int().nonnegative(),
        lastShadowHardFalseDenies: z.number().int().nonnegative(),
        shadowGenerationCount: z.number().int().nonnegative(),
        ...sessionOutputFields,
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const store = getStore(options);
      const session = await store.recordShadowGeneration(input.sessionId, {
        generation: input.generation,
        hardFalseAllows: input.hardFalseAllows,
        hardFalseDenies: input.hardFalseDenies,
      });
      return {
        schemaVersion: "runbook.session-record-shadow.v1" as const,
        sessionId: session.sessionId,
        lastShadowHardFalseAllows: session.lastShadowHardFalseAllows as number,
        lastShadowHardFalseDenies: session.lastShadowHardFalseDenies as number,
        shadowGenerationCount: session.shadowGenerations.length,
        session: jsonSafe(session),
        brokerEffect: false as const,
        compositeScore: false as const,
        capitalAtRisk: 0 as const,
        limitations: [...SESSION_LIMITATIONS, "synthetic-curriculum-process-quality-only"],
      };
    }),
  );

  server.registerTool(
    "runbook_approval_create_signed",
    {
      title: "Create Device-Key Signed Approval Intent",
      description:
        "Generate an ephemeral Ed25519 keypair, sign a local approval intent, and return the intent plus public SPKI (base64) for later verify. Private key is NOT persisted (demo / local attestation only). Never broker authorization; humanAuthorityEstablished and authorizationEstablished remain false.",
      inputSchema: {
        sessionId: sessionIdSchema,
        experimentId: z.string().trim().min(1).max(120),
        proposalId: z.string().trim().min(1).max(120),
        proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
        charterDigest: z.string().regex(/^[a-f0-9]{64}$/),
        approved: z.boolean(),
        approvalId: z.string().trim().min(1).max(120).optional(),
        decidedAt: z.iso.datetime().optional(),
        expiresAt: z.iso.datetime().optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.approval-create-signed.v1"),
        intent: z.record(z.string(), z.unknown()),
        publicKeySpkiBase64: z.string(),
        publicKeyFingerprint: z.string(),
        privateKeyPersisted: z.literal(false),
        humanAuthorityEstablished: z.literal(false),
        authorizationEstablished: z.literal(false),
        brokerEffect: z.literal(false),
        assurance: z.literal("local-device-key-attestation-only"),
        note: z.string(),
        limitations: z.array(z.string()),
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const keys = generateApprovalKeyPair();
      const unsigned = createCallerAssertedApproval({
        approvalId: input.approvalId ?? newId("appr"),
        sessionId: input.sessionId,
        experimentId: input.experimentId,
        proposalId: input.proposalId,
        proposalDigest: input.proposalDigest,
        charterDigest: input.charterDigest,
        approved: input.approved,
        ...(input.decidedAt !== undefined ? { decidedAt: input.decidedAt } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      });
      const intent = signApprovalIntent(unsigned, keys.privateKeyPkcs8Der, keys.publicKeySpkiDer);
      return {
        schemaVersion: "runbook.approval-create-signed.v1" as const,
        intent: jsonSafe(intent),
        publicKeySpkiBase64: keys.publicKeySpkiDer.toString("base64"),
        publicKeyFingerprint: keys.publicKeyFingerprint,
        privateKeyPersisted: false as const,
        humanAuthorityEstablished: false as const,
        authorizationEstablished: false as const,
        brokerEffect: false as const,
        assurance: "local-device-key-attestation-only" as const,
        note: "Ephemeral device key used for local attestation only. Private key is not returned and not persisted. Does not establish broker authorization or authenticated human identity.",
        limitations: [...APPROVAL_LIMITATIONS],
      };
    }),
  );

  server.registerTool(
    "runbook_approval_verify",
    {
      title: "Verify Signed Approval Intent",
      description:
        "Verify a device-key signed approval intent against a public key SPKI (base64). Success is local attestation only — never broker authorization. humanAuthorityEstablished and authorizationEstablished always false.",
      inputSchema: {
        intent: signedApprovalIntentSchema,
        publicKeySpkiBase64: z.string().trim().min(1).max(4_096),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.approval-verify.v1"),
        valid: z.boolean(),
        authority: z.enum([
          "caller-asserted-unauthenticated",
          "device-key-signed",
          "gateway-quorum-evaluated",
        ]),
        humanAuthorityEstablished: z.literal(false),
        authorizationEstablished: z.literal(false),
        brokerEffect: z.literal(false),
        reason: z.string(),
        assurance: z.literal("local-device-key-attestation-only"),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async ({ intent, publicKeySpkiBase64 }) => {
      const publicKeySpkiDer = Buffer.from(publicKeySpkiBase64, "base64");
      const verification = verifySignedApprovalIntent(intent, publicKeySpkiDer);
      return {
        schemaVersion: "runbook.approval-verify.v1" as const,
        valid: verification.valid,
        authority: verification.authority,
        humanAuthorityEstablished: false as const,
        authorizationEstablished: false as const,
        brokerEffect: false as const,
        reason: verification.reason,
        assurance: "local-device-key-attestation-only" as const,
        limitations: [...APPROVAL_LIMITATIONS],
      };
    }),
  );
}
