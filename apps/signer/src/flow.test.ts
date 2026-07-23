import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finalizeProofCapsule } from "@runbook/capsule-author";
import { verifyProofCapsule as verifyNode } from "../../../packages/capsule/src/index.js";
import { openVerifiedCreatorSeed, prepareCreatorFork, verifyPreparedCreatorFork, type CreatorForkChoice } from "@runbook/creator-proof";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const seedArchive = new Uint8Array(readFileSync(new URL("../../../packages/creator-proof/fixtures/rich-synthetic-seed.runbook", import.meta.url)));

describe("isolated signer fixed flow", () => {
  it.each(["concentration", "drawdown", "frequency", "evidence"] as CreatorForkChoice[])("authors and verifies the %s child without arbitrary input", async (choice) => {
    const parent = await openVerifiedCreatorSeed(seedArchive, { subtle });
    const pair = await subtle.generateKey("Ed25519", false, ["sign", "verify"]);
    const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
    const fork = await prepareCreatorFork({ checkpointSequence: 1, choice, createdAt: "2026-07-21T23:00:00Z", experimentId: `SIGNER-${choice.toUpperCase()}`, parent, publicKeySpkiDer: spki, subtle });
    const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, fork.prepared.signingBytes));
    const authored = await finalizeProofCapsule(fork.prepared, signature, { subtle });
    const [core, domain] = await Promise.all([
      verifyNode(Buffer.from(authored.archiveBytes)),
      verifyPreparedCreatorFork({ parentArchive: seedArchive, childArchive: authored.archiveBytes, fork, subtle }),
    ]);
    expect(core).toMatchObject({ valid: true, capsuleId: authored.capsuleId, lineage: { relation: "derived", parents: [parent.capsuleId] } });
    expect(domain).toMatchObject({ valid: true, childCapsuleId: authored.capsuleId });
  });
});
