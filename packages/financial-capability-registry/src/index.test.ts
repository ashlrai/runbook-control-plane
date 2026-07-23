import { describe, expect, it } from "vitest";
import {
  CAPABILITY_SNAPSHOT_SCHEMA,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  RegistryValidationError,
  StrictJsonError,
  capabilitySnapshotSha256,
  canonicalizeJcs,
  parseCapabilitySnapshot,
  parseExactJcsCapabilitySnapshotBytes,
  parseStrictJson,
  serializeCapabilitySnapshot,
  sha256Jcs,
  type CapabilitySnapshotV1,
  type FinancialCapabilityV1,
} from "./index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function readCapability(
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
    descriptionContract: { sha256: HASH_B, state: "known" },
    identityEvidence: "public-explicit",
    identityKind: "published-tool-name",
    mutationClass: "read",
    mutationScopes: ["none"],
    providerToolName: "get_accounts",
    requestContract: { sha256: null, state: "not-published" },
    responseContract: { sha256: null, state: "not-published" },
    riskEvidence: "public-derived",
    sourceAssertionSha256: HASH_C,
    sourceIds: ["robinhood-trading-docs"],
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
    capabilities: [readCapability()],
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
        publicUri: "https://robinhood.com/us/en/support/articles/trading-with-your-agent/",
        retrievedAtDeclared: "2026-07-22T11:59:00Z",
        sourceId: "robinhood-trading-docs",
        sourceProjectionSha256: HASH_A,
      },
    ],
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<RegistryValidationError>>({ code }),
  );
}

describe("financial capability snapshot V1 validation", () => {
  it("owns, serializes, and hashes a closed public-documentation snapshot", () => {
    const input = snapshot();
    const parsed = parseCapabilitySnapshot(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.capabilities[0]).not.toBe(input.capabilities[0]);
    expect(serializeCapabilitySnapshot(input)).toBe(canonicalizeJcs(input));
    expect(capabilitySnapshotSha256(input)).toBe(sha256Jcs(input));
  });

  it("allows a registry-derived documented operation with no fabricated tool name", () => {
    const documented = readCapability({
      accountScope: "authorized-card",
      actionFamilies: ["credential-release"],
      capabilityId: "banking.agentic-card.payment-credential-release",
      credentialRelease: "payment-credential",
      dataScopes: ["payment-credentials"],
      identityEvidence: "public-derived",
      identityKind: "documented-operation",
      mutationScopes: ["credential-release"],
      providerToolName: null,
      stateReadDomains: ["payment-credential-state"],
    });
    expect(
      parseCapabilitySnapshot(snapshot({ capabilities: [documented] })).capabilities[0]
        ?.providerToolName,
    ).toBeNull();
  });

  it("models unknown credential effects only through the exclusive unknown scope", () => {
    const unknown = readCapability({
      actionFamilies: ["unknown"],
      credentialRelease: "unknown",
      dataScopes: ["unknown"],
      mutationClass: "unknown",
      mutationScopes: ["unknown"],
      riskEvidence: "public-derived",
      stateReadDomains: ["unknown"],
      stateWriteDomains: ["unknown"],
    });
    expect(parseCapabilitySnapshot(snapshot({ capabilities: [unknown] }))).toBeDefined();
    expectCode(
      () =>
        parseCapabilitySnapshot(
          snapshot({
            capabilities: [
              { ...unknown, mutationScopes: ["credential-release"] },
            ],
          }),
        ),
      "snapshot.capability-invalid",
    );
  });

  it("rejects approval action-binding vocabulary outside the frozen profile", () => {
    const deprecated = snapshot() as unknown as {
      capabilities: Array<{
        approvalSemantics: { actionBinding: string };
      }>;
    };
    deprecated.capabilities[0]!.approvalSemantics.actionBinding = "action-family";
    expectCode(() => parseCapabilitySnapshot(deprecated), "snapshot.capability-invalid");

    deprecated.capabilities[0]!.approvalSemantics.actionBinding = "policy";
    expectCode(() => parseCapabilitySnapshot(deprecated), "snapshot.capability-invalid");
  });

  it("rejects fabricated or evidence-inconsistent identities", () => {
    expectCode(
      () =>
        parseCapabilitySnapshot(
          snapshot({
            capabilities: [
              readCapability({
                identityKind: "documented-operation",
                providerToolName: "get_card_details",
              }),
            ],
          }),
        ),
      "snapshot.capability-invalid",
    );
    expectCode(
      () =>
        parseCapabilitySnapshot(
          snapshot({
            capabilities: [
              readCapability({ identityEvidence: "runtime-confirmed" }),
            ],
          }),
        ),
      "snapshot.capability-invalid",
    );
  });

  it("requires controlled exercise evidence for runtime-exercised claims", () => {
    const runtimeCapability = readCapability({
      capabilityId: "runtime.get-accounts",
      identityEvidence: "runtime-exercised",
      identityKind: "runtime-tool-name",
      riskEvidence: "runtime-exercised",
      sourceIds: ["runtime-evidence"],
    });
    const runtimeSource = {
      authority: "authenticated-runtime-discovery" as const,
      completeness: "complete-enumeration" as const,
      publicUri: null,
      retrievedAtDeclared: "2026-07-22T11:59:00Z",
      sourceId: "runtime-evidence",
      sourceProjectionSha256: HASH_A,
    };
    expectCode(
      () => parseCapabilitySnapshot(snapshot({
        capabilities: [runtimeCapability],
        sources: [runtimeSource],
      })),
      "snapshot.capability-invalid",
    );
    expect(parseCapabilitySnapshot(snapshot({
      capabilities: [runtimeCapability],
      sources: [{ ...runtimeSource, authority: "controlled-runtime-exercise" }],
    }))).toBeDefined();
  });

  it("requires exact contract-state digest semantics", () => {
    expectCode(
      () =>
        parseCapabilitySnapshot(
          snapshot({
            capabilities: [
              readCapability({
                requestContract: { sha256: null, state: "known" },
              }),
            ],
          }),
        ),
      "snapshot.capability-invalid",
    );
    expectCode(
      () =>
        parseCapabilitySnapshot(
          snapshot({
            capabilities: [
              readCapability({
                responseContract: { sha256: HASH_A, state: "not-published" },
              }),
            ],
          }),
        ),
      "snapshot.capability-invalid",
    );
  });

  it("rejects unknown fields, uppercase identities, unsafe lineage, and unsorted sets", () => {
    expectCode(
      () => parseCapabilitySnapshot({ ...snapshot(), accountNumber: "canary" }),
      "snapshot.invalid",
    );
    expectCode(
      () => parseCapabilitySnapshot(snapshot({ providerId: "Robinhood" })),
      "snapshot.invalid",
    );
    expectCode(
      () =>
        parseCapabilitySnapshot(
          snapshot({ registryRevision: 2, previousAdmittedSnapshotSha256: null }),
        ),
      "snapshot.invalid",
    );
    expectCode(
      () =>
        parseCapabilitySnapshot(
          snapshot({
            capabilities: [
              readCapability({ dataScopes: ["market-data", "account-identifiers"] }),
            ],
          }),
        ),
      "snapshot.capability-invalid",
    );
  });

  it("rejects accessors without invoking them", () => {
    let invoked = false;
    const input = snapshot() as CapabilitySnapshotV1 & Record<string, unknown>;
    Object.defineProperty(input, "providerId", {
      enumerable: true,
      get() {
        invoked = true;
        return "robinhood";
      },
    });
    expectCode(() => parseCapabilitySnapshot(input), "snapshot.invalid");
    expect(invoked).toBe(false);
  });
});

