import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serializeLineageAnalysisReceipt, serializeLineageResearchPacket } from "@runbook/capsule-lineage";
import { serializeCreatorForkReceipt } from "@runbook/creator-proof";
import {
  MAX_LINEAGE_ATLAS_BATCH_BYTES,
  MAX_LINEAGE_ATLAS_BLOB_BYTES,
  MAX_LINEAGE_ATLAS_BLOBS,
  parseLineageAtlasWorkerRequest,
  parseLineageAtlasWorkerResponse,
  validateLineageAtlasSelection,
} from "./lineage-atlas-worker-protocol";

function buffer(value: string) {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

function receipt() {
  const archiveSha256 = "4a11da34f4f8ed3dcea6167f93e729dbbde7d69246e665d0b8616656eda74191";
  const authorKeyId = "sha256:b4d90a08583c87e8b69423aa17746e8d0359b8f3765ead1567531d232c28ce55";
  const capsuleId = "66b200560e20f723ece402931277043b85316687aac30f73c4da6a4d5a323578";
  return {
    analysisComplete: true,
    artifacts: [{
      archiveSha256,
      authorKeyId,
      byteLength: 4522,
      capsuleId,
      coreErrorCodes: [],
      coreReceiptSha256: "6d5c361575e2b2b8af36410234f249c8b3f97d5bd174400496253e090028e100",
      coreStatus: "valid",
      parents: [],
      relation: "root",
    }],
    counts: {
      capsuleNodes: 1,
      coreInvalidArtifacts: 0,
      coreValidArtifacts: 1,
      cycleComponents: 0,
      identityConflicts: 0,
      keyGroups: 1,
      missingEdges: 0,
      resolvedEdges: 0,
      transportAliases: 0,
      uniqueTransports: 1,
    },
    cycles: [],
    edges: [],
    findings: { errors: [], warnings: [] },
    keyGroups: [{ authorKeyId, capsuleIds: [capsuleId] }],
    limitations: [
      "receipt-is-unsigned-local-analysis",
      "selected-set-does-not-prove-complete-history",
      "declared-lineage-does-not-prove-parent-consent-causality-or-correctness",
      "shared-self-asserted-key-does-not-prove-identity-control-continuity-or-common-authorship",
      "correction-or-supersession-does-not-revoke-or-erase",
      "analysis-does-not-prove-independent-time-broker-activity-performance-skill-suitability-or-compliance",
      "metadata-hashes-capsule-ids-key-ids-and-lineage-can-correlate-artifacts",
    ],
    nodes: [{ authorKeyId, capsuleId, parents: [], relation: "root", transportSha256: [archiveSha256] }],
    schemaVersion: "runbook.proof-lineage-analysis.v1",
    verifierProfile: "runbook.proof-capsule.v1",
  } as const;
}

function validResult(overrides: Record<string, unknown> = {}) {
  const value = receipt();
  return {
    creatorDomainResults: [],
    duplicateSelectionCount: 0,
    kind: "result",
    receipt: value,
    receiptBytes: serializeLineageAnalysisReceipt(value).buffer as ArrayBuffer,
    requestId: 4,
    researchPacketBytes: serializeLineageResearchPacket(value).buffer as ArrayBuffer,
    ...overrides,
  };
}

function resolvedCreatorResult() {
  const seedId = "2f5f3d9f2f7cdf7af0f9b6d6ba290c31609623bf1acccb0f46f3bd716fc6fb64";
  const childId = "a".repeat(64);
  const seedKey = `sha256:${"0".repeat(64)}`;
  const childKey = `sha256:${"1".repeat(64)}`;
  const base = receipt();
  const graph = {
    ...base,
    artifacts: [
      { archiveSha256: "1".repeat(64), authorKeyId: seedKey, byteLength: 10, capsuleId: seedId, coreErrorCodes: [], coreReceiptSha256: "3".repeat(64), coreStatus: "valid", parents: [], relation: "root" },
      { archiveSha256: "2".repeat(64), authorKeyId: childKey, byteLength: 11, capsuleId: childId, coreErrorCodes: [], coreReceiptSha256: "4".repeat(64), coreStatus: "valid", parents: [seedId], relation: "derived" },
    ],
    counts: { ...base.counts, capsuleNodes: 2, coreValidArtifacts: 2, keyGroups: 2, resolvedEdges: 1, uniqueTransports: 2 },
    edges: [{ childCapsuleId: childId, keyRelationship: "different-self-asserted-key", parentCapsuleId: seedId, relation: "derived", status: "resolved" }],
    keyGroups: [{ authorKeyId: seedKey, capsuleIds: [seedId] }, { authorKeyId: childKey, capsuleIds: [childId] }],
    nodes: [
      { authorKeyId: seedKey, capsuleId: seedId, parents: [], relation: "root", transportSha256: ["1".repeat(64)] },
      { authorKeyId: childKey, capsuleId: childId, parents: [seedId], relation: "derived", transportSha256: ["2".repeat(64)] },
    ],
  } as const;
  const domain = {
    checks: { childCoreValid: true, childNamesExactParent: true, exactOneAllowedRuleChanged: false, fixedSyntheticProfile: false, parentCoreValid: true, policyDeltaRecomputed: false },
    childCapsuleId: childId,
    changedRule: null,
    limitations: [
      "domain-check-does-not-prove-parent-consent",
      "domain-check-does-not-prove-common-authorship",
      "domain-check-does-not-prove-broker-activity",
      "domain-check-does-not-prove-identity-performance-skill-suitability-or-compliance",
    ],
    parentCapsuleId: seedId,
    schemaVersion: "runbook.creator-fork-verification.v1",
    valid: false,
  } as const;
  return {
    creatorDomainResults: [{ receipt: domain, receiptBytes: serializeCreatorForkReceipt(domain).buffer as ArrayBuffer }],
    duplicateSelectionCount: 0,
    kind: "result",
    receipt: graph,
    receiptBytes: serializeLineageAnalysisReceipt(graph).buffer as ArrayBuffer,
    requestId: 9,
    researchPacketBytes: serializeLineageResearchPacket(graph).buffer as ArrayBuffer,
  };
}

type WorkerHarness = {
  messages: unknown[];
  restore(): void;
  send(data: unknown): void;
};

let workerImportSequence = 0;

async function loadBuiltWorker(): Promise<WorkerHarness> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "self");
  const messages: unknown[] = [];
  let listener: ((event: MessageEvent<unknown>) => void) | null = null;
  const fakeScope = {
    addEventListener(type: string, next: (event: MessageEvent<unknown>) => void) {
      if (type === "message") listener = next;
    },
    postMessage(value: unknown) { messages.push(value); },
  };
  Object.defineProperty(globalThis, "self", { configurable: true, value: fakeScope });
  const path = fileURLToPath(new URL("../../public/lineage-atlas.worker.js", import.meta.url));
  workerImportSequence += 1;
  await import(/* @vite-ignore */ `${pathToFileURL(path).href}?protocol-test=${workerImportSequence}`);
  if (listener === null) throw new Error("Built Worker did not install its message listener.");
  const activeListener = listener as (event: MessageEvent<unknown>) => void;
  return {
    messages,
    restore() {
      if (previous === undefined) Reflect.deleteProperty(globalThis, "self");
      else Object.defineProperty(globalThis, "self", previous);
    },
    send(data: unknown) { activeListener({ data } as MessageEvent<unknown>); },
  };
}

