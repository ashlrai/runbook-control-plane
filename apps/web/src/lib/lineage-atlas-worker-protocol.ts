import {
  isLineageAnalysisReceipt,
  serializeLineageAnalysisReceipt,
  serializeLineageResearchPacket,
  type LineageAnalysisReceipt,
} from "@runbook/capsule-lineage";

export const MAX_LINEAGE_ATLAS_BLOBS = 32;
export const MAX_LINEAGE_ATLAS_BLOB_BYTES = 64 * 1024 * 1024;
export const MAX_LINEAGE_ATLAS_BATCH_BYTES = 128 * 1024 * 1024;
export const MAX_LINEAGE_ATLAS_RECEIPT_BYTES = 1024 * 1024;
export const DEFAULT_LINEAGE_ATLAS_TIMEOUT_MS = 120_000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CREATOR_SEED_CAPSULE_ID = "2f5f3d9f2f7cdf7af0f9b6d6ba290c31609623bf1acccb0f46f3bd716fc6fb64";
const CREATOR_LIMITATIONS = [
  "domain-check-does-not-prove-parent-consent",
  "domain-check-does-not-prove-common-authorship",
  "domain-check-does-not-prove-broker-activity",
  "domain-check-does-not-prove-identity-performance-skill-suitability-or-compliance",
] as const;

export type LineageAtlasEnvironmentCode =
  | "input.batch-count-limit"
  | "input.batch-size-limit"
  | "input.empty"
  | "input.size-limit"
  | "input.read-failed"
  | "output.size-limit"
  | "crypto.unavailable"
  | "crypto.operation-failed"
  | "worker.timeout"
  | "worker.failure";

export type LineageAtlasProgressStage = "reading" | "verifying" | "domain-checking" | "analyzing" | "serializing";
export type LineageAtlasProgress = Readonly<{
  completed: number;
  stage: LineageAtlasProgressStage;
  total: number;
}>;

export type { LineageAnalysisReceipt } from "@runbook/capsule-lineage";

export type CreatorForkReceipt = Readonly<{
  checks: Readonly<{
    childCoreValid: boolean;
    childNamesExactParent: boolean;
    exactOneAllowedRuleChanged: boolean;
    fixedSyntheticProfile: boolean;
    parentCoreValid: boolean;
    policyDeltaRecomputed: boolean;
  }>;
  childCapsuleId: string | null;
  changedRule: Readonly<{ from: number; path: string; reasonCode: string; to: number }> | null;
  limitations: readonly string[];
  parentCapsuleId: string | null;
  schemaVersion: "runbook.creator-fork-verification.v1";
  valid: boolean;
}>;

export type CreatorDomainResult = Readonly<{
  receipt: CreatorForkReceipt;
  receiptBytes: ArrayBuffer;
}>;

export type LineageAtlasWorkerRequest =
  | { kind: "probe"; requestId: number }
  | { blobs: Blob[]; kind: "analyze"; requestId: number };

export type LineageAtlasWorkerResponse =
  | { kind: "ready"; requestId: number }
  | ({ kind: "progress"; requestId: number } & LineageAtlasProgress)
  | {
      creatorDomainResults: CreatorDomainResult[];
      duplicateSelectionCount: number;
      kind: "result";
      receipt: LineageAnalysisReceipt;
      receiptBytes: ArrayBuffer;
      requestId: number;
      researchPacketBytes: ArrayBuffer;
    }
  | { code: LineageAtlasEnvironmentCode; kind: "environment-error"; requestId: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function wellFormedString(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (!wellFormedString(value)) throw new Error("invalid-unicode");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("invalid-number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new Error("invalid-value");
  return `{${Object.keys(value).sort().map((key) => {
    if (!wellFormedString(key)) throw new Error("invalid-unicode");
    return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
  }).join(",")}}`;
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] as number) ^ (right[index] as number);
  return difference === 0;
}

function exactCanonicalBinding(value: unknown, buffer: ArrayBuffer) {
  if (buffer.byteLength < 1 || buffer.byteLength > MAX_LINEAGE_ATLAS_RECEIPT_BYTES) return false;
  try {
    return bytesEqual(new TextEncoder().encode(canonicalJson(value)), new Uint8Array(buffer));
  } catch {
    return false;
  }
}

