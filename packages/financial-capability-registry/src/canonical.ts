export {
  canonicalizeJcs,
  rawStringCompare,
  sha256Jcs,
  sha256Utf8,
} from "@runbook/financial-bench";

import { canonicalizeJcs } from "@runbook/financial-bench";

/** Returns exact RFC 8785 JCS UTF-8 bytes without a transport newline. */
export function jcsBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJcs(value));
}
