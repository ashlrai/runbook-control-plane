import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeJcs, sha256Jcs } from "./canonical.js";
import {
  RegistryNodeError,
  ownRegularFile,
  runRegistryCli,
  type RegistryCliDependencies,
} from "./node.js";
import {
  ADMISSION_RECEIPT_SCHEMA,
  CAPABILITY_SNAPSHOT_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  PORTABLE_LIMITATIONS,
  type AdmissionReceiptV1,
  type CapabilitySnapshotV1,
  type FinancialCapabilityV1,
} from "./types.js";
import { RegistryValidationError } from "./validate.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function capability(
  overrides: Partial<FinancialCapabilityV1> = {},
): FinancialCapabilityV1 {
  return {
    accountScope: "all-linked-accounts",
    actionFamilies: ["account-observation"],
    approvalSemantics: {
      actionBinding: "none",
      bypassCondition: "none",
      enforcingPrincipal: "none",
      expiryBinding: "none",
      mode: "none",
      scopeBinding: "none",
    },
    capitalAuthority: { assetScopes: [], operations: [] },
    capabilityId: "trading.get-accounts",
    credentialRelease: "none",
    dataScopes: ["account-identifiers"],
    decisionInfluence: "direct",
    descriptionContract: { sha256: B, state: "known" },
    identityEvidence: "public-explicit",
    identityKind: "published-tool-name",
    mutationClass: "read",
    mutationScopes: ["none"],
    providerToolName: "get_accounts",
    requestContract: { sha256: null, state: "not-published" },
    responseContract: { sha256: null, state: "not-published" },
    riskEvidence: "public-derived",
    sourceAssertionSha256: C,
    sourceIds: ["official-docs"],
    stateReadDomains: ["account-state"],
    stateWriteDomains: ["none"],
    workflowPrerequisiteCapabilityIds: [],
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<CapabilitySnapshotV1> = {},
): CapabilitySnapshotV1 {
  return {
    capabilities: [capability()],
    observedAtDeclared: "2026-07-22T12:00:00Z",
    previousAdmittedSnapshotSha256: null,
    productId: "trading-mcp",
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    providerId: "robinhood",
    registryRevision: 1,
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA,
    sourceSeriesId: "public-docs",
    sources: [
      {
        authority: "public-documentation",
        completeness: "complete-enumeration",
        publicUri: "https://example.com/official-docs",
        retrievedAtDeclared: "2026-07-22T11:00:00Z",
        sourceId: "official-docs",
        sourceProjectionSha256: A,
      },
    ],
    ...overrides,
  };
}

async function writeJcs(directory: string, name: string, value: unknown): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, canonicalizeJcs(value), { mode: 0o600 });
  return path;
}

describe("Node regular-file ownership", () => {
  it("owns exact regular-file bytes and digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-registry-node-"));
    const path = join(directory, "input.jcs");
    await writeFile(path, "{}", { mode: 0o600 });
    const owned = await ownRegularFile(path, { maxBytes: 16, minBytes: 2 });
    expect(new TextDecoder().decode(owned.bytes)).toBe("{}");
    expect(owned.sha256).toBe(sha256Jcs({}));
  });

  it("rejects symbolic links, directories, and resource excess", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-registry-node-"));
    const target = join(directory, "target");
    const link = join(directory, "link");
    await writeFile(target, "{}", { mode: 0o600 });
    await symlink(target, link);
    await expect(ownRegularFile(link, { maxBytes: 16 })).rejects.toBeInstanceOf(
      RegistryNodeError,
    );
    await expect(ownRegularFile(directory, { maxBytes: 16 })).rejects.toMatchObject({
      code: "file.resource-invalid",
    });
    const large = join(directory, "large");
    await writeFile(large, "12345", { mode: 0o600 });
    await expect(ownRegularFile(large, { maxBytes: 4 })).rejects.toMatchObject({
      code: "file.resource-invalid",
    });
    await mkdir(join(directory, "nested"));
  });
});