async function waitForWorkerMessage(harness: WorkerHarness, kind: string, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = harness.messages.find((message) => (message as { kind?: unknown }).kind === kind);
    if (result !== undefined) return result as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Worker did not emit ${kind}.`);
}

afterEach(() => vi.useRealTimers());

describe("lineage Atlas Worker protocol", () => {
  it("enforces count, individual, and aggregate boundaries before dispatch", () => {
    const sized = (size: number) => ({ size });
    expect(validateLineageAtlasSelection([])).toBe("input.empty");
    expect(validateLineageAtlasSelection([sized(0)])).toBe("input.empty");
    expect(validateLineageAtlasSelection(Array.from({ length: MAX_LINEAGE_ATLAS_BLOBS + 1 }, () => sized(1)))).toBe("input.batch-count-limit");
    expect(validateLineageAtlasSelection([sized(MAX_LINEAGE_ATLAS_BLOB_BYTES)])).toBeNull();
    expect(validateLineageAtlasSelection([sized(MAX_LINEAGE_ATLAS_BLOB_BYTES + 1)])).toBe("input.size-limit");
    expect(validateLineageAtlasSelection([sized(MAX_LINEAGE_ATLAS_BATCH_BYTES / 2), sized(MAX_LINEAGE_ATLAS_BATCH_BYTES / 2)])).toBeNull();
    expect(validateLineageAtlasSelection([
      sized(MAX_LINEAGE_ATLAS_BLOB_BYTES),
      sized(MAX_LINEAGE_ATLAS_BLOB_BYTES),
      sized(1),
    ])).toBe("input.batch-size-limit");
  });

  it("accepts only exact request shapes containing unnamed Blob values", () => {
    const blob = new Blob(["capsule"]);
    expect(parseLineageAtlasWorkerRequest({ kind: "probe", requestId: 1 })).toEqual({ kind: "probe", requestId: 1 });
    expect(parseLineageAtlasWorkerRequest({ blobs: [blob], kind: "analyze", requestId: 2 })).toEqual({ blobs: [blob], kind: "analyze", requestId: 2 });
    expect(parseLineageAtlasWorkerRequest({ blobs: [{ size: 7 }], kind: "analyze", requestId: 2 })).toBeNull();
    expect(parseLineageAtlasWorkerRequest({ blobs: [blob], extra: true, kind: "analyze", requestId: 2 })).toBeNull();
  });

  it("binds a complete receipt object to its exact JCS bytes", () => {
    expect(parseLineageAtlasWorkerResponse(validResult())).toMatchObject({ kind: "result", requestId: 4 });
    expect(parseLineageAtlasWorkerResponse(validResult({ receiptBytes: buffer("{}") }))).toBeNull();
    expect(parseLineageAtlasWorkerResponse(validResult({ receipt: { ...receipt(), analysisComplete: false } }))).toBeNull();
    expect(parseLineageAtlasWorkerResponse(validResult({ duplicateSelectionCount: -1 }))).toBeNull();
  });

  it("binds unique Creator receipts to exactly the resolved frozen-seed edges", () => {
    const result = resolvedCreatorResult();
    expect(parseLineageAtlasWorkerResponse(result)).toMatchObject({ kind: "result", requestId: 9 });
    expect(parseLineageAtlasWorkerResponse({ ...result, creatorDomainResults: [] })).toBeNull();
    expect(parseLineageAtlasWorkerResponse({ ...result, creatorDomainResults: [result.creatorDomainResults[0], result.creatorDomainResults[0]] })).toBeNull();
    const wrong = { ...result.creatorDomainResults[0].receipt, childCapsuleId: "b".repeat(64) };
    expect(parseLineageAtlasWorkerResponse({
      ...result,
      creatorDomainResults: [{ receipt: wrong, receiptBytes: serializeCreatorForkReceipt(wrong).buffer as ArrayBuffer }],
    })).toBeNull();
  });

  it("requires a valid Creator receipt to carry one exact allowed changed-rule tuple", () => {
    const result = resolvedCreatorResult();
    const original = result.creatorDomainResults[0]!.receipt;
    const allowed = { from: 2500, path: "policy.maxPositionBps", reasonCode: "reduce-concentration", to: 1500 } as const;
    const positive = {
      ...original,
      changedRule: allowed,
      checks: {
        childCoreValid: true,
        childNamesExactParent: true,
        exactOneAllowedRuleChanged: true,
        fixedSyntheticProfile: true,
        parentCoreValid: true,
        policyDeltaRecomputed: true,
      },
      valid: true,
    } as const;
    const withDomain = (receiptValue: Record<string, unknown>) => ({
      ...result,
      creatorDomainResults: [{
        receipt: receiptValue,
        receiptBytes: serializeCreatorForkReceipt(receiptValue as never).slice().buffer,
      }],
    });
    expect(parseLineageAtlasWorkerResponse(withDomain(positive))).toMatchObject({ kind: "result" });
    expect(parseLineageAtlasWorkerResponse(withDomain({ ...positive, changedRule: null }))).toBeNull();
    for (const changedRule of [
      { ...allowed, from: 2499 },
      { ...allowed, path: "policy.drawdownStopBps" },
      { ...allowed, reasonCode: "tighten-loss-stop" },
      { ...allowed, to: 1499 },
    ]) {
      expect(parseLineageAtlasWorkerResponse(withDomain({ ...positive, changedRule }))).toBeNull();
    }
  });

  it("rejects malformed progress, unknown errors, extra fields, and invalid UTF-8 packets", () => {
    expect(parseLineageAtlasWorkerResponse({ completed: 1, kind: "progress", requestId: 1, stage: "uploading", total: 2 })).toBeNull();
    expect(parseLineageAtlasWorkerResponse({ code: "signature.invalid", kind: "environment-error", requestId: 1 })).toBeNull();
    expect(parseLineageAtlasWorkerResponse({ extra: true, kind: "ready", requestId: 1 })).toBeNull();
    expect(parseLineageAtlasWorkerResponse(validResult({ researchPacketBytes: new Uint8Array([0xff]).buffer }))).toBeNull();
  });

  it("keeps the production Worker free of network, persistence, and archive-display capabilities", async () => {
    const path = fileURLToPath(new URL("../../public/lineage-atlas.worker.js", import.meta.url));
    const source = await readFile(path, "utf8");
    expect(source).toContain('addEventListener("message"');
    expect(source).not.toMatch(/@runbook\/|import\s+type|DedicatedWorkerGlobalScope/);
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|indexedDB|localStorage|sessionStorage|FileReader)\b/);
    expect(source).not.toMatch(/createObjectURL|dangerouslySetInnerHTML|innerHTML|srcdoc/i);
  });

  it("rejects a Blob read-size mismatch without producing a partial result", async () => {
    class SizeMismatchBlob extends Blob {
      override arrayBuffer() { return Promise.resolve(new ArrayBuffer(this.size + 1)); }
    }
    const worker = await loadBuiltWorker();
    try {
      worker.send({ blobs: [new SizeMismatchBlob(["capsule"])], kind: "analyze", requestId: 31 });
      const error = await waitForWorkerMessage(worker, "environment-error");
      expect(error).toMatchObject({ code: "input.read-failed", requestId: 31 });
      expect(worker.messages.some((message) => (message as { kind?: unknown }).kind === "result")).toBe(false);
    } finally {
      worker.restore();
    }
  });

  it("enforces the per-archive deadline in the built Worker", async () => {
    class NeverReadsBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> { return new Promise(() => undefined); }
    }
    vi.useFakeTimers();
    const worker = await loadBuiltWorker();
    try {
      worker.send({ blobs: [new NeverReadsBlob(["capsule"])], kind: "analyze", requestId: 32 });
      await vi.advanceTimersByTimeAsync(30_001);
      for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
      expect(worker.messages).toContainEqual({ code: "worker.timeout", kind: "environment-error", requestId: 32 });
      expect(worker.messages.some((message) => (message as { kind?: unknown }).kind === "result")).toBe(false);
    } finally {
      worker.restore();
    }
  });

  it("withholds all evidence when a later archive read fails", async () => {
    class SizeMismatchBlob extends Blob {
      override arrayBuffer() { return Promise.resolve(new ArrayBuffer(this.size + 1)); }
    }
    const fixture = await readFile(fileURLToPath(new URL("../../../../conformance/fixtures/minimal-synthetic-root.runbook", import.meta.url)));
    const worker = await loadBuiltWorker();
    try {
      worker.send({ blobs: [new Blob([fixture]), new SizeMismatchBlob(["later"])], kind: "analyze", requestId: 33 });
      const error = await waitForWorkerMessage(worker, "environment-error");
      expect(error).toMatchObject({ code: "input.read-failed", requestId: 33 });
      expect(worker.messages.some((message) => (message as { kind?: unknown }).kind === "result")).toBe(false);
    } finally {
      worker.restore();
    }
  });
});
