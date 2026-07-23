/**
 * In-process gateway quorum theater demo.
 *
 * Uses @runbook/engine/gateway pure evaluators with ephemeral Ed25519 keys.
 * Local policy theater only — not human authority, not broker authorization,
 * not order submission.
 */

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  type ApprovalArtifact,
  type ApprovalClaims,
  type AuthorizationDecision,
  type AuthorizationEvaluation,
  approvalSigningPayload,
  createGatewayPolicy,
  evaluateActionAuthorization,
} from "@runbook/engine/gateway";

export const GATEWAY_QUORUM_DEMO_SCHEMA = "runbook.gateway-quorum-demo.v1" as const;

export type GatewayQuorumDemoScenarioId = "authorize" | "deny" | "replay";

export type GatewayQuorumDemoScenario = Readonly<{
  id: GatewayQuorumDemoScenarioId;
  decision: AuthorizationDecision["decision"];
  authorizationConditionsSatisfied: boolean;
  checks: Array<{ code: string; passed: boolean }>;
}>;

export type GatewayQuorumDemoResult = Readonly<{
  schemaVersion: typeof GATEWAY_QUORUM_DEMO_SCHEMA;
  actionType: "policy.activate";
  scenarios: GatewayQuorumDemoScenario[];
  humanAuthorityEstablished: false;
  authorizationEstablished: false;
  brokerEffect: false;
  notBrokerOrderSubmission: true;
  localPolicyTheaterOnly: true;
  note: string;
}>;

const digest = (character: string) => character.repeat(64);
const ownerId = "11111111-1111-4111-8111-111111111111";
const riskId = "22222222-2222-4222-8222-222222222222";
const approvalOneId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const approvalTwoId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function publicKeyBase64(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function artifact(claims: ApprovalClaims, privateKey: KeyObject): ApprovalArtifact {
  return {
    ...claims,
    signatureBase64: sign(null, approvalSigningPayload(claims), privateKey).toString("base64"),
  };
}

/**
 * Run three deterministic gateway quorum scenarios in-process:
 * 1. authorize — valid 2-role (owner+risk) quorum
 * 2. deny — missing risk approval
 * 3. replay — prior use with the same fingerprint
 */
export function runGatewayQuorumDemo(): GatewayQuorumDemoResult {
  const ownerKeys = generateKeyPairSync("ed25519");
  const riskKeys = generateKeyPairSync("ed25519");

  const policyClaims = {
    schemaVersion: "runbook.gateway-policy.v1" as const,
    requiredApprovals: 2,
    requiredRoles: ["owner", "risk"] as ("owner" | "risk")[],
    maxApprovalLifetimeSeconds: 900,
    approvers: [
      {
        approverId: ownerId,
        role: "owner" as const,
        publicKeySpkiBase64: publicKeyBase64(ownerKeys.publicKey),
      },
      {
        approverId: riskId,
        role: "risk" as const,
        publicKeySpkiBase64: publicKeyBase64(riskKeys.publicKey),
      },
    ],
  };
  const policy = createGatewayPolicy(policyClaims);

  const request = {
    schemaVersion: "runbook.authorization-request.v1" as const,
    actionType: "policy.activate" as const,
    environment: "paper" as const,
    actionDigest: digest("b"),
    policyDigest: policy.policyDigest,
    idempotencyKey: digest("c"),
    requestedAt: "2026-07-21T14:00:00.000Z",
    evaluatedAt: "2026-07-21T14:02:00.000Z",
  };

  function approval(
    approverId: string,
    approvalId: string,
    privateKey: KeyObject,
    overrides: Partial<ApprovalClaims> = {},
  ): ApprovalArtifact {
    return artifact(
      {
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
      },
      privateKey,
    );
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

  function scenario(
    id: GatewayQuorumDemoScenarioId,
    decision: AuthorizationDecision,
  ): GatewayQuorumDemoScenario {
    return {
      id,
      decision: decision.decision,
      authorizationConditionsSatisfied: decision.authorizationConditionsSatisfied,
      checks: decision.checks.map((check) => ({ code: check.code, passed: check.passed })),
    };
  }

  // 1. authorize: full 2-role quorum
  const authorized = evaluateActionAuthorization(evaluation());

  // 2. deny: owner only — missing risk approval
  const denied = evaluateActionAuthorization(
    evaluation({
      approvals: [approval(ownerId, approvalOneId, ownerKeys.privateKey)],
    }),
  );

  // 3. replay: prior use with same fingerprint (no new approvals needed for replay path)
  const replayed = evaluateActionAuthorization(
    evaluation({
      approvals: [],
      priorUses: [
        {
          schemaVersion: "runbook.authorization-use.v1",
          actionType: request.actionType,
          environment: request.environment,
          actionDigest: request.actionDigest,
          policyDigest: request.policyDigest,
          idempotencyKey: request.idempotencyKey,
          authorizationFingerprint: authorized.authorizationFingerprint as string,
          consumedAt: "2026-07-21T14:02:01.000Z",
        },
      ],
      request: { ...request, evaluatedAt: "2026-07-21T14:03:00.000Z" },
    }),
  );

  return {
    schemaVersion: GATEWAY_QUORUM_DEMO_SCHEMA,
    actionType: "policy.activate",
    scenarios: [
      scenario("authorize", authorized),
      scenario("deny", denied),
      scenario("replay", replayed),
    ],
    humanAuthorityEstablished: false,
    authorizationEstablished: false,
    brokerEffect: false,
    notBrokerOrderSubmission: true,
    localPolicyTheaterOnly: true,
    note:
      "Local gateway policy theater only. Signed approvals use ephemeral demo keys. " +
      "Does not establish human authority, broker authorization, or order submission. " +
      "actionType is policy.activate (not broker.order.submit).",
  };
}