function exactLineageReceiptBinding(value: unknown, buffer: ArrayBuffer) {
  if (!isLineageAnalysisReceipt(value) || buffer.byteLength < 1 || buffer.byteLength > MAX_LINEAGE_ATLAS_RECEIPT_BYTES) return false;
  try {
    return bytesEqual(serializeLineageAnalysisReceipt(value), new Uint8Array(buffer));
  } catch {
    return false;
  }
}

function looksLikeChangedRule(value: unknown) {
  if (!isRecord(value)) return false;
  if (!exactKeys(value, ["from", "path", "reasonCode", "to"])
    || !Number.isSafeInteger(value.from) || !Number.isSafeInteger(value.to)
    || typeof value.path !== "string" || typeof value.reasonCode !== "string") return false;
  return (value.from === 2500 && value.path === "policy.maxPositionBps" && value.reasonCode === "reduce-concentration" && value.to === 1500)
    || (value.from === 800 && value.path === "policy.drawdownStopBps" && value.reasonCode === "tighten-loss-stop" && value.to === 400)
    || (value.from === 2 && value.path === "policy.maxDailyProposals" && value.reasonCode === "reduce-action-frequency" && value.to === 1)
    || (value.from === 2 && value.path === "policy.minimumEvidenceSources" && value.reasonCode === "raise-evidence-bar" && value.to === 3);
}

function looksLikeCreatorReceipt(value: unknown): value is CreatorForkReceipt {
  if (!isRecord(value) || !exactKeys(value, ["checks", "childCapsuleId", "changedRule", "limitations", "parentCapsuleId", "schemaVersion", "valid"])) return false;
  if (!isRecord(value.checks) || !exactKeys(value.checks, ["childCoreValid", "childNamesExactParent", "exactOneAllowedRuleChanged", "fixedSyntheticProfile", "parentCoreValid", "policyDeltaRecomputed"])) return false;
  const checks = Object.values(value.checks);
  if (checks.some((check) => typeof check !== "boolean") || value.valid !== checks.every(Boolean)) return false;
  if (value.schemaVersion !== "runbook.creator-fork-verification.v1") return false;
  if (value.childCapsuleId !== null && (typeof value.childCapsuleId !== "string" || !SHA256_PATTERN.test(value.childCapsuleId))) return false;
  if (value.parentCapsuleId !== null && (typeof value.parentCapsuleId !== "string" || !SHA256_PATTERN.test(value.parentCapsuleId))) return false;
  const hasChangedRule = value.changedRule !== null;
  if (hasChangedRule && !looksLikeChangedRule(value.changedRule)) return false;
  if (hasChangedRule !== value.checks.exactOneAllowedRuleChanged
    || (value.checks.fixedSyntheticProfile && !hasChangedRule)
    || (value.checks.policyDeltaRecomputed && !hasChangedRule)
    || (value.valid && !hasChangedRule)) return false;
  return Array.isArray(value.limitations)
    && value.limitations.length === CREATOR_LIMITATIONS.length
    && value.limitations.every((entry, index) => entry === CREATOR_LIMITATIONS[index]);
}

function looksLikeCreatorDomainResult(value: unknown): value is CreatorDomainResult {
  return isRecord(value)
    && exactKeys(value, ["receipt", "receiptBytes"])
    && looksLikeCreatorReceipt(value.receipt)
    && value.receiptBytes instanceof ArrayBuffer
    && exactCanonicalBinding(value.receipt, value.receiptBytes);
}

function validResearchPacket(receipt: LineageAnalysisReceipt, value: ArrayBuffer) {
  if (value.byteLength < 1 || value.byteLength > MAX_LINEAGE_ATLAS_RECEIPT_BYTES) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(value);
    return bytesEqual(serializeLineageResearchPacket(receipt), new Uint8Array(value));
  } catch {
    return false;
  }
}

function domainResultsBindToGraph(receipt: LineageAnalysisReceipt, results: readonly CreatorDomainResult[]) {
  const nodes = new Set(receipt.nodes.map((node) => node.capsuleId));
  const expectedChildren = new Set(receipt.edges
    .filter((edge) => edge.status === "resolved" && edge.parentCapsuleId === CREATOR_SEED_CAPSULE_ID)
    .map((edge) => edge.childCapsuleId));
  const seen = new Set<string>();
  let prior = "";
  for (const result of results) {
    const child = result.receipt.childCapsuleId;
    if (child === null || result.receipt.parentCapsuleId !== CREATOR_SEED_CAPSULE_ID
      || !result.receipt.checks.parentCoreValid || !result.receipt.checks.childCoreValid || !result.receipt.checks.childNamesExactParent
      || !nodes.has(CREATOR_SEED_CAPSULE_ID) || !nodes.has(child) || !expectedChildren.has(child)
      || seen.has(child) || (prior !== "" && prior >= child)) return false;
    seen.add(child);
    prior = child;
  }
  return seen.size === expectedChildren.size;
}

