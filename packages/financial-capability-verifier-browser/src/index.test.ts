import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  parseExactJcsCapabilitySnapshotBytes as parseReferenceSnapshot,
} from "../../financial-capability-registry/src/validate.js";
import {
  IndependentVerifierError,
  evaluateAdmissionBytes,
  parseSnapshotBytes,
  recomputeCapabilityDiff,
  serializeAdmissionReceipt,
  serializeCapabilityDiff,
  serializeIndependentVerificationReceipt,
  verifyCapabilityRegistryBundle,
  verifySnapshotBytes,
} from "./index.js";
import { canonicalJcs, sha256Bytes, sha256Text } from "./primitives.js";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const corpusDirectory = resolve(
  packageDirectory,
  "../../financial-capability-registry/conformance/v1",
);

type FileReference = Readonly<{ path: string; sha256: string }>;
type CorpusCase = Readonly<{
  caseId: string;
  evaluatedAtDeclared: string | null;
  expectedCodeCounts: Readonly<Record<string, number>>;
  expectedDisposition: "admit" | "invalid-artifact" | "quarantine" | "reject";
  forbiddenCodes: readonly string[];
  input: Readonly<{
    baselineSnapshot: FileReference | null;
    candidateSnapshot: FileReference | null;
    policy: FileReference | null;
    reviewArtifact: FileReference | null;
    reviewerSpki: FileReference | null;
    targetSnapshot: FileReference | null;
  }>;
  operation: "admit" | "verify-snapshot";
  oracle: FileReference;
  requiredCodes: readonly string[];
  title: string;
}>;
type CorpusManifest = Readonly<{
  cases: readonly CorpusCase[];
  forbiddenOutputUtf8: readonly string[];
}>;

const manifestBytes = new Uint8Array(readFileSync(resolve(corpusDirectory, "manifest.jcs")));
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as CorpusManifest;

const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function own(reference: FileReference): Uint8Array {
  if (!/^cases\/\d{3}\/[a-z0-9.-]+$/.test(reference.path)) {
    throw new Error("test.corpus-path-invalid");
  }
  const absolute = resolve(corpusDirectory, reference.path);
  if (!absolute.startsWith(`${corpusDirectory}${sep}`)) throw new Error("test.corpus-path-invalid");
  const bytes = new Uint8Array(readFileSync(absolute));
  expect(digest(bytes), reference.path).toBe(reference.sha256);
  return bytes;
}

function required(reference: FileReference | null): FileReference {
  if (reference === null) throw new Error("test.corpus-input-missing");
  return reference;
}

function stableValidationCodes(code: string): string[] {
  return code.startsWith("snapshot.") ? [code, "snapshot.invalid"] : [code];
}

function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

