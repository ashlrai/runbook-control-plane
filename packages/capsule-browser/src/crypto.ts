const ENCODER = new TextEncoder();
const ED25519_SPKI_PREFIX = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
const X25519_SPKI_PREFIX = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);

export type ProofCapsuleCryptoErrorCode = "crypto.unavailable" | "crypto.operation-failed";

export class ProofCapsuleCryptoError extends Error {
  readonly name = "ProofCapsuleCryptoError";

  constructor(readonly code: ProofCapsuleCryptoErrorCode, options?: { cause?: unknown }) {
    super(code, options);
  }
}

export function resolveSubtle(explicit?: SubtleCrypto) {
  const subtle = explicit ?? globalThis.crypto?.subtle;
  if (subtle === undefined) throw new ProofCapsuleCryptoError("crypto.unavailable");
  return subtle;
}

function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function cryptoFailure(error: unknown): never {
  if (error instanceof ProofCapsuleCryptoError) throw error;
  throw new ProofCapsuleCryptoError("crypto.operation-failed", { cause: error });
}

export async function sha256(subtle: SubtleCrypto, bytes: Uint8Array) {
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest("SHA-256", owned(bytes));
  } catch (error) {
    return cryptoFailure(error);
  }
  const result = new Uint8Array(digest);
  if (result.byteLength !== 32) throw new ProofCapsuleCryptoError("crypto.operation-failed");
  return result;
}

export function hex(bytes: Uint8Array) {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

export function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] as number) ^ (right[index] as number);
  return difference === 0;
}

export function concatBytes(...parts: readonly Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function dssePreAuthenticationEncoding(payloadType: string, payload: Uint8Array) {
  const typeBytes = ENCODER.encode(payloadType);
  return concatBytes(
    ENCODER.encode(`DSSEv1 ${typeBytes.byteLength} `),
    typeBytes,
    ENCODER.encode(` ${payload.byteLength} `),
    payload,
  );
}

export type SpkiClassification = "ed25519-canonical" | "algorithm-unsupported" | "encoding-noncanonical" | "invalid";

export function classifyEd25519Spki(bytes: Uint8Array): SpkiClassification {
  if (bytes.byteLength !== 44) return "invalid";
  const prefix = bytes.subarray(0, ED25519_SPKI_PREFIX.byteLength);
  if (equalBytes(prefix, ED25519_SPKI_PREFIX)) return "ed25519-canonical";
  if (
    equalBytes(bytes.subarray(0, ED25519_SPKI_PREFIX.byteLength - 1), ED25519_SPKI_PREFIX.subarray(0, -1))
    && (bytes[11] as number) >= 1
    && (bytes[11] as number) <= 7
  ) return "encoding-noncanonical";
  // X25519 is the one supported non-Ed25519 key shape with the same canonical
  // 44-byte RFC 8410 SPKI framing. Arbitrary OID mutations are malformed DER,
  // not evidence of a recognized but unsupported algorithm.
  if (equalBytes(prefix, X25519_SPKI_PREFIX)) return "algorithm-unsupported";
  return "invalid";
}

export type ImportedKey = { key: CryptoKey; canonical: boolean } | { invalid: true };

export async function importEd25519Key(subtle: SubtleCrypto, bytes: Uint8Array): Promise<ImportedKey> {
  let key: CryptoKey;
  try {
    key = await subtle.importKey("spki", owned(bytes), { name: "Ed25519" }, true, ["verify"]);
  } catch (error) {
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "DataError") return { invalid: true };
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "NotSupportedError") {
      throw new ProofCapsuleCryptoError("crypto.unavailable", { cause: error });
    }
    return cryptoFailure(error);
  }
  let exported: ArrayBuffer;
  try {
    exported = await subtle.exportKey("spki", key);
  } catch (error) {
    return cryptoFailure(error);
  }
  return { key, canonical: equalBytes(new Uint8Array(exported), bytes) };
}

export async function verifyEd25519(subtle: SubtleCrypto, key: CryptoKey, signature: Uint8Array, message: Uint8Array) {
  try {
    return await subtle.verify({ name: "Ed25519" }, key, owned(signature), owned(message));
  } catch (error) {
    return cryptoFailure(error);
  }
}
