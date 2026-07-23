const CREDENTIAL_FIELD_PATTERN = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|private[_-]?key|client[_-]?secret|secret|session[_-]?(?:id|key|token)|account[_-]?(?:id|number)|routing[_-]?number|email|phone|ssn)$/i;

export type StrictJsonLimits = {
  maxDepth: number;
  maxNodes: number;
  maxStringLength: number;
  rejectCredentialFields: boolean;
  topLevelStringValueLimits: Readonly<Record<string, number>>;
};

const DEFAULT_LIMITS: StrictJsonLimits = {
  maxDepth: 32,
  maxNodes: 5_000,
  maxStringLength: 32_768,
  rejectCredentialFields: true,
  topLevelStringValueLimits: {},
};

export type StrictJsonErrorCode = "invalid-utf8" | "invalid-json" | "duplicate-key" | "credential-shaped-field";

export class StrictJsonError extends Error {
  constructor(readonly code: StrictJsonErrorCode) {
    super(code);
  }
}

class Parser {
  private index = 0;
  private nodes = 0;

  constructor(private readonly source: string, private readonly limits: StrictJsonLimits) {}

  parse(): unknown {
    const value = this.value(0);
    this.whitespace();
    if (this.index !== this.source.length) throw new StrictJsonError("invalid-json");
    return value;
  }

  private value(depth: number, stringLimit = this.limits.maxStringLength): unknown {
    this.nodes += 1;
    if (depth > this.limits.maxDepth || this.nodes > this.limits.maxNodes) throw new StrictJsonError("invalid-json");
    this.whitespace();
    const character = this.source[this.index];
    if (character === "{") return this.object(depth + 1);
    if (character === "[") return this.array(depth + 1);
    if (character === '"') return this.string(stringLimit);
    if (character === "t") return this.literal("true", true);
    if (character === "f") return this.literal("false", false);
    if (character === "n") return this.literal("null", null);
    return this.number();
  }

  private object(depth: number): Record<string, unknown> {
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      this.whitespace();
      if (this.source[this.index] !== '"') throw new StrictJsonError("invalid-json");
      const key = this.string();
      if (keys.has(key)) throw new StrictJsonError("duplicate-key");
      if (this.limits.rejectCredentialFields && CREDENTIAL_FIELD_PATTERN.test(key)) {
        throw new StrictJsonError("credential-shaped-field");
      }
      keys.add(key);
      this.whitespace();
      if (this.source[this.index] !== ":") throw new StrictJsonError("invalid-json");
      this.index += 1;
      const topLevelLimit = depth === 1 && Object.hasOwn(this.limits.topLevelStringValueLimits, key)
        ? this.limits.topLevelStringValueLimits[key]
        : undefined;
      result[key] = this.value(depth, topLevelLimit);
      this.whitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") throw new StrictJsonError("invalid-json");
      this.index += 1;
    }
    throw new StrictJsonError("invalid-json");
  }

  private array(depth: number): unknown[] {
    const result: unknown[] = [];
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.value(depth));
      this.whitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") throw new StrictJsonError("invalid-json");
      this.index += 1;
    }
    throw new StrictJsonError("invalid-json");
  }

  private string(maxLength = this.limits.maxStringLength): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index] as string;
      if (!escaped && character === '"') {
        this.index += 1;
        let result: unknown;
        try {
          result = JSON.parse(this.source.slice(start, this.index)) as unknown;
        } catch {
          throw new StrictJsonError("invalid-json");
        }
        if (typeof result !== "string" || result.length > maxLength) throw new StrictJsonError("invalid-json");
        return result;
      }
      escaped = !escaped && character === "\\";
      this.index += 1;
    }
    throw new StrictJsonError("invalid-json");
  }

  private literal<T>(text: string, result: T): T {
    if (this.source.slice(this.index, this.index + text.length) !== text) throw new StrictJsonError("invalid-json");
    this.index += text.length;
    return result;
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index));
    if (!match) throw new StrictJsonError("invalid-json");
    this.index += match[0].length;
    const result = Number(match[0]);
    if (!Number.isFinite(result) || Object.is(result, -0)) throw new StrictJsonError("invalid-json");
    if (Number.isInteger(result) && !Number.isSafeInteger(result)) throw new StrictJsonError("invalid-json");
    return result;
  }

  private whitespace() {
    while (this.index < this.source.length && /[\t\n\r ]/.test(this.source[this.index] as string)) this.index += 1;
  }
}

export function parseStrictJson(bytes: Uint8Array, overrides: Partial<StrictJsonLimits> = {}): unknown {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StrictJsonError("invalid-utf8");
  }
  return new Parser(source, { ...DEFAULT_LIMITS, ...overrides }).parse();
}
