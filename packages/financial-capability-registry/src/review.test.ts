import { describe, expect, it } from "vitest";
import {
  reviewerKeyIdFromSpki,
  reviewSigningBytes,
  verifyReviewArtifactSignature,
} from "./review.js";
import {
  REVIEW_ARTIFACT_SCHEMA,
  REVIEW_CLAIMS_SCHEMA,
  type ReviewArtifactV1,
  type ReviewClaimsV1,
} from "./types.js";

const hash = (digit: string) => digit.repeat(64);

async function signedArtifact(): Promise<{
  artifact: ReviewArtifactV1;
  privateKey: CryptoKey;
  spki: Uint8Array;
}> {
  const keys = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const reviewerKeyId = await reviewerKeyIdFromSpki(spki);
  const claims: ReviewClaimsV1 = {
    baselineSnapshotSha256: hash("1"),
    blockedChangeSetSha256: hash("2"),
    candidateSnapshotSha256: hash("3"),
    decisions: [{
      changeId: hash("4"),
      decision: "approve",
      rationaleSha256: hash("5"),
    }],
    diffSha256: hash("6"),
    expiresAt: "2026-07-23T00:00:00Z",
    issuedAt: "2026-07-22T00:00:00Z",
    nonceSha256: hash("7"),
    notBefore: "2026-07-22T00:00:00Z",
    policySha256: hash("8"),
    purpose: "registry-admission-only",
    requiredEvidenceSha256: [hash("9")],
    reviewId: "review-001",
    reviewerKeyId,
    schemaVersion: REVIEW_CLAIMS_SCHEMA,
    sourceSetSha256: hash("a"),
  };
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    keys.privateKey,
    reviewSigningBytes(claims),
  ));
  const signatureBase64 = btoa(String.fromCharCode(...signature));
  return {
    artifact: {
      algorithm: "ed25519",
      claims,
      schemaVersion: REVIEW_ARTIFACT_SCHEMA,
      signatureBase64,
    },
    privateKey: keys.privateKey,
    spki,
  };
}

describe("bounded Ed25519 registry review signatures", () => {
  it("verifies exact domain-separated claims under the selected SPKI", async () => {
    const fixture = await signedArtifact();
    await expect(verifyReviewArtifactSignature(fixture.artifact, fixture.spki))
      .resolves.toMatchObject({ errorCode: null, valid: true });
  });

  it("rejects a claims mutation under the original signature", async () => {
    const fixture = await signedArtifact();
    const mutated: ReviewArtifactV1 = {
      ...fixture.artifact,
      claims: { ...fixture.artifact.claims, candidateSnapshotSha256: hash("b") },
    };
    await expect(verifyReviewArtifactSignature(mutated, fixture.spki))
      .resolves.toMatchObject({ errorCode: "review-signature-invalid", valid: false });
  });

  it("rejects another well-formed reviewer key", async () => {
    const fixture = await signedArtifact();
    const other = await signedArtifact();
    await expect(verifyReviewArtifactSignature(fixture.artifact, other.spki))
      .resolves.toMatchObject({ errorCode: "review-key-invalid", valid: false });
  });

  it("rejects noncanonical or incorrectly sized signatures and SPKI input", async () => {
    const fixture = await signedArtifact();
    await expect(verifyReviewArtifactSignature(
      { ...fixture.artifact, signatureBase64: "A".repeat(88) },
      fixture.spki,
    )).resolves.toMatchObject({ valid: false });
    await expect(verifyReviewArtifactSignature(fixture.artifact, new Uint8Array(4)))
      .resolves.toMatchObject({ errorCode: "review-key-invalid", valid: false });
  });
});
