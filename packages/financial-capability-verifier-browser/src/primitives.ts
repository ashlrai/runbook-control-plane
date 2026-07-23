export class IndependentVerifierError extends Error {
  readonly name = "IndependentVerifierError";

  constructor(readonly code: string) {
    super(code);
  }
}

export const fail = (code: string): never => {
  throw new IndependentVerifierError(code);
};

export function compareCodeUnits(left: string, right: string): number {
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function assertUnicode(value: string, code: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) fail(code);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(code);
    }
  }
}

/** RFC 8785 serialization over already-owned JSON data. */
export function canonicalJcs(value: unknown): string {
  let visited = 0;
  const encode = (current: unknown, depth: number): string => {
    visited += 1;
    if (depth > 64 || visited > 100_000) fail("jcs.input-too-complex");
    if (current === null) return "null";
    if (typeof current === "string") {
      assertUnicode(current, "jcs.invalid-unicode");
      return JSON.stringify(current);
    }
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "number") {
      if (!Number.isFinite(current)) fail("jcs.invalid-number");
      return JSON.stringify(current);
    }
    if (Array.isArray(current)) {
      return `[${current.map((entry) => encode(entry, depth + 1)).join(",")}]`;
    }
    if (typeof current !== "object") fail("jcs.invalid-value");
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) fail("jcs.invalid-value");
    const input = current as Record<string, unknown>;
    return `{${Object.keys(input).sort(compareCodeUnits).map((key) => {
      assertUnicode(key, "jcs.invalid-unicode");
      return `${JSON.stringify(key)}:${encode(input[key], depth + 1)}`;
    }).join(",")}}`;
  };
  return encode(value, 0);
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc,
  0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
  0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
  0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3,
  0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
  0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

