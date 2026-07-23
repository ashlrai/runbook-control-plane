/**
 * Signed approval intent helpers.
 * Device-key signatures are local attestation only — never broker authorization.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { sha256Hex } from "./canonical.js";
import {
  signedApprovalIntentSchema,
  type SignedApprovalIntent,
} from "./types.js";

export type GeneratedApprovalKey = {
  publicKeySpkiDer: Buffer;
  privateKeyPkcs8Der: Buffer;
  publicKeyFingerprint: string;
};

export function fingerprintSpki(publicKeySpkiDer: Buffer): string {
  return createHash("sha256").update(publicKeySpkiDer).digest("hex");
}

export function generateApprovalKeyPair(): GeneratedApprovalKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeySpkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const privateKeyPkcs8Der = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  return {
    publicKeySpkiDer,
    privateKeyPkcs8Der,
    publicKeyFingerprint: fingerprintSpki(publicKeySpkiDer),
  };
}

/** Canonical bytes for signing — excludes signature and authority upgrade fields. */
export function canonicalApprovalPayload(intent: {
  approvalId: string;
  sessionId: string;
  experimentId: string;
  proposalId: string;
  proposalDigest: string;
  charterDigest: string;
  approved: boolean;
  decidedAt: string;
  expiresAt?: string | undefined;
}): string {
  return JSON.stringify({
    schemaVersion: "runbook.signed-approval-intent.v1",
    approvalId: intent.approvalId,
    sessionId: intent.sessionId,
    experimentId: intent.experimentId,
    proposalId: intent.proposalId,
    proposalDigest: intent.proposalDigest,
    charterDigest: intent.charterDigest,
    approved: intent.approved,
    decidedAt: intent.decidedAt,
    expiresAt: intent.expiresAt ?? null,
  });
}

export function createCallerAssertedApproval(input: {
  approvalId: string;
  sessionId: string;
  experimentId: string;
  proposalId: string;
  proposalDigest: string;
  charterDigest: string;
  approved: boolean;
  decidedAt?: string;
  expiresAt?: string;
}): SignedApprovalIntent {
  return signedApprovalIntentSchema.parse({
    schemaVersion: "runbook.signed-approval-intent.v1",
    approvalId: input.approvalId,
    sessionId: input.sessionId,
    experimentId: input.experimentId,
    proposalId: input.proposalId,
    proposalDigest: input.proposalDigest,
    charterDigest: input.charterDigest,
    approved: input.approved,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    authority: "caller-asserted-unauthenticated",
    humanAuthorityEstablished: false,
    authorizationEstablished: false,
    brokerEffect: false,
    limitations: [
      "not-broker-authorization",
      "device-key-signed-is-local-attestation-only",
      "caller-asserted-is-not-authenticated-human",
    ],
  });
}

export function signApprovalIntent(
  intent: Omit<SignedApprovalIntent, "signatureBase64" | "authority" | "publicKeyFingerprint"> & {
    authority?: SignedApprovalIntent["authority"];
  },
  privateKeyPkcs8Der: Buffer,
  publicKeySpkiDer: Buffer,
): SignedApprovalIntent {
  const payload = canonicalApprovalPayload(intent);
  const key = createPrivateKey({ key: privateKeyPkcs8Der, format: "der", type: "pkcs8" });
  const signature = sign(null, Buffer.from(payload, "utf8"), key);
  return signedApprovalIntentSchema.parse({
    ...intent,
    authority: "device-key-signed",
    publicKeyFingerprint: fingerprintSpki(publicKeySpkiDer),
    signatureBase64: signature.toString("base64"),
    humanAuthorityEstablished: false,
    authorizationEstablished: false,
    brokerEffect: false,
    limitations: [
      "not-broker-authorization",
      "device-key-signed-is-local-attestation-only",
      "caller-asserted-is-not-authenticated-human",
      "local-attestation-not-identity-proof",
    ],
  });
}

export type ApprovalVerification = {
  valid: boolean;
  authority: SignedApprovalIntent["authority"];
  humanAuthorityEstablished: false;
  authorizationEstablished: false;
  brokerEffect: false;
  reason: string;
};

export function verifySignedApprovalIntent(
  intent: SignedApprovalIntent,
  publicKeySpkiDer?: Buffer,
): ApprovalVerification {
  const base = {
    humanAuthorityEstablished: false as const,
    authorizationEstablished: false as const,
    brokerEffect: false as const,
    authority: intent.authority,
  };

  if (intent.authority === "caller-asserted-unauthenticated") {
    return {
      ...base,
      valid: true,
      reason: "Caller-asserted approval accepted as unauthenticated local record only.",
    };
  }

  if (!intent.signatureBase64 || !intent.publicKeyFingerprint) {
    return { ...base, valid: false, reason: "Missing signature or public key fingerprint." };
  }

  if (!publicKeySpkiDer) {
    return {
      ...base,
      valid: false,
      reason: "Device-key-signed approval requires the verifying public key bytes.",
    };
  }

  const fp = fingerprintSpki(publicKeySpkiDer);
  if (fp !== intent.publicKeyFingerprint) {
    return { ...base, valid: false, reason: "Public key fingerprint mismatch." };
  }

  try {
    const key = createPublicKey({ key: publicKeySpkiDer, format: "der", type: "spki" });
    const payload = canonicalApprovalPayload(intent);
    const ok = verify(
      null,
      Buffer.from(payload, "utf8"),
      key,
      Buffer.from(intent.signatureBase64, "base64"),
    );
    return {
      ...base,
      valid: ok,
      reason: ok
        ? "Device-key signature verifies as local attestation only — not broker authorization."
        : "Signature verification failed.",
    };
  } catch {
    return { ...base, valid: false, reason: "Signature verification error." };
  }
}

export function proposalDigestFromFields(fields: Record<string, unknown>): string {
  return sha256Hex(JSON.stringify(fields));
}
