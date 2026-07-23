export type StrictJsonLimits = Readonly<{
  maxDepth: number;
  maxNodes: number;
  maxStringLength: number;
}>;

const DEFAULT_LIMITS: StrictJsonLimits = {
  maxDepth: 32,
  maxNodes: 10_000,
  maxStringLength: 4_096,
};

export type StrictJsonErrorCode =
  | "duplicate-key"
  | "invalid-json"
  | "invalid-unicode"
  | "invalid-utf8";

export class StrictJsonError extends Error {
  readonly name = "StrictJsonError";

  constructor(readonly code: StrictJsonErrorCode) {
    super(code);
  }
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new StrictJsonError("invalid-unicode");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new StrictJsonError("invalid-unicode");
    }
  }
}

class StrictParser {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly source: string,
    private readonly limits: StrictJsonLimits,
  ) {}

  parse(): unknown {
    const value = this.value(0);
    this.whitespace();
    if (this.index !== this.source.length) this.fail();
    return value;
  }

  private fail(): never {
    throw new StrictJsonError("invalid-json");
  }

  private value(depth: number): unknown {
    this.nodes += 1;
    if (depth > this.limits.maxDepth || this.nodes > this.limits.maxNodes) this.fail();
    this.whitespace();
    const character = this.source[this.index];
    if (character === "{") return this.object(depth + 1);
    if (character === "[") return this.array(depth + 1);
    if (character === '"') return this.string();
    if (character === "t") return this.literal("true", true);
    if (character === "f") return this.literal("false", false);
    if (character === "n") return this.literal("null", null);
    return this.number();
  }

  private object(depth: number): Record<string, unknown> {
    const output = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return output;
    }
    while (this.index < this.source.length) {
      this.whitespace();
      if (this.source[this.index] !== '"') this.fail();
      const key = this.string();
      if (keys.has(key)) throw new StrictJsonError("duplicate-key");
      keys.add(key);
      this.whitespace();
      if (this.source[this.index] !== ":") this.fail();
      this.index += 1;
      output[key] = this.value(depth);
      this.whitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return output;
      }
      if (this.source[this.index] !== ",") this.fail();
      this.index += 1;
    }
    this.fail();
  }

  private array(depth: number): unknown[] {
    const output: unknown[] = [];
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return output;
    }
    while (this.index < this.source.length) {
      output.push(this.value(depth));
      this.whitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return output;
      }
      if (this.source[this.index] !== ",") this.fail();
      this.index += 1;
    }
    this.fail();
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index] as string;
      if (character === '"') {
        this.index += 1;
        let output: unknown;
        try {
          output = JSON.parse(this.source.slice(start, this.index)) as unknown;
        } catch {
          this.fail();
        }
        if (typeof output !== "string" || output.length > this.limits.maxStringLength) {
          this.fail();
        }
        assertWellFormedUnicode(output);
        return output;
      }
      if (character.charCodeAt(0) < 0x20) this.fail();
      if (character === "\\") {
        this.index += 1;
        const escape = this.source[this.index];
        if (escape === "u") {
          const digits = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail();
          this.index += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) this.fail();
      }
      this.index += 1;
    }
    this.fail();
  }

  private literal<T>(text: string, output: T): T {
    if (this.source.slice(this.index, this.index + text.length) !== text) this.fail();
    this.index += text.length;
    return output;
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index),
    );
    if (match === null) this.fail();
    this.index += match[0].length;
    const output = Number(match[0]);
    if (
      !Number.isFinite(output) ||
      Object.is(output, -0) ||
      (Number.isInteger(output) && !Number.isSafeInteger(output))
    ) {
      this.fail();
    }
    return output;
  }

  private whitespace(): void {
    while (
      this.index < this.source.length &&
      (this.source[this.index] === " " ||
        this.source[this.index] === "\t" ||
        this.source[this.index] === "\n" ||
        this.source[this.index] === "\r")
    ) {
      this.index += 1;
    }
  }
}

export function parseStrictJson(
  bytes: Uint8Array,
  overrides: Partial<StrictJsonLimits> = {},
): unknown {
  if (!(bytes instanceof Uint8Array)) throw new StrictJsonError("invalid-utf8");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new StrictJsonError("invalid-utf8");
  }
  return new StrictParser(source, { ...DEFAULT_LIMITS, ...overrides }).parse();
}
