import {
  ProofCapsuleCryptoError,
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "@runbook/capsule-browser";
import { buildLineageReceipt, findLineageCycles } from "./graph.js";
import { canonicalizeJcs, rawStringCompare } from "./jcs.js";
import {
  LINEAGE_ANALYSIS_SCHEMA,
  LINEAGE_VERIFIER_PROFILE,
  LineageAnalysisError,
  type LineageAnalysisErrorCode,
  type LineageAnalysisOptions,
  type LineageAnalysisReceipt,
  type LineageArtifact,
  type LineageCycle,
  type LineageEdge,
  type LineageErrorFinding,
  type LineageKeyGroup,
  type LineageNode,
  type LineageRelation,
  type LineageWarningFinding,
  type VerifiedTransportMetadata,
} from "./types.js";

export const MAX_LINEAGE_ARCHIVES = 32;
export const MAX_LINEAGE_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_LINEAGE_BATCH_BYTES = 128 * 1024 * 1024;
export const MAX_LINEAGE_RECEIPT_BYTES = 1024 * 1024;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KEY_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ENCODER = new TextEncoder();
const LIMITATIONS = [
  "receipt-is-unsigned-local-analysis",
  "selected-set-does-not-prove-complete-history",
  "declared-lineage-does-not-prove-parent-consent-causality-or-correctness",
  "shared-self-asserted-key-does-not-prove-identity-control-continuity-or-common-authorship",
  "correction-or-supersession-does-not-revoke-or-erase",
  "analysis-does-not-prove-independent-time-broker-activity-performance-skill-suitability-or-compliance",
  "metadata-hashes-capsule-ids-key-ids-and-lineage-can-correlate-artifacts",
] as const;

export type {
  LineageAnalysisCounts,
  LineageAnalysisErrorCode,
  LineageAnalysisOptions,
  LineageAnalysisReceipt,
  LineageArtifact,
  LineageCoreStatus,
  LineageCycle,
  LineageEdge,
  LineageEdgeStatus,
  LineageErrorFinding,
  LineageKeyGroup,
  LineageKeyRelationship,
  LineageNode,
  LineageRelation,
  LineageWarningFinding,
} from "./types.js";
export { LINEAGE_ANALYSIS_SCHEMA, LINEAGE_VERIFIER_PROFILE, LineageAnalysisError } from "./types.js";

export interface ProofLineageAnalyzer {
  /** Copies this one caller-owned snapshot before its first asynchronous operation. */
  addArchive(archive: Uint8Array): Promise<LineageArchiveIngestResult>;
  /** Completes once; throws after an empty, failed, busy, or already-finished analysis. */
  finish(): LineageAnalysisReceipt;
}

export type LineageArchiveIngestResult = Readonly<{
  archiveSha256: string;
  duplicate: boolean;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort(rawStringCompare);
  const sorted = [...expected].sort(rawStringCompare);
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function sortedUnique(values: readonly string[]) {
  return values.every((value, index) => index === 0 || rawStringCompare(values[index - 1] as string, value) < 0);
}

function isStrings(value: unknown, pattern: RegExp, maximum = Number.MAX_SAFE_INTEGER): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === "string" && pattern.test(item));
}

function isRelation(value: unknown): value is LineageRelation {
  return value === "root" || value === "derived" || value === "corrects" || value === "supersedes";
}

