import {
  prepareProofCapsule,
  type CapsulePayloadMember,
  type PreparedProofCapsule,
} from "@runbook/capsule-author";
import {
  CAPSULE_CONTROL_MEMBER_NAMES,
  inspectProofCapsuleStatement,
  type ProofVerificationReceipt,
} from "@runbook/capsule-browser";
import {
  BENCH_PROFILE,
  SYNTHETIC_V0_CORPUS_MANIFEST,
  SYNTHETIC_V0_CORPUS_MANIFEST_SHA256,
  canonicalizeJcs,
  getSyntheticV0ScenarioDefinitions,
  parseFrozenSyntheticV0BenchReceipt,
  runFrozenSyntheticV0Bench,
  serializeBenchRunReceipt,
  sha256Jcs,
  sha256Utf8,
  type BenchRunReceipt,
} from "@runbook/financial-bench";

export const CONTROL_CARD_PROFILE = "runbook.synthetic-control-self-test-card.v0" as const;
export const CONTROL_CARD_EXPERIMENT_ID = "RUNBOOK-CONTROL-SELF-TEST-SYNTHETIC-V0" as const;
export const CONTROL_CARD_CLAIMS_SCHEMA = "runbook.synthetic-control-self-test-claims.v0" as const;
export const CONTROL_CARD_DISCLOSURES_SCHEMA = "runbook.synthetic-control-self-test-disclosures.v0" as const;
export const CONTROL_CARD_SCENARIOS_SCHEMA = "runbook.synthetic-control-self-test-scenarios.v0" as const;
export const CONTROL_CARD_VERIFICATION_SCHEMA = "runbook.synthetic-control-self-test-verification.v0" as const;

export const CONTROL_CARD_CORPUS_SHA256 = "50237521416134b941f924c4222d43bf4ed9b6ff2b81f810ef2a03f88bc15c12" as const;
export const CONTROL_CARD_CORPUS_MANIFEST_SHA256 = "7c36694e0ef17059bffe3f82f2b6da5089934b76eb5da53acd5085dd1ae95087" as const;
export const CONTROL_CARD_OUTCOMES_SHA256 = "a0588492aefea0213dcc322ef164cced829422b3692da29d7de62879e1647b96" as const;
export const CONTROL_CARD_MANIFEST_SHA256 = "f09d883e6bebfb53bcf352f4090ac4401a58c321c4efc804b6b3b840d8858404" as const;
export const CONTROL_CARD_SAMPLE_ARCHIVE_SHA256 = "4518e9957ffaefbb6f51ce8dddfe0129c9bf347a8227153508234c29b53af980" as const;
export const CONTROL_CARD_SAMPLE_CAPSULE_ID = "cc67ddf104d4e5ec2dd618927708dc7c8141e18d84bfd1f33ca3ae7d9e0e1fce" as const;
export const CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID = "sha256:deb2ded39dc26fce0e6085b6fc34bf6b5941913bbfe2ea614113cff9e004c170" as const;

export const CONTROL_CARD_DISCLOSURES = [
  "fixed-four-scenario-synthetic-corpus-only",
  "reference-control-self-test-not-agent-evaluation",
  "no-live-agent-model-mcp-client-broker-account-order-execution-or-capital-observed",
  "capability-snapshots-are-synthetic-source-reported-fixtures",
  "capsule-signature-uses-a-self-asserted-key-and-author-declared-time",
  "card-is-not-a-score-grade-certification-or-readiness-decision",
  "card-does-not-prove-identity-performance-safety-suitability-compliance-or-investment-skill",
  "same-project-node-browser-agreement-is-not-independent-verification",
] as const;

export const CONTROL_CARD_LIMITATIONS = [
  "synthetic-reference-control-only",
  "no-agent-model-mcp-client-or-broker-was-tested",
  "reproduced-findings-are-not-a-score-grade-certification-or-readiness-decision",
  "self-asserted-signature-does-not-prove-identity-or-independent-time",
  "card-does-not-prove-execution-performance-safety-suitability-compliance-or-investment-skill",
  "same-project-node-browser-agreement-is-not-independent-verification",
] as const;

const EMPTY_EVENT_HEAD = "0".repeat(64);
const ENCODER = new TextEncoder();
const REQUIRED_SCENARIO_IDS = [
  "scenario-01-wrong-account",
  "scenario-04-undocumented-tool",
  "scenario-05-mutation-capability-drift",
  "scenario-06-incompatible-schema-drift",
] as const;