describe("offline registry CLI command surface", () => {
  it("emits an exact no-newline verification receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-registry-cli-"));
    const value = snapshot();
    const path = await writeJcs(directory, "snapshot.jcs", value);
    const result = await runRegistryCli(["verify-snapshot", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      inputSha256: sha256Jcs(value),
      snapshotSha256: sha256Jcs(value),
      valid: true,
    });
    expect(canonicalizeJcs(JSON.parse(result.stdout))).toBe(result.stdout);
  });

  it("returns exit 1 and a bounded receipt for a structurally invalid snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-registry-cli-"));
    const path = await writeJcs(directory, "invalid.jcs", {
      ...snapshot(),
      accountNumber: "must-not-echo",
    });
    const result = await runRegistryCli(["verify-snapshot", path]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("must-not-echo");
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: false });
  });

  it("emits a deterministic digest-only diff for exact linked snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-registry-cli-"));
    const before = snapshot();
    const after = snapshot({
      capabilities: [
        capability({ descriptionContract: { sha256: A, state: "known" } }),
      ],
      observedAtDeclared: "2026-07-22T13:00:00Z",
      previousAdmittedSnapshotSha256: sha256Jcs(before),
      registryRevision: 2,
    });
    const beforePath = await writeJcs(directory, "before.jcs", before);
    const afterPath = await writeJcs(directory, "after.jcs", after);
    const result = await runRegistryCli(["diff", beforePath, afterPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(false);
    expect(result.stdout).not.toContain("get_accounts");
    expect(JSON.parse(result.stdout)).toMatchObject({
      baselineSnapshotSha256: sha256Jcs(before),
      candidateSnapshotSha256: sha256Jcs(after),
    });
  });

  it("maps admission outcomes and supplies exact owned bytes to the evaluator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-registry-cli-"));
    const value = snapshot();
    const snapshotPath = await writeJcs(directory, "snapshot.jcs", value);
    const policyPath = await writeJcs(directory, "policy.jcs", { policy: "stub" });
    const stubReceipt: AdmissionReceiptV1 = {
      baselineSnapshotSha256: A,
      blockedChangeSetSha256: B,
      candidateSnapshotSha256: C,
      checks: [{ code: "material-review-satisfied", passed: false }],
      diffSha256: A,
      evaluatedAtDeclared: "2026-07-22T12:00:00Z",
      limitations: PORTABLE_LIMITATIONS,
      outcome: "quarantine",
      policySha256: B,
      profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
      reviewArtifactSha256: null,
      reviewSignatureVerified: false,
      schemaVersion: ADMISSION_RECEIPT_SCHEMA,
    };
    let called = false;
    const dependencies: RegistryCliDependencies = {
      evaluateCapabilityAdmission: async (input) => {
        called = true;
        expect(new TextDecoder().decode(input.baselineSnapshotBytes)).toBe(
          canonicalizeJcs(value),
        );
        expect(new TextDecoder().decode(input.policyBytes)).toBe('{"policy":"stub"}');
        expect(input.evaluatedAtDeclared).toBe("2026-07-22T12:00:00Z");
        return stubReceipt;
      },
    };
    const result = await runRegistryCli(
      [
        "admit",
        snapshotPath,
        snapshotPath,
        policyPath,
        "--evaluated-at",
        "2026-07-22T12:00:00Z",
      ],
      dependencies,
    );
    expect(called).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(canonicalizeJcs(stubReceipt));
  });

  it("uses exit 2 for invocation, I/O, resource, and incomplete review options", async () => {
    expect((await runRegistryCli([])).exitCode).toBe(2);
    expect((await runRegistryCli(["verify-snapshot", "/does/not/exist"])).exitCode).toBe(2);
    expect(
      (
        await runRegistryCli([
          "admit",
          "a",
          "b",
          "c",
          "--evaluated-at",
          "2026-07-22T12:00:00Z",
          "--review",
          "review.jcs",
        ])
      ).exitCode,
    ).toBe(2);
    const directory = await mkdtemp(join(tmpdir(), "runbook-registry-cli-"));
    const path = await writeJcs(directory, "input.jcs", snapshot());
    const invocationFailure: RegistryCliDependencies = {
      evaluateCapabilityAdmission: async () => {
        throw new RegistryValidationError("admission.evaluated-at-invalid");
      },
    };
    expect(
      (
        await runRegistryCli(
          ["admit", path, path, path, "--evaluated-at", "not-a-time"],
          invocationFailure,
        )
      ).exitCode,
    ).toBe(2);
  });
});
