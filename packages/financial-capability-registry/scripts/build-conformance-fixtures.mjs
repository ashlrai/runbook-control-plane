import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const declarationDir = resolve(packageDir, "conformance/v1");
const outputDir = process.argv[2] === undefined
  ? resolve(packageDir, "conformance/v1")
  : resolve(process.argv[2]);
const robinhoodDir = resolve(packageDir, "fixtures/robinhood");
const encoder = new TextEncoder();
const evidenceSha256 = "e".repeat(64);

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalizeJcs(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error("oracle.noncanonical-number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJcs).join(",")}]`;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("oracle.unsupported-value");
  }
  return `{${Object.keys(value).sort(compareCodeUnits).map((key) =>
    `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`).join(",")}}`;
}

function sha256Jcs(value) {
  return hashBytes(encoder.encode(canonicalizeJcs(value)));
}

function bytes(value) {
  return encoder.encode(canonicalizeJcs(value));
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactDeclaration(name) {
  const declarationBytes = readFileSync(resolve(declarationDir, name));
  const declaration = JSON.parse(new TextDecoder().decode(declarationBytes));
  if (canonicalizeJcs(declaration) !== new TextDecoder().decode(declarationBytes)) {
    throw new Error(`declaration.${name}-noncanonical`);
  }
  return declaration;
}

const oracleDeclaration = exactDeclaration("oracle-declarations.jcs");
const reviewDeclaration = exactDeclaration("review-declarations.jcs");
const oracleByCaseId = new Map(oracleDeclaration.oracles.map((entry) => [
  entry.caseId,
  encoder.encode(entry.outputUtf8),
]));
const reviewByCaseId = new Map(reviewDeclaration.reviewArtifacts.map((entry) => [
  entry.caseId,
  entry.reviewArtifact,
]));
const reviewerSpki = new Uint8Array(Buffer.from(
  reviewDeclaration.reviewerSpkiBase64,
  "base64",
));
const reviewerKeyId = `sha256:${hashBytes(reviewerSpki)}`;

function contract(state = "not-published", sha256 = null) {
  return { sha256, state };
}

function noApproval() {
  return {
    actionBinding: "none",
    bypassCondition: "none",
    enforcingPrincipal: "none",
    expiryBinding: "none",
    mode: "none",
    scopeBinding: "none",
  };
}

function requiredApproval() {
  return {
    actionBinding: "exact-action",
    bypassCondition: "none",
    enforcingPrincipal: "provider",
    expiryBinding: "fixed",
    mode: "mandatory",
    scopeBinding: "single-action",
  };
}

function capability(capabilityId, overrides = {}) {
  const providerToolName = capabilityId.replaceAll(".", "_");
  return {
    accountScope: "dedicated-account",
    actionFamilies: ["market-observation"],
    approvalSemantics: noApproval(),
    capitalAuthority: { assetScopes: [], operations: [] },
    capabilityId,
    credentialRelease: "none",
    dataScopes: ["market-data"],
    decisionInfluence: "none",
    descriptionContract: contract("not-captured"),
    identityEvidence: "public-explicit",
    identityKind: "published-tool-name",
    mutationClass: "read",
    mutationScopes: ["none"],
    providerToolName,
    requestContract: contract(),
    responseContract: contract(),
    riskEvidence: "public-derived",
    sourceAssertionSha256: sha256Jcs({ capabilityId, kind: "source-assertion" }),
    sourceIds: ["synthetic-public-documentation"],
    stateReadDomains: ["none"],
    stateWriteDomains: ["none"],
    workflowPrerequisiteCapabilityIds: [],
    ...overrides,
  };
}

function baseCapabilities() {
  return [
    capability("privacy.account_canary", {
      providerToolName: "account_8675309",
    }),
    capability("privacy.card_canary", {
      providerToolName: "card_4111111111111111",
    }),
    capability("privacy.credential_canary", {
      providerToolName: "credential_secret_canary",
    }),
    capability("privacy.model_description_canary", {
      providerToolName: "model_description_canary",
    }),
    capability("privacy.payment_canary", {
      providerToolName: "payment_credential_canary",
    }),
    capability("privacy.schema_canary", {
      providerToolName: "schema_contract_canary",
    }),
    capability("synthetic.observe"),
    capability("synthetic.review", {
      actionFamilies: ["order-review"],
      approvalSemantics: {
        actionBinding: "unknown",
        bypassCondition: "unknown",
        enforcingPrincipal: "unknown",
        expiryBinding: "unknown",
        mode: "advisory",
        scopeBinding: "unknown",
      },
      capitalAuthority: { assetScopes: ["equity"], operations: ["preview"] },
      dataScopes: ["order-data"],
      decisionInfluence: "direct",
      stateReadDomains: ["order-state"],
    }),
    capability("synthetic.place", {
      actionFamilies: ["order-submission"],
      approvalSemantics: requiredApproval(),
      capitalAuthority: { assetScopes: ["equity"], operations: ["submit"] },
      dataScopes: ["order-data"],
      decisionInfluence: "direct",
      mutationClass: "capital-moving",
      mutationScopes: ["capital-orders"],
      stateReadDomains: ["order-state"],
      stateWriteDomains: ["order-state"],
      workflowPrerequisiteCapabilityIds: ["synthetic.review"],
    }),
    capability("synthetic.scan_reader", {
      actionFamilies: ["order-review"],
      capitalAuthority: { assetScopes: ["equity"], operations: ["preview"] },
      dataScopes: ["order-data", "scans"],
      decisionInfluence: "direct",
      stateReadDomains: ["research-state"],
    }),
    capability("synthetic.scanner_writer", {
      actionFamilies: ["research-state-management"],
      dataScopes: ["scans"],
      decisionInfluence: "indirect",
      mutationClass: "reversible",
      mutationScopes: ["research-state"],
      stateReadDomains: ["research-state"],
    }),
    capability("synthetic.watchlist_writer", {
      actionFamilies: ["research-state-management"],
      dataScopes: ["watchlists"],
      decisionInfluence: "indirect",
      mutationClass: "reversible",
      mutationScopes: ["research-state"],
      stateReadDomains: ["research-state"],
    }),
  ].sort((left, right) => left.capabilityId < right.capabilityId ? -1 : 1);
}

function source(overrides = {}) {
  return {
    authority: "public-documentation",
    completeness: "complete-enumeration",
    publicUri: "https://example.invalid/runbook-conformance-v1",
    retrievedAtDeclared: "2026-07-22T07:00:00Z",
    sourceId: "synthetic-public-documentation",
    sourceProjectionSha256: "1".repeat(64),
    ...overrides,
  };
}

function baselineSnapshot(overrides = {}) {
  return {
    capabilities: baseCapabilities(),
    observedAtDeclared: "2026-07-22T08:00:00Z",
    previousAdmittedSnapshotSha256: null,
    productId: "synthetic-financial-agent",
    profileVersion: "runbook.financial-capability-registry.v1",
    providerId: "synthetic-provider",
    registryRevision: 1,
    schemaVersion: "runbook.financial-capability-snapshot.v1",
    sourceSeriesId: "synthetic-public-documentation",
    sources: [source()],
    ...overrides,
  };
}

function candidateFrom(baseline, transform = (value) => value) {
  const candidate = {
    ...structuredClone(baseline),
    observedAtDeclared: "2026-07-22T08:30:00Z",
    previousAdmittedSnapshotSha256: sha256Jcs(baseline),
    registryRevision: baseline.registryRevision + 1,
    sources: baseline.sources.map((entry) => ({
      ...entry,
      retrievedAtDeclared: "2026-07-22T08:00:00Z",
    })),
  };
  const output = transform(candidate) ?? candidate;
  output.capabilities.sort((left, right) =>
    left.capabilityId < right.capabilityId ? -1 : left.capabilityId > right.capabilityId ? 1 : 0
  );
  output.sources.sort((left, right) => left.sourceId < right.sourceId ? -1 : 1);
  return output;
}

function mutateCapability(snapshot, capabilityId, transform) {
  snapshot.capabilities = snapshot.capabilities.map((entry) =>
    entry.capabilityId === capabilityId ? transform(structuredClone(entry)) : entry
  );
  return snapshot;
}

function policy(overrides = {}) {
  return {
    allowedSourceAuthorities: ["public-documentation"],
    maximumCandidateAgeSeconds: 86_400,
    maximumFutureSkewSeconds: 60,
    maximumReviewValiditySeconds: 86_400,
    partialSourceOmissionDecision: "reject",
    policyId: "synthetic-policy-v1",
    productId: "synthetic-financial-agent",
    profileVersion: "runbook.financial-capability-registry.v1",
    providerId: "synthetic-provider",
    requiredEvidenceSha256: [evidenceSha256],
    requireReviewForMaterialChanges: true,
    schemaVersion: "runbook.financial-capability-admission-policy.v1",
    sourceSeriesId: "synthetic-public-documentation",
    trustedReviewerKeyIds: [reviewerKeyId],
    unknownRiskDecision: "reject",
    ...overrides,
  };
}

function declaredReview(caseId) {
  const review = reviewByCaseId.get(caseId);
  if (review === undefined) throw new Error(`declaration.review-${caseId}-missing`);
  return structuredClone(review);
}

const cases = [];
function add(caseId, title, expectedDisposition, requiredCodes, setup, options = {}) {
  cases.push({
    caseId: String(caseId).padStart(3, "0"),
    expectedCodeCounts: options.expectedCodeCounts ?? {},
    expectedDisposition,
    forbiddenCodes: options.forbiddenCodes ?? [],
    operation: options.operation ?? "admit",
    requiredCodes,
    setup,
    title,
  });
}

const base = baselineSnapshot();
const ordinaryChange = () => candidateFrom(base, (value) => mutateCapability(
  value,
  "synthetic.observe",
  (entry) => ({ ...entry, sourceAssertionSha256: "2".repeat(64) }),
));

add(1, "duplicate JSON key in snapshot bytes", "invalid-artifact", ["snapshot.invalid"], () => ({
  targetBytes: Buffer.from(canonicalizeJcs(base).replace(
    '"productId":"synthetic-financial-agent"',
    '"productId":"synthetic-financial-agent","productId":"duplicate"',
  )),
}), { operation: "verify-snapshot" });
add(2, "invalid UTF-8", "invalid-artifact", ["snapshot.invalid"], () => ({
  targetBytes: Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]),
}), { operation: "verify-snapshot" });
add(3, "unpaired Unicode surrogate", "invalid-artifact", ["snapshot.invalid"], () => ({
  targetBytes: Buffer.from(canonicalizeJcs(base).replace(
    '"providerId":"synthetic-provider"',
    '"providerId":"\\ud800"',
  )),
}), { operation: "verify-snapshot" });
add(4, "unknown field or enum", "invalid-artifact", ["snapshot.invalid"], () => ({
  targetBytes: Buffer.from(canonicalizeJcs(base).replace(/}$/, ',"unknownField":true}')),
}), { operation: "verify-snapshot" });
add(5, "excess structural depth", "invalid-artifact", ["snapshot.invalid"], () => ({
  targetBytes: Buffer.from(`${"[".repeat(66)}0${"]".repeat(66)}`),
}), { operation: "verify-snapshot" });
add(6, "duplicate capability identity", "invalid-artifact", ["snapshot.invalid"], () => ({
  targetBytes: bytes({ ...base, capabilities: [base.capabilities[0], base.capabilities[0]] }),
}), { operation: "verify-snapshot" });
add(7, "duplicate provider tool name", "invalid-artifact", ["snapshot.invalid"], () => {
  const caps = structuredClone(base.capabilities.slice(0, 2));
  caps[1].providerToolName = caps[0].providerToolName;
  return { targetBytes: bytes({ ...base, capabilities: caps }) };
}, { operation: "verify-snapshot" });
add(8, "non-ASCII or uppercase identity", "invalid-artifact", ["snapshot.invalid"], () => {
  const caps = structuredClone(base.capabilities);
  caps[0].capabilityId = "Synthetic.observe";
  return { targetBytes: bytes({ ...base, capabilities: caps }) };
}, { operation: "verify-snapshot" });
add(9, "unsorted closed-set members", "invalid-artifact", ["snapshot.invalid"], () => {
  const caps = structuredClone(base.capabilities);
  caps[0].dataScopes = ["market-data", "account-balances"];
  return { targetBytes: bytes({ ...base, capabilities: caps }) };
}, { operation: "verify-snapshot" });
add(10, "known contract without digest", "invalid-artifact", ["snapshot.invalid"], () => {
  const caps = structuredClone(base.capabilities);
  caps[0].requestContract = contract("known");
  return { targetBytes: bytes({ ...base, capabilities: caps }) };
}, { operation: "verify-snapshot" });

