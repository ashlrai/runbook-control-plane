import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  finalizeProofCapsule,
  prepareProofCapsule,
  type CapsulePayloadMember,
  type ProofCapsuleLineage,
} from "@runbook/capsule-author";
import { verifyProofCapsule } from "@runbook/capsule-browser";
import { beforeAll, describe, expect, it } from "vitest";
import { assembleProofCapsuleZip } from "../../capsule-author/src/zip.js";
import { buildLineageReceipt } from "./graph.js";
import {
  MAX_LINEAGE_ARCHIVES,
  MAX_LINEAGE_ARCHIVE_BYTES,
  MAX_LINEAGE_BATCH_BYTES,
  analyzeProofLineageArchives,
  createProofLineageAnalyzer,
  isLineageAnalysisReceipt,
  LineageAnalysisError,
  serializeLineageAnalysisReceipt,
  serializeLineageResearchPacket,
  type LineageAnalysisReceipt,
} from "./index.js";
import type { VerifiedTransportMetadata } from "./types.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const encoder = new TextEncoder();
const corpusRoot = new URL("../../../conformance/fixtures/", import.meta.url);
const ZERO = "0".repeat(64);

async function corpus(name: string) {
  return new Uint8Array(await readFile(fileURLToPath(new URL(name, corpusRoot))));
}

const payloads: CapsulePayloadMember[] = [
  { path: "payload/charter.json", role: "charter", mediaType: "application/json", bytes: encoder.encode('{"dataClass":"synthetic"}') },
  { path: "payload/claims.json", role: "claims", mediaType: "application/json", bytes: encoder.encode('{"claims":[],"dataClass":"synthetic"}') },
  { path: "payload/disclosures.json", role: "disclosures", mediaType: "application/json", bytes: encoder.encode('{"dataClass":"synthetic","limitations":["self-asserted"]}') },
  { path: "payload/events.ndjson", role: "events", mediaType: "application/x-ndjson", bytes: new Uint8Array() },
  { path: "payload/report.html", role: "report", mediaType: "text/html;charset=utf-8", bytes: encoder.encode("<!doctype html><title>PRIVATE SENTINEL</title>") },
];

type Keys = { privateKey: CryptoKey; spki: Uint8Array };
let keyA: Keys;
let keyB: Keys;

async function keys(): Promise<Keys> {
  const pair = await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  return { privateKey: pair.privateKey, spki: new Uint8Array(await subtle.exportKey("spki", pair.publicKey)) };
}

async function capsule(input: { id: string; key: Keys; lineage: ProofCapsuleLineage; sequence: number; createdAt?: string }) {
  const prepared = await prepareProofCapsule({
    checkpointSequence: input.sequence,
    createdAt: input.createdAt ?? "2026-07-21T23:00:00Z",
    dataClass: "synthetic",
    eventChain: { eventCount: 0, headHash: ZERO },
    experimentId: input.id,
    lineage: input.lineage,
    payloads,
    publicKeySpkiDer: input.key.spki,
  }, { subtle });
  const signature = new Uint8Array(await subtle.sign("Ed25519", input.key.privateKey, prepared.signingBytes));
  return finalizeProofCapsule(prepared, signature, { subtle });
}

function readStoredMembers(input: Uint8Array) {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const members: { path: string; bytes: Uint8Array }[] = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    members.push({
      path: new TextDecoder().decode(input.subarray(nameStart, dataStart)),
      bytes: input.slice(dataStart, dataStart + size),
    });
    offset = dataStart + size;
  }
  return members;
}

function alternateEnvelopeTransport(input: Uint8Array) {
  const members = readStoredMembers(input);
  const envelope = members.find((member) => member.path === "runbook/checkpoint.dsse.json");
  if (envelope === undefined) throw new Error("missing envelope");
  const parsed = JSON.parse(new TextDecoder().decode(envelope.bytes)) as Record<string, unknown>;
  parsed.extension = "same signed statement, alternate transport";
  envelope.bytes = encoder.encode(JSON.stringify(parsed));
  return assembleProofCapsuleZip(members);
}

