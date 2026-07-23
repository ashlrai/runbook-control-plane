/// <reference lib="webworker" />

import {
  createProofLineageAnalyzer,
  serializeLineageAnalysisReceipt,
  serializeLineageResearchPacket,
  type LineageAnalysisReceipt,
} from "@runbook/capsule-lineage";
import {
  CREATOR_SEED_CAPSULE_ID,
  serializeCreatorForkReceipt,
  verifyCreatorForkArchives,
} from "@runbook/creator-proof";
import {
  parseLineageAtlasWorkerRequest,
  validateLineageAtlasSelection,
  type CreatorDomainResult,
  type LineageAtlasEnvironmentCode,
  type LineageAtlasProgressStage,
  type LineageAtlasWorkerResponse,
} from "../lib/lineage-atlas-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
const ARCHIVE_TIMEOUT_MS = 30_000;
const BATCH_TIMEOUT_MS = 120_000;
// Public RFC 8410 SPKI used only to capability-probe browser Ed25519 support.
const ED25519_SPKI_PROBE_HEX = "302a300506032b65700321002b3af4a3de1350c84dc7c8bd6c57ca898009c40a7657157ac785f3577543d50a";

let activeRequestId: number | null = null;

class WorkerDeadlineError extends Error {
  readonly code = "worker.timeout" as const;
}

function bytesFromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function post(response: LineageAtlasWorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(response, transfer);
}

function progress(requestId: number, stage: LineageAtlasProgressStage, completed: number, total: number) {
  post({ completed, kind: "progress", requestId, stage, total });
}

