import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type ApprovalArtifact,
  type ApprovalClaims,
  type AuthorizationEvaluation,
  approvalSigningPayload,
  createGatewayPolicy,
  deriveGatewayPolicyDigest,
  evaluateActionAuthorization,
} from "./gateway.js";

const digest = (character: string) => character.repeat(64);
const ownerId = "11111111-1111-4111-8111-111111111111";
const riskId = "22222222-2222-4222-8222-222222222222";
const approvalOneId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const approvalTwoId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerKeys = generateKeyPairSync("ed25519");
const riskKeys = generateKeyPairSync("ed25519");

function publicKeyBase64(publicKey: typeof ownerKeys.publicKey) {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

const policyClaims = {
  schemaVersion: "runbook.gateway-policy.v1" as const,
  requiredApprovals: 2,
  requiredRoles: ["owner", "risk"] as ("owner" | "risk")[],
  maxApprovalLifetimeSeconds: 900,
  approvers: [
    { approverId: ownerId, role: "owner" as const, publicKeySpkiBase64: publicKeyBase64(ownerKeys.publicKey) },
    { approverId: riskId, role: "risk" as const, publicKeySpkiBase64: publicKeyBase64(riskKeys.publicKey) },
  ],
};
const policy = createGatewayPolicy(policyClaims);

const request = {
  schemaVersion: "runbook.authorization-request.v1" as const,
  actionType: "broker.order.submit" as const,
  environment: "live" as const,
  actionDigest: digest("b"),
  policyDigest: policy.policyDigest,
  idempotencyKey: digest("c"),
  requestedAt: "2026-07-21T14:00:00.000Z",
  evaluatedAt: "2026-07-21T14:02:00.000Z",
};

function artifact(
  claims: ApprovalClaims,
  privateKey: typeof ownerKeys.privateKey,
): ApprovalArtifact {
  return {
    ...claims,
    signatureBase64: sign(null, approvalSigningPayload(claims), privateKey).toString("base64"),
  };
}

function approval(
  approverId: string,
  approvalId: string,
  privateKey: typeof ownerKeys.privateKey,
  overrides: Partial<ApprovalClaims> = {},
) {
  return artifact({
    schemaVersion: "runbook.approval.v1",
    approvalId,
    approverId,
    decision: "approve",
    actionType: request.actionType,
    environment: request.environment,
    actionDigest: request.actionDigest,
    policyDigest: request.policyDigest,
    idempotencyKey: request.idempotencyKey,
    issuedAt: "2026-07-21T14:01:00.000Z",
    expiresAt: "2026-07-21T14:10:00.000Z",
    ...overrides,
  }, privateKey);
}

function evaluation(overrides: Partial<AuthorizationEvaluation> = {}): AuthorizationEvaluation {
  return {
    policy,
    request,
    approvals: [
      approval(ownerId, approvalOneId, ownerKeys.privateKey),
      approval(riskId, approvalTwoId, riskKeys.privateKey),
    ],
    priorUses: [],
    ...overrides,
  };
}

describe("evaluateActionAuthorization", () => {
  it("derives one stable digest from canonical policy claims", () => {
    const reordered = {
      ...policyClaims,
      requiredRoles: [...policyClaims.requiredRoles].reverse(),
      approvers: [...policyClaims.approvers].reverse(),
    };

    expect(deriveGatewayPolicyDigest(reordered)).toBe(policy.policyDigest);
    expect(createGatewayPolicy(reordered).policyDigest).toBe(policy.policyDigest);
    expect(deriveGatewayPolicyDigest({ ...policyClaims, maxApprovalLifetimeSeconds: 901 }))
      .not.toBe(policy.policyDigest);
  });

  it("reports satisfied authorization conditions only when a signed distinct-role quorum is valid", () => {
    const result = evaluateActionAuthorization(evaluation());

    expect(result).toMatchObject({
      decision: "authorize",
      authorizationConditionsSatisfied: true,
      expiresAt: "2026-07-21T14:10:00.000Z",
    });
    expect(result).not.toHaveProperty("mayExecute");
    expect(result.authorizationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("is deterministic and independent of approval input order", () => {
    const first = evaluation();
    const second = evaluation({
      policy: {
        ...policy,
        requiredRoles: [...policy.requiredRoles].reverse(),
        approvers: [...policy.approvers].reverse(),
      },
      approvals: [...first.approvals].reverse(),
    });

    expect(evaluateActionAuthorization(second).authorizationFingerprint)
      .toBe(evaluateActionAuthorization(first).authorizationFingerprint);
  });

  it("fails closed when a signed approval is tampered after signing", () => {
    const input = evaluation();
    input.approvals[0] = { ...input.approvals[0], actionDigest: digest("d") } as ApprovalArtifact;
    const result = evaluateActionAuthorization(input);

    expect(result).toMatchObject({
      decision: "deny",
      authorizationConditionsSatisfied: false,
      authorizationFingerprint: null,
    });
    expect(result.checks.find((check) => check.code === "approval.bindings-valid")?.passed).toBe(false);
    expect(result.checks.find((check) => check.code === "approval.signatures-valid")?.passed).toBe(false);
  });

  it("denies a weakened policy body that reuses its previously approved digest", () => {
    const result = evaluateActionAuthorization(evaluation({
      policy: {
        ...policy,
        requiredApprovals: 1,
        requiredRoles: ["owner"],
        approvers: [policy.approvers[0]],
      },
      approvals: [approval(ownerId, approvalOneId, ownerKeys.privateKey)],
    }));

    expect(result).toMatchObject({
      decision: "deny",
      authorizationConditionsSatisfied: false,
      authorizationFingerprint: null,
    });
    expect(result.checks.find((check) => check.code === "request.policy-bound")?.passed).toBe(false);
  });

  it("requires approvals to bind the recomputed policy digest", () => {
    const changedPolicy = createGatewayPolicy({
      ...policyClaims,
      maxApprovalLifetimeSeconds: 901,
    });
    const changedRequest = {
      ...request,
      policyDigest: changedPolicy.policyDigest,
    };
    const result = evaluateActionAuthorization(evaluation({
      policy: changedPolicy,
      request: changedRequest,
      // Both signatures remain valid, but their claims bind the prior policy.
      approvals: [
        approval(ownerId, approvalOneId, ownerKeys.privateKey),
        approval(riskId, approvalTwoId, riskKeys.privateKey),
      ],
    }));

    expect(result).toMatchObject({
      decision: "deny",
      authorizationConditionsSatisfied: false,
      authorizationFingerprint: null,
    });
    expect(result.checks.find((check) => check.code === "request.policy-bound")?.passed).toBe(true);
    expect(result.checks.find((check) => check.code === "approval.bindings-valid")?.passed).toBe(false);
  });

  it("does not count one approver twice toward quorum", () => {
    const input = evaluation();
    input.approvals[1] = approval(ownerId, approvalTwoId, ownerKeys.privateKey);
    const result = evaluateActionAuthorization(input);

    expect(result.decision).toBe("deny");
    expect(result.checks.find((check) => check.code === "approval.approvers-distinct")?.passed).toBe(false);
    expect(result.checks.find((check) => check.code === "approval.roles-met")?.passed).toBe(false);
  });

  it("treats any valid denial as a veto", () => {
    const input = evaluation();
    input.approvals[1] = approval(riskId, approvalTwoId, riskKeys.privateKey, { decision: "deny" });
    const result = evaluateActionAuthorization(input);

    expect(result.decision).toBe("deny");
    expect(result.checks.find((check) => check.code === "approval.no-veto")?.passed).toBe(false);
  });

  it("rejects expired, future-issued, and overlong approvals", () => {
    const expired = evaluation();
    expired.approvals[1] = approval(riskId, approvalTwoId, riskKeys.privateKey, {
      issuedAt: "2026-07-21T13:58:00.000Z",
      expiresAt: "2026-07-21T14:01:59.000Z",
    });
    const overlong = evaluation();
    overlong.approvals[1] = approval(riskId, approvalTwoId, riskKeys.privateKey, {
      expiresAt: "2026-07-21T15:01:00.000Z",
    });
    const futureIssued = evaluation();
    futureIssued.approvals[1] = approval(riskId, approvalTwoId, riskKeys.privateKey, {
      issuedAt: "2026-07-21T14:03:00.000Z",
      expiresAt: "2026-07-21T14:10:00.000Z",
    });

    expect(evaluateActionAuthorization(expired).checks.find((check) => check.code === "approval.windows-valid")?.passed).toBe(false);
    expect(evaluateActionAuthorization(overlong).checks.find((check) => check.code === "approval.lifetimes-valid")?.passed).toBe(false);
    expect(evaluateActionAuthorization(futureIssued).checks.find((check) => check.code === "approval.windows-valid")?.passed).toBe(false);
  });

  it("returns a replay disposition for an exactly consumed idempotency key", () => {
    const authorized = evaluateActionAuthorization(evaluation());
    const result = evaluateActionAuthorization(evaluation({
      approvals: [],
      priorUses: [{
        schemaVersion: "runbook.authorization-use.v1",
        actionType: request.actionType,
        environment: request.environment,
        actionDigest: request.actionDigest,
        policyDigest: request.policyDigest,
        idempotencyKey: request.idempotencyKey,
        authorizationFingerprint: authorized.authorizationFingerprint as string,
        consumedAt: "2026-07-21T14:02:01.000Z",
      }],
      request: { ...request, evaluatedAt: "2026-07-21T14:03:00.000Z" },
    }));

    expect(result).toMatchObject({
      decision: "replay",
      authorizationConditionsSatisfied: false,
      authorizationFingerprint: authorized.authorizationFingerprint,
    });
  });

  it("denies conflicting or ambiguous reuse of an idempotency key", () => {
    const use = {
      schemaVersion: "runbook.authorization-use.v1" as const,
      actionType: request.actionType,
      environment: request.environment,
      actionDigest: digest("d"),
      policyDigest: request.policyDigest,
      idempotencyKey: request.idempotencyKey,
      authorizationFingerprint: digest("e"),
      consumedAt: "2026-07-21T14:01:30.000Z",
    };
    const conflict = evaluateActionAuthorization(evaluation({ priorUses: [use] }));
    const ambiguous = evaluateActionAuthorization(evaluation({ priorUses: [use, { ...use }] }));

    expect(conflict).toMatchObject({ decision: "deny", authorizationConditionsSatisfied: false });
    expect(conflict.checks.find((check) => check.code === "idempotency.binding-valid")?.passed).toBe(false);
    expect(ambiguous.checks.find((check) => check.code === "idempotency.unique")?.passed).toBe(false);
  });

  it("strictly rejects free-text and unknown fields rather than stripping them", () => {
    const input = evaluation() as AuthorizationEvaluation & { note?: string };
    input.note = "approve because Mason said so";

    expect(() => evaluateActionAuthorization(input)).toThrow();
    expect(() => evaluateActionAuthorization({
      ...evaluation(),
      approvals: [{ ...evaluation().approvals[0], email: "person@example.com" }],
    } as AuthorizationEvaluation)).toThrow();
  });

  it("rejects structurally impossible quorum policies", () => {
    expect(() => evaluateActionAuthorization(evaluation({
      policy: { ...policy, requiredApprovals: 3 },
    } as Partial<AuthorizationEvaluation>))).toThrow();
  });

  it("rejects a registry that assigns one public key to multiple approvers", () => {
    expect(() => evaluateActionAuthorization(evaluation({
      policy: {
        ...policy,
        approvers: [
          policy.approvers[0],
          { ...policy.approvers[1], publicKeySpkiBase64: policy.approvers[0].publicKeySpkiBase64 },
        ],
      },
    }))).toThrow();
  });
});