type PayloadSpec = CapsulePayloadMember & { readonly text: string };
type ExpectedProfile = Readonly<{
  benchReceipt: BenchRunReceipt;
  manifestBytes: Uint8Array;
  manifestSha256: string;
  outcomesSha256: string;
  payloads: readonly PayloadSpec[];
}>;

export type PrepareControlCardInput = Readonly<{
  checkpointSequence: number;
  createdAt: string;
  publicKeySpkiDer: Uint8Array;
}>;

export type ControlCardChecks = Readonly<{
  completeCoverage: boolean;
  coreValid: boolean;
  corpusIdentity: boolean;
  exactMemberProfile: boolean;
  referenceReceiptReproduced: boolean;
  statementProfile: boolean;
}>;

export type ControlCardVerificationReceipt = Readonly<{
  authorKeyId: string | null;
  benchReceipt: BenchRunReceipt | null;
  capsuleId: string | null;
  checks: ControlCardChecks;
  limitations: typeof CONTROL_CARD_LIMITATIONS;
  profileVersion: typeof CONTROL_CARD_PROFILE;
  schemaVersion: typeof CONTROL_CARD_VERIFICATION_SCHEMA;
  valid: boolean;
}>;

function fail(code: string): never { throw new Error(code); }
function utf8(value: string) { return ENCODER.encode(value); }
function rawCompare(left: string, right: string) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function exactDataObject(value: unknown, expectedKeys: readonly string[]) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort(rawCompare);
  const expected = [...expectedKeys].sort(rawCompare);
  return sameStrings(keys, expected)
    && keys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true;
    });
}

function validatePrepareInput(value: unknown): PrepareControlCardInput {
  if (!exactDataObject(value, ["checkpointSequence", "createdAt", "publicKeySpkiDer"])) fail("control-card.input-invalid");
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.checkpointSequence) || (input.checkpointSequence as number) < 1
    || (input.checkpointSequence as number) > 10_000_000 || typeof input.createdAt !== "string"
    || !(input.publicKeySpkiDer instanceof Uint8Array)) fail("control-card.input-invalid");
  return {
    checkpointSequence: input.checkpointSequence as number,
    createdAt: input.createdAt,
    publicKeySpkiDer: new Uint8Array(input.publicKeySpkiDer),
  };
}

function reportHtml(receipt: BenchRunReceipt) {
  const scenarioRows = receipt.results.map((result) =>
    `<li><code>${result.scenarioId}</code>: expected finding set reproduced</li>`).join("");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Runbook synthetic control self-test</title></head>"
    + "<body><main><p>REFERENCE CONTROL SELF-TEST · SYNTHETIC ONLY · 4 OF 30 SCENARIOS IMPLEMENTED · NO AGENT OR BROKER CONNECTION</p>"
    + "<h1>Synthetic Control Self-Test Card</h1><p>Runbook's reference control evaluator reproduced the predetermined finding set for each listed synthetic fixture.</p>"
    + `<ul>${scenarioRows}</ul>`
    + "<p>No external agent, model, MCP client, broker, account, order, approval system, execution, side effect, or capital was invoked or observed.</p>"
    + "<p>This is not a score, grade, certification, readiness decision, or proof of identity, performance, safety, suitability, compliance, or investment skill.</p>"
    + "</main></body></html>";
}

function jsonText(value: unknown) { return canonicalizeJcs(value); }

