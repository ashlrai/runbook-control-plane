import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finalizeProofCapsule, serializeJcs } from "@runbook/capsule-author";
import { verifyProofCapsule as verifyBrowser } from "@runbook/capsule-browser";
import { assembleProofCapsuleZip } from "../../capsule-author/src/zip.js";
import { readCapsuleMembers } from "../../capsule-browser/src/zip.js";
import { verifyProofCapsule as verifyNode } from "../../capsule/src/index.js";
import {
  CREATOR_SEED_CAPSULE_ID,
  createCreatorSeedCharter,
  deriveCreatorFork,
  evaluateSyntheticBoundary,
  openVerifiedCreatorSeed,
  prepareCreatorFork,
  serializeCreatorForkReceipt,
  verifyCreatorForkArchives,
  verifyPreparedCreatorFork,
  type CreatorForkChoice,
} from "./index.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const seedArchive = new Uint8Array(readFileSync(new URL("../fixtures/rich-synthetic-seed.runbook", import.meta.url)));

async function keys() {
  const pair = await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  return { pair, spki: new Uint8Array(await subtle.exportKey("spki", pair.publicKey)) };
}

async function rewriteSignedStatement(
  archive: Uint8Array,
  pair: CryptoKeyPair,
  spki: Uint8Array,
  update: (statement: Record<string, unknown>) => void,
) {
  const parsed = readCapsuleMembers(archive);
  const statement = JSON.parse(new TextDecoder().decode(parsed.members.get("runbook/checkpoint.statement.json"))) as Record<string, unknown>;
  update(statement);
  const statementBytes = serializeJcs(statement);
  const payloadType = "application/vnd.runbook.checkpoint+json;version=1";
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(payloadType);
  const signingBytes = new Uint8Array([
    ...encoder.encode(`DSSEv1 ${typeBytes.byteLength} `), ...typeBytes,
    ...encoder.encode(` ${statementBytes.byteLength} `), ...statementBytes,
  ]);
  const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, signingBytes));
  const keyId = `sha256:${Buffer.from(await subtle.digest("SHA-256", spki)).toString("hex")}`;
  const envelope = serializeJcs({
    payload: Buffer.from(statementBytes).toString("base64"),
    payloadType,
    signatures: [{ keyid: keyId, sig: Buffer.from(signature).toString("base64") }],
  });
  return assembleProofCapsuleZip(parsed.order.map((path) => ({
    path,
    bytes: path === "runbook/checkpoint.statement.json" ? statementBytes
      : path === "runbook/checkpoint.dsse.json" ? envelope : parsed.members.get(path) as Uint8Array,
  })));
}

