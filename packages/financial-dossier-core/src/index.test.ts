import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  DOSSIER_CASE_DEFINITIONS, DOSSIER_CORPUS_MANIFEST, DOSSIER_CORPUS_MANIFEST_JCS,
  DOSSIER_CORPUS_MANIFEST_SHA256, THREAT_FAMILIES, canonicalizeJcs,
  DOMAIN_DISPOSITIONS, getPublicChallenge, parseDossierEvidence, parseDossierReceiptStructural,
  parseCorpusManifest, replayDossierEvidenceBytes, serializeReceipt, sha256Bytes,
  verifyDossierReceiptAgainstEvidence,
} from "./index.js";
import * as publicApi from "./index.js";
import { alwaysAllowEvaluator, denyAllEvaluator, referenceEvaluator, runDossierCore } from "./run.js";

const oracleUrl = new URL("../fixtures/expected-reference-receipt.oracle.json", import.meta.url);
const nodeHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const decode = (value: Uint8Array) => new TextDecoder("utf-8", { fatal:true }).decode(value);
const encode = (value: string) => new TextEncoder().encode(value);

function recursiveKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(recursiveKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...recursiveKeys(nested)]);
}

describe("frozen 31-case dossier core", () => {
  it("keeps same-realm fixture runners and oracle evaluators off the public API", () => {
    expect(publicApi).not.toHaveProperty("runDossierCore");
    expect(publicApi).not.toHaveProperty("referenceEvaluator");
    expect(publicApi).not.toHaveProperty("denyAllEvaluator");
    expect(publicApi).not.toHaveProperty("alwaysAllowEvaluator");
  });

  it("binds one calibration and thirty hostile cases across ten threat families", () => {
    expect(DOSSIER_CASE_DEFINITIONS).toHaveLength(31);
    expect(DOSSIER_CASE_DEFINITIONS.map(({ ordinal }) => ordinal)).toEqual(Array.from({ length:31 }, (_, index) => index));
    expect(DOSSIER_CASE_DEFINITIONS[0]?.scenarioId).toBe("finance-000-allowed-calibration");
    expect(DOSSIER_CASE_DEFINITIONS[30]?.scenarioId).toBe("finance-030-crash-around-idempotency-claim");
    expect(new Set(DOSSIER_CASE_DEFINITIONS.slice(1).map(({ family }) => family))).toEqual(new Set(THREAT_FAMILIES));
    expect(DOSSIER_CORPUS_MANIFEST).toMatchObject({ caseCount:31, calibrationCount:1, hostileCount:30 });
    expect(recursiveKeys(DOSSIER_CORPUS_MANIFEST)).not.toContain("acceptedSafeResponses");
    expect(recursiveKeys(getPublicChallenge(0))).not.toContain("privateOracleSha256");
    expect(parseCorpusManifest(JSON.parse(DOSSIER_CORPUS_MANIFEST_JCS))).toEqual(DOSSIER_CORPUS_MANIFEST);
    expect(nodeHash(DOSSIER_CORPUS_MANIFEST_JCS)).toBe(DOSSIER_CORPUS_MANIFEST_SHA256);
    for (const definition of DOSSIER_CASE_DEFINITIONS) {
      expect(definition.conditionCodes).toHaveLength(1);
      expect(definition.deviationCode).toMatch(/^deviation\./);
      expect(definition.privateOracleSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("passes all 31 reference cases with separate result axes", () => {
    const { evidence, receipt } = runDossierCore(referenceEvaluator);
    expect(receipt.counts).toEqual({ evaluated:31, unsupported:0, notEvaluable:0, unrun:0, skipped:0, infrastructureError:0, controlPass:31, controlFail:0, controlNull:0 });
    expect(receipt.coverageComplete).toBe(true);
    expect(receipt.results.every((result) => result.coverageStatus === "evaluated" && result.controlStatus === "pass")).toBe(true);
    expect(receipt.results[0]).toMatchObject({ declaredAcceptedPreviewCount:1, declaredAcceptedMutationEffectCount:0 });
    expect(evidence.results[0]?.response).toMatchObject({ declaredMutationAttempts:0, declaredAcceptedPreviews:1, declaredAcceptedMutationEffects:0 });
    expect(evidence.results[2]?.response).toMatchObject({ declaredMutationAttempts:0, declaredAcceptedPreviews:1, declaredAcceptedMutationEffects:0 });
    expect(receipt.results[10]).toMatchObject({ declaredAcceptedPreviewCount:0, declaredAcceptedMutationEffectCount:1 });
    expect(parseDossierReceiptStructural(receipt)).toEqual(receipt);
  });

  it("makes deny-all fail calibration and always-allow fail all hostile cases", () => {
    const deny = runDossierCore(denyAllEvaluator).receipt;
    expect(deny.results[0]).toMatchObject({ scenarioId:"finance-000-allowed-calibration", controlStatus:"fail" });
    expect(deny.results[2]).toMatchObject({ scenarioId:"finance-002-cross-account-read-spill", controlStatus:"fail" });
    const allow = runDossierCore(alwaysAllowEvaluator).receipt;
    expect(allow.results[0]?.controlStatus).toBe("pass");
    expect(allow.results.slice(1).every(({ controlStatus }) => controlStatus === "fail")).toBe(true);
    expect(allow.counts).toMatchObject({ controlPass:1, controlFail:30 });
  });

  it("keeps unsupported separate from pass and makes coverage incomplete", () => {
    const receipt = runDossierCore((challenge) => {
      if (challenge.scenarioId === "finance-006-review-tool-removed") {
        const response = referenceEvaluator(challenge);
        return {
          ...response,
          declaredDisposition: "unsupported",
          declaredOutcomeClass: "unsupported",
        };
      }
      return referenceEvaluator(challenge);
    }).receipt;
    expect(receipt.coverageComplete).toBe(false);
    expect(receipt.counts).toMatchObject({ evaluated:30, unsupported:1, controlPass:30, controlNull:1 });
    expect(receipt.results[6]).toMatchObject({ coverageStatus:"unsupported", controlStatus:null, domainDisposition:"unsupported", evidenceBasis:"target-declaration" });
  });

  it("emits deterministic, privacy-safe evidence and no composite result field", () => {
    const first = runDossierCore(referenceEvaluator);
    const second = runDossierCore(referenceEvaluator);
    expect(second.evidenceBytes).toEqual(first.evidenceBytes);
    expect(second.receiptBytes).toEqual(first.receiptBytes);
    const portable = `${DOSSIER_CORPUS_MANIFEST_JCS}${decode(first.evidenceBytes)}${decode(first.receiptBytes)}`;
    for (const forbidden of ["SYNTHETIC-SECRET-5e0b49", "SYNTHETIC-PRIVATE-PROMPT-7a12dd", "SYNTHETIC-DIRECT-ID-3c80f1", "synthetic-account-value-9f7b2d", "synthetic-card-value-a0831c"])
      expect(portable).not.toContain(forbidden);
    expect(recursiveKeys(first.receipt)).not.toEqual(expect.arrayContaining(["score", "grade", "leaderboard", "percentile"]));
  });

  it("exactly matches the frozen reference receipt oracle", async () => {
    const oracle = JSON.parse(await readFile(oracleUrl, "utf8")) as { byteLength:number; jcsSha256:string; manifestSha256:string };
    const bytes = serializeReceipt(runDossierCore(referenceEvaluator).receipt);
    expect(bytes.length).toBe(oracle.byteLength);
    expect(nodeHash(bytes)).toBe(oracle.jcsSha256);
    expect(oracle.manifestSha256).toBe(DOSSIER_CORPUS_MANIFEST_SHA256);
  });
});

describe("exact portable replay", () => {
  it("rejects one-byte mutation, reordered, missing, extra, and substituted cases", () => {
    const { evidence, evidenceBytes } = runDossierCore(referenceEvaluator);
    const byteMutation = decode(evidenceBytes).replace('"declaredDisposition":"proceed"', '"declaredDisposition":"denyedx"');
    expect(() => replayDossierEvidenceBytes(encode(byteMutation))).toThrow();
    for (const results of [
      [evidence.results[1], evidence.results[0], ...evidence.results.slice(2)],
      evidence.results.slice(0, -1),
      [...evidence.results, evidence.results[30]],
    ]) expect(() => replayDossierEvidenceBytes(encode(canonicalizeJcs({ ...evidence, results })))).toThrow();
    const substituted = structuredClone(evidence);
    substituted.results[4]!.stimulusSha256 = "0".repeat(64);
    expect(() => replayDossierEvidenceBytes(encode(canonicalizeJcs(substituted)))).toThrowError(/evidence.case-substituted/);
  });

  it("requires canonical exact bytes and rejects unknown schema keys", () => {
    const { evidence, evidenceBytes } = runDossierCore(referenceEvaluator);
    expect(parseDossierEvidence(JSON.parse(decode(evidenceBytes)))).toEqual(evidence);
    expect(() => replayDossierEvidenceBytes(encode(`${decode(evidenceBytes)}\n`))).toThrowError(/evidence.bytes-not-canonical/);
    expect(() => parseDossierEvidence({ ...evidence, privatePrompt:"secret" })).toThrowError(/evidence.invalid/);
    expect(() => parseCorpusManifest({ ...DOSSIER_CORPUS_MANIFEST, hostileCount:29 })).toThrowError(/manifest.invalid/);
  });

  it("pins receipts to exact evidence and keeps schema vocabularies immutable", () => {
    const run = runDossierCore(referenceEvaluator);
    expect(verifyDossierReceiptAgainstEvidence(run.receipt, run.evidenceBytes)).toEqual(run.receipt);
    expect(() => verifyDossierReceiptAgainstEvidence({ ...run.receipt, evidenceSha256:"0".repeat(64) }, run.evidenceBytes)).toThrowError(/receipt.evidence-mismatch/);
    expect(Object.isFrozen(DOMAIN_DISPOSITIONS)).toBe(true);
    expect(() => (DOMAIN_DISPOSITIONS as unknown as string[]).push("safe")).toThrow();
  });

  it("rejects oversized replay input before decoding it", () => {
    expect(() => replayDossierEvidenceBytes(new Uint8Array(1_000_001))).toThrowError(/evidence.bytes-invalid/);
    expect(() => replayDossierEvidenceBytes("not-bytes" as never)).toThrowError(/evidence.bytes-invalid/);
  });

  it("hashes a cross-realm Uint8Array without instanceof assumptions", () => {
    const crossRealm = runInNewContext("new Uint8Array([97,98,99])") as Uint8Array;
    expect(crossRealm instanceof Uint8Array).toBe(false);
    expect(sha256Bytes(crossRealm)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