function buildExpectedProfile(): ExpectedProfile {
  const definitions = getSyntheticV0ScenarioDefinitions();
  if (definitions.length !== REQUIRED_SCENARIO_IDS.length
    || !sameStrings(definitions.map((definition) => definition.scenarioId), REQUIRED_SCENARIO_IDS)) {
    fail("control-card.corpus-identity-invalid");
  }
  const corpusManifestSha256 = sha256Jcs(SYNTHETIC_V0_CORPUS_MANIFEST);
  if (corpusManifestSha256 !== CONTROL_CARD_CORPUS_MANIFEST_SHA256
    || corpusManifestSha256 !== SYNTHETIC_V0_CORPUS_MANIFEST_SHA256
    || SYNTHETIC_V0_CORPUS_MANIFEST.corpusSha256 !== CONTROL_CARD_CORPUS_SHA256) fail("control-card.corpus-identity-invalid");

  const benchReceipt = parseFrozenSyntheticV0BenchReceipt(runFrozenSyntheticV0Bench());
  const outcomeText = serializeBenchRunReceipt(benchReceipt);
  const outcomesSha256 = sha256Utf8(outcomeText);
  if (outcomesSha256 !== CONTROL_CARD_OUTCOMES_SHA256) fail("control-card.reference-receipt-invalid");
  const constitution = definitions[0]?.constitution;
  if (constitution === undefined || definitions.some((definition) => sha256Jcs(definition.constitution) !== sha256Jcs(constitution))) {
    fail("control-card.constitution-profile-invalid");
  }
  const claims = {
    corpusManifestSha256,
    dataClass: "synthetic",
    outcomeCode: "complete-frozen-corpus-expected-finding-sets-reproduced",
    outcomesSha256,
    profileVersion: CONTROL_CARD_PROFILE,
    scenarioCount: REQUIRED_SCENARIO_IDS.length,
    schemaVersion: CONTROL_CARD_CLAIMS_SCHEMA,
  } as const;
  const disclosures = {
    dataClass: "synthetic",
    limitations: CONTROL_CARD_DISCLOSURES,
    schemaVersion: CONTROL_CARD_DISCLOSURES_SCHEMA,
  } as const;
  const scenarios = {
    corpusManifest: SYNTHETIC_V0_CORPUS_MANIFEST,
    corpusManifestSha256,
    dataClass: "synthetic",
    definitions,
    profileVersion: BENCH_PROFILE,
    projectionType: "frozen-synthetic-scenario-definitions",
    schemaVersion: CONTROL_CARD_SCENARIOS_SCHEMA,
  } as const;
  const texts = [
    ["payload/charter.json", "charter", "application/json", jsonText(constitution)],
    ["payload/claims.json", "claims", "application/json", jsonText(claims)],
    ["payload/disclosures.json", "disclosures", "application/json", jsonText(disclosures)],
    ["payload/events.ndjson", "events", "application/x-ndjson", ""],
    ["payload/outcomes.json", "outcomes", "application/json", outcomeText],
    ["payload/report.html", "report", "text/html;charset=utf-8", reportHtml(benchReceipt)],
    ["payload/scenarios.json", "evidence-projection", "application/json", jsonText(scenarios)],
  ] as const;
  const payloads: PayloadSpec[] = texts.map(([path, role, mediaType, text]) => ({
    bytes: utf8(text), mediaType, path, role, text,
  }));
  const members = payloads.map((payload) => ({
    bytes: payload.bytes.byteLength,
    mediaType: payload.mediaType,
    path: payload.path,
    role: payload.role,
    sha256: sha256Utf8(payload.text),
  }));
  const manifestBytes = utf8(jsonText({
    capsuleProfile: "runbook.proof-capsule.v1",
    experimentId: CONTROL_CARD_EXPERIMENT_ID,
    lineage: { parents: [], relation: "root" },
    members,
    schemaVersion: "runbook.proof-manifest.v1",
  }));
  const manifestSha256 = sha256Utf8(new TextDecoder().decode(manifestBytes));
  if (manifestSha256 !== CONTROL_CARD_MANIFEST_SHA256) fail("control-card.manifest-profile-invalid");
  return Object.freeze({
    benchReceipt,
    manifestBytes,
    manifestSha256,
    outcomesSha256,
    payloads: Object.freeze(payloads),
  });
}

export async function prepareControlCard(
  inputValue: PrepareControlCardInput,
  options: { subtle?: SubtleCrypto } = {},
): Promise<PreparedProofCapsule> {
  const input = validatePrepareInput(inputValue);
  const profile = buildExpectedProfile();
  const request = {
    checkpointSequence: input.checkpointSequence,
    createdAt: input.createdAt,
    dataClass: "synthetic" as const,
    eventChain: { eventCount: 0, headHash: EMPTY_EVENT_HEAD },
    experimentId: CONTROL_CARD_EXPERIMENT_ID,
    lineage: { relation: "root" as const, parents: [] as const },
    payloads: profile.payloads.map(({ text: _text, ...payload }) => payload),
    publicKeySpkiDer: input.publicKeySpkiDer,
  };
  return prepareProofCapsule(request, options);
}

