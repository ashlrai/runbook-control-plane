export type StrictJsonLimits = Readonly<{
  maxDepth: number;
  maxNodes: number;
  maxStringLength: number;
}>;

const DEFAULT_LIMITS: StrictJsonLimits = {
  maxDepth: 16,
  maxNodes: 1_024,
  maxStringLength: 4_096,
};

export class PublicAuthMetadataError extends Error {
  readonly name = "PublicAuthMetadataError";

  constructor(readonly code: string) {
    super(code);
  }
}

const fail = (code: string): never => {
  throw new PublicAuthMetadataError(code);
};

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;

export function ownPlainUint8Array(
  input: unknown,
  code: string,
  maxBytes: number,
  tooLargeCode = code,
): Uint8Array {
  try {
    if (typedArrayByteLengthGetter === undefined || typedArrayTagGetter === undefined ||
      typedArrayTagGetter.call(input) !== "Uint8Array") {
      return fail(code);
    }
    const byteLength = typedArrayByteLengthGetter.call(input) as unknown;
    if (!Number.isSafeInteger(byteLength)) {
      return fail(code);
    }
    if ((byteLength as number) > maxBytes) return fail(tooLargeCode);
    const output = new Uint8Array(byteLength as number);
    Uint8Array.prototype.set.call(output, input as ArrayLike<number>);
    return output;
  } catch (error) {
    if (error instanceof PublicAuthMetadataError) throw error;
    return fail(code);
  }
}

function assertUnicode(value: string, prefix: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        fail(`${prefix}.bytes-invalid-unicode`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(`${prefix}.bytes-invalid-unicode`);
    }
  }
}

class Reader {
  private cursor = 0;
  private nodes = 0;

  constructor(
    private readonly text: string,
    private readonly limits: StrictJsonLimits,
    private readonly prefix: string,
  ) {}

  read(): unknown {
    const value = this.value(0);
    this.space();
    if (this.cursor !== this.text.length) this.invalid();
    return value;
  }

  private invalid(): never {
    return fail(`${this.prefix}.bytes-invalid-json`);
  }

  private value(depth: number): unknown {
    this.nodes += 1;
    if (depth > this.limits.maxDepth || this.nodes > this.limits.maxNodes) {
      return fail(`${this.prefix}.bytes-too-complex`);
    }
    this.space();
    const token = this.text[this.cursor];
    if (token === "{") return this.object(depth + 1);
    if (token === "[") return this.array(depth + 1);
    if (token === '"') return this.string();
    if (this.text.startsWith("true", this.cursor)) return this.literal("true", true);
    if (this.text.startsWith("false", this.cursor)) return this.literal("false", false);
    if (this.text.startsWith("null", this.cursor)) return this.literal("null", null);
    return this.number();
  }

  private object(depth: number): Record<string, unknown> {
    this.cursor += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const names = new Set<string>();
    this.space();
    if (this.text[this.cursor] === "}") {
      this.cursor += 1;
      return result;
    }
    while (this.cursor < this.text.length) {
      this.space();
      if (this.text[this.cursor] !== '"') this.invalid();
      const name = this.string();
      if (names.has(name)) fail(`${this.prefix}.bytes-duplicate-key`);
      names.add(name);
      this.space();
      if (this.text[this.cursor] !== ":") this.invalid();
      this.cursor += 1;
      result[name] = this.value(depth);
      this.space();
      if (this.text[this.cursor] === "}") {
        this.cursor += 1;
        return result;
      }
      if (this.text[this.cursor] !== ",") this.invalid();
      this.cursor += 1;
    }
    return this.invalid();
  }

  private array(depth: number): unknown[] {
    this.cursor += 1;
    const result: unknown[] = [];
    this.space();
    if (this.text[this.cursor] === "]") {
      this.cursor += 1;
      return result;
    }
    while (this.cursor < this.text.length) {
      result.push(this.value(depth));
      this.space();
      if (this.text[this.cursor] === "]") {
        this.cursor += 1;
        return result;
      }
      if (this.text[this.cursor] !== ",") this.invalid();
      this.cursor += 1;
    }
    return this.invalid();
  }

  private string(): string {
    const start = this.cursor;
    this.cursor += 1;
    while (this.cursor < this.text.length) {
      const character = this.text[this.cursor] as string;
      if (character === '"') {
        this.cursor += 1;
        let result: unknown;
        try {
          result = JSON.parse(this.text.slice(start, this.cursor)) as unknown;
        } catch {
          return this.invalid();
        }
        if (typeof result !== "string" || result.length > this.limits.maxStringLength) {
          return fail(`${this.prefix}.bytes-string-too-large`);
        }
        assertUnicode(result, this.prefix);
        return result;
      }
      if (character.charCodeAt(0) < 0x20) this.invalid();
      if (character === "\\") {
        this.cursor += 1;
        const escape = this.text[this.cursor];
        if (escape === "u") {
          const digits = this.text.slice(this.cursor + 1, this.cursor + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.invalid();
          this.cursor += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) this.invalid();
      }
      this.cursor += 1;
    }
    return this.invalid();
  }

  private literal<T>(text: string, value: T): T {
    if (!this.text.startsWith(text, this.cursor)) this.invalid();
    this.cursor += text.length;
    return value;
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.cursor),
    );
    if (match === null) return this.invalid();
    this.cursor += match[0].length;
    const value = Number(match[0]);
    if (
      !Number.isFinite(value) ||
      Object.is(value, -0) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      return this.invalid();
    }
    return value;
  }

  private space(): void {
    while (
      this.cursor < this.text.length &&
      [" ", "\t", "\n", "\r"].includes(this.text[this.cursor] ?? "")
    ) {
      this.cursor += 1;
    }
  }
}

export function parseStrictJsonBytes(
  input: Uint8Array,
  options: Readonly<{
    maxBytes: number;
    limits?: Partial<StrictJsonLimits>;
    prefix?: string;
  }>,
): unknown {
  const prefix = options.prefix ?? "metadata";
  const bytes = ownPlainUint8Array(
    input,
    `${prefix}.bytes-invalid`,
    options.maxBytes,
    `${prefix}.bytes-too-large`,
  );
  if (bytes.byteLength < 2 || bytes.byteLength > options.maxBytes) {
    fail(`${prefix}.bytes-too-large`);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(`${prefix}.bytes-bom`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail(`${prefix}.bytes-invalid-utf8`);
  }
  return new Reader(text, { ...DEFAULT_LIMITS, ...options.limits }, prefix).read();
}
