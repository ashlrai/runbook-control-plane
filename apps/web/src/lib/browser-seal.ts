/**
 * Browser-local process capsule seal.
 * Synthetic self-asserted Ed25519 only — not identity, not broker-issued.
 * Process evidence packaging for download / verify path.
 */

import {
  finalizeProofCapsule,
  prepareProofCapsule,
  type CapsulePayloadMember,
} from "@runbook/capsule-author";
import {
  buildProcessCapsulePayloads,
  processCapsuleExperimentId,
} from "@runbook/session/process-capsule";
import type { ControlPlaneSession, SessionEvidencePack } from "./control-plane-session";

export type BrowserSealedProcessCapsule = {
  capsuleId: string;
  archiveSha256: string;
  archiveBytes: Uint8Array;
  /** Ready-to-download .runbook blob */
  blob: Blob;
  experimentId: string;
  authorKeyId: `sha256:${string}`;
  filename: string;
  limitations: readonly string[];
};

const SEAL_LIMITATIONS = [
  "self-asserted-author-key-integrity-only",
  "ephemeral-key-not-persisted",
  "not-broker-issued",
  "not-identity-proof",
  "not-trading-performance",
  "not-capital-allocation",
  "advisory-not-hard-gateway",
  "process-evidence-only",
] as const;

/** Mirror browserSessionStore.exportPack shape without touching storage. */
export function evidencePackFromSession(
  session: ControlPlaneSession,
  exportedAt = new Date().toISOString(),
): SessionEvidencePack {
  return {
    schemaVersion: "runbook.session-evidence-pack.v1",
    exportedAt,
    session,
    assurance: "local-control-plane-export-only",
    brokerEffect: false,
    compositeScore: false,
    notTradingPerformance: true,
  };
}

function rfc3339UtcNoMs(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Seal a control-plane session into a synthetic Proof Capsule (.runbook).
 * Generates an ephemeral Ed25519 key pair via Web Crypto — key is not stored.
 */
export async function sealSessionProcessCapsule(
  session: ControlPlaneSession,
  options?: { subtle?: SubtleCrypto; createdAt?: string },
): Promise<BrowserSealedProcessCapsule> {
  const subtle = options?.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Web Crypto SubtleCrypto is unavailable — cannot seal process capsule.");
  }

  const pack = evidencePackFromSession(session);
  const drafts = buildProcessCapsulePayloads(pack);
  // Copy into this realm's Uint8Array — vitest/jsdom can fail instanceof across packages.
  const payloads: CapsulePayloadMember[] = drafts.map((d) => ({
    path: d.path,
    role: d.role,
    mediaType: d.mediaType,
    bytes: new Uint8Array(d.bytes),
  }));

  const pair = (await subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
  const experimentId = processCapsuleExperimentId(session.sessionId);
  const createdAt = options?.createdAt ?? rfc3339UtcNoMs();

  const prepared = await prepareProofCapsule(
    {
      checkpointSequence: 1,
      createdAt,
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

  const filename = `runbook-process-capsule-${session.sessionId}.runbook`;
  const archiveCopy = new Uint8Array(authored.archiveBytes);
  const blob = new Blob([archiveCopy], {
    type: "application/vnd.runbook.proof+zip",
  });

  return {
    capsuleId: authored.capsuleId,
    archiveSha256: authored.archiveSha256,
    archiveBytes: authored.archiveBytes,
    blob,
    experimentId,
    authorKeyId: authored.authorKeyId,
    filename,
    limitations: SEAL_LIMITATIONS,
  };
}

/** Trigger a browser download for a sealed process capsule. */
export function downloadSealedProcessCapsule(sealed: BrowserSealedProcessCapsule): void {
  const url = URL.createObjectURL(sealed.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sealed.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