const ENVIRONMENT_CODES = new Set<LineageAtlasEnvironmentCode>([
  "input.batch-count-limit",
  "input.batch-size-limit",
  "input.empty",
  "input.size-limit",
  "input.read-failed",
  "output.size-limit",
  "crypto.unavailable",
  "crypto.operation-failed",
  "worker.timeout",
  "worker.failure",
]);

export function parseLineageAtlasWorkerResponse(value: unknown): LineageAtlasWorkerResponse | null {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.kind !== "string") return null;
  if (value.kind === "ready" && exactKeys(value, ["kind", "requestId"])) return { kind: "ready", requestId: value.requestId };
  if (value.kind === "progress" && exactKeys(value, ["completed", "kind", "requestId", "stage", "total"])) {
    if ((value.stage !== "reading" && value.stage !== "verifying" && value.stage !== "domain-checking" && value.stage !== "analyzing" && value.stage !== "serializing")
      || !Number.isSafeInteger(value.completed) || (value.completed as number) < 0
      || !Number.isSafeInteger(value.total) || (value.total as number) < 1 || (value.total as number) > MAX_LINEAGE_ATLAS_BLOBS
      || (value.completed as number) > (value.total as number)) return null;
    return value as LineageAtlasWorkerResponse;
  }
  if (value.kind === "environment-error" && exactKeys(value, ["code", "kind", "requestId"])
    && typeof value.code === "string" && ENVIRONMENT_CODES.has(value.code as LineageAtlasEnvironmentCode)) return value as LineageAtlasWorkerResponse;
  if (value.kind !== "result" || !exactKeys(value, ["creatorDomainResults", "duplicateSelectionCount", "kind", "receipt", "receiptBytes", "requestId", "researchPacketBytes"])) return null;
  if (!isLineageAnalysisReceipt(value.receipt) || !(value.receiptBytes instanceof ArrayBuffer)
    || !exactLineageReceiptBinding(value.receipt, value.receiptBytes)
    || !(value.researchPacketBytes instanceof ArrayBuffer) || !validResearchPacket(value.receipt, value.researchPacketBytes)
    || !Number.isSafeInteger(value.duplicateSelectionCount) || (value.duplicateSelectionCount as number) < 0
    || (value.duplicateSelectionCount as number) >= MAX_LINEAGE_ATLAS_BLOBS
    || !Array.isArray(value.creatorDomainResults) || !value.creatorDomainResults.every(looksLikeCreatorDomainResult)
    || !domainResultsBindToGraph(value.receipt, value.creatorDomainResults)) return null;
  return value as LineageAtlasWorkerResponse;
}

export function validateLineageAtlasSelection(blobs: readonly Pick<Blob, "size">[]): LineageAtlasEnvironmentCode | null {
  if (blobs.length < 1) return "input.empty";
  if (blobs.length > MAX_LINEAGE_ATLAS_BLOBS) return "input.batch-count-limit";
  let total = 0;
  for (const blob of blobs) {
    if (!Number.isSafeInteger(blob.size) || blob.size < 1) return "input.empty";
    if (blob.size > MAX_LINEAGE_ATLAS_BLOB_BYTES) return "input.size-limit";
    total += blob.size;
    if (!Number.isSafeInteger(total) || total > MAX_LINEAGE_ATLAS_BATCH_BYTES) return "input.batch-size-limit";
  }
  return null;
}

export function parseLineageAtlasWorkerRequest(value: unknown): LineageAtlasWorkerRequest | null {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.kind !== "string") return null;
  if (value.kind === "probe" && exactKeys(value, ["kind", "requestId"])) return { kind: "probe", requestId: value.requestId };
  if (value.kind !== "analyze" || !exactKeys(value, ["blobs", "kind", "requestId"]) || !Array.isArray(value.blobs)
    || value.blobs.some((blob) => !(blob instanceof Blob))) return null;
  return { blobs: value.blobs as Blob[], kind: "analyze", requestId: value.requestId };
}

export function isSha256(value: string) {
  return SHA256_PATTERN.test(value);
}

export function isKeyId(value: string) {
  return KEY_ID_PATTERN.test(value);
}