function isArtifact(value: unknown): value is LineageArtifact {
  if (!isRecord(value) || !exactKeys(value, ["archiveSha256", "authorKeyId", "byteLength", "capsuleId", "coreErrorCodes", "coreReceiptSha256", "coreStatus", "parents", "relation"])) return false;
  if (typeof value.archiveSha256 !== "string" || !HASH_PATTERN.test(value.archiveSha256)
    || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1 || (value.byteLength as number) > MAX_LINEAGE_ARCHIVE_BYTES
    || typeof value.coreReceiptSha256 !== "string" || !HASH_PATTERN.test(value.coreReceiptSha256)
    || !isStrings(value.coreErrorCodes, ERROR_CODE_PATTERN, 128) || !sortedUnique(value.coreErrorCodes)
    || !isStrings(value.parents, HASH_PATTERN, 8) || !sortedUnique(value.parents)) return false;
  if (value.coreStatus === "valid") {
    if (value.coreErrorCodes.length !== 0 || typeof value.capsuleId !== "string" || !HASH_PATTERN.test(value.capsuleId)
      || typeof value.authorKeyId !== "string" || !KEY_PATTERN.test(value.authorKeyId)
      || !isRelation(value.relation) || value.parents.includes(value.capsuleId)) return false;
    return value.relation === "root" ? value.parents.length === 0
      : value.relation === "derived" ? value.parents.length >= 1 && value.parents.length <= 8
        : value.parents.length === 1;
  }
  return value.coreStatus === "invalid" && value.capsuleId === null && value.authorKeyId === null
    && value.relation === null && value.parents.length === 0;
}

function isNode(value: unknown): value is LineageNode {
  if (!isRecord(value) || !exactKeys(value, ["authorKeyId", "capsuleId", "parents", "relation", "transportSha256"])) return false;
  if (typeof value.authorKeyId !== "string" || !KEY_PATTERN.test(value.authorKeyId)
    || typeof value.capsuleId !== "string" || !HASH_PATTERN.test(value.capsuleId)
    || !isStrings(value.parents, HASH_PATTERN, 8) || !sortedUnique(value.parents)
    || !isStrings(value.transportSha256, HASH_PATTERN, 32) || value.transportSha256.length < 1 || !sortedUnique(value.transportSha256)
    || !isRelation(value.relation) || value.parents.includes(value.capsuleId)) return false;
  return value.relation === "root" ? value.parents.length === 0
    : value.relation === "derived" ? value.parents.length >= 1 && value.parents.length <= 8
      : value.parents.length === 1;
}

function isEdge(value: unknown): value is LineageEdge {
  return isRecord(value) && exactKeys(value, ["childCapsuleId", "keyRelationship", "parentCapsuleId", "relation", "status"])
    && typeof value.childCapsuleId === "string" && HASH_PATTERN.test(value.childCapsuleId)
    && typeof value.parentCapsuleId === "string" && HASH_PATTERN.test(value.parentCapsuleId)
    && (value.relation === "derived" || value.relation === "corrects" || value.relation === "supersedes")
    && (value.status === "resolved" || value.status === "missing")
    && (value.keyRelationship === "same-self-asserted-key" || value.keyRelationship === "different-self-asserted-key" || value.keyRelationship === "not-evaluated")
    && (value.status === "resolved" ? value.keyRelationship !== "not-evaluated" : value.keyRelationship === "not-evaluated");
}

function isKeyGroup(value: unknown): value is LineageKeyGroup {
  return isRecord(value) && exactKeys(value, ["authorKeyId", "capsuleIds"])
    && typeof value.authorKeyId === "string" && KEY_PATTERN.test(value.authorKeyId)
    && isStrings(value.capsuleIds, HASH_PATTERN, 32) && value.capsuleIds.length > 0 && sortedUnique(value.capsuleIds);
}

function isCycle(value: unknown): value is LineageCycle {
  return isRecord(value) && exactKeys(value, ["capsuleIds"])
    && isStrings(value.capsuleIds, HASH_PATTERN, 32) && value.capsuleIds.length > 0 && sortedUnique(value.capsuleIds);
}

function isErrorFinding(value: unknown): value is LineageErrorFinding {
  if (!isRecord(value) || typeof value.code !== "string") return false;
  if (value.code === "lineage.cycle") return exactKeys(value, ["capsuleIds", "code"]) && isStrings(value.capsuleIds, HASH_PATTERN, 32) && value.capsuleIds.length > 0 && sortedUnique(value.capsuleIds);
  return value.code === "lineage.identity-conflict" && exactKeys(value, ["capsuleId", "code"])
    && typeof value.capsuleId === "string" && HASH_PATTERN.test(value.capsuleId);
}