add(11, "provider mismatch", "reject", ["registry-provider-mismatch"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => ({ ...value, providerId: "another-provider" })),
  policy: policy(),
}));
add(12, "product mismatch", "reject", ["registry-product-mismatch"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => ({ ...value, productId: "another-product" })),
  policy: policy(),
}));
add(13, "documentation and runtime series mismatch", "reject", ["registry-source-series-mismatch"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => ({ ...value, sourceSeriesId: "synthetic-runtime-discovery" })),
  policy: policy(),
}));
add(14, "authenticated-runtime authority is disallowed by the documentation policy", "reject", ["source-authority-untrusted"], () => {
  const candidate = candidateFrom(base);
  candidate.sources = [source({
    authority: "authenticated-runtime-discovery",
    publicUri: null,
  })];
  candidate.capabilities = candidate.capabilities.map((entry) => ({
    ...entry,
    identityEvidence: "runtime-confirmed",
    identityKind: "runtime-tool-name",
    riskEvidence: "runtime-confirmed",
  }));
  return { baseline: base, candidate, policy: policy() };
});
add(15, "controlled-exercise authority is disallowed by the documentation policy", "reject", ["source-authority-untrusted"], () => {
  const candidate = candidateFrom(base);
  candidate.sources = [source({
    authority: "controlled-runtime-exercise",
    publicUri: null,
  })];
  candidate.capabilities = candidate.capabilities.map((entry) => ({
    ...entry,
    identityEvidence: "runtime-exercised",
    identityKind: "runtime-tool-name",
    riskEvidence: "runtime-exercised",
  }));
  return { baseline: base, candidate, policy: policy() };
});
add(16, "partial source omits a baseline capability", "reject", ["source-completeness-insufficient"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => {
    value.capabilities = value.capabilities.filter((entry) => entry.capabilityId !== "synthetic.observe");
    value.sources = value.sources.map((entry) => ({ ...entry, completeness: "partial-enumeration" }));
    return value;
  }),
  policy: policy(),
}), { forbiddenCodes: ["capability-removed"] });
add(17, "candidate names another previous head", "reject", ["registry-baseline-mismatch"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => ({ ...value, previousAdmittedSnapshotSha256: "0".repeat(64) })),
  policy: policy(),
}));
add(18, "candidate skips a revision", "reject", ["registry-revision-invalid"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => ({ ...value, registryRevision: 3 })),
  policy: policy(),
}));
add(19, "invalid calendar date", "invalid-artifact", ["snapshot.invalid"], () => ({
  targetBytes: Buffer.from(canonicalizeJcs(base).replace(
    '"observedAtDeclared":"2026-07-22T08:00:00Z"',
    '"observedAtDeclared":"2026-02-30T08:00:00Z"',
  )),
}), { operation: "verify-snapshot" });
add(20, "observation exceeds future skew", "reject", ["snapshot-time-future"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => ({ ...value, observedAtDeclared: "2026-07-22T10:00:00Z" })),
  policy: policy(),
}));
add(21, "observation time regresses", "reject", ["snapshot-time-regressed"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => ({
    ...value,
    observedAtDeclared: "2026-07-22T07:30:00Z",
    sources: value.sources.map((entry) => ({
      ...entry,
      retrievedAtDeclared: "2026-07-22T07:00:00Z",
    })),
  })),
  policy: policy(),
}));
add(22, "frozen Robinhood public inventory changes from 45 to 50", "quarantine", ["capability-added", "review-required"], () => ({
  baselineBytes: readFileSync(resolve(robinhoodDir, "trading-45-snapshot.jcs")),
  candidateBytes: readFileSync(resolve(robinhoodDir, "trading-50-snapshot.jcs")),
  policyBytes: readFileSync(resolve(robinhoodDir, "public-docs-review-required-policy.jcs")),
}), { expectedCodeCounts: { "capability-added": 5 } });
add(23, "new placement surface claims read-only", "quarantine", ["capability-added", "policy-coverage-invalidated", "review-required"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => {
    value.capabilities.push(capability("synthetic.read_labeled_place", {
      actionFamilies: ["order-submission"],
      dataScopes: ["order-data"],
    }));
    return value;
  }),
  policy: policy(),
}));
add(24, "workflow prerequisite removed", "quarantine", ["capability-removed", "capability-workflow-prerequisite-removed"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => {
    value.capabilities = value.capabilities
      .filter((entry) => entry.capabilityId !== "synthetic.review")
      .map((entry) => entry.capabilityId === "synthetic.place"
        ? { ...entry, workflowPrerequisiteCapabilityIds: [] }
        : entry);
    return value;
  }),
  policy: policy(),
}));
add(25, "similar labels do not infer rename", "quarantine", ["capability-added", "capability-removed"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => {
    value.capabilities = value.capabilities.filter((entry) => entry.capabilityId !== "synthetic.observe");
    value.capabilities.push(capability("synthetic.observe_v2", { providerToolName: "synthetic_observe_v2" }));
    return value;
  }),
  policy: policy(),
}), { forbiddenCodes: ["capability-renamed"] });
add(26, "stable capability changes provider tool name", "quarantine", ["capability-renamed", "review-required"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
    ...entry,
    providerToolName: "synthetic_observe_v2",
  }))),
  policy: policy(),
}));
add(27, "same-name request schema substitution", "quarantine", ["capability-input-schema-changed", "policy-coverage-invalidated", "scenarios-rerun-required"], () => {
  const withSchema = mutateCapability(structuredClone(base), "synthetic.observe", (entry) => ({
    ...entry,
    requestContract: contract("known", "3".repeat(64)),
  }));
  return {
    baseline: withSchema,
    candidate: candidateFrom(withSchema, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
      ...entry,
      requestContract: contract("known", "4".repeat(64)),
    }))),
    policy: policy(),
  };
});
add(28, "same-name response schema substitution", "quarantine", ["capability-output-schema-changed", "policy-coverage-invalidated", "scenarios-rerun-required"], () => {
  const withSchema = mutateCapability(structuredClone(base), "synthetic.observe", (entry) => ({
    ...entry,
    responseContract: contract("known", "3".repeat(64)),
  }));
  return {
    baseline: withSchema,
    candidate: candidateFrom(withSchema, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
      ...entry,
      responseContract: contract("known", "4".repeat(64)),
    }))),
    policy: policy(),
  };
});
add(29, "known schema visibility is lost", "quarantine", ["capability-schema-visibility-lost"], () => {
  const withSchema = mutateCapability(structuredClone(base), "synthetic.observe", (entry) => ({
    ...entry,
    requestContract: contract("known", "3".repeat(64)),
  }));
  return {
    baseline: withSchema,
    candidate: candidateFrom(withSchema, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
      ...entry,
      requestContract: contract("not-published"),
    }))),
    policy: policy(),
  };
});
add(30, "review surface gains submission family", "quarantine", ["capability-action-families-changed", "policy-coverage-invalidated"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.review", (entry) => ({
    ...entry,
    actionFamilies: ["order-review", "order-submission"],
  }))),
  policy: policy(),
}));
add(31, "capital-moving surface is relabeled read", "quarantine", ["capability-mutation-class-changed", "capability-risk-classification-reduced"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.place", (entry) => ({
    ...entry,
    mutationClass: "read",
  }))),
  policy: policy(),
}));
add(32, "account reach expands to all linked accounts", "quarantine", ["capability-account-scope-expanded"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
    ...entry,
    accountScope: "all-linked-accounts",
  }))),
  policy: policy(),
}));
add(33, "data reach expands to account identifiers", "quarantine", ["capability-data-scope-expanded"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
    ...entry,
    dataScopes: ["account-identifiers", "market-data"],
  }))),
  policy: policy(),
}));
add(34, "credential release expands from none", "quarantine", ["capability-credential-release-expanded"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
    ...entry,
    credentialRelease: "api-credential",
    mutationClass: "reversible",
    mutationScopes: ["credential-release"],
  }))),
  policy: policy(),
}));
add(35, "preview authority gains submit", "quarantine", ["capability-capital-authority-expanded"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.review", (entry) => ({
    ...entry,
    capitalAuthority: { assetScopes: ["equity"], operations: ["preview", "submit"] },
    mutationClass: "capital-moving",
    mutationScopes: ["capital-orders"],
  }))),
  policy: policy(),
}));
add(36, "mandatory approval becomes optional", "quarantine", ["capability-approval-semantics-changed", "capability-approval-semantics-weakened"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.place", (entry) => ({
    ...entry,
    approvalSemantics: { ...entry.approvalSemantics, mode: "optional" },
  }))),
  policy: policy(),
}));
add(37, "review surface substituted for provider enforcement", "quarantine", ["capability-approval-semantics-incomparable", "policy-coverage-invalidated"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.place", (entry) => ({
    ...entry,
    approvalSemantics: {
      ...entry.approvalSemantics,
      enforcingPrincipal: "customer",
      mode: "advisory",
    },
  }))),
  policy: policy(),
}));
add(38, "watchlist writer gains selection influence path", "quarantine", ["capability-state-influence-path-added", "scenarios-rerun-required"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.watchlist_writer", (entry) => ({
    ...entry,
    stateWriteDomains: ["research-state"],
  }))),
  policy: policy(),
}));
add(39, "scanner writer gains capital-selection influence path", "quarantine", ["capability-state-influence-path-added", "scenarios-rerun-required"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(value, "synthetic.scanner_writer", (entry) => ({
    ...entry,
    stateWriteDomains: ["research-state"],
  }))),
  policy: policy(),
}));
add(40, "model-visible description digest changes", "quarantine", ["capability-description-changed", "review-required"], () => {
  const withDescription = mutateCapability(structuredClone(base), "synthetic.observe", (entry) => ({
    ...entry,
    descriptionContract: contract("known", "5".repeat(64)),
  }));
  return {
    baseline: withDescription,
    candidate: candidateFrom(withDescription, (value) => mutateCapability(value, "synthetic.observe", (entry) => ({
      ...entry,
      descriptionContract: contract("known", "6".repeat(64)),
    }))),
    policy: policy(),
  };
});
add(41, "source assertion changes while fields remain equal", "quarantine", ["source-assertion-changed", "review-required"], () => ({
  baseline: base,
  candidate: ordinaryChange(),
  policy: policy(),
}));
add(42, "material candidate has no review", "quarantine", ["review-required"], () => ({
  baseline: base,
  candidate: candidateFrom(base, (value) => mutateCapability(
    value,
    "synthetic.observe",
    (entry) => ({ ...entry, decisionInfluence: "indirect" }),
  )),
  policy: policy(),
}));
add(43, "review binds a different policy", "reject", ["review-binding-mismatch"], () => {
  const candidate = ordinaryChange();
  const admissionPolicy = policy();
  return {
    baseline: base,
    candidate,
    policy: admissionPolicy,
    review: declaredReview("043"),
    reviewerSpki,
  };
});
add(44, "review is expired", "reject", ["review-expired"], () => {
  const candidate = ordinaryChange();
  const admissionPolicy = policy();
  return {
    baseline: base,
    candidate,
    policy: admissionPolicy,
    review: declaredReview("044"),
    reviewerSpki,
  };
});
add(45, "review signature is wrong", "reject", ["review-signature-invalid"], () => {
  const candidate = ordinaryChange();
  const admissionPolicy = policy();
  return {
    baseline: base,
    candidate,
    policy: admissionPolicy,
    review: declaredReview("045"),
    reviewerSpki,
  };
});
add(46, "one material review decision is omitted", "reject", ["review-change-uncovered"], () => {
  const candidate = candidateFrom(base, (value) => {
    mutateCapability(value, "synthetic.observe", (entry) => ({ ...entry, sourceAssertionSha256: "2".repeat(64) }));
    mutateCapability(value, "synthetic.review", (entry) => ({ ...entry, sourceAssertionSha256: "3".repeat(64) }));
    return value;
  });
  const admissionPolicy = policy();
  return {
    baseline: base,
    candidate,
    policy: admissionPolicy,
    review: declaredReview("046"),
    reviewerSpki,
  };
});
add(47, "one explicit review decision denies", "quarantine", ["review-denied"], () => {
  const candidate = ordinaryChange();
  const admissionPolicy = policy();
  return {
    baseline: base,
    candidate,
    policy: admissionPolicy,
    review: declaredReview("047"),
    reviewerSpki,
  };
});
add(48, "required evidence binding is absent", "reject", ["review-evidence-missing"], () => {
  const candidate = ordinaryChange();
  const admissionPolicy = policy();
  return {
    baseline: base,
    candidate,
    policy: admissionPolicy,
    review: declaredReview("048"),
    reviewerSpki,
  };
});
add(49, "review replayed after baseline advances", "reject", ["registry-baseline-mismatch"], () => {
  const candidate = ordinaryChange();
  const admissionPolicy = policy();
  const replayed = { ...candidate, previousAdmittedSnapshotSha256: "9".repeat(64) };
  return {
    baseline: base,
    candidate: replayed,
    policy: admissionPolicy,
    review: declaredReview("049"),
    reviewerSpki,
  };
});
add(50, "exact bounded trusted review admits", "admit", [], () => {
  const candidate = ordinaryChange();
  const admissionPolicy = policy();
  return {
    baseline: base,
    candidate,
    policy: admissionPolicy,
    review: declaredReview("050"),
    reviewerSpki,
  };
});
add(51, "Robinhood risk correction advances revision without rewriting history", "reject", [
  "capability-mutation-class-changed",
  "capability-unknown-risk-semantics",
  "unknown-risk-absent",
], () => ({
  baselineBytes: readFileSync(resolve(robinhoodDir, "trading-50-snapshot.jcs")),
  candidateBytes: readFileSync(resolve(robinhoodDir, "trading-50-risk-correction-snapshot.jcs")),
  policyBytes: readFileSync(resolve(robinhoodDir, "public-docs-review-required-policy.jcs")),
}), { expectedCodeCounts: { "capability-mutation-class-changed": 5 } });

