/**
 * Control Plane Session — shared spine across MCP, web, shadow-lab, dossier.
 * Process / evidence only. Not trading performance. Not hard broker gateway.
 */

import { z } from "zod";
import { riskPolicySchema } from "@runbook/engine/schema";

export const SESSION_SCHEMA = "runbook.control-plane-session.v1" as const;
export const INVENTORY_PIN_SCHEMA = "runbook.inventory-pin.v1" as const;
export const SESSION_EVIDENCE_PACK_SCHEMA = "runbook.session-evidence-pack.v1" as const;
export const SIGNED_APPROVAL_SCHEMA = "runbook.signed-approval-intent.v1" as const;

export const inventoryToolEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    source: z.enum(["public-docs", "runtime-snapshot", "fixture", "operator-declared"]),
    effectClass: z
      .enum([
        "observation",
        "research-state-mutation",
        "order-review",
        "capital-order-mutation",
        "credential-release",
        "unknown",
      ])
      .default("unknown"),
  })
  .strict();

export type InventoryToolEntry = z.infer<typeof inventoryToolEntrySchema>;

export const inventoryPinSchema = z
  .object({
    schemaVersion: z.literal(INVENTORY_PIN_SCHEMA),
    pinId: z.string().trim().min(1).max(120),
    createdAt: z.string().datetime(),
    label: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(80).default("robinhood-public-docs"),
    tools: z.array(inventoryToolEntrySchema).max(200),
    /** SHA-256 hex of canonical tool-name set (sorted names joined by newline). */
    toolSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    admitted: z.boolean(),
    notes: z.string().trim().max(2_000).optional(),
    limitations: z.array(z.string()).default([
      "not-runtime-confirmed-unless-source-is-runtime-snapshot",
      "not-broker-authorization",
      "fail-closed-on-unknown-tools-when-enforced",
    ]),
  })
  .strict();

export type InventoryPin = z.infer<typeof inventoryPinSchema>;

export const dossierAttachmentSchema = z
  .object({
    attachmentId: z.string().trim().min(1).max(120),
    attachedAt: z.string().datetime(),
    kind: z.enum([
      "process-bridged-receipt-ref",
      "status-snapshot",
      "gap-register-draft",
      "operator-note",
    ]),
    scenarioIds: z.array(z.string()).max(64).default([]),
    summary: z.string().trim().min(1).max(1_000),
    /** Opaque digest or path reference — never embed credentials. */
    evidenceRef: z.string().trim().min(1).max(500).optional(),
    processBridgedCount: z.number().int().nonnegative().optional(),
    honestLabel: z.string().trim().max(200).default("architecture-evidence-not-certification"),
  })
  .strict();

export type DossierAttachment = z.infer<typeof dossierAttachmentSchema>;

export const shadowGenerationSummarySchema = z
  .object({
    generation: z.number().int().positive(),
    hardFalseAllows: z.number().int().nonnegative(),
    hardFalseDenies: z.number().int().nonnegative(),
    recordedAt: z.string().datetime(),
  })
  .strict();

export const controlPlaneSessionSchema = z
  .object({
    schemaVersion: z.literal(SESSION_SCHEMA),
    sessionId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    label: z.string().trim().min(1).max(200),
    purpose: z.literal("control-plane-process-evidence"),
    capitalAtRisk: z.literal(0),
    brokerEffect: z.literal(false),
    compositeScore: z.literal(false),
    /** Active charter policy (advisory). */
    charter: riskPolicySchema.optional(),
    charterDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    experimentId: z.string().trim().max(120).optional(),
    ledgerHeadHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    inventoryPin: inventoryPinSchema.optional(),
    inventoryEnforcement: z.enum(["off", "warn", "fail-closed"]).default("fail-closed"),
    /**
     * How preflight dual-eval treats session charter vs experiment ledger charter.
     * - off: skip dual-eval (report no-session binding)
     * - warn (default): report mismatch; process `allowed` stays ledger result
     * - fail-closed: process `allowed` = ledger AND session (missing charter → deny)
     * Never a hard broker gateway.
     */
    charterBindingEnforcement: z.enum(["off", "warn", "fail-closed"]).default("warn"),
    shadowGenerations: z.array(shadowGenerationSummarySchema).max(32).default([]),
    lastShadowHardFalseAllows: z.number().int().nonnegative().optional(),
    lastShadowHardFalseDenies: z.number().int().nonnegative().optional(),
    dossierAttachments: z.array(dossierAttachmentSchema).max(32).default([]),
    notes: z.array(z.string().max(500)).max(50).default([]),
    limitations: z.array(z.string()).default([
      "advisory-not-hard-gateway",
      "not-trading-performance",
      "not-capital-allocation",
      "no-composite-safety-score",
      "local-session-only",
    ]),
  })
  .strict();

export type ControlPlaneSession = z.infer<typeof controlPlaneSessionSchema>;

export const sessionEvidencePackSchema = z
  .object({
    schemaVersion: z.literal(SESSION_EVIDENCE_PACK_SCHEMA),
    exportedAt: z.string().datetime(),
    session: controlPlaneSessionSchema,
    assurance: z.literal("local-control-plane-export-only"),
    brokerEffect: z.literal(false),
    compositeScore: z.literal(false),
    notTradingPerformance: z.literal(true),
  })
  .strict();

export type SessionEvidencePack = z.infer<typeof sessionEvidencePackSchema>;

/** Signed approval intent — structure for device-key binding (verify path optional). */
export const signedApprovalIntentSchema = z
  .object({
    schemaVersion: z.literal(SIGNED_APPROVAL_SCHEMA),
    approvalId: z.string().trim().min(1).max(120),
    sessionId: z.string().trim().min(1).max(120),
    experimentId: z.string().trim().min(1).max(120),
    proposalId: z.string().trim().min(1).max(120),
    proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    charterDigest: z.string().regex(/^[a-f0-9]{64}$/),
    approved: z.boolean(),
    decidedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    /** SPKI public key fingerprint (sha256 hex) — not the private key. */
    publicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    /** Detached signature over canonical intent bytes (base64) when present. */
    signatureBase64: z.string().min(1).max(2_000).optional(),
    authority: z.enum([
      "caller-asserted-unauthenticated",
      "device-key-signed",
      "gateway-quorum-evaluated",
    ]),
    humanAuthorityEstablished: z.literal(false),
    authorizationEstablished: z.literal(false),
    brokerEffect: z.literal(false),
    limitations: z.array(z.string()).default([
      "not-broker-authorization",
      "device-key-signed-is-local-attestation-only",
      "caller-asserted-is-not-authenticated-human",
    ]),
  })
  .strict();

export type SignedApprovalIntent = z.infer<typeof signedApprovalIntentSchema>;

export type InventoryCheckResult = {
  schemaVersion: "runbook.inventory-check.v1";
  ok: boolean;
  enforcement: "off" | "warn" | "fail-closed";
  unknownTools: string[];
  missingPinnedTools: string[];
  extraTools: string[];
  pinToolSetSha256: string | null;
  observedToolSetSha256: string;
  brokerEffect: false;
  compositeScore: false;
  message: string;
};
