import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateCapabilityAdmission } from "./admission.js";
import { canonicalizeJcs, sha256Jcs } from "./canonical.js";
import { buildCapabilityDiff } from "./diff.js";
import { parseStrictJson } from "./strict-json.js";
import type { AdmissionReceiptV1, CapabilityDiffV1 } from "./types.js";
import {
  RegistryValidationError,
  parseExactJcsCapabilitySnapshotBytes,
} from "./validate.js";

const corpusDir = fileURLToPath(new URL("../conformance/v1/", import.meta.url));
const manifestBytes = readFileSync(resolve(corpusDir, "manifest.jcs"));
const manifest = parseStrictJson(manifestBytes) as ConformanceManifest;

type FileReference = Readonly<{ path: string; sha256: string }>;
type CaseInput = Readonly<{
  baselineSnapshot: FileReference | null;
  candidateSnapshot: FileReference | null;
  policy: FileReference | null;
  reviewArtifact: FileReference | null;
  reviewerSpki: FileReference | null;
  targetSnapshot: FileReference | null;
}>;
type ConformanceCase = Readonly<{
  caseId: string;
  evaluatedAtDeclared: string | null;
  expectedCodeCounts: Readonly<Record<string, number>>;
  expectedDisposition: "admit" | "invalid-artifact" | "quarantine" | "reject";
  forbiddenCodes: readonly string[];
  input: CaseInput;
  operation: "admit" | "verify-snapshot";
  oracle: FileReference;
  requiredCodes: readonly string[];
  title: string;
}>;
type ConformanceManifest = Readonly<{
  cases: readonly ConformanceCase[];
  forbiddenOutputUtf8: readonly string[];
  profileVersion: string;
  schemaVersion: string;
}>;

type Execution = Readonly<{
  codes: readonly string[];
  codeCounts: ReadonlyMap<string, number>;
  disposition: ConformanceCase["expectedDisposition"];
  outputBytes: Uint8Array;
}>;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function ownFile(reference: FileReference): Uint8Array {
  if (!/^cases\/\d{3}\/[a-z0-9.-]+$/.test(reference.path)) {
    throw new Error("conformance.path-invalid");
  }
  const absolute = resolve(corpusDir, reference.path);
  if (!absolute.startsWith(`${resolve(corpusDir)}${sep}`)) {
    throw new Error("conformance.path-invalid");
  }
  const value = new Uint8Array(readFileSync(absolute));
  expect(sha256(value), reference.path).toBe(reference.sha256);
  return value;
}

function required(reference: FileReference | null, name: string): FileReference {
  if (reference === null) throw new Error(`conformance.${name}-missing`);
  return reference;
}