describe("strict exact-JCS snapshot bytes", () => {
  it("accepts exact JCS and returns the same semantic snapshot", () => {
    const input = snapshot();
    const bytes = new TextEncoder().encode(canonicalizeJcs(input));
    expect(parseExactJcsCapabilitySnapshotBytes(bytes)).toEqual(input);
  });

  it("rejects duplicate keys before semantic validation", () => {
    const jcs = canonicalizeJcs(snapshot()).replace(
      '"capabilities":',
      '"capabilities":[],"capabilities":',
    );
    expectCode(
      () => parseExactJcsCapabilitySnapshotBytes(new TextEncoder().encode(jcs)),
      "snapshot.bytes-duplicate-key",
    );
  });

  it("rejects invalid UTF-8, unpaired surrogates, BOM, and transport whitespace", () => {
    expectCode(
      () => parseExactJcsCapabilitySnapshotBytes(new Uint8Array([0xff, 0xfe])),
      "snapshot.bytes-invalid-utf8",
    );
    const unpaired = canonicalizeJcs(snapshot()).replace(
      '"sourceSeriesId":"public-docs"',
      '"sourceSeriesId":"\\ud800"',
    );
    expectCode(
      () => parseExactJcsCapabilitySnapshotBytes(new TextEncoder().encode(unpaired)),
      "snapshot.bytes-invalid-unicode",
    );
    expectCode(
      () =>
        parseExactJcsCapabilitySnapshotBytes(
          new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
        ),
      "snapshot.bytes-invalid",
    );
    expectCode(
      () =>
        parseExactJcsCapabilitySnapshotBytes(
          new TextEncoder().encode(`${canonicalizeJcs(snapshot())}\n`),
        ),
      "snapshot.bytes-noncanonical",
    );
  });

  it("bounds generic strict JSON depth and rejects malformed escapes", () => {
    const deep = new TextEncoder().encode(`${"[".repeat(34)}0${"]".repeat(34)}`);
    expect(() => parseStrictJson(deep)).toThrowError(StrictJsonError);
    expect(() => parseStrictJson(new TextEncoder().encode('"\\x"'))).toThrowError(
      expect.objectContaining<Partial<StrictJsonError>>({ code: "invalid-json" }),
    );
  });
});