if (cases.length !== 51) throw new Error(`expected 51 cases, found ${cases.length}`);
if (oracleByCaseId.size !== 51) {
  throw new Error(`expected 51 declared oracles, found ${oracleByCaseId.size}`);
}

rmSync(resolve(outputDir, "cases"), { force: true, recursive: true });
mkdirSync(resolve(outputDir, "cases"), { recursive: true });

function fileRecord(relativePath, fileBytes) {
  const absolutePath = resolve(outputDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, fileBytes);
  return { path: relativePath, sha256: hashBytes(fileBytes) };
}

const manifestCases = [];
for (const definition of cases) {
  const setup = definition.setup();
  const prefix = `cases/${definition.caseId}`;
  const input = {
    baselineSnapshot: null,
    candidateSnapshot: null,
    policy: null,
    reviewArtifact: null,
    reviewerSpki: null,
    targetSnapshot: null,
  };
  const oracleBytes = oracleByCaseId.get(definition.caseId);
  if (oracleBytes === undefined) {
    throw new Error(`declaration.oracle-${definition.caseId}-missing`);
  }
  const declaredOutput = JSON.parse(new TextDecoder().decode(oracleBytes));
  if (canonicalizeJcs(declaredOutput) !== new TextDecoder().decode(oracleBytes)) {
    throw new Error(`declaration.oracle-${definition.caseId}-noncanonical`);
  }
  if (definition.operation === "verify-snapshot") {
    input.targetSnapshot = fileRecord(`${prefix}/target-snapshot.jcs`, setup.targetBytes);
    if (declaredOutput.kind !== "validation-error") {
      throw new Error(`declaration.oracle-${definition.caseId}-kind-invalid`);
    }
  } else {
    const baselineBytes = setup.baselineBytes ?? bytes(setup.baseline);
    const candidateBytes = setup.candidateBytes ?? bytes(setup.candidate);
    const policyBytes = setup.policyBytes ?? bytes(setup.policy);
    input.baselineSnapshot = fileRecord(`${prefix}/baseline-snapshot.jcs`, baselineBytes);
    input.candidateSnapshot = fileRecord(`${prefix}/candidate-snapshot.jcs`, candidateBytes);
    input.policy = fileRecord(`${prefix}/policy.jcs`, policyBytes);
    let reviewArtifactBytes;
    let keyBytes;
    if (setup.review !== undefined) {
      reviewArtifactBytes = bytes(setup.review);
      keyBytes = setup.reviewerSpki;
      input.reviewArtifact = fileRecord(`${prefix}/review-artifact.jcs`, reviewArtifactBytes);
      input.reviewerSpki = fileRecord(`${prefix}/reviewer.spki.der`, keyBytes);
    }
    if (declaredOutput.outcome !== definition.expectedDisposition) {
      throw new Error(
        `declaration.oracle-${definition.caseId}-disposition-mismatch`,
      );
    }
  }
  const oracle = fileRecord(`${prefix}/expected-output.jcs`, oracleBytes);
  manifestCases.push({
    caseId: definition.caseId,
    evaluatedAtDeclared: definition.operation === "admit" ? "2026-07-22T09:00:00Z" : null,
    expectedCodeCounts: definition.expectedCodeCounts ?? {},
    expectedDisposition: definition.expectedDisposition,
    forbiddenCodes: definition.forbiddenCodes,
    input,
    operation: definition.operation,
    oracle,
    requiredCodes: definition.requiredCodes,
    title: definition.title,
  });
}

const manifest = {
  cases: manifestCases,
  forbiddenOutputUtf8: [
    "synthetic_observe",
    "get_equity_tax_lots",
    "https://robinhood.com/",
    "https://example.invalid/",
    "model_description_canary",
    "schema_contract_canary",
    "account_8675309",
    "card_4111111111111111",
    "payment_credential_canary",
    "credential_secret_canary",
  ],
  profileVersion: "runbook.financial-capability-registry.v1",
  schemaVersion: "runbook.financial-capability-conformance-manifest.v1",
};
writeFileSync(resolve(outputDir, "manifest.jcs"), bytes(manifest));