function addFindingCodes(diff: CapabilityDiffV1, counts: Map<string, number>): void {
  for (const change of [...diff.changes, ...diff.sourceChanges]) {
    for (const code of change.findingCodes) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
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

function relativeFiles(root: string, current = root): string[] {
  return readdirSync(current).flatMap((name) => {
    const absolute = resolve(current, name);
    return statSync(absolute).isDirectory()
      ? relativeFiles(root, absolute)
      : [absolute.slice(root.length + 1)];
  }).sort();
}

function stableValidationCodes(errorCode: string): string[] {
  return errorCode.startsWith("snapshot.")
    ? [errorCode, "snapshot.invalid"]
    : [errorCode];
}

async function execute(definition: ConformanceCase): Promise<Execution> {
  if (definition.operation === "verify-snapshot") {
    const target = ownFile(required(definition.input.targetSnapshot, "target-snapshot"));
    try {
      parseExactJcsCapabilitySnapshotBytes(target);
    } catch (error) {
      if (!(error instanceof RegistryValidationError)) throw error;
      const outputBytes = new TextEncoder().encode(canonicalizeJcs({
        errorCode: error.code,
        kind: "validation-error",
      }));
      const codes = stableValidationCodes(error.code);
      return {
        codeCounts: new Map(codes.map((code) => [code, 1])),
        codes,
        disposition: "invalid-artifact",
        outputBytes,
      };
    }
    throw new Error(`conformance.${definition.caseId}-unexpectedly-valid`);
  }

  const baselineSnapshotBytes = ownFile(required(
    definition.input.baselineSnapshot,
    "baseline-snapshot",
  ));
  const candidateSnapshotBytes = ownFile(required(
    definition.input.candidateSnapshot,
    "candidate-snapshot",
  ));
  const policyBytes = ownFile(required(definition.input.policy, "policy"));
  const reviewArtifactBytes = definition.input.reviewArtifact === null
    ? undefined
    : ownFile(definition.input.reviewArtifact);
  const reviewerSpki = definition.input.reviewerSpki === null
    ? undefined
    : ownFile(definition.input.reviewerSpki);
  if (definition.evaluatedAtDeclared === null) {
    throw new Error("conformance.evaluated-at-missing");
  }
  const receipt = await evaluateCapabilityAdmission({
    baselineSnapshotBytes,
    candidateSnapshotBytes,
    evaluatedAtDeclared: definition.evaluatedAtDeclared,
    policyBytes,
    ...(reviewArtifactBytes === undefined || reviewerSpki === undefined
      ? {}
      : { reviewArtifactBytes, reviewerSpki }),
  });
  const counts = new Map<string, number>();
  for (const check of receipt.checks.filter((entry) => !entry.passed)) {
    counts.set(check.code, (counts.get(check.code) ?? 0) + 1);
  }
  try {
    const baseline = parseExactJcsCapabilitySnapshotBytes(baselineSnapshotBytes);
    const candidate = parseExactJcsCapabilitySnapshotBytes(candidateSnapshotBytes);
    addFindingCodes(buildCapabilityDiff(baseline, candidate), counts);
  } catch (error) {
    if (!(error instanceof RegistryValidationError)) throw error;
    counts.set(error.code, (counts.get(error.code) ?? 0) + 1);
  }
  return {
    codeCounts: counts,
    codes: [...counts.keys()].sort(),
    disposition: receipt.outcome,
    outputBytes: new TextEncoder().encode(canonicalizeJcs(receipt)),
  };
}

describe("Financial Capability Registry V1 hostile conformance corpus", () => {
  it("freezes every normative row plus the append-only lineage case", () => {
    expect(canonicalizeJcs(manifest)).toBe(new TextDecoder().decode(manifestBytes));
    expect(manifestBytes.at(-1)).not.toBe(0x0a);
    expect(manifest.schemaVersion).toBe(
      "runbook.financial-capability-conformance-manifest.v1",
    );
    expect(manifest.cases).toHaveLength(51);
    expect(manifest.cases.map((entry) => entry.caseId)).toEqual(
      Array.from({ length: 51 }, (_, index) => String(index + 1).padStart(3, "0")),
    );
    expect(new Set(manifest.cases.map((entry) => entry.title)).size).toBe(51);

    for (const definition of manifest.cases) {
      const references = [
        ...Object.values(definition.input),
        definition.oracle,
      ].filter((entry): entry is FileReference => entry !== null);
      for (const reference of references) {
        const value = ownFile(reference);
        if (reference.path.endsWith(".jcs")) expect(value.at(-1)).not.toBe(0x0a);
      }
    }
  });

  it("regenerates exactly from declarative authority with no implementation import", () => {
    const generator = fileURLToPath(new URL(
      "../scripts/build-conformance-fixtures.mjs",
      import.meta.url,
    ));
    const source = readFileSync(generator, "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((specifier) => specifier?.startsWith("node:"))).toBe(true);
    expect(source).not.toMatch(
      /evaluateCapabilityAdmission|evaluateAdmissionBytes|recomputeCapabilityDiff|buildCapabilityDiff|verifySnapshotBytes/,
    );

    for (const name of ["oracle-declarations.jcs", "review-declarations.jcs"]) {
      const declaration = readFileSync(resolve(corpusDir, name));
      expect(declaration.at(-1), name).not.toBe(0x0a);
      expect(canonicalizeJcs(parseStrictJson(declaration)), name).toBe(
        new TextDecoder().decode(declaration),
      );
    }

    const generated = mkdtempSync(resolve(tmpdir(), "runbook-registry-conformance-"));
    try {
      execFileSync(process.execPath, [generator, generated], {
        cwd: dirname(generator),
        stdio: "pipe",
      });
      const expectedRoot = resolve(corpusDir, "cases");
      const generatedRoot = resolve(generated, "cases");
      const expectedFiles = relativeFiles(expectedRoot);
      expect(relativeFiles(generatedRoot)).toEqual(expectedFiles);
      for (const relative of expectedFiles) {
        expect(
          readFileSync(resolve(generatedRoot, relative)),
          relative,
        ).toEqual(readFileSync(resolve(expectedRoot, relative)));
      }
      expect(readFileSync(resolve(generated, "manifest.jcs"))).toEqual(manifestBytes);
    } finally {
      rmSync(generated, { force: true, recursive: true });
    }
  }, 15_000);

  it("reproduces all 50 normative oracles and the append-only lineage oracle", async () => {
    for (const definition of manifest.cases) {
      const first = await execute(definition);
      const second = await execute(definition);
      const oracle = ownFile(definition.oracle);
      expect(first.disposition, definition.caseId).toBe(definition.expectedDisposition);
      expect(first.outputBytes, definition.caseId).toEqual(oracle);
      expect(second.outputBytes, `${definition.caseId}:repeat`).toEqual(oracle);
      expect(first.outputBytes.at(-1), definition.caseId).not.toBe(0x0a);
      for (const code of definition.requiredCodes) {
        expect(first.codes, `${definition.caseId}:${code}`).toContain(code);
      }
      for (const [code, count] of Object.entries(definition.expectedCodeCounts)) {
        expect(first.codeCounts.get(code), `${definition.caseId}:${code}`).toBe(count);
      }
      for (const code of definition.forbiddenCodes) {
        expect(first.codes, `${definition.caseId}:${code}`).not.toContain(code);
      }
      if (definition.caseId === "050") {
        const receipt = JSON.parse(new TextDecoder().decode(first.outputBytes)) as AdmissionReceiptV1;
        const candidate = ownFile(required(
          definition.input.candidateSnapshot,
          "candidate-snapshot",
        ));
        expect(receipt.outcome).toBe("admit");
        expect(receipt.checks.every((check) => check.passed)).toBe(true);
        expect(receipt.candidateSnapshotSha256).toBe(sha256(candidate));
      }
    }
  });

  it("keeps portable outputs free of names, URLs, canaries, key, and signature bytes", async () => {
    const inputFiles = new Map<string, Uint8Array>();
    for (const definition of manifest.cases) {
      for (const reference of Object.values(definition.input)) {
        if (reference !== null) inputFiles.set(reference.path, ownFile(reference));
      }
    }
    for (const forbidden of manifest.forbiddenOutputUtf8) {
      const canary = new TextEncoder().encode(forbidden);
      expect(
        [...inputFiles.values()].some((value) => bytesContain(value, canary)),
        `input-canary:${forbidden}`,
      ).toBe(true);
    }

    for (const definition of manifest.cases) {
      const execution = await execute(definition);
      const output = new TextDecoder().decode(execution.outputBytes);
      for (const forbidden of manifest.forbiddenOutputUtf8) {
        expect(output, `${definition.caseId}:${forbidden}`).not.toContain(forbidden);
      }
      if (definition.input.reviewerSpki !== null) {
        const spki = ownFile(definition.input.reviewerSpki);
        expect(bytesContain(execution.outputBytes, spki), definition.caseId).toBe(false);
        expect(output, definition.caseId).not.toContain(
          Buffer.from(spki).toString("base64"),
        );
      }
      if (definition.input.reviewArtifact !== null) {
        const artifact = JSON.parse(new TextDecoder().decode(
          ownFile(definition.input.reviewArtifact),
        )) as { signatureBase64: string };
        const signature = Buffer.from(artifact.signatureBase64, "base64");
        expect(output, definition.caseId).not.toContain(artifact.signatureBase64);
        expect(bytesContain(execution.outputBytes, signature), definition.caseId).toBe(false);
      }
    }
  });

  it("retains the exact no-change control and publishes no composite score", async () => {
    const firstAdmission = manifest.cases.find((entry) => entry.operation === "admit");
    if (firstAdmission === undefined) throw new Error("conformance.admission-case-missing");
    const baselineBytes = ownFile(required(
      firstAdmission.input.baselineSnapshot,
      "baseline-snapshot",
    ));
    const policyBytes = ownFile(required(firstAdmission.input.policy, "policy"));
    const receipt: AdmissionReceiptV1 = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: baselineBytes,
      candidateSnapshotBytes: baselineBytes,
      evaluatedAtDeclared: "2026-07-22T09:00:00Z",
      policyBytes,
    });
    expect(receipt.outcome).toBe("no-change");
    expect(receipt.baselineSnapshotSha256).toBe(sha256Jcs(
      parseExactJcsCapabilitySnapshotBytes(baselineBytes),
    ));
    expect(receipt.candidateSnapshotSha256).toBe(receipt.baselineSnapshotSha256);
    expect(canonicalizeJcs(manifest)).not.toMatch(/(?:safety|risk|composite)Score/i);
  });
});
