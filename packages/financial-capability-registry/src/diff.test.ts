import { describe, expect, it } from "vitest";
import { parseCapabilityDiff } from "./artifact-validate.js";
import { sha256Jcs } from "./canonical.js";
import { buildCapabilityDiff, serializeCapabilityDiff } from "./diff.js";
import {
  CAPABILITY_SNAPSHOT_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  type CapabilitySnapshotV1,
  type FinancialCapabilityV1,
} from "./types.js";
import { RegistryValidationError } from "./validate.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

function capability(
  overrides: Partial<FinancialCapabilityV1> = {},
): FinancialCapabilityV1 {
  return {
    accountScope: "dedicated-account",
    actionFamilies: ["order-review"],
    approvalSemantics: {
      actionBinding: "exact-action",
      bypassCondition: "none",
      enforcingPrincipal: "provider",
      expiryBinding: "fixed",
      mode: "mandatory",
      scopeBinding: "single-action",
    },
    capitalAuthority: { assetScopes: ["equity"], operations: ["preview"] },
    capabilityId: "trading.review-equity-order",
    credentialRelease: "none",
    dataScopes: ["order-data"],
    decisionInfluence: "direct",
    descriptionContract: { sha256: A, state: "known" },
    identityEvidence: "public-explicit",
    identityKind: "published-tool-name",
    mutationClass: "reversible",
    mutationScopes: ["research-state"],
    providerToolName: "review_equity_order",
    requestContract: { sha256: B, state: "known" },
    responseContract: { sha256: C, state: "known" },
    riskEvidence: "public-derived",
    sourceAssertionSha256: D,
    sourceIds: ["trading-docs"],
    stateReadDomains: ["order-state"],
    stateWriteDomains: ["research-state"],
    workflowPrerequisiteCapabilityIds: [],
    ...overrides,
  };
}

function baseline(
  capabilities: readonly FinancialCapabilityV1[] = [capability()],
): CapabilitySnapshotV1 {
  return {
    capabilities,
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
        publicUri:
          "https://robinhood.com/us/en/support/articles/trading-with-your-agent/",
        retrievedAtDeclared: "2026-07-22T11:59:00Z",
        sourceId: "trading-docs",
        sourceProjectionSha256: A,
      },
    ],
  };
}

function candidateFrom(
  prior: CapabilitySnapshotV1,
  overrides: Partial<CapabilitySnapshotV1> = {},
): CapabilitySnapshotV1 {
  return {
    ...prior,
    observedAtDeclared: "2026-07-22T13:00:00Z",
    previousAdmittedSnapshotSha256: sha256Jcs(prior),
    registryRevision: prior.registryRevision + 1,
    sources: prior.sources.map((source) => ({
      ...source,
      retrievedAtDeclared: "2026-07-22T12:59:00Z",
    })),
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<RegistryValidationError>>({ code }),
  );
}

