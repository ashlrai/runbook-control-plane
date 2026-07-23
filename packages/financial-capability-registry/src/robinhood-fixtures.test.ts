import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildCapabilityDiff,
  parseExactJcsCapabilitySnapshotBytes,
  type CapabilitySnapshotV1,
} from "./index.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/robinhood/", import.meta.url));
const BUILDER = fileURLToPath(new URL("../scripts/build-robinhood-fixtures.mjs", import.meta.url));
const SNAPSHOTS = [
  "banking-snapshot.jcs",
  "trading-45-snapshot.jcs",
  "trading-50-snapshot.jcs",
  "trading-50-risk-correction-snapshot.jcs",
] as const;
const ADDITIONS = [
  "get_equity_price_book",
  "get_equity_tax_lots",
  "get_financials",
  "get_option_historicals",
  "get_scanner_filter_specs",
];
const DOCUMENTED_INVERSE_RESEARCH_WRITERS = [
  "add_option_to_watchlist",
  "add_to_watchlist",
  "follow_watchlist",
  "remove_from_watchlist",
  "remove_option_from_watchlist",
  "unfollow_watchlist",
];
const UNPUBLISHED_INVERSE_RESEARCH_WRITERS = [
  "create_scan",
  "create_watchlist",
  "update_scan_config",
  "update_scan_filters",
  "update_watchlist",
];
const SNAPSHOT_SHA256: Record<(typeof SNAPSHOTS)[number], string> = {
  "banking-snapshot.jcs": "4ad91fdcdade8e91aba2b5a7c44afa5ec61fc786521280240c58db1ed81d4b86",
  "trading-45-snapshot.jcs": "2a414ea97e02d0732cbf03a3809486b5141977ca07311fe792787c4418b2b408",
  "trading-50-snapshot.jcs": "762eeb025972717453c863f4cb57d109c80950433796e3afe9c34684141b608e",
  "trading-50-risk-correction-snapshot.jcs": "ae158cf5d9f26b4c005f931c291831e4ab42658d69c96b01b64ca6a4be6bc346",
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function fixture(name: (typeof SNAPSHOTS)[number]): Uint8Array {
  return readFileSync(join(FIXTURE_DIR, name));
}

function parsed(name: (typeof SNAPSHOTS)[number]): CapabilitySnapshotV1 {
  return parseExactJcsCapabilitySnapshotBytes(fixture(name));
}

function countMutationClasses(snapshot: CapabilitySnapshotV1): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const capability of snapshot.capabilities) {
    counts[capability.mutationClass] = (counts[capability.mutationClass] ?? 0) + 1;
  }
  return counts;
}