function isWarningFinding(value: unknown): value is LineageWarningFinding {
  if (!isRecord(value) || typeof value.code !== "string") return false;
  if (value.code === "lineage.parent-missing") {
    return exactKeys(value, ["childCapsuleId", "code", "parentCapsuleId"])
      && typeof value.childCapsuleId === "string" && HASH_PATTERN.test(value.childCapsuleId)
      && typeof value.parentCapsuleId === "string" && HASH_PATTERN.test(value.parentCapsuleId);
  }
  return value.code === "lineage.transport-alias" && exactKeys(value, ["capsuleId", "code", "transportSha256"])
    && typeof value.capsuleId === "string" && HASH_PATTERN.test(value.capsuleId)
    && isStrings(value.transportSha256, HASH_PATTERN, 32) && value.transportSha256.length > 1 && sortedUnique(value.transportSha256);
}

function pairKey(left: string, right: string) { return `${left}\0${right}`; }

function findingGuardKey(value: LineageErrorFinding | LineageWarningFinding) {
  if (value.code === "lineage.cycle") return `${value.code}\0${value.capsuleIds.join("\0")}`;
  if (value.code === "lineage.identity-conflict") return `${value.code}\0${value.capsuleId}`;
  if (value.code === "lineage.parent-missing") return `${value.code}\0${value.childCapsuleId}\0${value.parentCapsuleId}`;
  return `${value.code}\0${value.capsuleId}\0${value.transportSha256.join("\0")}`;
}