function metadata(input: Partial<VerifiedTransportMetadata> & Pick<VerifiedTransportMetadata, "archiveSha256" | "capsuleId" | "authorKeyId" | "parents" | "relation">): VerifiedTransportMetadata {
  return {
    archiveSha256: input.archiveSha256,
    authorKeyId: input.authorKeyId,
    byteLength: input.byteLength ?? 100,
    capsuleId: input.capsuleId,
    coreErrorCodes: input.coreErrorCodes ?? [],
    coreReceiptSha256: input.coreReceiptSha256 ?? input.archiveSha256,
    coreValid: input.coreValid ?? true,
    parents: input.parents,
    relation: input.relation,
  };
}

function cloneReceipt(receipt: LineageAnalysisReceipt): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(serializeLineageAnalysisReceipt(receipt))) as Record<string, unknown>;
}

beforeAll(async () => {
  [keyA, keyB] = await Promise.all([keys(), keys()]);
});

describe("raw-byte lineage analysis", () => {
  it("quarantines the tampered transport even though its core parser computes the same tentative capsule ID", async () => {
    const [golden, tampered] = await Promise.all([
      corpus("minimal-synthetic-root.runbook"),
      corpus("minimal-synthetic-root-payload-tampered.runbook"),
    ]);
    const [validCore, invalidCore] = await Promise.all([
      verifyProofCapsule(golden, { subtle }),
      verifyProofCapsule(tampered, { subtle }),
    ]);
    expect(validCore.capsuleId).toBe(invalidCore.capsuleId);

    const receipt = await analyzeProofLineageArchives([tampered, golden], { subtle });
    expect(receipt).toMatchObject({
      analysisComplete: true,
      counts: { capsuleNodes: 1, coreInvalidArtifacts: 1, coreValidArtifacts: 1, uniqueTransports: 2 },
    });
    const invalid = receipt.artifacts.find((artifact) => artifact.coreStatus === "invalid");
    expect(invalid).toMatchObject({ authorKeyId: null, capsuleId: null, coreErrorCodes: ["manifest.member-digest-mismatch"] });
    expect(receipt.nodes).toHaveLength(1);
    expect(receipt.nodes[0]?.capsuleId).toBe(validCore.capsuleId);

    const exported = new TextDecoder().decode(serializeLineageAnalysisReceipt(receipt));
    expect(exported).not.toContain("RUNBOOK-SYNTHETIC-CORPUS-001");
    expect(exported).not.toContain("payload/");
    expect(exported).not.toContain("PRIVATE SENTINEL");
    expect(exported).not.toContain("createdAt");
    expect(exported).not.toContain("experimentId");
    expect(exported.endsWith("\n")).toBe(false);
  });

  it("keeps a parent declaration missing when only an invalid transport with that tentative ID is loaded", async () => {
    const tampered = await corpus("minimal-synthetic-root-payload-tampered.runbook");
    const tentative = await verifyProofCapsule(tampered, { subtle });
    if (tentative.capsuleId === null) throw new Error("fixture must expose its tentative signed-statement ID");
    const child = await capsule({
      id: "ATLAS-INVALID-PARENT-ALIAS",
      key: keyA,
      lineage: { relation: "derived", parents: [tentative.capsuleId] },
      sequence: 11,
    });
    const receipt = await analyzeProofLineageArchives([tampered, child.archiveBytes], { subtle });
    expect(receipt.counts).toMatchObject({ coreInvalidArtifacts: 1, capsuleNodes: 1, missingEdges: 1, resolvedEdges: 0 });
    expect(receipt.edges).toEqual([{
      childCapsuleId: child.capsuleId,
      keyRelationship: "not-evaluated",
      parentCapsuleId: tentative.capsuleId,
      relation: "derived",
      status: "missing",
    }]);
  });

  it("resolves only loaded valid nodes and labels same, different, and unevaluated key relationships exactly", async () => {
    const root = await capsule({ id: "ATLAS-ROOT", key: keyA, lineage: { relation: "root", parents: [] }, sequence: 1 });
    const same = await capsule({ id: "ATLAS-SAME", key: keyA, lineage: { relation: "derived", parents: [root.capsuleId] }, sequence: 2 });
    const different = await capsule({ id: "ATLAS-DIFFERENT", key: keyB, lineage: { relation: "corrects", parents: [root.capsuleId] }, sequence: 3 });
    const missingId = "f".repeat(64);
    const orphan = await capsule({ id: "ATLAS-ORPHAN", key: keyB, lineage: { relation: "supersedes", parents: [missingId] }, sequence: 4 });

    const receipt = await analyzeProofLineageArchives([orphan.archiveBytes, root.archiveBytes, different.archiveBytes, same.archiveBytes], { subtle });
    expect(receipt.counts).toMatchObject({ capsuleNodes: 4, missingEdges: 1, resolvedEdges: 2, keyGroups: 2 });
    expect(receipt.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ childCapsuleId: same.capsuleId, status: "resolved", keyRelationship: "same-self-asserted-key" }),
      expect.objectContaining({ childCapsuleId: different.capsuleId, status: "resolved", keyRelationship: "different-self-asserted-key" }),
      expect.objectContaining({ childCapsuleId: orphan.capsuleId, status: "missing", keyRelationship: "not-evaluated" }),
    ]));
    expect(receipt.findings.warnings).toContainEqual({ childCapsuleId: orphan.capsuleId, code: "lineage.parent-missing", parentCapsuleId: missingId });
  });

  it("is exact-byte invariant to selection order and exact repeats while repeats still consume preflight budget", async () => {
    const root = await capsule({ id: "ATLAS-INVARIANT-ROOT", key: keyA, lineage: { relation: "root", parents: [] }, sequence: 5 });
    const child = await capsule({ id: "ATLAS-INVARIANT-CHILD", key: keyA, lineage: { relation: "derived", parents: [root.capsuleId] }, sequence: 6 });
    const first = await analyzeProofLineageArchives([root.archiveBytes, child.archiveBytes, root.archiveBytes], { subtle });
    const second = await analyzeProofLineageArchives([child.archiveBytes, root.archiveBytes], { subtle });
    expect(serializeLineageAnalysisReceipt(first)).toEqual(serializeLineageAnalysisReceipt(second));
    expect(first.counts.uniqueTransports).toBe(2);
    expect(new TextDecoder().decode(serializeLineageAnalysisReceipt(first))).not.toContain("occurrence");
  });

  it("collapses alternate core-valid transports into one node and emits a transport-alias warning", async () => {
    const root = await capsule({ id: "ATLAS-ALIAS", key: keyA, lineage: { relation: "root", parents: [] }, sequence: 7 });
    const alternate = alternateEnvelopeTransport(root.archiveBytes);
    const alternateCore = await verifyProofCapsule(alternate, { subtle });
    expect(alternateCore).toMatchObject({ valid: true, capsuleId: root.capsuleId, warnings: [{ code: "envelope.ignored-extension" }] });

    const receipt = await analyzeProofLineageArchives([alternate, root.archiveBytes], { subtle });
    expect(receipt.nodes).toHaveLength(1);
    expect(receipt.nodes[0]?.transportSha256).toHaveLength(2);
    expect(receipt.findings.warnings).toContainEqual(expect.objectContaining({ code: "lineage.transport-alias", capsuleId: root.capsuleId }));
  });

  it("copies every batch input before the first digest await", async () => {
    const root = await capsule({ id: "ATLAS-SNAPSHOT", key: keyA, lineage: { relation: "root", parents: [] }, sequence: 8 });
    const expected = await analyzeProofLineageArchives([root.archiveBytes], { subtle });
    const mutable = new Uint8Array(root.archiveBytes);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    const delayed = new Proxy(subtle, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (property === "digest") return async (...args: Parameters<SubtleCrypto["digest"]>) => {
          if (first) { first = false; await gate; }
          return target.digest(...args);
        };
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as SubtleCrypto;
    const analyzing = analyzeProofLineageArchives([mutable], { subtle: delayed });
    mutable.fill(0xff);
    release();
    const actual = await analyzing;
    expect(serializeLineageAnalysisReceipt(actual)).toEqual(serializeLineageAnalysisReceipt(expected));
  });
});

