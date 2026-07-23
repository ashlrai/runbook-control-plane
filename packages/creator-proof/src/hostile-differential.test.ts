import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  finalizeProofCapsule,
  prepareProofCapsule,
  serializeJcs,
  type CapsulePayloadMember,
} from "@runbook/capsule-author";
import { verifyProofCapsule as verifyBrowser } from "@runbook/capsule-browser";
import { verifyProofCapsule as verifyNode } from "../../capsule/src/index.js";
import {
  CREATOR_SEED_CAPSULE_ID,
  openVerifiedCreatorSeed,
  prepareCreatorFork,
  verifyCreatorForkArchives,
  verifyPreparedCreatorFork,
  type CreatorForkChoice,
} from "./index.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const seedArchive = new Uint8Array(readFileSync(new URL("../fixtures/rich-synthetic-seed.runbook", import.meta.url)));
const choices = ["concentration", "drawdown", "evidence", "frequency"] as const satisfies readonly CreatorForkChoice[];
const zeroHash = "0".repeat(64);

// RFC 8032 test vector 2. Fixed test-only material makes signatures and complete
// archives reproducible; it is not imported by any application bundle.
const privatePkcs8 = Uint8Array.from(Buffer.from("302e020100300506032b6570042204204ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "hex"));
const publicSpki = Uint8Array.from(Buffer.from("302a300506032b65700321003d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "hex"));

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function archiveMembers(input: Uint8Array) {
  const archive = Buffer.from(input);
  const result = new Map<string, Uint8Array>();
  const eocd = archive.length - 22;
  const count = archive.readUInt16LE(eocd + 10);
  let central = archive.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    const nameLength = archive.readUInt16LE(central + 28);
    const name = archive.subarray(central + 46, central + 46 + nameLength).toString("ascii");
    const local = archive.readUInt32LE(central + 42);
    const localNameLength = archive.readUInt16LE(local + 26);
    const size = archive.readUInt32LE(local + 22);
    result.set(name, new Uint8Array(archive.subarray(local + 30 + localNameLength, local + 30 + localNameLength + size)));
    central += 46 + nameLength;
  }
  return result;
}

function mutateStoredMember(input: Uint8Array, target: string, mutation: (member: Buffer) => void) {
  const archive = Buffer.from(input);
  const eocd = archive.length - 22;
  const count = archive.readUInt16LE(eocd + 10);
  let central = archive.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    const nameLength = archive.readUInt16LE(central + 28);
    const name = archive.subarray(central + 46, central + 46 + nameLength).toString("ascii");
    if (name === target) {
      const local = archive.readUInt32LE(central + 42);
      const localNameLength = archive.readUInt16LE(local + 26);
      const size = archive.readUInt32LE(local + 22);
      const member = archive.subarray(local + 30 + localNameLength, local + 30 + localNameLength + size);
      mutation(member);
      const checksum = crc32(member);
      archive.writeUInt32LE(checksum, local + 14);
      archive.writeUInt32LE(checksum, central + 16);
      return new Uint8Array(archive);
    }
    central += 46 + nameLength;
  }
  throw new Error(`missing member: ${target}`);
}

async function deterministicSigner() {
  return subtle.importKey("pkcs8", privatePkcs8, { name: "Ed25519" }, false, ["sign"]);
}

async function signedFork(parent: Awaited<ReturnType<typeof openVerifiedCreatorSeed>>, choice: CreatorForkChoice, privateKey: CryptoKey) {
  const suffix = choice.toUpperCase();
  const fork = await prepareCreatorFork({
    checkpointSequence: 1,
    choice,
    createdAt: "2026-07-21T23:30:00.000Z",
    experimentId: `HOSTILE-MATRIX-${suffix}`,
    parent,
    publicKeySpkiDer: publicSpki,
    subtle,
  });
  const signature = new Uint8Array(await subtle.sign("Ed25519", privateKey, fork.prepared.signingBytes));
  const child = await finalizeProofCapsule(fork.prepared, signature, { subtle });
  return { child, fork, signature };
}

async function coreParity(archive: Uint8Array) {
  const [node, browser] = await Promise.all([
    Promise.resolve(verifyNode(Buffer.from(archive))),
    verifyBrowser(archive, { subtle }),
  ]);
  expect(node).toEqual(browser);
  return browser;
}

async function resignWithUnsupportedCharterSchema(baseline: Uint8Array, choice: CreatorForkChoice, privateKey: CryptoKey) {
  const members = archiveMembers(baseline);
  const manifest = JSON.parse(new TextDecoder().decode(members.get("runbook/manifest.json"))) as {
    members: { mediaType: string; path: string; role: CapsulePayloadMember["role"] }[];
  };
  const payloads = manifest.members.filter((member) => member.path.startsWith("payload/")).map((member) => {
    const original = members.get(member.path);
    if (original === undefined) throw new Error(`missing payload: ${member.path}`);
    let bytes = original;
    if (member.path === "payload/charter.json") {
      const charter = JSON.parse(new TextDecoder().decode(original)) as Record<string, unknown>;
      charter.schemaVersion = "runbook.creator-charter.v2";
      bytes = serializeJcs(charter);
    }
    return { bytes, mediaType: member.mediaType, path: member.path, role: member.role };
  });
  const prepared = await prepareProofCapsule({
    checkpointSequence: 2,
    createdAt: "2026-07-21T23:31:00.000Z",
    dataClass: "synthetic",
    eventChain: { eventCount: 0, headHash: zeroHash },
    experimentId: `HOSTILE-MATRIX-${choice.toUpperCase()}-SCHEMA-V2`,
    lineage: { parents: [CREATOR_SEED_CAPSULE_ID], relation: "derived" },
    payloads,
    publicKeySpkiDer: publicSpki,
  }, { subtle });
  const signature = new Uint8Array(await subtle.sign("Ed25519", privateKey, prepared.signingBytes));
  return finalizeProofCapsule(prepared, signature, { subtle });
}

describe("Creator Proof hostile Node/browser/domain differential", () => {
  it("fails closed across seven deterministic cases for each of the four exported forks", async () => {
    const parent = await openVerifiedCreatorSeed(seedArchive, { subtle });
    const privateKey = await deterministicSigner();
    const fixtures = new Map<CreatorForkChoice, Awaited<ReturnType<typeof signedFork>>>();

    for (const choice of choices) fixtures.set(choice, await signedFork(parent, choice, privateKey));

    let deterministicArchivePairs = 0;
    let coreParityComparisons = 0;
    let domainValidReceipts = 0;
    let domainRejectedReceipts = 0;

    for (const [choiceIndex, choice] of choices.entries()) {
      const fixture = fixtures.get(choice)!;
      const repeated = await signedFork(parent, choice, privateKey);
      expect(repeated.signature).toEqual(fixture.signature);
      expect(repeated.child.archiveBytes).toEqual(fixture.child.archiveBytes);
      deterministicArchivePairs += 1;

      const validCore = await coreParity(fixture.child.archiveBytes);
      expect(validCore.valid).toBe(true);
      coreParityComparisons += 1;
      const [validDomain, validPrepared] = await Promise.all([
        verifyCreatorForkArchives(seedArchive, fixture.child.archiveBytes, { subtle }),
        verifyPreparedCreatorFork({ parentArchive: seedArchive, childArchive: fixture.child.archiveBytes, fork: fixture.fork, subtle }),
      ]);
      expect(validDomain).toEqual(validPrepared);
      expect(validDomain).toMatchObject({ valid: true, checks: { childCoreValid: true, parentCoreValid: true } });
      domainValidReceipts += 2;

      const wrongParent = await verifyCreatorForkArchives(fixture.child.archiveBytes, fixture.child.archiveBytes, { subtle });
      expect(wrongParent).toMatchObject({ valid: false, checks: { childCoreValid: true, parentCoreValid: false } });
      domainRejectedReceipts += 1;

      const siblingChoice = choices[(choiceIndex + 1) % choices.length]!;
      const sibling = fixtures.get(siblingChoice)!;
      const siblingCore = await coreParity(sibling.child.archiveBytes);
      expect(siblingCore.valid).toBe(true);
      coreParityComparisons += 1;
      const [genericSibling, preparedSibling] = await Promise.all([
        verifyCreatorForkArchives(seedArchive, sibling.child.archiveBytes, { subtle }),
        verifyPreparedCreatorFork({ parentArchive: seedArchive, childArchive: sibling.child.archiveBytes, fork: fixture.fork, subtle }),
      ]);
      expect(genericSibling).toMatchObject({ valid: true, checks: { childCoreValid: true } });
      expect(preparedSibling).toMatchObject({ valid: false, checks: { childCoreValid: false } });
      domainValidReceipts += 1;
      domainRejectedReceipts += 1;

      const keyMutation = mutateStoredMember(fixture.child.archiveBytes, "runbook/author-key.spki.der", (member) => {
        member[member.length - 1] = (member[member.length - 1] as number) ^ 1;
      });
      const keyCore = await coreParity(keyMutation);
      expect(keyCore.valid).toBe(false);
      expect(keyCore.errors.map((error) => error.code)).toEqual(["key.fingerprint-mismatch", "signature.invalid"]);
      coreParityComparisons += 1;
      const keyDomain = await verifyCreatorForkArchives(seedArchive, keyMutation, { subtle });
      expect(keyDomain).toMatchObject({ valid: false, checks: { childCoreValid: false } });
      domainRejectedReceipts += 1;

      const signatureMutation = mutateStoredMember(fixture.child.archiveBytes, "runbook/checkpoint.dsse.json", (member) => {
        const marker = member.indexOf('"sig":"');
        if (marker < 0) throw new Error("signature marker missing");
        const offset = marker + 7;
        member[offset] = member[offset] === 0x41 ? 0x42 : 0x41;
      });
      const signatureCore = await coreParity(signatureMutation);
      expect(signatureCore.valid).toBe(false);
      expect(signatureCore.errors.map((error) => error.code)).toEqual(["signature.invalid"]);
      coreParityComparisons += 1;
      const signatureDomain = await verifyCreatorForkArchives(seedArchive, signatureMutation, { subtle });
      expect(signatureDomain).toMatchObject({ valid: false, checks: { childCoreValid: false } });
      domainRejectedReceipts += 1;

      const memberMutation = mutateStoredMember(fixture.child.archiveBytes, "payload/report.html", (member) => {
        const offset = member.indexOf("No trade");
        if (offset < 0) throw new Error("report marker missing");
        member[offset] = 0x58;
      });
      const memberCore = await coreParity(memberMutation);
      expect(memberCore.valid).toBe(false);
      expect(memberCore.errors.map((error) => error.code)).toEqual(["manifest.member-digest-mismatch"]);
      coreParityComparisons += 1;
      const memberDomain = await verifyCreatorForkArchives(seedArchive, memberMutation, { subtle });
      expect(memberDomain).toMatchObject({ valid: false, checks: { childCoreValid: false, fixedSyntheticProfile: false } });
      domainRejectedReceipts += 1;

      const schemaMutation = await resignWithUnsupportedCharterSchema(fixture.child.archiveBytes, choice, privateKey);
      const schemaCore = await coreParity(schemaMutation.archiveBytes);
      expect(schemaCore).toMatchObject({ valid: true, errors: [] });
      coreParityComparisons += 1;
      const schemaDomain = await verifyCreatorForkArchives(seedArchive, schemaMutation.archiveBytes, { subtle });
      expect(schemaDomain).toMatchObject({
        valid: false,
        checks: { childCoreValid: true, exactOneAllowedRuleChanged: false, fixedSyntheticProfile: false, parentCoreValid: true },
      });
      domainRejectedReceipts += 1;
    }

    expect({ coreParityComparisons, deterministicArchivePairs, domainRejectedReceipts, domainValidReceipts }).toEqual({
      coreParityComparisons: 24,
      deterministicArchivePairs: 4,
      domainRejectedReceipts: 24,
      domainValidReceipts: 12,
    });
  });
});
