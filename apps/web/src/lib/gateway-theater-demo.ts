/**
 * Gateway quorum theater demo for the browser.
 *
 * Full evaluateActionAuthorization / approvalSigningPayload live in
 * @runbook/engine/gateway and depend on node:crypto (Buffer, createHash, verify).
 * They must NOT be imported into client bundles.
 *
 * This module:
 * 1) Uses Web Crypto Ed25519 for a 2-role (owner + risk) signing demo.
 * 2) Serves pre-structured authorize / deny / replay fixture check lists.
 *
 * Labeled fixture theater — full crypto evaluation is MCP/CLI.
 */

export type GatewayTheaterRole = "owner" | "risk";

export type GatewayTheaterCheck = {
  code: string;
  passed: boolean;
  note?: string;
};

export type GatewayTheaterDecision = "authorize" | "deny" | "replay";

export type GatewayTheaterScenarioId = "authorize-quorum" | "deny-missing-role" | "replay-prior-use";

export type GatewayTheaterScenario = {
  id: GatewayTheaterScenarioId;
  title: string;
  summary: string;
  decision: GatewayTheaterDecision;
  authorizationConditionsSatisfied: boolean;
  actionType: "broker.order.submit";
  environment: "live" | "paper";
  requiredApprovals: 2;
  requiredRoles: readonly GatewayTheaterRole[];
  checks: readonly GatewayTheaterCheck[];
  honesty: readonly string[];
};

export type GatewayTheaterRoleKey = {
  role: GatewayTheaterRole;
  approverId: string;
  publicKeySpkiBase64: string;
  /** SHA-256 of SPKI DER as hex (demo fingerprint only). */
  keyFingerprintSha256: string;
};

export type GatewayTheaterSigningDemo = {
  roles: readonly GatewayTheaterRoleKey[];
  /** Canonical-ish demo approval payload (UTF-8) that both roles signed. */
  approvalPayloadUtf8: string;
  signaturesBase64: Readonly<Record<GatewayTheaterRole, string>>;
  allSignaturesValid: boolean;
  theaterLabel: "fixture theater · full crypto evaluation is MCP/CLI";
  limitations: readonly string[];
};

export const GATEWAY_THEATER_LABEL =
  "fixture theater · full crypto evaluation is MCP/CLI" as const;

export const GATEWAY_THEATER_LIMITATIONS = [
  "not-broker-issued",
  "not-live-capital",
  "not-identity-proof",
  "browser-fixture-not-engine-evaluate",
  "full-crypto-evaluation-is-mcp-cli",
  "no-mayExecute-authority",
] as const;

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const RISK_ID = "22222222-2222-4222-8222-222222222222";

const baseHonesty = [
  "authorizationConditionsSatisfied is not mayExecute",
  "Host may still bypass Runbook",
  "Self-asserted demo keys only",
  GATEWAY_THEATER_LABEL,
] as const;

