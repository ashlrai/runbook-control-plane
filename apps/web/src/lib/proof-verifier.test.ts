import { describe, expect, it } from "vitest";
import {
  buildVerificationReceipt,
  buildSyntheticCloneShell,
  inspectPublicSnapshot,
  MAX_PASTED_ARTIFACT_BYTES,
  pastedArtifactSizeError,
} from "./proof-verifier";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function artifact() {
  return {
    schemaVersion: "runbook.public-snapshot.v1",
    generatedAt: "2026-07-21T15:00:00.000Z",
    experimentId: "RUN-PROOF-001",
    sourceLedger: {
      validAtExport: true,
      eventCount: 3,
      headHash: hashB,
      assurance: "local-tamper-evidence-only",
    },
    projection: {
      privacy: "metadata-only",
      independentlyVerifiable: false,
      note: "Filtered metadata projection; verify against the trusted source ledger head.",
    },
    events: [
      { sequence: 1, type: "experiment.created", occurredAt: "2026-07-21T14:00:00.000Z", hash: hashA },
      { sequence: 3, type: "preflight.completed", occurredAt: "2026-07-21T14:20:00.000Z", hash: hashB },
    ],
  };
}

describe("portable snapshot inspection", () => {
  it("accepts a strict, temporally consistent metadata artifact", () => {
    const result = inspectPublicSnapshot(artifact());
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected a valid artifact.");
    expect(result.checks).toHaveLength(4);
    expect(result.eventCounts["preflight.completed"]).toBe(1);
  });

  it("rejects empty artifacts and impossible source counts", () => {
    expect(inspectPublicSnapshot({ ...artifact(), events: [] })).toMatchObject({ valid: false });
    expect(inspectPublicSnapshot({ ...artifact(), sourceLedger: { ...artifact().sourceLedger, eventCount: 1 } })).toMatchObject({ valid: false });
  });

  it("rejects duplicate, unordered, and future event commitments", () => {
    const duplicate = artifact();
    duplicate.events[1] = { ...duplicate.events[1]!, sequence: 1, hash: hashA };
    expect(inspectPublicSnapshot(duplicate)).toMatchObject({ valid: false });
    const future = artifact();
    future.events[1] = { ...future.events[1]!, occurredAt: "2026-07-21T16:00:00.000Z" };
    expect(inspectPublicSnapshot(future)).toMatchObject({ valid: false });
  });

  it("rejects impossible head commitments and unsafe public identifiers", () => {
    const wrongHead = artifact();
    wrongHead.sourceLedger.headHash = "c".repeat(64);
    expect(inspectPublicSnapshot(wrongHead)).toMatchObject({ valid: false });
    const genesisHead = artifact();
    genesisHead.sourceLedger.headHash = "0".repeat(64);
    expect(inspectPublicSnapshot(genesisHead)).toMatchObject({ valid: false });
    expect(inspectPublicSnapshot({ ...artifact(), experimentId: "RUN-account-123456789" })).toMatchObject({ valid: false });
  });

  it("rejects extra fields that could smuggle private data", () => {
    expect(inspectPublicSnapshot({ ...artifact(), brokerAccountId: "private" })).toMatchObject({ valid: false });
  });

  it("builds a receipt that states the assurance limit", () => {
    const result = inspectPublicSnapshot(artifact());
    if (!result.valid) throw new Error("Expected a valid artifact.");
    expect(buildVerificationReceipt(result.snapshot, "f".repeat(64))).toContain("not independently verified");
  });

  it("builds a synthetic clone shell without copying a trade or position", () => {
    const result = inspectPublicSnapshot(artifact());
    if (!result.valid) throw new Error("Expected a valid artifact.");
    const clone = JSON.parse(buildSyntheticCloneShell(result.snapshot, "f".repeat(64))) as Record<string, unknown>;
    expect(clone).toMatchObject({
      dataClass: "synthetic",
      derivedFrom: { experimentId: "RUN-PROOF-001", assurance: "structure-and-pasted-text-fingerprint-only" },
      cloneRules: { copyTradeOrPosition: false, requireNewProspectiveCharter: true },
    });
    expect(JSON.stringify(clone)).not.toContain("VTI");
  });

  it("rejects raw pasted text above the local byte ceiling before parsing", () => {
    expect(pastedArtifactSizeError("a".repeat(MAX_PASTED_ARTIFACT_BYTES))).toBeNull();
    expect(pastedArtifactSizeError("a".repeat(MAX_PASTED_ARTIFACT_BYTES + 1))).toContain("exceeds");
  });
});
