import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";

const MAX_APPROVERS = 20;
const MAX_APPROVALS = 20;
const MAX_PRIOR_USES = 1_000;
const HASH_DOMAIN = "RUNBOOK_ACTION_AUTHORIZATION_V1\0";
const POLICY_HASH_DOMAIN = "RUNBOOK_GATEWAY_POLICY_V1\0";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const opaqueIdSchema = z.uuid().transform((value) => value.toLowerCase());
const utcTimestampSchema = z.iso.datetime().refine(
  (value) => value.endsWith("Z") && !Number.isNaN(Date.parse(value)),
  "Timestamp must be UTC RFC3339 ending in Z.",
);
const canonicalBase64Schema = z
  .string()
  .min(4)
  .max(512)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine((value) => Buffer.from(value, "base64").toString("base64") === value, "Value must use canonical base64 encoding.");

export const gatewayRoleSchema = z.enum(["owner", "risk", "operator", "compliance"]);
export const gatewayActionTypeSchema = z.enum([
  "broker.order.submit",
  "broker.order.cancel",
  "broker.position.liquidate",
  "content.publish",
  "policy.activate",
]);
export const gatewayEnvironmentSchema = z.enum(["paper", "live"]);

export const gatewayApproverSchema = z.object({
  approverId: opaqueIdSchema,
  role: gatewayRoleSchema,
  publicKeySpkiBase64: canonicalBase64Schema,
}).strict();

const gatewayPolicyClaimsShape = {
  schemaVersion: z.literal("runbook.gateway-policy.v1"),
  requiredApprovals: z.number().int().min(1).max(MAX_APPROVERS),
  requiredRoles: z.array(gatewayRoleSchema).min(1).max(4),
  maxApprovalLifetimeSeconds: z.number().int().min(30).max(86_400),
  approvers: z.array(gatewayApproverSchema).min(1).max(MAX_APPROVERS),
};

function validateGatewayPolicyClaims(
  policy: {
    requiredApprovals: number;
    requiredRoles: readonly string[];
    approvers: readonly { approverId: string; role: string; publicKeySpkiBase64: string }[];
  },
  context: z.RefinementCtx,
) {
  if (new Set(policy.requiredRoles).size !== policy.requiredRoles.length) {
    context.addIssue({ code: "custom", path: ["requiredRoles"], message: "Required roles must be unique." });
  }
  const approverIds = policy.approvers.map((approver) => approver.approverId);
  if (new Set(approverIds).size !== approverIds.length) {
    context.addIssue({ code: "custom", path: ["approvers"], message: "Approver IDs must be unique." });
  }
  const publicKeys = policy.approvers.map((approver) => approver.publicKeySpkiBase64);
  if (new Set(publicKeys).size !== publicKeys.length) {
    context.addIssue({ code: "custom", path: ["approvers"], message: "Approver public keys must be unique." });
  }
  if (policy.requiredApprovals > policy.approvers.length) {
    context.addIssue({ code: "custom", path: ["requiredApprovals"], message: "Quorum exceeds the approver registry." });
  }
  const availableRoles = new Set(policy.approvers.map((approver) => approver.role));
  for (const role of policy.requiredRoles) {
    if (!availableRoles.has(role)) {
      context.addIssue({ code: "custom", path: ["requiredRoles"], message: "Every required role must exist in the approver registry." });
    }
  }
}

/** The complete authorization policy body; its digest is always derived, never asserted. */
export const gatewayPolicyClaimsSchema = z
  .object(gatewayPolicyClaimsShape)
  .strict()
  .superRefine(validateGatewayPolicyClaims);

export const gatewayPolicySchema = z
  .object({
    ...gatewayPolicyClaimsShape,
    policyDigest: digestSchema,
  })
  .strict()
  .superRefine(validateGatewayPolicyClaims);

export const authorizationRequestSchema = z.object({
  schemaVersion: z.literal("runbook.authorization-request.v1"),
  actionType: gatewayActionTypeSchema,
  environment: gatewayEnvironmentSchema,
  actionDigest: digestSchema,
  policyDigest: digestSchema,
  idempotencyKey: digestSchema,
  requestedAt: utcTimestampSchema,
  evaluatedAt: utcTimestampSchema,
}).strict();

export const approvalClaimsSchema = z.object({
  schemaVersion: z.literal("runbook.approval.v1"),
  approvalId: opaqueIdSchema,
  approverId: opaqueIdSchema,
  decision: z.enum(["approve", "deny"]),
  actionType: gatewayActionTypeSchema,
  environment: gatewayEnvironmentSchema,
  actionDigest: digestSchema,
  policyDigest: digestSchema,
  idempotencyKey: digestSchema,
  issuedAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
}).strict();