describe("financial capability semantic diff", () => {
  it("emits an empty, deterministic, self-digested diff for unchanged capabilities", () => {
    const before = baseline();
    const after = candidateFrom(before);
    const first = buildCapabilityDiff(before, after);
    const second = buildCapabilityDiff(before, after);
    expect(first).toEqual(second);
    expect(first.changes).toEqual([]);
    expect(first.sourceChanges).toEqual([]);
    expect(first.materialChangeIds).toEqual([]);
    const { diffSha256, ...withoutDigest } = first;
    expect(diffSha256).toBe(sha256Jcs(withoutDigest));
    expect(serializeCapabilityDiff(first).endsWith("\n")).toBe(false);
  });

  it("makes otherwise unexplained source projection drift material", () => {
    const before = baseline();
    const after = candidateFrom(before, {
      sources: before.sources.map((source) => ({
        ...source,
        retrievedAtDeclared: "2026-07-22T12:59:00Z",
        sourceProjectionSha256: B,
      })),
    });
    const diff = buildCapabilityDiff(before, after);
    expect(diff.changes).toEqual([]);
    expect(diff.sourceChanges).toHaveLength(1);
    expect(diff.sourceChanges[0]).toMatchObject({
      changedFields: ["source-projection"],
      findingCodes: ["review-required", "source-record-changed", "source-set-changed"],
      materiality: "material",
    });
    expect(parseCapabilityDiff(JSON.parse(serializeCapabilityDiff(diff)))).toEqual(diff);
  });

  it("marks a newly reachable research-state influence path", () => {
    const writer = capability({
      actionFamilies: ["research-state-management"],
      capitalAuthority: { assetScopes: [], operations: [] },
      capabilityId: "trading.update-watchlist",
      mutationClass: "reversible",
      mutationScopes: ["research-state"],
      providerToolName: "update_watchlist",
      stateReadDomains: ["research-state"],
      stateWriteDomains: ["research-state"],
    });
    const before = baseline([writer]);
    const reader = capability({
      actionFamilies: ["research-observation"],
      capitalAuthority: { assetScopes: [], operations: [] },
      capabilityId: "trading.run-scan",
      mutationClass: "read",
      mutationScopes: ["none"],
      providerToolName: "run_scan",
      stateReadDomains: ["research-state"],
    });
    const after = candidateFrom(before, {
      capabilities: [reader, writer].sort((left, right) =>
        left.capabilityId.localeCompare(right.capabilityId)),
    });
    const diff = buildCapabilityDiff(before, after);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]?.findingCodes).toContain(
      "capability-state-influence-path-added",
    );
    expect(diff.changes[0]?.changedFields).toContain("influence-path");
  });

  it("marks removal of a declared workflow prerequisite on its dependent", () => {
    const review = capability({
      capabilityId: "trading.review-equity-order",
      providerToolName: "review_equity_order",
    });
    const place = capability({
      actionFamilies: ["order-submission"],
      capabilityId: "trading.place-equity-order",
      providerToolName: "place_equity_order",
      workflowPrerequisiteCapabilityIds: [review.capabilityId],
    });
    const before = baseline([place, review].sort((left, right) =>
      left.capabilityId.localeCompare(right.capabilityId)));
    const after = candidateFrom(before, {
      capabilities: [{ ...place, workflowPrerequisiteCapabilityIds: [] }],
    });
    const diff = buildCapabilityDiff(before, after);
    const dependent = diff.changes.find((change) =>
      change.findingCodes.includes("capability-workflow-prerequisite-removed"));
    expect(dependent?.changedFields).toContain("workflow-prerequisites");
  });

  it("fails closed on provider, product, source-series, head, and revision discontinuity", () => {
    const before = baseline();
    const linked = candidateFrom(before);
    expectCode(
      () => buildCapabilityDiff(before, { ...linked, providerId: "other" }),
      "registry-provider-mismatch",
    );
    expectCode(
      () => buildCapabilityDiff(before, { ...linked, productId: "other" }),
      "registry-product-mismatch",
    );
    expectCode(
      () => buildCapabilityDiff(before, { ...linked, sourceSeriesId: "runtime" }),
      "registry-source-series-mismatch",
    );
    expectCode(
      () =>
        buildCapabilityDiff(before, {
          ...linked,
          previousAdmittedSnapshotSha256: A,
        }),
      "registry-baseline-mismatch",
    );
    expectCode(
      () => buildCapabilityDiff(before, { ...linked, registryRevision: 3 }),
      "registry-revision-invalid",
    );
  });

  it("rejects regressed snapshot and same-source retrieval time", () => {
    const before = baseline();
    const linked = candidateFrom(before);
    expectCode(
      () => buildCapabilityDiff(before, {
        ...linked,
        observedAtDeclared: "2026-07-22T11:59:59Z",
        sources: linked.sources.map((source) => ({
          ...source,
          retrievedAtDeclared: "2026-07-22T11:59:58Z",
        })),
      }),
      "snapshot-time-regressed",
    );
    expectCode(
      () => buildCapabilityDiff(before, {
        ...linked,
        sources: linked.sources.map((source) => ({
          ...source,
          retrievedAtDeclared: "2026-07-22T11:58:59Z",
        })),
      }),
      "snapshot-time-regressed",
    );
  });

  it("records additions and complete-source removals without raw identities", () => {
    const before = baseline();
    const added = capability({
      capabilityId: "trading.get-financials",
      providerToolName: "get_financials",
    });
    const afterAdd = candidateFrom(before, {
      capabilities: [added, before.capabilities[0]!],
    });
    const addition = buildCapabilityDiff(before, afterAdd);
    expect(addition.changes).toHaveLength(1);
    expect(addition.changes[0]).toMatchObject({
      changedFields: ["capability-added"],
      findingCodes: expect.arrayContaining([
        "capability-added",
        "policy-coverage-invalidated",
        "review-required",
      ]),
      materiality: "material",
      previousCapabilitySha256: null,
    });

    const afterRemove = candidateFrom(before, { capabilities: [added] });
    const removal = buildCapabilityDiff(before, afterRemove);
    expect(removal.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changedFields: ["capability-removed"],
          findingCodes: expect.arrayContaining(["capability-removed"]),
          currentCapabilitySha256: null,
        }),
      ]),
    );
    const portable = serializeCapabilityDiff(addition);
    expect(portable).not.toContain("get_financials");
    expect(portable).not.toContain("trading.get-financials");
    expect(portable).not.toContain("robinhood");
    expect(portable).not.toContain("trading-mcp");
    expect(portable).not.toContain("https://");
  });

  it("treats a provider tool-name change on the stable identity as an exact rename", () => {
    const before = baseline();
    const renamed = capability({ providerToolName: "review_equity_order_v2" });
    const diff = buildCapabilityDiff(
      before,
      candidateFrom(before, { capabilities: [renamed] }),
    );
    expect(diff.changes[0]).toMatchObject({
      changedFields: ["provider-tool-name"],
      findingCodes: expect.arrayContaining(["capability-renamed"]),
    });
  });

  it("detects request substitution, response substitution, and schema visibility loss", () => {
    const before = baseline();
    const substituted = capability({
      requestContract: { sha256: C, state: "known" },
      responseContract: { sha256: D, state: "known" },
    });
    const changed = buildCapabilityDiff(
      before,
      candidateFrom(before, { capabilities: [substituted] }),
    ).changes[0]!;
    expect(changed.findingCodes).toEqual(
      expect.arrayContaining([
        "capability-input-schema-changed",
        "capability-output-schema-changed",
        "policy-coverage-invalidated",
        "scenarios-rerun-required",
      ]),
    );

    const hidden = capability({
      requestContract: { sha256: null, state: "not-published" },
    });
    const visibility = buildCapabilityDiff(
      before,
      candidateFrom(before, { capabilities: [hidden] }),
    ).changes[0]!;
    expect(visibility.findingCodes).toContain("capability-schema-visibility-lost");
  });

  it("detects account, data, mutation, credential, and capital expansions", () => {
    const priorCapability = capability({
      capitalAuthority: { assetScopes: [], operations: [] },
      mutationClass: "read",
      mutationScopes: ["none"],
      stateWriteDomains: ["none"],
    });
    const before = baseline([priorCapability]);
    const expanded = capability({
      accountScope: "all-linked-accounts",
      capitalAuthority: { assetScopes: ["equity"], operations: ["submit"] },
      credentialRelease: "account-identifier",
      dataScopes: ["account-identifiers", "order-data"],
      mutationClass: "capital-moving",
      mutationScopes: ["capital-orders", "credential-release"],
      stateWriteDomains: ["order-state"],
    });
    const findings = buildCapabilityDiff(
      before,
      candidateFrom(before, { capabilities: [expanded] }),
    ).changes[0]!.findingCodes;
    expect(findings).toEqual(
      expect.arrayContaining([
        "capability-account-scope-expanded",
        "capability-data-scope-expanded",
        "capability-mutation-scope-expanded",
        "capability-credential-release-expanded",
        "capability-capital-authority-expanded",
      ]),
    );
  });

  it("classifies approval weakening and mixed changes through a partial order", () => {
    const before = baseline();
    const weakened = capability({
      approvalSemantics: {
        actionBinding: "action-class",
        bypassCondition: "user-instruction",
        enforcingPrincipal: "external-agent",
        expiryBinding: "none",
        mode: "optional",
        scopeBinding: "session",
      },
    });
    const weakFindings = buildCapabilityDiff(
      before,
      candidateFrom(before, { capabilities: [weakened] }),
    ).changes[0]!.findingCodes;
    expect(weakFindings).toEqual(
      expect.arrayContaining([
        "capability-approval-semantics-changed",
        "capability-approval-semantics-weakened",
      ]),
    );

    const mixed = capability({
      approvalSemantics: {
        ...capability().approvalSemantics,
        bypassCondition: "user-instruction",
        enforcingPrincipal: "joint",
      },
    });
    const mixedFindings = buildCapabilityDiff(
      before,
      candidateFrom(before, { capabilities: [mixed] }),
    ).changes[0]!.findingCodes;
    expect(mixedFindings).toContain("capability-approval-semantics-incomparable");
  });

  it("marks unknown semantics as blocking even when added under a friendly identity", () => {
    const before = baseline();
    const unknown = capability({
      accountScope: "unknown",
      actionFamilies: ["unknown"],
      approvalSemantics: {
        actionBinding: "unknown",
        bypassCondition: "unknown",
        enforcingPrincipal: "unknown",
        expiryBinding: "unknown",
        mode: "unknown",
        scopeBinding: "unknown",
      },
      capitalAuthority: { assetScopes: ["unknown"], operations: ["unknown"] },
      capabilityId: "trading.friendly-helper",
      credentialRelease: "unknown",
      dataScopes: ["unknown"],
      mutationClass: "unknown",
      mutationScopes: ["unknown"],
      providerToolName: "friendly_helper",
      stateReadDomains: ["unknown"],
      stateWriteDomains: ["unknown"],
    });
    const diff = buildCapabilityDiff(
      before,
      candidateFrom(before, {
        capabilities: [unknown, before.capabilities[0]!],
      }),
    );
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          findingCodes: expect.arrayContaining([
            "capability-added",
            "capability-unknown-risk-semantics",
          ]),
        }),
      ]),
    );
  });

  it("does not turn an omission from a partial source into a removal", () => {
    const before = baseline();
    const partial = candidateFrom(before, {
      capabilities: [
        capability({
          capabilityId: "trading.get-financials",
          providerToolName: "get_financials",
        }),
      ],
      sources: before.sources.map((source) => ({
        ...source,
        completeness: "partial-enumeration",
        retrievedAtDeclared: "2026-07-22T12:59:00Z",
        sourceProjectionSha256: B,
      })),
    });
    const diff = buildCapabilityDiff(before, partial);
    const omitted = diff.changes.find((change) =>
      change.findingCodes.includes("source-completeness-insufficient"),
    );
    expect(omitted).toMatchObject({
      changedFields: ["capability-omitted"],
      currentCapabilitySha256: null,
      findingCodes: ["source-completeness-insufficient"],
      materiality: "material",
    });
    expect(omitted?.findingCodes).not.toContain("capability-removed");
    expect(parseCapabilityDiff(JSON.parse(serializeCapabilityDiff(diff)))).toEqual(diff);
  });

  it("binds stable references, change IDs, source sets, and blocked sets deterministically", () => {
    const before = baseline();
    const firstCandidate = candidateFrom(before, {
      capabilities: [capability({ descriptionContract: { sha256: B, state: "known" } })],
    });
    const first = buildCapabilityDiff(before, firstCandidate);
    const second = buildCapabilityDiff(
      structuredClone(before),
      structuredClone(firstCandidate),
    );
    expect(second).toEqual(first);
    expect(first.changes[0]?.capabilityReferenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.changes[0]?.changeId).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sourceSetSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.blockedChangeSetSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.materialChangeIds).toEqual([first.changes[0]?.changeId]);
  });
});