describe("Robinhood public-documentation snapshot fixtures", () => {
  it("are exact JCS, parseable, hash-bound, and deterministically rebuilt", () => {
    const output = mkdtempSync(join(tmpdir(), "runbook-robinhood-fixtures-"));
    try {
      execFileSync(process.execPath, [BUILDER, output], { stdio: "pipe" });
      for (const name of SNAPSHOTS) {
        const expected = fixture(name);
        expect(expected.at(-1)).not.toBe(0x0a);
        expect(sha256(expected)).toBe(SNAPSHOT_SHA256[name]);
        expect(readFileSync(join(output, name))).toEqual(expected);
        expect(parseExactJcsCapabilitySnapshotBytes(expected)).toBeDefined();
      }
      expect(readFileSync(join(output, "SHA256SUMS"))).toEqual(
        readFileSync(join(FIXTURE_DIR, "SHA256SUMS")),
      );
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it("freezes the documentation lineage and exact five-capability addition", () => {
    const baseline = parsed("trading-45-snapshot.jcs");
    const candidate = parsed("trading-50-snapshot.jcs");
    expect(baseline.registryRevision).toBe(1);
    expect(baseline.previousAdmittedSnapshotSha256).toBeNull();
    expect(candidate.registryRevision).toBe(2);
    expect(candidate.previousAdmittedSnapshotSha256).toBe(
      sha256(fixture("trading-45-snapshot.jcs")),
    );
    expect(baseline.sourceSeriesId).toBe(candidate.sourceSeriesId);
    expect(baseline.sources[0]?.sourceProjectionSha256).toBe(
      "7346e19ce302b28cd78edbcf0443d7042e76622ecc02c5532474b862263d17c0",
    );
    expect(candidate.sources[0]?.sourceProjectionSha256).toBe(
      "06beecd4a73fe69b3e6cb70e1a2b0de07a589772c2e472860edaa3308a9410d9",
    );
    const baselineNames = new Set(
      baseline.capabilities.flatMap((capability) =>
        capability.providerToolName === null ? [] : [capability.providerToolName],
      ),
    );
    expect(
      candidate.capabilities
        .flatMap((capability) =>
          capability.providerToolName === null ? [] : [capability.providerToolName],
        )
        .filter((name) => !baselineNames.has(name))
        .sort(),
    ).toEqual([...ADDITIONS].sort());
    const diff = buildCapabilityDiff(baseline, candidate);
    expect(diff.changes).toHaveLength(5);
    expect(diff.changes.every((change) =>
      change.changedFields.includes("capability-added")
    )).toBe(true);
    expect(countMutationClasses(baseline)).toEqual({
      "capital-moving": 4,
      read: 30,
      reversible: 11,
    });
    expect(countMutationClasses(candidate)).toEqual({
      "capital-moving": 4,
      read: 35,
      reversible: 11,
    });
  });

  it("appends the risk correction as revision 3 without rewriting admitted history", () => {
    const admitted = parsed("trading-50-snapshot.jcs");
    const correction = parsed("trading-50-risk-correction-snapshot.jcs");
    expect(correction.registryRevision).toBe(3);
    expect(correction.previousAdmittedSnapshotSha256).toBe(
      sha256(fixture("trading-50-snapshot.jcs")),
    );
    expect(correction.sourceSeriesId).toBe(admitted.sourceSeriesId);
    expect(correction.sources).toEqual(admitted.sources);
    const diff = buildCapabilityDiff(admitted, correction);
    expect(diff.changes).toHaveLength(5);
    expect(diff.changes.every((change) =>
      change.changedFields.length === 1 &&
      change.changedFields[0] === "mutation-class" &&
      change.findingCodes.includes("capability-mutation-class-changed") &&
      change.findingCodes.includes("capability-unknown-risk-semantics")
    )).toBe(true);
    expect(countMutationClasses(correction)).toEqual({
      "capital-moving": 4,
      read: 35,
      reversible: 6,
      unknown: 5,
    });
  });

  it("models research-state poisoning and approval bypass without runtime claims", () => {
    const snapshot = parsed("trading-50-risk-correction-snapshot.jcs");
    const researchWriters = snapshot.capabilities.filter((capability) =>
      capability.mutationScopes.includes("research-state"),
    );
    expect(researchWriters).toHaveLength(11);
    expect(
      researchWriters.every(
        (capability) =>
          capability.decisionInfluence === "indirect" &&
          capability.actionFamilies.includes("research-state-management") &&
          capability.stateWriteDomains.includes("research-state") &&
          capability.approvalSemantics.mode === "unknown",
      ),
    ).toBe(true);
    expect(
      researchWriters
        .filter((capability) => capability.mutationClass === "reversible")
        .map((capability) => capability.providerToolName)
        .sort(),
    ).toEqual(DOCUMENTED_INVERSE_RESEARCH_WRITERS);
    expect(
      researchWriters
        .filter((capability) => capability.mutationClass === "unknown")
        .map((capability) => capability.providerToolName)
        .sort(),
    ).toEqual(UNPUBLISHED_INVERSE_RESEARCH_WRITERS);
    for (const name of ["place_equity_order", "place_option_order"]) {
      const capability = snapshot.capabilities.find(
        (entry) => entry.providerToolName === name,
      );
      expect(capability?.approvalSemantics).toEqual({
        actionBinding: "unknown",
        bypassCondition: "user-instruction",
        enforcingPrincipal: "customer",
        expiryBinding: "unknown",
        mode: "optional",
        scopeBinding: "unknown",
      });
    }
    for (const capability of snapshot.capabilities) {
      expect(capability.identityEvidence).toBe("public-explicit");
      expect(capability.riskEvidence).toBe("public-derived");
      expect(capability.requestContract).toEqual({ sha256: null, state: "not-published" });
      expect(capability.responseContract).toEqual({ sha256: null, state: "not-published" });
    }
  });

  it("keeps Banking capabilities-only, provider-name-free, and credential-aware", () => {
    const snapshot = parsed("banking-snapshot.jcs");
    expect(snapshot.registryRevision).toBe(1);
    expect(snapshot.previousAdmittedSnapshotSha256).toBeNull();
    expect(snapshot.sources[0]).toMatchObject({
      completeness: "capabilities-only",
      sourceProjectionSha256:
        "980bef414a42c6437857558565405fce128eea4689a2b0a813bff5beddd58aa5",
    });
    expect(snapshot.capabilities).toHaveLength(3);
    expect(
      snapshot.capabilities.every(
        (capability) =>
          capability.identityKind === "documented-operation" &&
          capability.identityEvidence === "public-derived" &&
          capability.providerToolName === null &&
          capability.riskEvidence === "public-derived",
      ),
    ).toBe(true);
    const credential = snapshot.capabilities.find(
      (capability) => capability.credentialRelease === "payment-credential",
    );
    expect(credential).toMatchObject({
      accountScope: "authorized-card",
      actionFamilies: ["credential-release"],
      capitalAuthority: { assetScopes: [], operations: [] },
      dataScopes: ["payment-credentials"],
      mutationClass: "unknown",
      mutationScopes: ["credential-release"],
    });
    const text = new TextDecoder().decode(fixture("banking-snapshot.jcs"));
    expect(text).not.toMatch(/(?:account|card)(?:Number|Value)/);
    expect(text).not.toContain("4111111111111111");
  });
});