export const approvalArtifactSchema = approvalClaimsSchema.extend({
  signatureBase64: canonicalBase64Schema,
}).strict();

export const authorizationUseSchema = z.object({
  schemaVersion: z.literal("runbook.authorization-use.v1"),
  actionType: gatewayActionTypeSchema,
  environment: gatewayEnvironmentSchema,
  actionDigest: digestSchema,
  policyDigest: digestSchema,
  idempotencyKey: digestSchema,
  authorizationFingerprint: digestSchema,
  consumedAt: utcTimestampSchema,
}).strict();

export const authorizationEvaluationSchema = z.object({
  policy: gatewayPolicySchema,
  request: authorizationRequestSchema,
  approvals: z.array(approvalArtifactSchema).max(MAX_APPROVALS),
  priorUses: z.array(authorizationUseSchema).max(MAX_PRIOR_USES),
}).strict();

export const authorizationCheckCodeSchema = z.enum([
  "request.time-valid",
  "request.policy-bound",
  "idempotency.unique",
  "idempotency.binding-valid",
  "idempotency.use-time-valid",
  "approval.ids-unique",
  "approval.approvers-distinct",
  "approval.authorities-registered",
  "approval.bindings-valid",
  "approval.signatures-valid",
  "approval.windows-valid",
  "approval.lifetimes-valid",
  "approval.no-veto",
  "approval.quorum-met",
  "approval.roles-met",
]);

export const authorizationCheckSchema = z.object({
  code: authorizationCheckCodeSchema,
  passed: z.boolean(),
}).strict();

export const authorizationDecisionSchema = z.object({
  schemaVersion: z.literal("runbook.authorization-decision.v1"),
  decision: z.enum(["authorize", "deny", "replay"]),
  authorizationConditionsSatisfied: z.boolean(),
  authorizationFingerprint: digestSchema.nullable(),
  expiresAt: utcTimestampSchema.nullable(),
  checks: z.array(authorizationCheckSchema).min(1).max(20),
}).strict();

export type GatewayPolicy = z.infer<typeof gatewayPolicySchema>;
export type GatewayPolicyClaims = z.infer<typeof gatewayPolicyClaimsSchema>;
export type AuthorizationRequest = z.infer<typeof authorizationRequestSchema>;
export type ApprovalClaims = z.infer<typeof approvalClaimsSchema>;
export type ApprovalArtifact = z.infer<typeof approvalArtifactSchema>;
export type AuthorizationUse = z.infer<typeof authorizationUseSchema>;
export type AuthorizationEvaluation = z.infer<typeof authorizationEvaluationSchema>;
export type AuthorizationCheck = z.infer<typeof authorizationCheckSchema>;
export type AuthorizationDecision = z.infer<typeof authorizationDecisionSchema>;

function canonicalGatewayPolicyClaims(rawClaims: GatewayPolicyClaims) {
  const claims = gatewayPolicyClaimsSchema.parse(rawClaims);
  return JSON.stringify({
    schemaVersion: claims.schemaVersion,
    requiredApprovals: claims.requiredApprovals,
    requiredRoles: [...claims.requiredRoles].sort(),
    maxApprovalLifetimeSeconds: claims.maxApprovalLifetimeSeconds,
    approvers: [...claims.approvers]
      .sort((left, right) => left.approverId < right.approverId ? -1 : left.approverId > right.approverId ? 1 : 0)
      .map((approver) => ({
        approverId: approver.approverId,
        role: approver.role,
        publicKeySpkiBase64: approver.publicKeySpkiBase64,
      })),
  });
}

/** Derives the only valid digest for a gateway policy body. */
export function deriveGatewayPolicyDigest(rawClaims: GatewayPolicyClaims): string {
  return createHash("sha256")
    .update(POLICY_HASH_DOMAIN)
    .update(canonicalGatewayPolicyClaims(rawClaims))
    .digest("hex");
}

/** Constructs a policy whose digest is cryptographically bound to every policy claim. */
export function createGatewayPolicy(rawClaims: GatewayPolicyClaims): GatewayPolicy {
  const claims = gatewayPolicyClaimsSchema.parse(rawClaims);
  return gatewayPolicySchema.parse({
    ...claims,
    policyDigest: deriveGatewayPolicyDigest(claims),
  });
}