async function execute(definition: CorpusCase): Promise<Readonly<{
  codes: readonly string[];
  counts: ReadonlyMap<string, number>;
  disposition: CorpusCase["expectedDisposition"];
  outputBytes: Uint8Array;
}>> {
  if (definition.operation === "verify-snapshot") {
    try {
      verifySnapshotBytes(own(required(definition.input.targetSnapshot)));
      throw new Error("test.snapshot-unexpectedly-valid");
    } catch (error) {
      if (!(error instanceof IndependentVerifierError)) throw error;
      const outputBytes = new TextEncoder().encode(canonicalJcs({
        errorCode: error.code,
        kind: "validation-error",
      }));
      const codes = stableValidationCodes(error.code);
      return {
        codes,
        counts: new Map(codes.map((code) => [code, 1])),
        disposition: "invalid-artifact",
        outputBytes,
      };
    }
  }
  if (definition.evaluatedAtDeclared === null) throw new Error("test.evaluated-at-missing");
  const baselineSnapshotBytes = own(required(definition.input.baselineSnapshot));
  const candidateSnapshotBytes = own(required(definition.input.candidateSnapshot));
  const policyBytes = own(required(definition.input.policy));
  const reviewArtifactBytes = definition.input.reviewArtifact === null
    ? undefined : own(definition.input.reviewArtifact);
  const reviewerSpkiBytes = definition.input.reviewerSpki === null
    ? undefined : own(definition.input.reviewerSpki);
  const receipt = await evaluateAdmissionBytes({
    baselineSnapshotBytes,
    candidateSnapshotBytes,
    evaluatedAtDeclared: definition.evaluatedAtDeclared,
    policyBytes,
    ...(reviewArtifactBytes === undefined || reviewerSpkiBytes === undefined
      ? {} : { reviewArtifactBytes, reviewerSpkiBytes }),
  });
  const counts = new Map<string, number>();
  for (const check of receipt.checks.filter((entry) => !entry.passed)) {
    counts.set(check.code, (counts.get(check.code) ?? 0) + 1);
  }
  try {
    const diff = recomputeCapabilityDiff(
      parseSnapshotBytes(baselineSnapshotBytes),
      parseSnapshotBytes(candidateSnapshotBytes),
    );
    for (const change of [...diff.changes, ...diff.sourceChanges]) {
      for (const code of change.findingCodes) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  } catch (error) {
    if (!(error instanceof IndependentVerifierError)) throw error;
    counts.set(error.code, (counts.get(error.code) ?? 0) + 1);
  }
  return {
    codes: [...counts.keys()].sort(),
    counts,
    disposition: receipt.outcome,
    outputBytes: serializeAdmissionReceipt(receipt),
  };
}

describe("independent financial capability browser verifier", () => {
  it("implements independent exact-JCS and SHA-256 primitives", () => {
    expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(canonicalJcs({ z: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"z":1}');
  });

  it("reproduces all 50 normative oracles plus the append-only provider-lineage oracle", async () => {
    expect(manifest.cases).toHaveLength(51);
    for (const definition of manifest.cases) {
      const first = await execute(definition);
      const second = await execute(definition);
      const oracle = own(definition.oracle);
      expect(first.disposition, definition.caseId).toBe(definition.expectedDisposition);
      expect(first.outputBytes, definition.caseId).toEqual(oracle);
      expect(second.outputBytes, `${definition.caseId}:repeat`).toEqual(oracle);
      expect(first.outputBytes.at(-1), definition.caseId).not.toBe(0x0a);
      for (const code of definition.requiredCodes) {
        expect(first.codes, `${definition.caseId}:${code}`).toContain(code);
      }
      for (const [code, count] of Object.entries(definition.expectedCodeCounts)) {
        expect(first.counts.get(code), `${definition.caseId}:${code}`).toBe(count);
      }
      for (const code of definition.forbiddenCodes) {
        expect(first.codes, `${definition.caseId}:${code}`).not.toContain(code);
      }
    }
  });

  it("rejects caller-supplied self-consistent artifact substitutions", async () => {
    const definition = manifest.cases.find((entry) => entry.caseId === "022");
    if (definition === undefined || definition.evaluatedAtDeclared === null) throw new Error("test.case-missing");
    const baselineSnapshotBytes = own(required(definition.input.baselineSnapshot));
    const candidateSnapshotBytes = own(required(definition.input.candidateSnapshot));
    const policyBytes = own(required(definition.input.policy));
    const admission = await evaluateAdmissionBytes({
      baselineSnapshotBytes,
      candidateSnapshotBytes,
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes,
    });
    const diff = recomputeCapabilityDiff(
      parseSnapshotBytes(baselineSnapshotBytes),
      parseSnapshotBytes(candidateSnapshotBytes),
    );
    const valid = await verifyCapabilityRegistryBundle({
      baselineSnapshotBytes,
      candidateSnapshotBytes,
      claimedAdmissionReceiptBytes: serializeAdmissionReceipt(admission),
      claimedDiffBytes: serializeCapabilityDiff(diff),
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes,
    });
    expect(valid.recomputationComplete).toBe(true);
    expect(valid.claimedDiffMatches).toBe(true);
    expect(valid.claimedAdmissionReceiptMatches).toBe(true);

    const forged = JSON.parse(new TextDecoder().decode(serializeAdmissionReceipt(admission))) as Record<string, unknown>;
    forged.outcome = "admit";
    const substituted = await verifyCapabilityRegistryBundle({
      baselineSnapshotBytes,
      candidateSnapshotBytes,
      claimedAdmissionReceiptBytes: new TextEncoder().encode(canonicalJcs(forged)),
      claimedDiffBytes: serializeCapabilityDiff(diff),
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes,
    });
    expect(substituted.recomputationComplete).toBe(false);
    expect(substituted.claimedAdmissionReceiptMatches).toBe(false);
    expect(substituted.codes).toContain("claimed-admission-receipt-mismatch");
  });

  it("preserves the exact public rejection receipt when semantic diffing is unavailable", async () => {
    const definition = manifest.cases.find((entry) => entry.caseId === "011");
    if (definition === undefined || definition.evaluatedAtDeclared === null) throw new Error("test.case-missing");
    const oracle = own(definition.oracle);
    const receipt = await verifyCapabilityRegistryBundle({
      baselineSnapshotBytes: own(required(definition.input.baselineSnapshot)),
      candidateSnapshotBytes: own(required(definition.input.candidateSnapshot)),
      claimedAdmissionReceiptBytes: oracle,
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes: own(required(definition.input.policy)),
    });
    expect(receipt.admissionOutcome).toBe("reject");
    expect(receipt.claimedAdmissionReceiptMatches).toBe(true);
    expect(receipt.recomputedAdmissionReceiptSha256).toBe(sha256Bytes(oracle));
    expect(receipt.recomputedDiffSha256).toBeNull();
    expect(receipt.codes).toContain("registry-provider-mismatch");
    expect(receipt.recomputationComplete).toBe(true);
  });

  it("returns bounded failure receipts for malformed claimed artifacts", async () => {
    const definition = manifest.cases.find((entry) => entry.caseId === "022");
    if (definition === undefined || definition.evaluatedAtDeclared === null) throw new Error("test.case-missing");
    const base = {
      baselineSnapshotBytes: own(required(definition.input.baselineSnapshot)),
      candidateSnapshotBytes: own(required(definition.input.candidateSnapshot)),
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes: own(required(definition.input.policy)),
    };
    const malformedDiff = await verifyCapabilityRegistryBundle({
      ...base,
      claimedDiffBytes: new TextEncoder().encode("{{"),
    });
    expect(malformedDiff.admissionOutcome).toBe("quarantine");
    expect(malformedDiff.claimedDiffMatches).toBe(false);
    expect(malformedDiff.recomputationComplete).toBe(false);
    expect(malformedDiff.codes).toContain("claimed-diff.bytes-invalid-json");

    const noncanonicalAdmission = await verifyCapabilityRegistryBundle({
      ...base,
      claimedAdmissionReceiptBytes: new TextEncoder().encode('{"x": 1}'),
    });
    expect(noncanonicalAdmission.admissionOutcome).toBe("quarantine");
    expect(noncanonicalAdmission.claimedAdmissionReceiptMatches).toBe(false);
    expect(noncanonicalAdmission.recomputationComplete).toBe(false);
    expect(noncanonicalAdmission.codes).toContain(
      "claimed-admission-receipt.bytes-noncanonical",
    );
  });

  it("rejects every oversized input before cloning it", async () => {
    const definition = manifest.cases.find((entry) => entry.caseId === "022");
    if (definition === undefined || definition.evaluatedAtDeclared === null) throw new Error("test.case-missing");
    const base = {
      baselineSnapshotBytes: own(required(definition.input.baselineSnapshot)),
      candidateSnapshotBytes: own(required(definition.input.candidateSnapshot)),
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes: own(required(definition.input.policy)),
    };
    const cases: readonly Readonly<{
      code: string;
      input: Parameters<typeof verifyCapabilityRegistryBundle>[0];
    }>[] = [
      { code: "snapshot.bytes-invalid", input: { ...base, baselineSnapshotBytes: new Uint8Array(4 * 1024 * 1024 + 1) } },
      { code: "snapshot.bytes-invalid", input: { ...base, candidateSnapshotBytes: new Uint8Array(4 * 1024 * 1024 + 1) } },
      { code: "policy.bytes-invalid", input: { ...base, policyBytes: new Uint8Array(64 * 1024 + 1) } },
      { code: "review-artifact.bytes-invalid", input: { ...base, reviewArtifactBytes: new Uint8Array(320 * 1024 + 1) } },
      { code: "review-key-invalid", input: { ...base, reviewerSpkiBytes: new Uint8Array(1_025) } },
      { code: "claimed-diff.bytes-invalid", input: { ...base, claimedDiffBytes: new Uint8Array(2 * 1024 * 1024 + 1) } },
      { code: "claimed-admission-receipt.bytes-invalid", input: { ...base, claimedAdmissionReceiptBytes: new Uint8Array(256 * 1024 + 1) } },
    ];
    for (const testCase of cases) {
      await expect(verifyCapabilityRegistryBundle(testCase.input)).rejects.toMatchObject({
        code: testCase.code,
      });
    }
  });

  it("owns caller buffers before an asynchronous verifier boundary", async () => {
    const definition = manifest.cases.find((entry) => entry.caseId === "022");
    if (definition === undefined || definition.evaluatedAtDeclared === null) throw new Error("test.case-missing");
    const baselineSnapshotBytes = own(required(definition.input.baselineSnapshot));
    const candidateSnapshotBytes = own(required(definition.input.candidateSnapshot));
    const policyBytes = own(required(definition.input.policy));
    const admissionBytes = serializeAdmissionReceipt(await evaluateAdmissionBytes({
      baselineSnapshotBytes,
      candidateSnapshotBytes,
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes,
    }));
    const pending = verifyCapabilityRegistryBundle({
      baselineSnapshotBytes,
      candidateSnapshotBytes,
      claimedAdmissionReceiptBytes: admissionBytes,
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes,
    });
    admissionBytes.fill(0x78);
    candidateSnapshotBytes.fill(0x78);
    const receipt = await pending;
    expect(receipt.recomputationComplete).toBe(true);
    expect(receipt.claimedAdmissionReceiptMatches).toBe(true);
  });

  it("has zero exact-code disagreements across 5,000 deterministic byte mutations", () => {
    const seedCase = manifest.cases.find((entry) => entry.caseId === "022");
    if (seedCase === undefined) throw new Error("test.case-missing");
    const seed = own(required(seedCase.input.baselineSnapshot));
    let state = 0x5f37_59df;
    const random = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const result = (parse: (bytes: Uint8Array) => unknown, bytes: Uint8Array): string => {
      try { return `valid:${canonicalJcs(parse(bytes))}`; }
      catch (error) {
        if (typeof error === "object" && error !== null && "code" in error &&
          typeof (error as { code?: unknown }).code === "string") {
          return (error as { code: string }).code;
        }
        throw error;
      }
    };
    expect(result(parseSnapshotBytes, seed)).toBe(result(parseReferenceSnapshot, seed));
    for (let iteration = 0; iteration < 5_000; iteration += 1) {
      const candidate = new Uint8Array(seed);
      const mutations = 1 + (random() % 3);
      for (let count = 0; count < mutations; count += 1) {
        const index = random() % candidate.byteLength;
        candidate[index] = (candidate[index] ?? 0) ^ (1 << (random() % 8));
      }
      expect(
        result(parseSnapshotBytes, candidate),
        `mutation:${iteration}`,
      ).toBe(result(parseReferenceSnapshot, candidate));
    }
  }, 30_000);

  it("performs no network request during exact-byte replay", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network forbidden")));
    vi.stubGlobal("fetch", fetchSpy);
    const definition = manifest.cases.find((entry) => entry.caseId === "022");
    if (definition === undefined || definition.evaluatedAtDeclared === null) throw new Error("test.case-missing");
    await verifyCapabilityRegistryBundle({
      baselineSnapshotBytes: own(required(definition.input.baselineSnapshot)),
      candidateSnapshotBytes: own(required(definition.input.candidateSnapshot)),
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes: own(required(definition.input.policy)),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("emits deterministic digest-only receipts with non-vacuous privacy canaries", async () => {
    const definition = manifest.cases.find((entry) => entry.caseId === "050");
    if (definition === undefined || definition.evaluatedAtDeclared === null) throw new Error("test.case-missing");
    const reviewArtifactBytes = own(required(definition.input.reviewArtifact));
    const reviewerSpkiBytes = own(required(definition.input.reviewerSpki));
    const input = {
      baselineSnapshotBytes: own(required(definition.input.baselineSnapshot)),
      candidateSnapshotBytes: own(required(definition.input.candidateSnapshot)),
      evaluatedAtDeclared: definition.evaluatedAtDeclared,
      policyBytes: own(required(definition.input.policy)),
      reviewArtifactBytes,
      reviewerSpkiBytes,
    };
    const first = serializeIndependentVerificationReceipt(await verifyCapabilityRegistryBundle(input));
    const second = serializeIndependentVerificationReceipt(await verifyCapabilityRegistryBundle(input));
    expect(first).toEqual(second);
    expect(first.at(-1)).not.toBe(0x0a);
    const sourceBytes = [
      input.baselineSnapshotBytes,
      input.candidateSnapshotBytes,
      input.policyBytes,
      reviewArtifactBytes,
    ];
    const activeCanaries = manifest.forbiddenOutputUtf8.filter((canary) => {
      const needle = new TextEncoder().encode(canary);
      return sourceBytes.some((source) => bytesContain(source, needle));
    });
    expect(activeCanaries.length).toBeGreaterThanOrEqual(3);
    for (const canary of activeCanaries) {
      expect(bytesContain(first, new TextEncoder().encode(canary)), canary).toBe(false);
    }
    const review = JSON.parse(new TextDecoder().decode(reviewArtifactBytes)) as {
      signatureBase64: string;
    };
    expect(review.signatureBase64.length).toBe(88);
    expect(bytesContain(first, new TextEncoder().encode(review.signatureBase64))).toBe(false);
    expect(bytesContain(first, reviewerSpkiBytes)).toBe(false);
    expect(sha256Bytes(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("contains no Node runtime, filesystem, transport, or mutation imports", () => {
    const runtimeFiles = readdirSync(packageDirectory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const source = runtimeFiles.map((name) => readFileSync(resolve(packageDirectory, name), "utf8")).join("\n");
    for (const forbidden of ["node:", "require(", "fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "Buffer.", "@runbook/financial-capability-registry"] as const) {
      expect(source).not.toContain(forbidden);
    }
  });
});
