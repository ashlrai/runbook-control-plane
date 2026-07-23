import { canonicalizeJcs } from "./canonical.js";
import { parseReviewArtifact } from "./artifact-validate.js";
import type { ReviewArtifactV1, ReviewClaimsV1 } from "./types.js";

const REVIEW_SIGNATURE_DOMAIN =
  "runbook.financial-capability-review-signature.v1\u0000";
const MAX_REVIEWER_SPKI_BYTES = 1_024;

export type ReviewSignatureVerificationV1 = Readonly<{
  errorCode: "review-signature-invalid" | "review-key-invalid" | null;
  reviewerKeyId: string | null;
  valid: boolean;
}>;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function strictBase64(value: string): Uint8Array | null {
  if (
    value.length !== 88 ||
    !/^[A-Za-z0-9+/]{86}==$/.test(value)
  ) return null;
  try {
    const binary = atob(value);
    if (binary.length !== 64 || btoa(binary) !== value) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function ownedSpki(value: Uint8Array): Uint8Array | null {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 32 ||
    value.byteLength > MAX_REVIEWER_SPKI_BYTES
  ) return null;
  return new Uint8Array(value);
}

function ownedArrayBuffer(value: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(value.byteLength);
  new Uint8Array(output).set(value);
  return output;
}

export function reviewSigningBytes(claims: ReviewClaimsV1): Uint8Array {
  return new TextEncoder().encode(
    `${REVIEW_SIGNATURE_DOMAIN}${canonicalizeJcs(claims)}`,
  );
}

export async function reviewerKeyIdFromSpki(
  reviewerSpki: Uint8Array,
): Promise<string> {
  const owned = ownedSpki(reviewerSpki);
  if (owned === null) throw new Error("review-key-invalid");
  const digest = await crypto.subtle.digest("SHA-256", ownedArrayBuffer(owned));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function verifyReviewArtifactSignature(
  artifact: ReviewArtifactV1,
  reviewerSpki: Uint8Array,
): Promise<ReviewSignatureVerificationV1> {
  let parsed: ReviewArtifactV1;
  try {
    parsed = parseReviewArtifact(artifact);
  } catch {
    return {
      errorCode: "review-signature-invalid",
      reviewerKeyId: null,
      valid: false,
    };
  }
  const owned = ownedSpki(reviewerSpki);
  const signature = strictBase64(parsed.signatureBase64);
  if (owned === null) {
    return { errorCode: "review-key-invalid", reviewerKeyId: null, valid: false };
  }
  if (signature === null) {
    return { errorCode: "review-signature-invalid", reviewerKeyId: null, valid: false };
  }
  let reviewerKeyId: string;
  try {
    reviewerKeyId = await reviewerKeyIdFromSpki(owned);
  } catch {
    return { errorCode: "review-key-invalid", reviewerKeyId: null, valid: false };
  }
  if (parsed.claims.reviewerKeyId !== reviewerKeyId) {
    return { errorCode: "review-key-invalid", reviewerKeyId, valid: false };
  }
  try {
    const publicKey = await crypto.subtle.importKey(
      "spki",
      ownedArrayBuffer(owned),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      ownedArrayBuffer(signature),
      ownedArrayBuffer(reviewSigningBytes(parsed.claims)),
    );
    return {
      errorCode: valid ? null : "review-signature-invalid",
      reviewerKeyId,
      valid,
    };
  } catch {
    return { errorCode: "review-key-invalid", reviewerKeyId, valid: false };
  }
}
