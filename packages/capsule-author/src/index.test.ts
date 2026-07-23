import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyProofCapsule as verifyBrowser } from "../../capsule-browser/src/index.js";
import { verifyProofCapsule as verifyNode } from "../../capsule/src/index.js";
import { finalizeProofCapsule, prepareProofCapsule, type CapsulePayloadMember, type PrepareProofCapsuleInput } from "./index.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const payloads: CapsulePayloadMember[] = [
  { path: "payload/charter.json", role: "charter", mediaType: "application/json", bytes: new TextEncoder().encode('{"dataClass":"synthetic"}') },
  { path: "payload/claims.json", role: "claims", mediaType: "application/json", bytes: new TextEncoder().encode('{"claims":[],"dataClass":"synthetic"}') },
  { path: "payload/disclosures.json", role: "disclosures", mediaType: "application/json", bytes: new TextEncoder().encode('{"dataClass":"synthetic","limitations":["self-asserted"]}') },
  { path: "payload/events.ndjson", role: "events", mediaType: "application/x-ndjson", bytes: new Uint8Array() },
  { path: "payload/report.html", role: "report", mediaType: "text/html;charset=utf-8", bytes: new TextEncoder().encode("<!doctype html><title>Synthetic</title>") },
];

async function keys() {
  const pair = await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  return { pair, spki: new Uint8Array(await subtle.exportKey("spki", pair.publicKey)) };
}

describe("two-phase Proof Capsule authoring", () => {
  it("prepares, verifies a raw signature, packages deterministically, and passes both verifiers", async () => {
    const { pair, spki } = await keys();
    const prepared = await prepareProofCapsule({
      checkpointSequence: 1,
      createdAt: "2026-07-21T21:00:00Z",
      dataClass: "synthetic",
      eventChain: { eventCount: 0, headHash: "0".repeat(64) },
      experimentId: "AUTHOR-TEST-001",
      lineage: { relation: "root", parents: [] },
      payloads,
      publicKeySpkiDer: spki,
    }, { subtle });
    const signature = new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, prepared.signingBytes));
    const first = await finalizeProofCapsule(prepared, signature, { subtle });
    const second = await finalizeProofCapsule(prepared, signature, { subtle });
    expect(first.archiveBytes).toEqual(second.archiveBytes);
    const [nodeReceipt, browserReceipt] = await Promise.all([
      verifyNode(Buffer.from(first.archiveBytes)),
      verifyBrowser(first.archiveBytes, { subtle }),
    ]);
    expect(nodeReceipt).toEqual(browserReceipt);
    expect(nodeReceipt).toMatchObject({ valid: true, capsuleId: prepared.capsuleId, authorKeyId: prepared.authorKeyId });
  });

  it("keeps finalization bound to internal prepared bytes", async () => {
    const { pair, spki } = await keys();
    const prepared = await prepareProofCapsule({
      checkpointSequence: 1, createdAt: "2026-07-21T21:00:00Z", dataClass: "synthetic",
      eventChain: { eventCount: 0, headHash: "0".repeat(64) }, experimentId: "AUTHOR-TEST-002",
      lineage: { relation: "root", parents: [] }, payloads, publicKeySpkiDer: spki,
    }, { subtle });
    const mutatedView = prepared.signingBytes;
    mutatedView[0] ^= 0xff;
    const signatureOverMutatedView = new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, mutatedView));
    await expect(finalizeProofCapsule(prepared, signatureOverMutatedView, { subtle })).rejects.toThrow("author.signature-invalid");
  });

  it("owns one validated input snapshot across asynchronous hashing", async () => {
    const { pair, spki } = await keys();
    const mutablePayloads = payloads.map((payload) => ({ ...payload, bytes: new Uint8Array(payload.bytes) }));
    const input: PrepareProofCapsuleInput = {
      checkpointSequence: 1,
      createdAt: "2026-07-21T21:00:00Z",
      dataClass: "synthetic",
      eventChain: { eventCount: 0, headHash: "0".repeat(64) },
      experimentId: "AUTHOR-SNAPSHOT",
      lineage: { relation: "root", parents: [] },
      payloads: mutablePayloads,
      publicKeySpkiDer: spki,
    };
    const preparing = prepareProofCapsule(input, { subtle });
    input.checkpointSequence = 0;
    input.createdAt = "2026-02-30T00:00:00Z";
    input.dataClass = "live-author-declared" as never;
    input.eventChain.eventCount = 1;
    input.eventChain.headHash = "1".repeat(64);
    input.experimentId = "*INVALID";
    Object.assign(input.lineage, { relation: "derived", parents: ["not-a-capsule"] });
    mutablePayloads[0]!.bytes.fill(0xff);
    spki.fill(0xff);

    const prepared = await preparing;
    expect(prepared.review).toMatchObject({
      checkpointSequence: 1,
      createdAt: "2026-07-21T21:00:00Z",
      dataClass: "synthetic",
      experimentId: "AUTHOR-SNAPSHOT",
      lineage: { relation: "root", parents: [] },
    });
    const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, prepared.signingBytes));
    const authored = await finalizeProofCapsule(prepared, signature, { subtle });
    await expect(verifyBrowser(authored.archiveBytes, { subtle })).resolves.toMatchObject({ valid: true, capsuleId: prepared.capsuleId });
  });

  it("accepts early proleptic-Gregorian years and rejects runtime-invalid union values", async () => {
    const { spki } = await keys();
    const base = {
      checkpointSequence: 1, createdAt: "0001-01-01T00:00:00Z", dataClass: "synthetic" as const,
      eventChain: { eventCount: 0, headHash: "0".repeat(64) }, experimentId: "EARLY-YEAR",
      lineage: { relation: "root" as const, parents: [] as const }, payloads, publicKeySpkiDer: spki,
    };
    await expect(prepareProofCapsule(base, { subtle })).resolves.toMatchObject({ review: { createdAt: "0001-01-01T00:00:00Z" } });
    await expect(prepareProofCapsule({ ...base, lineage: { relation: "unknown", parents: [] } as never }, { subtle })).rejects.toThrow("author.lineage-invalid");
    const invalidRole = payloads.map((payload, index) => index === 0 ? { ...payload, role: "unknown" } : payload) as never;
    await expect(prepareProofCapsule({ ...base, payloads: invalidRole }, { subtle })).rejects.toThrow("author.payload-profile-invalid");
  });

  it("fails before archive output on invalid signatures and malformed profile inputs", async () => {
    const { spki } = await keys();
    const validInput = {
      checkpointSequence: 1, createdAt: "2026-07-21T21:00:00Z", dataClass: "synthetic" as const,
      eventChain: { eventCount: 0, headHash: "0".repeat(64) }, experimentId: "AUTHOR-TEST-003",
      lineage: { relation: "root" as const, parents: [] as const }, payloads, publicKeySpkiDer: spki,
    };
    const prepared = await prepareProofCapsule(validInput, { subtle });
    await expect(finalizeProofCapsule(prepared, new Uint8Array(64), { subtle })).rejects.toThrow("author.signature-invalid");
    await expect(prepareProofCapsule({ ...validInput, createdAt: "2026-02-30T00:00:00Z" }, { subtle })).rejects.toThrow("author.created-at-invalid");
    await expect(prepareProofCapsule({ ...validInput, payloads: [...payloads].reverse() }, { subtle })).rejects.toThrow("author.payload-order-invalid");
    await expect(prepareProofCapsule({ ...validInput, publicKeySpkiDer: new Uint8Array(44) }, { subtle })).rejects.toThrow("author.key-invalid");
  });
});