/** Strict closed-schema guard for untrusted Worker result objects. */
export function isLineageAnalysisReceipt(value: unknown): value is LineageAnalysisReceipt {
  if (!isRecord(value) || !exactKeys(value, ["analysisComplete", "artifacts", "counts", "cycles", "edges", "findings", "keyGroups", "limitations", "nodes", "schemaVersion", "verifierProfile"])
    || value.analysisComplete !== true || value.schemaVersion !== LINEAGE_ANALYSIS_SCHEMA || value.verifierProfile !== LINEAGE_VERIFIER_PROFILE
    || !Array.isArray(value.artifacts) || value.artifacts.length > MAX_LINEAGE_ARCHIVES || !value.artifacts.every(isArtifact)
    || !Array.isArray(value.nodes) || value.nodes.length > MAX_LINEAGE_ARCHIVES || !value.nodes.every(isNode)
    || !Array.isArray(value.edges) || value.edges.length > MAX_LINEAGE_ARCHIVES * 8 || !value.edges.every(isEdge)
    || !Array.isArray(value.keyGroups) || value.keyGroups.length > MAX_LINEAGE_ARCHIVES || !value.keyGroups.every(isKeyGroup)
    || !Array.isArray(value.cycles) || value.cycles.length > MAX_LINEAGE_ARCHIVES || !value.cycles.every(isCycle)
    || !isRecord(value.findings) || !exactKeys(value.findings, ["errors", "warnings"])
    || !Array.isArray(value.findings.errors) || !value.findings.errors.every(isErrorFinding)
    || !Array.isArray(value.findings.warnings) || !value.findings.warnings.every(isWarningFinding)
    || !Array.isArray(value.limitations) || value.limitations.length !== LIMITATIONS.length
    || !value.limitations.every((item, index) => item === LIMITATIONS[index]) || !isRecord(value.counts)) return false;

  const counts = value.counts as Record<string, unknown>;
  const artifacts = value.artifacts as LineageArtifact[];
  const receiptNodes = value.nodes as LineageNode[];
  const receiptEdges = value.edges as LineageEdge[];
  const receiptKeyGroups = value.keyGroups as LineageKeyGroup[];
  const receiptCycles = value.cycles as LineageCycle[];
  const errorFindings = value.findings.errors as LineageErrorFinding[];
  const warningFindings = value.findings.warnings as LineageWarningFinding[];
  const countKeys = ["capsuleNodes", "coreInvalidArtifacts", "coreValidArtifacts", "cycleComponents", "identityConflicts", "keyGroups", "missingEdges", "resolvedEdges", "transportAliases", "uniqueTransports"];
  if (!exactKeys(counts, countKeys) || countKeys.some((key) => !Number.isSafeInteger(counts[key]) || (counts[key] as number) < 0)) return false;
  if (!sortedUnique(artifacts.map((artifact) => artifact.archiveSha256))
    || !sortedUnique(receiptNodes.map((node) => node.capsuleId))
    || !sortedUnique(receiptKeyGroups.map((group) => group.authorKeyId))
    || !sortedUnique(receiptEdges.map((edge) => pairKey(edge.childCapsuleId, edge.parentCapsuleId)))
    || !sortedUnique(receiptCycles.map((cycle) => cycle.capsuleIds.join("\0")))
    || !sortedUnique(errorFindings.map(findingGuardKey))
    || !sortedUnique(warningFindings.map(findingGuardKey))) return false;

  const artifactHashes = new Set(artifacts.map((artifact) => artifact.archiveSha256));
  const validArtifacts = artifacts.filter((artifact) => artifact.coreStatus === "valid");
  const validByCapsule = new Map<string, LineageArtifact[]>();
  for (const artifact of validArtifacts) {
    const group = validByCapsule.get(artifact.capsuleId as string) ?? [];
    group.push(artifact);
    validByCapsule.set(artifact.capsuleId as string, group);
  }
  const nodes = new Map(receiptNodes.map((node) => [node.capsuleId, node]));
  const expectedConflictIds = new Set<string>();
  for (const [capsuleId, group] of validByCapsule) {
    const variants = new Set(group.map((artifact) => canonicalizeJcs({
      authorKeyId: artifact.authorKeyId,
      parents: artifact.parents,
      relation: artifact.relation,
    })));
    const node = nodes.get(capsuleId);
    if (variants.size > 1) {
      expectedConflictIds.add(capsuleId);
      if (group.length < 2 || node !== undefined) return false;
      continue;
    }
    const first = group[0] as LineageArtifact;
    if (node === undefined || node.authorKeyId !== first.authorKeyId || node.relation !== first.relation
      || canonicalizeJcs(node.parents) !== canonicalizeJcs(first.parents)) return false;
    const expectedTransports = group.map((artifact) => artifact.archiveSha256).sort(rawStringCompare);
    if (expectedTransports.length !== node.transportSha256.length
      || expectedTransports.some((hash, index) => hash !== node.transportSha256[index])) return false;
  }
  if (receiptNodes.some((node) => expectedConflictIds.has(node.capsuleId) || !validByCapsule.has(node.capsuleId)
    || node.transportSha256.some((hash) => !artifactHashes.has(hash)))) return false;

  const expectedEdges: LineageEdge[] = [];
  for (const child of receiptNodes) {
    if (child.relation === "root") continue;
    for (const parentCapsuleId of child.parents) {
      const parent = nodes.get(parentCapsuleId);
      expectedEdges.push({
        childCapsuleId: child.capsuleId,
        keyRelationship: parent === undefined ? "not-evaluated"
          : child.authorKeyId === parent.authorKeyId ? "same-self-asserted-key" : "different-self-asserted-key",
        parentCapsuleId,
        relation: child.relation,
        status: parent === undefined ? "missing" : "resolved",
      });
    }
  }
  expectedEdges.sort((left, right) => rawStringCompare(pairKey(left.childCapsuleId, left.parentCapsuleId), pairKey(right.childCapsuleId, right.parentCapsuleId)));
  if (expectedEdges.length !== receiptEdges.length
    || expectedEdges.some((edge, index) => canonicalizeJcs(edge) !== canonicalizeJcs(receiptEdges[index]))) return false;

  const expectedGroups = new Map<string, string[]>();
  for (const node of receiptNodes) {
    const group = expectedGroups.get(node.authorKeyId) ?? [];
    group.push(node.capsuleId);
    expectedGroups.set(node.authorKeyId, group);
  }
  const exactGroups = [...expectedGroups.entries()].sort(([left], [right]) => rawStringCompare(left, right));
  if (exactGroups.length !== receiptKeyGroups.length || exactGroups.some(([authorKeyId, capsuleIds], index) => {
    capsuleIds.sort(rawStringCompare);
    const actual = receiptKeyGroups[index];
    return actual?.authorKeyId !== authorKeyId || capsuleIds.length !== actual.capsuleIds.length
      || capsuleIds.some((id, itemIndex) => id !== actual.capsuleIds[itemIndex]);
  })) return false;

  const expectedMissing = new Set(expectedEdges.filter((edge) => edge.status === "missing").map((edge) => pairKey(edge.childCapsuleId, edge.parentCapsuleId)));
  const actualMissing = warningFindings.filter((finding) => finding.code === "lineage.parent-missing");
  if (expectedMissing.size !== actualMissing.length || actualMissing.some((finding) => !expectedMissing.has(pairKey(finding.childCapsuleId, finding.parentCapsuleId)))) return false;
  const expectedAliases = [...validByCapsule.entries()].filter(([, group]) => group.length > 1);
  const actualAliases = warningFindings.filter((finding) => finding.code === "lineage.transport-alias");
  if (expectedAliases.length !== actualAliases.length || expectedAliases.some(([capsuleId, group]) => {
    const actual = actualAliases.find((finding) => finding.capsuleId === capsuleId);
    const hashes = group.map((artifact) => artifact.archiveSha256).sort(rawStringCompare);
    return actual === undefined || hashes.length !== actual.transportSha256.length
      || hashes.some((hash, index) => hash !== actual.transportSha256[index]);
  })) return false;
  const expectedCycles = findLineageCycles(receiptNodes, expectedEdges);
  if (canonicalizeJcs(expectedCycles) !== canonicalizeJcs(receiptCycles)) return false;
  const expectedErrors: LineageErrorFinding[] = [
    ...[...expectedConflictIds].sort(rawStringCompare).map((capsuleId) => ({ capsuleId, code: "lineage.identity-conflict" as const })),
    ...expectedCycles.map((cycle) => ({ capsuleIds: cycle.capsuleIds, code: "lineage.cycle" as const })),
  ].sort((left, right) => rawStringCompare(findingGuardKey(left), findingGuardKey(right)));
  if (canonicalizeJcs(expectedErrors) !== canonicalizeJcs(errorFindings)) return false;

  const expectedCounts: Record<string, number> = {
    capsuleNodes: receiptNodes.length,
    coreInvalidArtifacts: artifacts.length - validArtifacts.length,
    coreValidArtifacts: validArtifacts.length,
    cycleComponents: receiptCycles.length,
    identityConflicts: expectedConflictIds.size,
    keyGroups: receiptKeyGroups.length,
    missingEdges: receiptEdges.filter((edge) => edge.status === "missing").length,
    resolvedEdges: receiptEdges.filter((edge) => edge.status === "resolved").length,
    transportAliases: warningFindings.filter((finding) => finding.code === "lineage.transport-alias").length,
    uniqueTransports: artifacts.length,
  };
  return countKeys.every((key) => counts[key] === expectedCounts[key]);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function resolveSubtle(explicit?: SubtleCrypto) {
  const subtle = explicit ?? globalThis.crypto?.subtle;
  if (subtle === undefined) throw new ProofCapsuleCryptoError("crypto.unavailable");
  return subtle;
}

async function digestHex(subtle: SubtleCrypto, bytes: Uint8Array) {
  try {
    const result = new Uint8Array(await subtle.digest("SHA-256", new Uint8Array(bytes)));
    if (result.byteLength !== 32) throw new Error("digest length");
    return [...result].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    if (error instanceof ProofCapsuleCryptoError) throw error;
    throw new ProofCapsuleCryptoError("crypto.operation-failed", { cause: error });
  }
}

function fail(code: LineageAnalysisErrorCode): never {
  throw new LineageAnalysisError(code);
}

function copyArchive(input: Uint8Array) {
  if (!(input instanceof Uint8Array)) fail("input.read-failed");
  if (input.byteLength < 1) fail("input.empty");
  if (input.byteLength > MAX_LINEAGE_ARCHIVE_BYTES) fail("input.size-limit");
  return new Uint8Array(input);
}

class Analyzer implements ProofLineageAnalyzer {
  private readonly subtle: SubtleCrypto;
  private readonly transports = new Map<string, VerifiedTransportMetadata>();
  private archiveCount = 0;
  private totalBytes = 0;
  private busy = false;
  private failed: unknown = null;
  private finished = false;

  constructor(options: LineageAnalysisOptions) {
    this.subtle = resolveSubtle(options.subtle);
  }

  async addArchive(input: Uint8Array): Promise<LineageArchiveIngestResult> {
    if (this.failed !== null) throw this.failed;
    if (this.finished || this.busy) return this.poison(new LineageAnalysisError("input.read-failed"));
    // Own the caller's mutable bytes before the first await.
    let archive: Uint8Array;
    try {
      archive = copyArchive(input);
    } catch (error) {
      return this.poison(error);
    }
    this.archiveCount += 1;
    this.totalBytes += archive.byteLength;
    if (this.archiveCount > MAX_LINEAGE_ARCHIVES) return this.poison(new LineageAnalysisError("input.batch-count-limit"));
    if (this.totalBytes > MAX_LINEAGE_BATCH_BYTES) return this.poison(new LineageAnalysisError("input.batch-size-limit"));
    this.busy = true;
    try {
      const archiveSha256 = await digestHex(this.subtle, archive);
      if (this.transports.has(archiveSha256)) return Object.freeze({ archiveSha256, duplicate: true });
      const receipt = await verifyProofCapsule(archive, { subtle: this.subtle });
      const coreReceiptBytes = serializeProofVerificationReceipt(receipt);
      const coreReceiptSha256 = await digestHex(this.subtle, coreReceiptBytes);
      this.transports.set(archiveSha256, Object.freeze({
        archiveSha256,
        authorKeyId: receipt.valid ? receipt.authorKeyId : null,
        byteLength: archive.byteLength,
        capsuleId: receipt.valid ? receipt.capsuleId : null,
        coreErrorCodes: Object.freeze([...new Set(receipt.errors.map((issue) => issue.code))].sort(rawStringCompare)),
        coreReceiptSha256,
        coreValid: receipt.valid,
        parents: Object.freeze(receipt.valid ? [...receipt.lineage.parents] : []),
        relation: receipt.valid ? receipt.lineage.relation : null,
      }));
      return Object.freeze({ archiveSha256, duplicate: false });
    } catch (error) {
      return this.poison(error);
    } finally {
      this.busy = false;
    }
  }

  finish(): LineageAnalysisReceipt {
    if (this.failed !== null) throw this.failed;
    if (this.finished || this.busy) return this.poison(new LineageAnalysisError("input.read-failed"));
    if (this.archiveCount === 0) return this.poison(new LineageAnalysisError("input.empty"));
    this.finished = true;
    const receipt = deepFreeze(buildLineageReceipt([...this.transports.values()]));
    serializeLineageAnalysisReceipt(receipt);
    return receipt;
  }

  private poison(error: unknown): never {
    this.failed = error;
    throw error;
  }
}

/** Creates a sequential analyzer that retains metadata, never archive bytes. */
export function createProofLineageAnalyzer(options: LineageAnalysisOptions = {}): ProofLineageAnalyzer {
  return new Analyzer(options);
}

/**
 * Convenience batch API. It preflights and copies every caller-owned archive
 * synchronously before its first await. Workers should prefer the incremental
 * analyzer so only one package-owned archive snapshot is live at a time.
 */
export async function analyzeProofLineageArchives(
  inputs: readonly Uint8Array[],
  options: LineageAnalysisOptions = {},
): Promise<LineageAnalysisReceipt> {
  if (!Array.isArray(inputs)) fail("input.read-failed");
  if (inputs.length < 1) fail("input.empty");
  if (inputs.length > MAX_LINEAGE_ARCHIVES) fail("input.batch-count-limit");
  let totalBytes = 0;
  for (const input of inputs) {
    if (!(input instanceof Uint8Array)) fail("input.read-failed");
    if (input.byteLength < 1) fail("input.empty");
    if (input.byteLength > MAX_LINEAGE_ARCHIVE_BYTES) fail("input.size-limit");
    totalBytes += input.byteLength;
    if (totalBytes > MAX_LINEAGE_BATCH_BYTES) fail("input.batch-size-limit");
  }
  // This copy happens before createProofLineageAnalyzer can reach an await.
  const snapshots = inputs.map((input) => new Uint8Array(input));
  const analyzer = createProofLineageAnalyzer(options);
  for (const snapshot of snapshots) await analyzer.addArchive(snapshot);
  return analyzer.finish();
}

/** Emits exact RFC 8785 JCS UTF-8 with no BOM or trailing line feed. */
export function serializeLineageAnalysisReceipt(receipt: LineageAnalysisReceipt): Uint8Array {
  if (!isLineageAnalysisReceipt(receipt)) throw new Error("lineage.receipt-schema-invalid");
  const bytes = ENCODER.encode(canonicalizeJcs(receipt));
  if (bytes.byteLength > MAX_LINEAGE_RECEIPT_BYTES) fail("output.size-limit");
  return bytes;
}

function findingLine(finding: LineageErrorFinding | LineageWarningFinding) {
  if (finding.code === "lineage.cycle") return `${finding.code} ${finding.capsuleIds.join(",")}`;
  if (finding.code === "lineage.identity-conflict") return `${finding.code} ${finding.capsuleId}`;
  if (finding.code === "lineage.parent-missing") return `${finding.code} ${finding.childCapsuleId} -> ${finding.parentCapsuleId}`;
  return `${finding.code} ${finding.capsuleId} ${finding.transportSha256.join(",")}`;
}

/** Emits a deterministic metadata-only UTF-8 text view with no trailing LF. */
export function serializeLineageResearchPacket(receipt: LineageAnalysisReceipt): Uint8Array {
  if (!isLineageAnalysisReceipt(receipt)) throw new Error("lineage.receipt-schema-invalid");
  const lines = [
    "RUNBOOK LINEAGE ATLAS RESEARCH PACKET",
    "Status: Unsigned local analysis",
    "Privacy warning: This export is metadata-only, but hashes, capsule IDs, self-asserted key IDs, and lineage can still correlate artifacts.",
    `Schema: ${receipt.schemaVersion}`,
    `Verifier profile: ${receipt.verifierProfile}`,
    "Analysis complete: yes",
    "",
    "COUNTS",
    ...Object.entries(receipt.counts).sort(([left], [right]) => rawStringCompare(left, right)).map(([key, value]) => `${key}: ${value}`),
    "",
    "FINDINGS",
    ...receipt.findings.errors.map((finding) => `ERROR ${findingLine(finding)}`),
    ...receipt.findings.warnings.map((finding) => `WARNING ${findingLine(finding)}`),
    ...(receipt.findings.errors.length + receipt.findings.warnings.length === 0 ? ["none"] : []),
    "",
    "ARTIFACTS",
    ...receipt.artifacts.map((artifact) => [
      `${artifact.archiveSha256} ${artifact.coreStatus} ${artifact.byteLength} bytes`,
      `  core receipt ${artifact.coreReceiptSha256}`,
      `  capsule ${artifact.capsuleId ?? "withheld-invalid"}`,
      `  self-asserted key ${artifact.authorKeyId ?? "withheld-invalid"}`,
      `  core errors ${artifact.coreErrorCodes.join(",") || "none"}`,
    ]).flat(),
    "",
    "NODES",
    ...receipt.nodes.map((node) => `${node.capsuleId} ${node.relation} parents=${node.parents.join(",") || "none"} transports=${node.transportSha256.join(",")} self-asserted-key=${node.authorKeyId}`),
    "",
    "EDGES",
    ...receipt.edges.map((edge) => `${edge.childCapsuleId} -> ${edge.parentCapsuleId} ${edge.relation} ${edge.status} ${edge.keyRelationship}`),
    "",
    "KEY GROUPS (SELF-ASSERTED CORRELATORS ONLY)",
    ...receipt.keyGroups.map((group) => `${group.authorKeyId} ${group.capsuleIds.join(",")}`),
    "",
    "LIMITATIONS",
    ...receipt.limitations.map((limitation) => `- ${limitation}`),
  ];
  const bytes = ENCODER.encode(lines.join("\n"));
  if (bytes.byteLength > MAX_LINEAGE_RECEIPT_BYTES) fail("output.size-limit");
  return bytes;
}
