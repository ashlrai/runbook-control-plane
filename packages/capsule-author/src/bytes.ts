const ENCODER = new TextEncoder();
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertWellFormed(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) throw new Error("author.invalid-unicode");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("author.invalid-unicode");
    }
  }
}

export function canonicalizeJcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertWellFormed(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("author.invalid-number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(",")}]`;
  if (!isRecord(value)) throw new Error("author.invalid-value");
  return `{${Object.keys(value).sort().map((key) => {
    assertWellFormed(key);
    return `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`;
  }).join(",")}}`;
}

export function jcsBytes(value: unknown) {
  return ENCODER.encode(canonicalizeJcs(value));
}

export function utf8(value: string) {
  assertWellFormed(value);
  return ENCODER.encode(value);
}

export function concatBytes(...parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number);
  }
  return difference === 0;
}

export function hex(bytes: Uint8Array) {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export function base64(bytes: Uint8Array) {
  let output = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 3) {
    const first = bytes[offset] as number;
    const hasSecond = offset + 1 < bytes.byteLength;
    const hasThird = offset + 2 < bytes.byteLength;
    const second = hasSecond ? bytes[offset + 1] as number : 0;
    const third = hasThird ? bytes[offset + 2] as number : 0;
    const value = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET[(value >>> 18) & 63];
    output += BASE64_ALPHABET[(value >>> 12) & 63];
    output += hasSecond ? BASE64_ALPHABET[(value >>> 6) & 63] : "=";
    output += hasThird ? BASE64_ALPHABET[value & 63] : "=";
  }
  return output;
}

export async function sha256(bytes: Uint8Array, subtle: SubtleCrypto) {
  return new Uint8Array(await subtle.digest("SHA-256", new Uint8Array(bytes)));
}

export function dssePae(payloadType: string, payload: Uint8Array) {
  const typeBytes = utf8(payloadType);
  return concatBytes(
    utf8(`DSSEv1 ${typeBytes.byteLength} `),
    typeBytes,
    utf8(` ${payload.byteLength} `),
    payload,
  );
}