describe("incremental Worker-facing analyzer", () => {
  it("returns same-snapshot archive identity, deduplicates, retains no caller bytes, and finishes once", async () => {
    const golden = await corpus("minimal-synthetic-root.runbook");
    const analyzer = createProofLineageAnalyzer({ subtle });
    const first = await analyzer.addArchive(golden);
    golden.fill(0xff);
    const original = await corpus("minimal-synthetic-root.runbook");
    const duplicate = await analyzer.addArchive(original);
    expect(first).toMatchObject({ duplicate: false });
    expect(duplicate).toEqual({ archiveSha256: first.archiveSha256, duplicate: true });
    const receipt = analyzer.finish();
    expect(receipt.counts).toMatchObject({ uniqueTransports: 1, capsuleNodes: 1 });
    expect(() => analyzer.finish()).toThrow("input.read-failed");
  });

  it("poisons permanently after input or concurrent-use failure and never emits partial evidence", async () => {
    const analyzer = createProofLineageAnalyzer({ subtle });
    await expect(analyzer.addArchive(new Uint8Array())).rejects.toMatchObject({ code: "input.empty" });
    await expect(analyzer.addArchive(new Uint8Array([1]))).rejects.toMatchObject({ code: "input.empty" });
    expect(() => analyzer.finish()).toThrow("input.empty");

    const golden = await corpus("minimal-synthetic-root.runbook");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const delayed = new Proxy(subtle, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (property === "digest") return async (...args: Parameters<SubtleCrypto["digest"]>) => { await gate; return target.digest(...args); };
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as SubtleCrypto;
    const busy = createProofLineageAnalyzer({ subtle: delayed });
    const pending = busy.addArchive(golden);
    await expect(busy.addArchive(golden)).rejects.toMatchObject({ code: "input.read-failed" });
    release();
    await pending;
    expect(() => busy.finish()).toThrow("input.read-failed");
  });
});

describe("graph invariants and strict receipt guard", () => {
  const idA = "a".repeat(64);
  const idB = "b".repeat(64);
  const idC = "c".repeat(64);
  const idD = "d".repeat(64);
  const key = `sha256:${"1".repeat(64)}`;

  it("finds bounded two- and three-node SCCs iteratively while leaving a diamond acyclic", () => {
    const two = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "derived", parents: [idB] }),
      metadata({ archiveSha256: "2".repeat(64), capsuleId: idB, authorKeyId: key, relation: "derived", parents: [idA] }),
    ]);
    expect(two.cycles).toEqual([{ capsuleIds: [idA, idB] }]);
    expect(two.findings.errors).toContainEqual({ capsuleIds: [idA, idB], code: "lineage.cycle" });

    const three = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "derived", parents: [idB] }),
      metadata({ archiveSha256: "2".repeat(64), capsuleId: idB, authorKeyId: key, relation: "derived", parents: [idC] }),
      metadata({ archiveSha256: "3".repeat(64), capsuleId: idC, authorKeyId: key, relation: "derived", parents: [idA] }),
    ]);
    expect(three.cycles).toEqual([{ capsuleIds: [idA, idB, idC] }]);

    const diamond = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "root", parents: [] }),
      metadata({ archiveSha256: "2".repeat(64), capsuleId: idB, authorKeyId: key, relation: "derived", parents: [idA] }),
      metadata({ archiveSha256: "3".repeat(64), capsuleId: idC, authorKeyId: key, relation: "derived", parents: [idA] }),
      metadata({ archiveSha256: "4".repeat(64), capsuleId: idD, authorKeyId: key, relation: "derived", parents: [idB, idC] }),
    ]);
    expect(diamond.cycles).toEqual([]);
    expect(diamond.counts.resolvedEdges).toBe(4);
  });

  it("withholds a defensive identity conflict and does not create its edges", () => {
    const receipt = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "root", parents: [] }),
      metadata({ archiveSha256: "2".repeat(64), capsuleId: idA, authorKeyId: key, relation: "derived", parents: [idB] }),
    ]);
    expect(isLineageAnalysisReceipt(receipt)).toBe(true);
    expect(receipt.nodes).toEqual([]);
    expect(receipt.edges).toEqual([]);
    expect(receipt.findings.errors).toContainEqual({ capsuleId: idA, code: "lineage.identity-conflict" });
    expect(receipt.findings.warnings).toContainEqual(expect.objectContaining({ capsuleId: idA, code: "lineage.transport-alias" }));
  });

  it("rejects cross-layer inconsistent objects even when their outer schema looks plausible", async () => {
    const root = await capsule({ id: "ATLAS-GUARD-ROOT", key: keyA, lineage: { relation: "root", parents: [] }, sequence: 9 });
    const child = await capsule({ id: "ATLAS-GUARD-CHILD", key: keyA, lineage: { relation: "derived", parents: [root.capsuleId] }, sequence: 10 });
    const receipt = await analyzeProofLineageArchives([root.archiveBytes, child.archiveBytes], { subtle });
    expect(isLineageAnalysisReceipt(receipt)).toBe(true);

    const wrongNodeKey = cloneReceipt(receipt);
    ((wrongNodeKey.nodes as Record<string, unknown>[])[0] as Record<string, unknown>).authorKeyId = `sha256:${"9".repeat(64)}`;
    expect(isLineageAnalysisReceipt(wrongNodeKey)).toBe(false);

    const missingEdge = cloneReceipt(receipt);
    (missingEdge.edges as unknown[]).pop();
    expect(isLineageAnalysisReceipt(missingEdge)).toBe(false);

    const wrongEdge = cloneReceipt(receipt);
    ((wrongEdge.edges as Record<string, unknown>[])[0] as Record<string, unknown>).keyRelationship = "different-self-asserted-key";
    expect(isLineageAnalysisReceipt(wrongEdge)).toBe(false);

    const wrongGroup = cloneReceipt(receipt);
    ((wrongGroup.keyGroups as Record<string, unknown>[])[0] as Record<string, unknown>).capsuleIds = [root.capsuleId];
    expect(isLineageAnalysisReceipt(wrongGroup)).toBe(false);

    const extra = cloneReceipt(receipt);
    extra.valid = true;
    expect(isLineageAnalysisReceipt(extra)).toBe(false);
    expect(() => serializeLineageAnalysisReceipt(extra as unknown as LineageAnalysisReceipt)).toThrow("lineage.receipt-schema-invalid");
  });

  it("rejects a cyclic graph whose cycle and matching finding were both suppressed", () => {
    const receipt = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "derived", parents: [idB] }),
      metadata({ archiveSha256: "2".repeat(64), capsuleId: idB, authorKeyId: key, relation: "derived", parents: [idA] }),
    ]);
    const forged = cloneReceipt(receipt);
    forged.cycles = [];
    (forged.findings as Record<string, unknown>).errors = [];
    (forged.counts as Record<string, unknown>).cycleComponents = 0;
    expect(isLineageAnalysisReceipt(forged)).toBe(false);
  });

  it("rejects an extra cycle and finding fabricated over an acyclic graph", () => {
    const receipt = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "root", parents: [] }),
      metadata({ archiveSha256: "2".repeat(64), capsuleId: idB, authorKeyId: key, relation: "derived", parents: [idA] }),
    ]);
    const forged = cloneReceipt(receipt);
    forged.cycles = [{ capsuleIds: [idA, idB] }];
    (forged.findings as Record<string, unknown>).errors = [{ capsuleIds: [idA, idB], code: "lineage.cycle" }];
    (forged.counts as Record<string, unknown>).cycleComponents = 1;
    expect(isLineageAnalysisReceipt(forged)).toBe(false);
  });

  it("rejects relabeling a single valid transport as an identity conflict", () => {
    const receipt = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "root", parents: [] }),
    ]);
    const forged = cloneReceipt(receipt);
    forged.nodes = [];
    forged.keyGroups = [];
    (forged.findings as Record<string, unknown>).errors = [{ capsuleId: idA, code: "lineage.identity-conflict" }];
    Object.assign(forged.counts as Record<string, unknown>, { capsuleNodes: 0, identityConflicts: 1, keyGroups: 0 });
    expect(isLineageAnalysisReceipt(forged)).toBe(false);
  });

  it("rejects an identity conflict backed by two transports that do not disagree", () => {
    const receipt = buildLineageReceipt([
      metadata({ archiveSha256: "1".repeat(64), capsuleId: idA, authorKeyId: key, relation: "root", parents: [] }),
      metadata({ archiveSha256: "2".repeat(64), capsuleId: idA, authorKeyId: key, relation: "root", parents: [] }),
    ]);
    const forged = cloneReceipt(receipt);
    forged.nodes = [];
    forged.keyGroups = [];
    (forged.findings as Record<string, unknown>).errors = [{ capsuleId: idA, code: "lineage.identity-conflict" }];
    Object.assign(forged.counts as Record<string, unknown>, { capsuleNodes: 0, identityConflicts: 1, keyGroups: 0 });
    expect(isLineageAnalysisReceipt(forged)).toBe(false);
  });
});