function policyClaims(policy: GatewayPolicy): GatewayPolicyClaims {
  return {
    schemaVersion: policy.schemaVersion,
    requiredApprovals: policy.requiredApprovals,
    requiredRoles: policy.requiredRoles,
    maxApprovalLifetimeSeconds: policy.maxApprovalLifetimeSeconds,
    approvers: policy.approvers,
  };
}

function canonicalApprovalClaims(claims: ApprovalClaims) {
  return JSON.stringify({
    schemaVersion: claims.schemaVersion,
    approvalId: claims.approvalId,
    approverId: claims.approverId,
    decision: claims.decision,
    actionType: claims.actionType,
    environment: claims.environment,
    actionDigest: claims.actionDigest,
    policyDigest: claims.policyDigest,
    idempotencyKey: claims.idempotencyKey,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

/** Returns the only byte representation that is valid for an approval signature. */
export function approvalSigningPayload(rawClaims: ApprovalClaims): Buffer {
  const claims = approvalClaimsSchema.parse(rawClaims);
  return Buffer.from(canonicalApprovalClaims(claims), "utf8");
}

function artifactClaims(artifact: ApprovalArtifact): ApprovalClaims {
  const { signatureBase64: _signatureBase64, ...claims } = artifact;
  return claims;
}

function approvalMatchesRequest(
  approval: ApprovalArtifact,
  request: AuthorizationRequest,
  derivedPolicyDigest: string,
) {
  return approval.actionType === request.actionType
    && approval.environment === request.environment
    && approval.actionDigest === request.actionDigest
    && request.policyDigest === derivedPolicyDigest
    && approval.policyDigest === derivedPolicyDigest
    && approval.idempotencyKey === request.idempotencyKey;
}

function useMatchesRequest(use: AuthorizationUse, request: AuthorizationRequest) {
  return use.actionType === request.actionType
    && use.environment === request.environment
    && use.actionDigest === request.actionDigest
    && use.policyDigest === request.policyDigest
    && use.idempotencyKey === request.idempotencyKey;
}

function verifyApprovalSignature(approval: ApprovalArtifact, publicKeySpkiBase64: string) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    return publicKey.asymmetricKeyType === "ed25519"
      && verify(null, approvalSigningPayload(artifactClaims(approval)), publicKey, Buffer.from(approval.signatureBase64, "base64"));
  } catch {
    return false;
  }
}

function fingerprintAuthorization(
  policy: GatewayPolicy,
  request: AuthorizationRequest,
  approvals: ApprovalArtifact[],
) {
  const stableRequest = {
    schemaVersion: request.schemaVersion,
    actionType: request.actionType,
    environment: request.environment,
    actionDigest: request.actionDigest,
    policyDigest: request.policyDigest,
    idempotencyKey: request.idempotencyKey,
    requestedAt: request.requestedAt,
  };
  const stablePolicy = {
    ...policy,
    requiredRoles: [...policy.requiredRoles].sort(),
    approvers: [...policy.approvers].sort((left, right) => left.approverId.localeCompare(right.approverId)),
  };
  const payload = JSON.stringify({
    policy: stablePolicy,
    request: stableRequest,
    approvals: [...approvals].sort((left, right) => left.approvalId.localeCompare(right.approvalId)),
  });
  return createHash("sha256").update(HASH_DOMAIN).update(payload).digest("hex");
}

function idempotencyChecks(matchingUses: AuthorizationUse[], request: AuthorizationRequest): AuthorizationCheck[] {
  return [
    { code: "idempotency.unique", passed: matchingUses.length <= 1 },
    {
      code: "idempotency.binding-valid",
      passed: matchingUses.length === 0 || (matchingUses.length === 1 && useMatchesRequest(matchingUses[0] as AuthorizationUse, request)),
    },
  ];
}

/**
 * Pure authorization evaluator. `authorizationConditionsSatisfied` means only
 * that every modeled check passed against the supplied inputs at evaluation
 * time; it neither grants execution authority nor proves that execution is safe.
 * `replay` always means return the prior execution result; never submit again.
 */
export function evaluateActionAuthorization(rawEvaluation: AuthorizationEvaluation): AuthorizationDecision {
  const { policy, request, approvals, priorUses } = authorizationEvaluationSchema.parse(rawEvaluation);
  const derivedPolicyDigest = deriveGatewayPolicyDigest(policyClaims(policy));
  const requestTime = Date.parse(request.requestedAt);
  const evaluatedTime = Date.parse(request.evaluatedAt);
  const sameKeyUses = priorUses.filter((use) => use.idempotencyKey === request.idempotencyKey);
  const initialChecks: AuthorizationCheck[] = [
    { code: "request.time-valid", passed: requestTime <= evaluatedTime },
    {
      code: "request.policy-bound",
      passed: policy.policyDigest === derivedPolicyDigest && request.policyDigest === derivedPolicyDigest,
    },
    ...idempotencyChecks(sameKeyUses, request),
  ];

  if (sameKeyUses.length === 1 && useMatchesRequest(sameKeyUses[0] as AuthorizationUse, request)) {
    const use = sameKeyUses[0] as AuthorizationUse;
    const replayChecks: AuthorizationCheck[] = [
      ...initialChecks,
      {
        code: "idempotency.use-time-valid",
        passed: Date.parse(use.consumedAt) >= requestTime && Date.parse(use.consumedAt) <= evaluatedTime,
      },
    ];
    const replayAllowed = replayChecks.every((check) => check.passed);
    return authorizationDecisionSchema.parse({
      schemaVersion: "runbook.authorization-decision.v1",
      decision: replayAllowed ? "replay" : "deny",
      authorizationConditionsSatisfied: false,
      authorizationFingerprint: replayAllowed ? use.authorizationFingerprint : null,
      expiresAt: null,
      checks: replayChecks,
    });
  }

  if (!initialChecks.every((check) => check.passed)) {
    return authorizationDecisionSchema.parse({
      schemaVersion: "runbook.authorization-decision.v1",
      decision: "deny",
      authorizationConditionsSatisfied: false,
      authorizationFingerprint: null,
      expiresAt: null,
      checks: initialChecks,
    });
  }

  const approvalIds = approvals.map((approval) => approval.approvalId);
  const approverIds = approvals.map((approval) => approval.approverId);
  const approverRegistry = new Map(policy.approvers.map((approver) => [approver.approverId, approver]));
  const approvalTimes = approvals.map((approval) => ({
    issued: Date.parse(approval.issuedAt),
    expires: Date.parse(approval.expiresAt),
  }));
  const approvingRoles = new Set(
    approvals
      .filter((approval) => approval.decision === "approve")
      .map((approval) => approverRegistry.get(approval.approverId)?.role)
      .filter((role): role is z.infer<typeof gatewayRoleSchema> => role !== undefined),
  );
  const approvingCount = approvals.filter((approval) => approval.decision === "approve").length;

  const approvalChecks: AuthorizationCheck[] = [
    { code: "approval.ids-unique", passed: new Set(approvalIds).size === approvalIds.length },
    { code: "approval.approvers-distinct", passed: new Set(approverIds).size === approverIds.length },
    { code: "approval.authorities-registered", passed: approvals.every((approval) => approverRegistry.has(approval.approverId)) },
    {
      code: "approval.bindings-valid",
      passed: approvals.every((approval) => approvalMatchesRequest(approval, request, derivedPolicyDigest)),
    },
    {
      code: "approval.signatures-valid",
      passed: approvals.every((approval) => {
        const approver = approverRegistry.get(approval.approverId);
        return approver !== undefined && verifyApprovalSignature(approval, approver.publicKeySpkiBase64);
      }),
    },
    {
      code: "approval.windows-valid",
      passed: approvals.length > 0 && approvalTimes.every(({ issued, expires }) => (
        issued >= requestTime && issued <= evaluatedTime && expires > evaluatedTime && expires > issued
      )),
    },
    {
      code: "approval.lifetimes-valid",
      passed: approvals.every(({ issuedAt, expiresAt }) => (
        (Date.parse(expiresAt) - Date.parse(issuedAt)) / 1_000 <= policy.maxApprovalLifetimeSeconds
      )),
    },
    { code: "approval.no-veto", passed: approvals.every((approval) => approval.decision !== "deny") },
    { code: "approval.quorum-met", passed: approvingCount >= policy.requiredApprovals },
    { code: "approval.roles-met", passed: policy.requiredRoles.every((role) => approvingRoles.has(role)) },
  ];
  const checks = [...initialChecks, ...approvalChecks];
  const authorizationConditionsSatisfied = checks.every((check) => check.passed);
  const expiresAt = authorizationConditionsSatisfied
    ? approvals.map((approval) => approval.expiresAt).sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null
    : null;

  return authorizationDecisionSchema.parse({
    schemaVersion: "runbook.authorization-decision.v1",
    decision: authorizationConditionsSatisfied ? "authorize" : "deny",
    authorizationConditionsSatisfied,
    authorizationFingerprint: authorizationConditionsSatisfied ? fingerprintAuthorization(policy, request, approvals) : null,
    expiresAt,
    checks,
  });
}
