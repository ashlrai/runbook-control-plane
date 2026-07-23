import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ProofCapsuleCryptoError,
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "./index.js";

const corpusRoot = new URL("../../../conformance/", import.meta.url);

async function corpusFile(path: string) {
  return new Uint8Array(await readFile(fileURLToPath(new URL(path, corpusRoot))));
}

function subtleWith(overrides: Partial<Record<"digest" | "importKey" | "exportKey" | "verify", (...args: never[]) => unknown>>) {
  return new Proxy(webcrypto.subtle, {
    get(target, property) {
      if (typeof property === "string" && Object.hasOwn(overrides, property)) return overrides[property as keyof typeof overrides];
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as SubtleCrypto;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function mutateStoredMember(capsule: Uint8Array, target: string, mutate: (member: Buffer) => void) {
  const archive = Buffer.from(capsule);
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
      mutate(member);
      const checksum = crc32(member);
      archive.writeUInt32LE(checksum, local + 14);
      archive.writeUInt32LE(checksum, central + 16);
      return new Uint8Array(archive);
    }
    central += 46 + nameLength;
  }
  throw new Error(`missing member: ${target}`);
}

describe("browser-native proof capsule verifier", () => {
  it.each([
    ["minimal-synthetic-root.runbook", "minimal-synthetic-root.receipt.json", true],
    ["minimal-synthetic-root-payload-tampered.runbook", "minimal-synthetic-root-payload-tampered.receipt.json", false],
  ] as const)("exact-byte matches the frozen %s oracle", async (capsuleName, receiptName, valid) => {
    const capsule = await corpusFile(`fixtures/${capsuleName}`);
    const expected = await corpusFile(`expected/${receiptName}`);
    const receipt = await verifyProofCapsule(capsule, { subtle: webcrypto.subtle });
    const serialized = serializeProofVerificationReceipt(receipt);

    expect(receipt.valid).toBe(valid);
    expect(serialized).toEqual(expected);
    expect(serialized.at(-1)).not.toBe(0x0a);
  });

  it("maps a cryptographically false Ed25519 result to signature.invalid", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const subtle = subtleWith({ verify: async () => false });
    const receipt = await verifyProofCapsule(capsule, { subtle });

    expect(receipt.valid).toBe(false);
    expect(receipt.authorKeyId).toBe("sha256:b4d90a08583c87e8b69423aa17746e8d0359b8f3765ead1567531d232c28ce55");
    expect(receipt.assurance.authorSignature).toBe("invalid");
    expect(receipt.assurance.packageIntegrity).toBe("invalid");
    expect(receipt.errors).toEqual([{ code: "signature.invalid" }]);
  });

  it("rejects an archive-level signature mutation after transport remains valid", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const mutated = mutateStoredMember(capsule, "runbook/checkpoint.dsse.json", (member) => {
      const marker = member.indexOf('"sig":"');
      if (marker < 0) throw new Error("signature marker missing");
      const offset = marker + 7;
      member[offset] = member[offset] === 0x41 ? 0x42 : 0x41;
    });
    const receipt = await verifyProofCapsule(mutated, { subtle: webcrypto.subtle });
    expect(receipt.assurance.transportProfile).toBe("valid");
    expect(receipt.assurance.authorSignature).toBe("invalid");
    expect(receipt.errors).toEqual([{ code: "signature.invalid" }]);
  });

  it("computes a mutated embedded key fingerprint but trusts neither keyid nor signature", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const mutated = mutateStoredMember(capsule, "runbook/author-key.spki.der", (member) => {
      member[member.length - 1] = (member[member.length - 1] as number) ^ 1;
    });
    const receipt = await verifyProofCapsule(mutated, { subtle: webcrypto.subtle });
    expect(receipt.assurance.transportProfile).toBe("valid");
    expect(receipt.authorKeyId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.authorKeyId).not.toBe("sha256:b4d90a08583c87e8b69423aa17746e8d0359b8f3765ead1567531d232c28ce55");
    expect(receipt.assurance.authorSignature).toBe("invalid");
    expect(receipt.errors).toEqual([
      { code: "key.fingerprint-mismatch" },
      { code: "signature.invalid" },
    ]);
  });

  it("distinguishes a canonical X25519 SPKI from malformed OID mutations", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const x25519 = mutateStoredMember(capsule, "runbook/author-key.spki.der", (member) => {
      member[8] = 0x6e;
    });
    const unsupported = await verifyProofCapsule(x25519, { subtle: webcrypto.subtle });
    expect(unsupported.errors).toEqual([{ code: "key.algorithm-unsupported" }]);
    expect(unsupported.assurance.authorSignature).toBe("not-evaluated");

    const malformedOid = mutateStoredMember(capsule, "runbook/author-key.spki.der", (member) => {
      member[8] = 0x71;
    });
    const invalid = await verifyProofCapsule(malformedOid, { subtle: webcrypto.subtle });
    expect(invalid.errors).toEqual([{ code: "key.invalid" }]);
    expect(invalid.assurance.authorSignature).toBe("not-evaluated");
  });

  it("classifies an otherwise canonical Ed25519 SPKI with unused bits as noncanonical", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    for (const unusedBits of [1, 2, 7]) {
      const mutated = mutateStoredMember(capsule, "runbook/author-key.spki.der", (member) => {
        member[11] = unusedBits;
      });
      const receipt = await verifyProofCapsule(mutated, { subtle: webcrypto.subtle });
      expect(receipt.errors).toEqual([{ code: "key.encoding-noncanonical" }]);
      expect(receipt.assurance.authorSignature).toBe("not-evaluated");
    }
  });

  it("distinguishes invalid key material from a crypto runtime failure", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const invalidKey = subtleWith({
      importKey: async () => { throw new DOMException("bad key", "DataError"); },
    });
    const receipt = await verifyProofCapsule(capsule, { subtle: invalidKey });
    expect(receipt.errors).toEqual([{ code: "key.invalid" }]);
    expect(receipt.assurance.authorSignature).toBe("not-evaluated");

    const unavailable = subtleWith({
      importKey: async () => { throw new DOMException("unsupported", "NotSupportedError"); },
    });
    await expect(verifyProofCapsule(capsule, { subtle: unavailable })).rejects.toMatchObject({
      name: "ProofCapsuleCryptoError",
      code: "crypto.unavailable",
    });
  });

  it("rejects noncanonical exported SPKI bytes before signature verification", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const noncanonical = subtleWith({ exportKey: async () => new Uint8Array(44).buffer });
    const receipt = await verifyProofCapsule(capsule, { subtle: noncanonical });
    expect(receipt.errors).toEqual([{ code: "key.encoding-noncanonical" }]);
    expect(receipt.assurance.authorSignature).toBe("not-evaluated");
  });

  it("raises typed failures when digest or verify infrastructure fails", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const digestFailure = subtleWith({ digest: async () => { throw new Error("digest runtime failed"); } });
    await expect(verifyProofCapsule(capsule, { subtle: digestFailure })).rejects.toBeInstanceOf(ProofCapsuleCryptoError);
    await expect(verifyProofCapsule(capsule, { subtle: digestFailure })).rejects.toMatchObject({ code: "crypto.operation-failed" });

    const verifyFailure = subtleWith({ verify: async () => { throw new Error("verify runtime failed"); } });
    await expect(verifyProofCapsule(capsule, { subtle: verifyFailure })).rejects.toMatchObject({ code: "crypto.operation-failed" });
  });

  it("does not require Web Crypto for an archive rejected at the transport stage", async () => {
    const unusable = subtleWith({ digest: async () => { throw new Error("must not be called"); } });
    const receipt = await verifyProofCapsule(new Uint8Array([1, 2, 3]), { subtle: unusable });
    expect(receipt.valid).toBe(false);
    expect(receipt.assurance.transportProfile).toBe("invalid");
    expect(receipt.errors).toEqual([{ code: "zip.range-invalid" }]);
  });
});