/** Pre-structured scenarios mirroring engine semantics for UI theater only. */
export const GATEWAY_THEATER_SCENARIOS: readonly GatewayTheaterScenario[] = [
  {
    id: "authorize-quorum",
    title: "Authorize · 2-of-2 role quorum",
    summary:
      "Owner + risk both approve a live broker.order.submit with distinct registered keys, valid windows, and matching digests.",
    decision: "authorize",
    authorizationConditionsSatisfied: true,
    actionType: "broker.order.submit",
    environment: "live",
    requiredApprovals: 2,
    requiredRoles: ["owner", "risk"],
    checks: [
      { code: "request.time-valid", passed: true },
      { code: "request.policy-bound", passed: true },
      { code: "idempotency.unique", passed: true },
      { code: "idempotency.binding-valid", passed: true },
      { code: "approval.ids-unique", passed: true },
      { code: "approval.approvers-distinct", passed: true },
      { code: "approval.authorities-registered", passed: true },
      { code: "approval.bindings-valid", passed: true },
      { code: "approval.signatures-valid", passed: true, note: "Fixture outcome · not live verify()" },
      { code: "approval.windows-valid", passed: true },
      { code: "approval.lifetimes-valid", passed: true },
      { code: "approval.no-veto", passed: true },
      { code: "approval.quorum-met", passed: true },
      { code: "approval.roles-met", passed: true },
    ],
    honesty: [...baseHonesty, "authorize ≠ order placement"],
  },
  {
    id: "deny-missing-role",
    title: "Deny · missing required role",
    summary:
      "Only owner approves; risk role is required by policy. Quorum count may look fine on raw approvals, but roles-met fails closed.",
    decision: "deny",
    authorizationConditionsSatisfied: false,
    actionType: "broker.order.submit",
    environment: "live",
    requiredApprovals: 2,
    requiredRoles: ["owner", "risk"],
    checks: [
      { code: "request.time-valid", passed: true },
      { code: "request.policy-bound", passed: true },
      { code: "idempotency.unique", passed: true },
      { code: "idempotency.binding-valid", passed: true },
      { code: "approval.ids-unique", passed: true },
      { code: "approval.approvers-distinct", passed: true },
      { code: "approval.authorities-registered", passed: true },
      { code: "approval.bindings-valid", passed: true },
      { code: "approval.signatures-valid", passed: true, note: "Owner signature present; risk absent" },
      { code: "approval.windows-valid", passed: true },
      { code: "approval.lifetimes-valid", passed: true },
      { code: "approval.no-veto", passed: true },
      { code: "approval.quorum-met", passed: false, note: "1 of 2 required approvals" },
      { code: "approval.roles-met", passed: false, note: "risk role missing" },
    ],
    honesty: [...baseHonesty, "fail-closed on incomplete role set"],
  },
  {
    id: "replay-prior-use",
    title: "Replay · prior matching use",
    summary:
      "Idempotency key already consumed with a matching prior use. Decision is replay (return prior result) — never re-submit.",
    decision: "replay",
    authorizationConditionsSatisfied: false,
    actionType: "broker.order.submit",
    environment: "paper",
    requiredApprovals: 2,
    requiredRoles: ["owner", "risk"],
    checks: [
      { code: "request.time-valid", passed: true },
      { code: "request.policy-bound", passed: true },
      { code: "idempotency.unique", passed: false, note: "prior use present for key" },
      { code: "idempotency.binding-valid", passed: true, note: "prior use bindings match request" },
      { code: "idempotency.use-time-valid", passed: true },
    ],
    honesty: [...baseHonesty, "replay always means return prior result; never submit again"],
  },
] as const;

export function getGatewayTheaterScenario(id: GatewayTheaterScenarioId): GatewayTheaterScenario {
  const scenario = GATEWAY_THEATER_SCENARIOS.find((s) => s.id === id);
  if (!scenario) {
    throw new Error(`Unknown gateway theater scenario: ${id}`);
  }
  return scenario;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Lightweight Web Crypto Ed25519 quorum demo for two roles.
 * Signs a demo approval payload — not engine approvalSigningPayload / evaluateActionAuthorization.
 */
export async function runGatewayTheaterSigningDemo(
  options?: { subtle?: SubtleCrypto },
): Promise<GatewayTheaterSigningDemo> {
  const subtle = options?.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Web Crypto SubtleCrypto is unavailable — cannot run gateway theater signing demo.");
  }

  const approvalPayloadUtf8 = JSON.stringify({
    schemaVersion: "runbook.gateway-theater-approval-demo.v1",
    theater: GATEWAY_THEATER_LABEL,
    actionType: "broker.order.submit",
    environment: "live",
    requiredRoles: ["owner", "risk"],
    note: "Demo payload only — not engine approvalSigningPayload bytes",
  });
  const payloadBytes = new TextEncoder().encode(approvalPayloadUtf8);

  const roleSpecs: { role: GatewayTheaterRole; approverId: string }[] = [
    { role: "owner", approverId: OWNER_ID },
    { role: "risk", approverId: RISK_ID },
  ];

  const roles: GatewayTheaterRoleKey[] = [];
  const signaturesBase64 = {} as Record<GatewayTheaterRole, string>;
  let allSignaturesValid = true;

  for (const spec of roleSpecs) {
    const pair = (await subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
    const fingerprint = new Uint8Array(await subtle.digest("SHA-256", spki));
    const signature = new Uint8Array(
      await subtle.sign({ name: "Ed25519" }, pair.privateKey, payloadBytes),
    );
    const verifyKey = await subtle.importKey(
      "spki",
      spki,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const valid = await subtle.verify({ name: "Ed25519" }, verifyKey, signature, payloadBytes);
    if (!valid) allSignaturesValid = false;

    roles.push({
      role: spec.role,
      approverId: spec.approverId,
      publicKeySpkiBase64: bytesToBase64(spki),
      keyFingerprintSha256: bytesToHex(fingerprint),
    });
    signaturesBase64[spec.role] = bytesToBase64(signature);
  }

  return {
    roles,
    approvalPayloadUtf8,
    signaturesBase64,
    allSignaturesValid,
    theaterLabel: GATEWAY_THEATER_LABEL,
    limitations: GATEWAY_THEATER_LIMITATIONS,
  };
}