async function probeCrypto() {
  if (!globalThis.crypto?.subtle) throw Object.assign(new Error("crypto.unavailable"), { code: "crypto.unavailable" });
  try {
    await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array());
    await globalThis.crypto.subtle.importKey("spki", bytesFromHex(ED25519_SPKI_PROBE_HEX), { name: "Ed25519" }, false, ["verify"]);
  } catch {
    throw Object.assign(new Error("crypto.unavailable"), { code: "crypto.unavailable" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function environmentCode(error: unknown): LineageAtlasEnvironmentCode | "worker.timeout" {
  if (!isRecord(error) || typeof error.code !== "string") return "worker.failure";
  switch (error.code) {
    case "input.batch-count-limit":
    case "input.batch-size-limit":
    case "input.empty":
    case "input.size-limit":
    case "input.read-failed":
    case "output.size-limit":
    case "crypto.unavailable":
    case "crypto.operation-failed":
    case "worker.timeout":
      return error.code;
    default:
      return "worker.failure";
  }
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return Promise.reject(new WorkerDeadlineError());
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new WorkerDeadlineError()), milliseconds);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error: unknown) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function remainingBatch(startedAt: number) {
  return BATCH_TIMEOUT_MS - (performance.now() - startedAt);
}

async function readExactBlob(blob: Blob, deadlineMs: number) {
  let buffer: ArrayBuffer;
  try {
    buffer = await withDeadline(blob.arrayBuffer(), deadlineMs);
  } catch (error) {
    if (error instanceof WorkerDeadlineError) throw error;
    throw Object.assign(new Error("input.read-failed"), { code: "input.read-failed" });
  }
  if (buffer.byteLength !== blob.size) throw Object.assign(new Error("input.read-failed"), { code: "input.read-failed" });
  return buffer;
}

function resolvedCreatorChildren(receipt: LineageAnalysisReceipt) {
  const children = new Set(receipt.edges
    .filter((edge) => edge.status === "resolved" && edge.parentCapsuleId === CREATOR_SEED_CAPSULE_ID)
    .map((edge) => edge.childCapsuleId));
  return [...children].sort();
}

async function creatorDomainChecks(
  requestId: number,
  receipt: LineageAnalysisReceipt,
  blobsByArchive: ReadonlyMap<string, Blob>,
  startedAt: number,
): Promise<CreatorDomainResult[]> {
  const nodeById = new Map(receipt.nodes.map((node) => [node.capsuleId, node]));
  const seed = nodeById.get(CREATOR_SEED_CAPSULE_ID);
  const children = resolvedCreatorChildren(receipt);
  if (seed === undefined || children.length === 0) return [];
  const seedBlob = blobsByArchive.get(seed.transportSha256[0] as string);
  if (seedBlob === undefined) throw new Error("worker.failure");
  const results: CreatorDomainResult[] = [];
  for (const [index, childId] of children.entries()) {
    progress(requestId, "domain-checking", index, children.length);
    const child = nodeById.get(childId);
    const childBlob = child === undefined ? undefined : blobsByArchive.get(child.transportSha256[0] as string);
    if (childBlob === undefined) throw new Error("worker.failure");
    const pairStartedAt = performance.now();
    const seedBuffer = await readExactBlob(seedBlob, Math.min(ARCHIVE_TIMEOUT_MS, remainingBatch(startedAt)));
    const childBuffer = await readExactBlob(childBlob, Math.min(
      ARCHIVE_TIMEOUT_MS - (performance.now() - pairStartedAt),
      remainingBatch(startedAt),
    ));
    const domainReceipt = await withDeadline(
      verifyCreatorForkArchives(new Uint8Array(seedBuffer), new Uint8Array(childBuffer), { subtle: globalThis.crypto.subtle }),
      Math.min(ARCHIVE_TIMEOUT_MS - (performance.now() - pairStartedAt), remainingBatch(startedAt)),
    );
    if (domainReceipt.parentCapsuleId !== CREATOR_SEED_CAPSULE_ID || domainReceipt.childCapsuleId !== childId
      || !domainReceipt.checks.parentCoreValid || !domainReceipt.checks.childCoreValid || !domainReceipt.checks.childNamesExactParent) {
      throw new Error("worker.failure");
    }
    const exact = serializeCreatorForkReceipt(domainReceipt).slice();
    results.push({ receipt: domainReceipt, receiptBytes: exact.buffer as ArrayBuffer });
  }
  if (children.length > 0) progress(requestId, "domain-checking", children.length, children.length);
  return results;
}

async function analyze(requestId: number, blobs: Blob[]) {
  const preflight = validateLineageAtlasSelection(blobs);
  if (preflight !== null) {
    post({ code: preflight, kind: "environment-error", requestId });
    return;
  }
  const startedAt = performance.now();
  const analyzer = createProofLineageAnalyzer({ subtle: globalThis.crypto.subtle });
  const blobsByArchive = new Map<string, Blob>();
  let duplicateSelectionCount = 0;
  for (const [index, blob] of blobs.entries()) {
    const archiveStartedAt = performance.now();
    progress(requestId, "reading", index, blobs.length);
    const buffer = await readExactBlob(blob, Math.min(ARCHIVE_TIMEOUT_MS, remainingBatch(startedAt)));
    progress(requestId, "verifying", index, blobs.length);
    const ingested = await withDeadline(
      analyzer.addArchive(new Uint8Array(buffer)),
      Math.min(ARCHIVE_TIMEOUT_MS - (performance.now() - archiveStartedAt), remainingBatch(startedAt)),
    );
    if (ingested.duplicate) duplicateSelectionCount += 1;
    else blobsByArchive.set(ingested.archiveSha256, blob);
    progress(requestId, "verifying", index + 1, blobs.length);
  }

  progress(requestId, "analyzing", blobs.length, blobs.length);
  const receipt = analyzer.finish();
  const creatorDomainResults = await creatorDomainChecks(requestId, receipt, blobsByArchive, startedAt);
  progress(requestId, "serializing", blobs.length, blobs.length);
  const exactReceipt = serializeLineageAnalysisReceipt(receipt).slice();
  const researchPacket = serializeLineageResearchPacket(receipt).slice();
  const receiptBytes = exactReceipt.buffer as ArrayBuffer;
  const researchPacketBytes = researchPacket.buffer as ArrayBuffer;
  const transfer: Transferable[] = [receiptBytes, researchPacketBytes];
  for (const result of creatorDomainResults) transfer.push(result.receiptBytes);
  post({
    creatorDomainResults,
    duplicateSelectionCount,
    kind: "result",
    receipt,
    receiptBytes,
    requestId,
    researchPacketBytes,
  }, transfer);
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = parseLineageAtlasWorkerRequest(event.data);
  if (request === null) {
    const requestId = isRecord(event.data) && Number.isSafeInteger(event.data.requestId) && (event.data.requestId as number) > 0
      ? event.data.requestId as number
      : null;
    if (requestId !== null) post({ code: "worker.failure", kind: "environment-error", requestId });
    return;
  }
  if (request.kind === "probe") {
    void probeCrypto().then(
      () => post({ kind: "ready", requestId: request.requestId }),
      (error: unknown) => post({ code: environmentCode(error) === "worker.timeout" ? "worker.failure" : environmentCode(error), kind: "environment-error", requestId: request.requestId }),
    );
    return;
  }
  if (activeRequestId !== null) {
    post({ code: "worker.failure", kind: "environment-error", requestId: request.requestId });
    return;
  }
  activeRequestId = request.requestId;
  void analyze(request.requestId, request.blobs)
    .catch((error: unknown) => {
      const code = environmentCode(error);
      post({ code, kind: "environment-error", requestId: request.requestId });
    })
    .finally(() => { activeRequestId = null; });
});