function validCompleteCoverage(receipt: BenchRunReceipt) {
  const coverage = receipt.coverage;
  return coverage.class === "frozen-synthetic-v0-complete"
    && coverage.corpusManifestSha256 === CONTROL_CARD_CORPUS_MANIFEST_SHA256
    && sameStrings(coverage.requiredScenarioIds, REQUIRED_SCENARIO_IDS)
    && receipt.results.length === REQUIRED_SCENARIO_IDS.length
    && sameStrings(receipt.results.map((result) => result.scenarioId), REQUIRED_SCENARIO_IDS)
    && receipt.results.every((result) => result.status === "pass")
    && receipt.counts.pass === REQUIRED_SCENARIO_IDS.length
    && receipt.counts.fail === 0 && receipt.counts["not-evaluable"] === 0
    && receipt.counts.skipped === 0 && receipt.counts.unsupported === 0;
}

function exactCoreMembers(core: ProofVerificationReceipt, profile: ExpectedProfile) {
  const expectedPaths = [...CAPSULE_CONTROL_MEMBER_NAMES, ...profile.payloads.map((payload) => payload.path)];
  if (!sameStrings(core.members.map((member) => member.path), expectedPaths)) return false;
  const members = new Map(core.members.map((member) => [member.path, member]));
  const manifest = members.get("runbook/manifest.json");
  if (manifest?.status !== "valid" || manifest.bytes !== profile.manifestBytes.byteLength || manifest.sha256 !== profile.manifestSha256) return false;
  return profile.payloads.every((payload) => {
    const member = members.get(payload.path);
    return member?.status === "valid" && member.bytes === payload.bytes.byteLength && member.sha256 === sha256Utf8(payload.text);
  });
}

export function evaluateControlCardProfile(
  archiveInput: Uint8Array,
  core: ProofVerificationReceipt,
): ControlCardVerificationReceipt {
  const archive = new Uint8Array(archiveInput);
  let profile: ExpectedProfile | null = null;
  try { profile = buildExpectedProfile(); } catch { profile = null; }
  const statement = inspectProofCapsuleStatement(archive);
  const coreValid = core.valid;
  const statementProfile = coreValid && statement?.dataClass === "synthetic"
    && statement.eventChain.eventCount === 0 && statement.eventChain.headHash === EMPTY_EVENT_HEAD
    && core.lineage.relation === "root" && core.lineage.parents.length === 0 && core.lineage.status === "root";
  const corpusIdentity = profile !== null
    && sha256Jcs(SYNTHETIC_V0_CORPUS_MANIFEST) === CONTROL_CARD_CORPUS_MANIFEST_SHA256;
  const completeCoverage = profile !== null && validCompleteCoverage(profile.benchReceipt);
  let referenceReceiptReproduced = false;
  if (profile !== null) {
    try {
      referenceReceiptReproduced = serializeBenchRunReceipt(parseFrozenSyntheticV0BenchReceipt(profile.benchReceipt))
        === serializeBenchRunReceipt(profile.benchReceipt);
    } catch { referenceReceiptReproduced = false; }
  }
  const exactMemberProfile = coreValid && profile !== null && exactCoreMembers(core, profile);
  const checks: ControlCardChecks = {
    completeCoverage,
    coreValid,
    corpusIdentity,
    exactMemberProfile,
    referenceReceiptReproduced,
    statementProfile,
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    authorKeyId: core.authorKeyId,
    benchReceipt: valid && profile !== null ? profile.benchReceipt : null,
    capsuleId: core.capsuleId,
    checks,
    limitations: CONTROL_CARD_LIMITATIONS,
    profileVersion: CONTROL_CARD_PROFILE,
    schemaVersion: CONTROL_CARD_VERIFICATION_SCHEMA,
    valid,
  };
}

export function serializeControlCardVerificationReceipt(receipt: ControlCardVerificationReceipt) {
  return utf8(canonicalizeJcs(receipt));
}

export function controlCardProfileSnapshot() {
  const profile = buildExpectedProfile();
  return Object.freeze({
    corpusManifestSha256: CONTROL_CARD_CORPUS_MANIFEST_SHA256,
    corpusSha256: CONTROL_CARD_CORPUS_SHA256,
    manifestBytes: new Uint8Array(profile.manifestBytes),
    manifestSha256: profile.manifestSha256,
    outcomesSha256: profile.outcomesSha256,
    payloads: Object.freeze(profile.payloads.map((payload) => Object.freeze({
      bytes: payload.bytes.byteLength,
      mediaType: payload.mediaType,
      path: payload.path,
      role: payload.role,
      sha256: sha256Utf8(payload.text),
    }))),
  });
}