describe("synthetic Creator Proof profile", () => {
  it.each(["concentration", "drawdown", "evidence", "frequency"] as CreatorForkChoice[])("allows only the restrictive %s fork and flips the fixed boundary outcome", (choice) => {
    const parent = createCreatorSeedCharter();
    const child = deriveCreatorFork(parent, choice);
    expect(evaluateSyntheticBoundary(parent.policy)).toMatchObject({ decision: "human-review", failedRules: [] });
    expect(evaluateSyntheticBoundary(child.policy)).toMatchObject({ decision: "rejected", failedRules: [child.fork.changedRule?.path] });
    expect(Object.keys(child.policy).filter((key) => child.policy[key as keyof typeof child.policy] !== parent.policy[key as keyof typeof parent.policy])).toHaveLength(1);
  });

  it("strictly rejects mutated, already-forked, extra-field, and malformed parents", () => {
    const parent = createCreatorSeedCharter();
    expect(() => deriveCreatorFork({ ...parent, policy: { ...parent.policy, maxPositionBps: 2499 } }, "concentration")).toThrow("creator.parent-unsupported");
    expect(() => deriveCreatorFork(deriveCreatorFork(parent, "concentration"), "drawdown")).toThrow("creator.parent-unsupported");
    expect(() => deriveCreatorFork({ ...parent, window: { ...parent.window, extra: true } } as never, "drawdown")).toThrow("creator.parent-charter-invalid");
    expect(() => deriveCreatorFork({ ...parent, fork: null } as never, "evidence")).toThrow("creator.parent-charter-invalid");
  });

  it("opens only the exact frozen seed and authors a child with full Node/browser/domain agreement", async () => {
    const parent = await openVerifiedCreatorSeed(seedArchive, { subtle });
    expect(parent.capsuleId).toBe(CREATOR_SEED_CAPSULE_ID);
    const { pair, spki } = await keys();
    const fork = await prepareCreatorFork({ checkpointSequence: 1, choice: "concentration", createdAt: "2026-07-21T22:05:00Z", experimentId: "CREATOR-FORK-001", parent, publicKeySpkiDer: spki, subtle });
    const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, fork.prepared.signingBytes));
    const child = await finalizeProofCapsule(fork.prepared, signature, { subtle });
    const [nodeReceipt, browserReceipt, domainReceipt, preparedReceipt] = await Promise.all([
      verifyNode(Buffer.from(child.archiveBytes)),
      verifyBrowser(child.archiveBytes, { subtle }),
      verifyCreatorForkArchives(seedArchive, child.archiveBytes, { subtle }),
      verifyPreparedCreatorFork({ parentArchive: seedArchive, childArchive: child.archiveBytes, fork, subtle }),
    ]);
    expect(nodeReceipt).toEqual(browserReceipt);
    expect(domainReceipt).toEqual(preparedReceipt);
    expect(domainReceipt).toMatchObject({ valid: true, parentCapsuleId: CREATOR_SEED_CAPSULE_ID, childCapsuleId: child.capsuleId, changedRule: { path: "policy.maxPositionBps", from: 2500, to: 1500 } });
    expect(new TextDecoder().decode(serializeCreatorForkReceipt(domainReceipt)).endsWith("\n")).toBe(false);
  });

  it("rejects forged parent capabilities and tampered child archives", async () => {
    const { pair, spki } = await keys();
    const forged = { capsuleId: CREATOR_SEED_CAPSULE_ID, receipt: {} } as never;
    await expect(prepareCreatorFork({ checkpointSequence: 1, choice: "evidence", createdAt: "2026-07-21T22:05:00Z", experimentId: "FORGED", parent: forged, publicKeySpkiDer: spki, subtle })).rejects.toThrow("creator.parent-not-verified");
    const parent = await openVerifiedCreatorSeed(seedArchive, { subtle });
    const fork = await prepareCreatorFork({ checkpointSequence: 1, choice: "evidence", createdAt: "2026-07-21T22:05:00Z", experimentId: "TAMPER", parent, publicKeySpkiDer: spki, subtle });
    const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, fork.prepared.signingBytes));
    const child = await finalizeProofCapsule(fork.prepared, signature, { subtle });
    const tampered = new Uint8Array(child.archiveBytes);
    tampered[120] ^= 1;
    const receipt = await verifyCreatorForkArchives(seedArchive, tampered, { subtle });
    expect(receipt.valid).toBe(false);
    expect(receipt.checks.childCoreValid).toBe(false);
  });

  it("rejects exact fork payloads when the signed statement claims live data or a nonempty event chain", async () => {
    const parent = await openVerifiedCreatorSeed(seedArchive, { subtle });
    const { pair, spki } = await keys();
    const fork = await prepareCreatorFork({ checkpointSequence: 1, choice: "concentration", createdAt: "2026-07-21T22:05:00Z", experimentId: "STATEMENT-PROFILE", parent, publicKeySpkiDer: spki, subtle });
    const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, fork.prepared.signingBytes));
    const child = await finalizeProofCapsule(fork.prepared, signature, { subtle });
    const forgedVariants = await Promise.all([
      rewriteSignedStatement(child.archiveBytes, pair, spki, (statement) => { statement.dataClass = "live-author-declared"; }),
      rewriteSignedStatement(child.archiveBytes, pair, spki, (statement) => {
        statement.eventChain = { algorithm: "runbook-jsonl-chain-v1", eventCount: 1, headHash: "1".repeat(64) };
      }),
    ]);

    for (const forged of forgedVariants) {
      const [core, domain, preparedDomain] = await Promise.all([
        verifyBrowser(forged, { subtle }),
        verifyCreatorForkArchives(seedArchive, forged, { subtle }),
        verifyPreparedCreatorFork({ parentArchive: seedArchive, childArchive: forged, fork, subtle }),
      ]);
      expect(core.valid).toBe(true);
      expect(domain).toMatchObject({ valid: false, checks: { childCoreValid: true, fixedSyntheticProfile: false } });
      expect(preparedDomain.valid).toBe(false);
    }

    const nonemptyAtInvocation = forgedVariants[1] as Uint8Array;
    expect(nonemptyAtInvocation.byteLength).toBe(child.archiveBytes.byteLength);
    const snapshotVerification = verifyCreatorForkArchives(seedArchive, nonemptyAtInvocation, { subtle });
    nonemptyAtInvocation.set(child.archiveBytes);
    await expect(snapshotVerification).resolves.toMatchObject({ valid: false, checks: { childCoreValid: true, fixedSyntheticProfile: false } });
  });

  it("does not open an unrelated valid root even when its profile is otherwise valid", async () => {
    const unrelated = new Uint8Array(seedArchive);
    unrelated[0] ^= 1;
    await expect(openVerifiedCreatorSeed(unrelated, { subtle })).rejects.toThrow("creator.seed-verification-failed");
  });
});
