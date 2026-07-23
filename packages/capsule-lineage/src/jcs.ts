function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertWellFormed(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) throw new Error("lineage.invalid-unicode");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("lineage.invalid-unicode");
    }
  }
}

export function rawStringCompare(left: string, right: string) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function canonicalizeJcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertWellFormed(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("lineage.invalid-number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(",")}]`;
  if (!isRecord(value)) throw new Error("lineage.invalid-value");
  return `{${Object.keys(value).sort(rawStringCompare).map((key) => {
    assertWellFormed(key);
    return `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`;
  }).join(",")}}`;
}