/** Local FIPS 180-4 implementation keeps semantic replay synchronous and browser-only. */
export function sha256Bytes(input: Uint8Array): string {
  if (!(input instanceof Uint8Array)) fail("sha256.input-invalid");
  const owned = new Uint8Array(input);
  const paddedLength = Math.ceil((owned.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(owned);
  padded[owned.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = owned.byteLength * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = schedule[index - 15] ?? 0;
      const y = schedule[index - 2] ?? 0;
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      schedule[index] = ((schedule[index - 16] ?? 0) + sigma0 +
        (schedule[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + sum1 + choose + (SHA256_CONSTANTS[index] ?? 0) +
        (schedule[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < state.length; index += 1) {
      state[index] = ((state[index] ?? 0) + (next[index] ?? 0)) >>> 0;
    }
  }
  return Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
}

export const sha256Text = (value: string): string =>
  sha256Bytes(new TextEncoder().encode(value));
export const sha256Jcs = (value: unknown): string => sha256Text(canonicalJcs(value));
export const jcsBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalJcs(value));

class JsonReader {
  private cursor = 0;
  private nodes = 0;

  constructor(private readonly text: string) {}

  read(): unknown {
    const output = this.readValue(0);
    this.skipSpace();
    if (this.cursor !== this.text.length) fail("json.syntax-invalid");
    return output;
  }

  private readValue(depth: number): unknown {
    this.nodes += 1;
    if (depth > 64 || this.nodes > 100_000) fail("json.too-complex");
    this.skipSpace();
    const token = this.text[this.cursor];
    if (token === "{") return this.readObject(depth + 1);
    if (token === "[") return this.readArray(depth + 1);
    if (token === '"') return this.readString();
    if (this.text.startsWith("true", this.cursor)) return this.literal("true", true);
    if (this.text.startsWith("false", this.cursor)) return this.literal("false", false);
    if (this.text.startsWith("null", this.cursor)) return this.literal("null", null);
    return this.readNumber();
  }

  private readObject(depth: number): Record<string, unknown> {
    this.cursor += 1;
    const output = Object.create(null) as Record<string, unknown>;
    const names = new Set<string>();
    this.skipSpace();
    if (this.text[this.cursor] === "}") { this.cursor += 1; return output; }
    while (this.cursor < this.text.length) {
      this.skipSpace();
      if (this.text[this.cursor] !== '"') fail("json.syntax-invalid");
      const name = this.readString();
      if (names.has(name)) fail("json.duplicate-key");
      names.add(name);
      this.skipSpace();
      if (this.text[this.cursor] !== ":") fail("json.syntax-invalid");
      this.cursor += 1;
      output[name] = this.readValue(depth);
      this.skipSpace();
      if (this.text[this.cursor] === "}") { this.cursor += 1; return output; }
      if (this.text[this.cursor] !== ",") fail("json.syntax-invalid");
      this.cursor += 1;
    }
    return fail("json.syntax-invalid");
  }

  private readArray(depth: number): unknown[] {
    this.cursor += 1;
    const output: unknown[] = [];
    this.skipSpace();
    if (this.text[this.cursor] === "]") { this.cursor += 1; return output; }
    while (this.cursor < this.text.length) {
      output.push(this.readValue(depth));
      this.skipSpace();
      if (this.text[this.cursor] === "]") { this.cursor += 1; return output; }
      if (this.text[this.cursor] !== ",") fail("json.syntax-invalid");
      this.cursor += 1;
    }
    return fail("json.syntax-invalid");
  }

  private readString(): string {
    const start = this.cursor;
    this.cursor += 1;
    while (this.cursor < this.text.length) {
      const character = this.text[this.cursor] as string;
      if (character === '"') {
        this.cursor += 1;
        let output: unknown = null;
        try { output = JSON.parse(this.text.slice(start, this.cursor)); } catch { return fail("json.syntax-invalid"); }
        if (typeof output !== "string" || output.length > 4_096) fail("json.string-invalid");
        assertUnicode(output as string, "json.unicode-invalid");
        return output as string;
      }
      if (character.charCodeAt(0) < 0x20) fail("json.syntax-invalid");
      if (character === "\\") {
        this.cursor += 1;
        const escape = this.text[this.cursor];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.cursor + 1, this.cursor + 5))) {
            fail("json.syntax-invalid");
          }
          this.cursor += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) fail("json.syntax-invalid");
      }
      this.cursor += 1;
    }
    return fail("json.syntax-invalid");
  }

  private readNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.cursor),
    );
    if (match === null) return fail("json.syntax-invalid");
    this.cursor += match[0].length;
    const output = Number(match[0]);
    if (!Number.isFinite(output) || Object.is(output, -0) ||
      (Number.isInteger(output) && !Number.isSafeInteger(output))) {
      fail("json.number-invalid");
    }
    return output;
  }

  private literal<T>(token: string, value: T): T {
    this.cursor += token.length;
    return value;
  }

  private skipSpace(): void {
    while (/[\x20\x09\x0a\x0d]/.test(this.text[this.cursor] ?? "!")) this.cursor += 1;
  }
}

export type ParsedJsonBytes = Readonly<{ source: string; value: unknown }>;

/** Transport-only parsing. Callers apply typed validation before canonicality. */
export function parseJsonBytes(
  bytes: Uint8Array,
  maximumBytes: number,
  code: string,
): ParsedJsonBytes {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 ||
    bytes.byteLength > maximumBytes ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    fail(`${code}.bytes-invalid`);
  }
  const text = (() => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); }
    catch { return fail(`${code}.bytes-invalid-utf8`); }
  })();
  let value: unknown;
  try { value = new JsonReader(text).read(); }
  catch (error) {
    if (error instanceof IndependentVerifierError && error.code === "json.duplicate-key") {
      fail(`${code}.bytes-duplicate-key`);
    }
    if (error instanceof IndependentVerifierError && error.code === "json.unicode-invalid") {
      fail(`${code}.bytes-invalid-unicode`);
    }
    fail(`${code}.bytes-invalid-json`);
  }
  return { source: text, value };
}

export function parseExactJcs(bytes: Uint8Array, maximumBytes: number, code: string): unknown {
  const parsed = parseJsonBytes(bytes, maximumBytes, code);
  const normalized = (() => {
    try { return canonicalJcs(parsed.value); } catch { return fail(`${code}.bytes-invalid-json`); }
  })();
  if (normalized !== parsed.source) fail(`${code}.bytes-noncanonical`);
  return parsed.value;
}

export const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