describe("resource and export boundaries", () => {
  it("rejects empty, count, per-archive, and 128 MiB aggregate failures atomically with stable codes", async () => {
    await expect(analyzeProofLineageArchives([], { subtle })).rejects.toEqual(new LineageAnalysisError("input.empty"));
    await expect(analyzeProofLineageArchives([new Uint8Array()], { subtle })).rejects.toMatchObject({ code: "input.empty" });
    const byte = new Uint8Array([1]);
    await expect(analyzeProofLineageArchives(Array.from({ length: MAX_LINEAGE_ARCHIVES + 1 }, () => byte), { subtle })).rejects.toMatchObject({ code: "input.batch-count-limit" });
    await expect(analyzeProofLineageArchives([new Uint8Array(MAX_LINEAGE_ARCHIVE_BYTES + 1)], { subtle })).rejects.toMatchObject({ code: "input.size-limit" });
    const maximum = new Uint8Array(MAX_LINEAGE_ARCHIVE_BYTES);
    expect(MAX_LINEAGE_BATCH_BYTES).toBe(MAX_LINEAGE_ARCHIVE_BYTES * 2);
    await expect(analyzeProofLineageArchives([maximum, maximum, byte], { subtle })).rejects.toMatchObject({ code: "input.batch-size-limit" });
  });

  it("emits strict, frozen, unsigned JCS and an explicit plain-language correlation warning", async () => {
    const golden = await corpus("minimal-synthetic-root.runbook");
    const receipt = await analyzeProofLineageArchives([golden], { subtle });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.artifacts)).toBe(true);
    expect(Object.isFrozen(receipt.artifacts[0])).toBe(true);
    expect(isLineageAnalysisReceipt(receipt)).toBe(true);
    const jcs = serializeLineageAnalysisReceipt(receipt);
    expect(jcs.byteLength).toBeLessThanOrEqual(1024 * 1024);
    expect(jcs.at(-1)).not.toBe(0x0a);
    expect(new TextDecoder().decode(jcs)).toContain("receipt-is-unsigned-local-analysis");

    const packetBytes = serializeLineageResearchPacket(receipt);
    const packet = new TextDecoder().decode(packetBytes);
    expect(packet).toContain("Status: Unsigned local analysis");
    expect(packet).toContain("This export is metadata-only, but hashes, capsule IDs, self-asserted key IDs, and lineage can still correlate artifacts.");
    expect(packet).not.toContain("payload/");
    expect(packet.endsWith("\n")).toBe(false);
  });
});
