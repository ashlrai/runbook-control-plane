import {
  prepareProofCapsule,
  serializeJcs,
  type CapsulePayloadMember,
  type PreparedProofCapsule,
} from "@runbook/capsule-author";
import {
  inspectProofCapsuleStatement,
  verifyProofCapsule,
  type ProofCapsuleStatementMetadata,
  type ProofVerificationReceipt,
} from "@runbook/capsule-browser";

export const CREATOR_CHARTER_SCHEMA = "runbook.creator-charter.v1";
export const CREATOR_TEMPLATE_ID = "runbook.synthetic-policy-lab.v1";
export const CREATOR_FORK_RECEIPT_SCHEMA = "runbook.creator-fork-verification.v1";
export const CREATOR_SEED_CAPSULE_ID = "2f5f3d9f2f7cdf7af0f9b6d6ba290c31609623bf1acccb0f46f3bd716fc6fb64";
export const CREATOR_SEED_AUTHOR_KEY_ID = "sha256:06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9";

export type CreatorPolicy = {
  approvalMode: "human-required";
  drawdownStopBps: number;
  leverageAllowed: false;
  maxDailyProposals: number;
  maxPositionBps: number;
  minimumEvidenceSources: number;
};
export type CreatorRulePath = "policy.drawdownStopBps" | "policy.maxDailyProposals" | "policy.maxPositionBps" | "policy.minimumEvidenceSources";
export type CreatorReasonCode = "reduce-concentration" | "tighten-loss-stop" | "reduce-action-frequency" | "raise-evidence-bar";
export type CreatorChangedRule = { from: number; path: CreatorRulePath; reasonCode: CreatorReasonCode; to: number };
export type CreatorCharter = {
  benchmarkCode: "same-synthetic-sequence";
  dataClass: "synthetic";
  fork: { changedRule: CreatorChangedRule | null };
  policy: CreatorPolicy;
  questionCode: "policy-sensitivity";
  schemaVersion: "runbook.creator-charter.v1";
  templateId: "runbook.synthetic-policy-lab.v1";
  window: { count: 2; unit: "fixture-proposals" };
};
export type CreatorForkChoice = "concentration" | "drawdown" | "evidence" | "frequency";
export type SyntheticPolicyResult = { decision: "human-review" | "rejected"; failedRules: CreatorRulePath[]; inputCode: "boundary-proposal-v1"; schemaVersion: "runbook.synthetic-policy-result.v1" };
export type VerifiedCreatorSeed = { readonly capsuleId: typeof CREATOR_SEED_CAPSULE_ID; readonly receipt: ProofVerificationReceipt };
export type PreparedCreatorFork = { readonly charter: CreatorCharter; readonly prepared: PreparedProofCapsule };
export type CreatorForkReceipt = {
  checks: { childCoreValid: boolean; childNamesExactParent: boolean; exactOneAllowedRuleChanged: boolean; fixedSyntheticProfile: boolean; parentCoreValid: boolean; policyDeltaRecomputed: boolean };
  childCapsuleId: string | null;
  changedRule: CreatorChangedRule | null;
  limitations: readonly ["domain-check-does-not-prove-parent-consent", "domain-check-does-not-prove-common-authorship", "domain-check-does-not-prove-broker-activity", "domain-check-does-not-prove-identity-performance-skill-suitability-or-compliance"];
  parentCapsuleId: string | null;
  schemaVersion: "runbook.creator-fork-verification.v1";
  valid: boolean;
};

const CHANGES: Record<CreatorForkChoice, CreatorChangedRule> = {
  concentration: { from: 2500, path: "policy.maxPositionBps", reasonCode: "reduce-concentration", to: 1500 },
  drawdown: { from: 800, path: "policy.drawdownStopBps", reasonCode: "tighten-loss-stop", to: 400 },
  evidence: { from: 2, path: "policy.minimumEvidenceSources", reasonCode: "raise-evidence-bar", to: 3 },
  frequency: { from: 2, path: "policy.maxDailyProposals", reasonCode: "reduce-action-frequency", to: 1 },
};
const EMPTY_EVENT_HEAD = "0".repeat(64);
const ENCODER = new TextEncoder();
const LIMITATIONS = ["domain-check-does-not-prove-parent-consent", "domain-check-does-not-prove-common-authorship", "domain-check-does-not-prove-broker-activity", "domain-check-does-not-prove-identity-performance-skill-suitability-or-compliance"] as const;
const VERIFIED_SEEDS = new WeakSet<VerifiedCreatorSeed>();
const PREPARED_FORKS = new WeakMap<PreparedCreatorFork, { choice: CreatorForkChoice; parent: VerifiedCreatorSeed }>();
const TOP_KEYS = ["benchmarkCode", "dataClass", "fork", "policy", "questionCode", "schemaVersion", "templateId", "window"];
const POLICY_KEYS = ["approvalMode", "drawdownStopBps", "leverageAllowed", "maxDailyProposals", "maxPositionBps", "minimumEvidenceSources"];
const FORK_KEYS = ["changedRule"];
const CHANGE_KEYS = ["from", "path", "reasonCode", "to"];
const WINDOW_KEYS = ["count", "unit"];

function fail(code: string): never { throw new Error(code); }
function utf8(value: string) { return ENCODER.encode(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] as number) ^ (right[index] as number);
  return difference === 0;
}
function deepFreezeCharter(charter: CreatorCharter) {
  if (charter.fork.changedRule !== null) Object.freeze(charter.fork.changedRule);
  Object.freeze(charter.fork);
  Object.freeze(charter.policy);
  Object.freeze(charter.window);
  return Object.freeze(charter);
}

export function createCreatorSeedCharter(): CreatorCharter {
  return {
    benchmarkCode: "same-synthetic-sequence",
    dataClass: "synthetic",
    fork: { changedRule: null },
    policy: { approvalMode: "human-required", drawdownStopBps: 800, leverageAllowed: false, maxDailyProposals: 2, maxPositionBps: 2500, minimumEvidenceSources: 2 },
    questionCode: "policy-sensitivity",
    schemaVersion: CREATOR_CHARTER_SCHEMA,
    templateId: CREATOR_TEMPLATE_ID,
    window: { count: 2, unit: "fixture-proposals" },
  };
}

function validChange(value: unknown): value is CreatorChangedRule {
  return isRecord(value) && exactKeys(value, CHANGE_KEYS) && Number.isSafeInteger(value.from) && Number.isSafeInteger(value.to)
    && typeof value.path === "string" && typeof value.reasonCode === "string"
    && Object.values(CHANGES).some((allowed) => equalBytes(serializeJcs(allowed), serializeJcs(value)));
}

function validCreatorCharter(value: unknown): value is CreatorCharter {
  if (!isRecord(value) || !exactKeys(value, TOP_KEYS) || !isRecord(value.policy) || !exactKeys(value.policy, POLICY_KEYS)
    || !isRecord(value.fork) || !exactKeys(value.fork, FORK_KEYS) || !isRecord(value.window) || !exactKeys(value.window, WINDOW_KEYS)) return false;
  const change = value.fork.changedRule;
  return value.benchmarkCode === "same-synthetic-sequence" && value.dataClass === "synthetic" && value.questionCode === "policy-sensitivity"
    && value.schemaVersion === CREATOR_CHARTER_SCHEMA && value.templateId === CREATOR_TEMPLATE_ID && value.window.count === 2 && value.window.unit === "fixture-proposals"
    && value.policy.approvalMode === "human-required" && value.policy.leverageAllowed === false
    && Number.isSafeInteger(value.policy.drawdownStopBps) && Number.isSafeInteger(value.policy.maxDailyProposals)
    && Number.isSafeInteger(value.policy.maxPositionBps) && Number.isSafeInteger(value.policy.minimumEvidenceSources)
    && (change === null || validChange(change));
}

export function deriveCreatorFork(parent: CreatorCharter, choice: CreatorForkChoice): CreatorCharter {
  if (!validCreatorCharter(parent)) fail("creator.parent-charter-invalid");
  if (!equalBytes(serializeJcs(parent), serializeJcs(createCreatorSeedCharter()))) fail("creator.parent-unsupported");
  const changedRule = CHANGES[choice];
  if (changedRule === undefined) fail("creator.change-unsupported");
  const key = changedRule.path.split(".")[1] as keyof CreatorPolicy;
  if (parent.policy[key] !== changedRule.from) fail("creator.change-from-mismatch");
  return deepFreezeCharter({ ...parent, fork: { changedRule: { ...changedRule } }, policy: { ...parent.policy, [key]: changedRule.to }, window: { ...parent.window } });
}

export function evaluateSyntheticBoundary(policy: CreatorPolicy): SyntheticPolicyResult {
  const failedRules: CreatorRulePath[] = [];
  if (2 > policy.maxDailyProposals) failedRules.push("policy.maxDailyProposals");
  if (600 > policy.drawdownStopBps) failedRules.push("policy.drawdownStopBps");
  if (2000 > policy.maxPositionBps) failedRules.push("policy.maxPositionBps");
  if (2 < policy.minimumEvidenceSources) failedRules.push("policy.minimumEvidenceSources");
  failedRules.sort();
  return { decision: failedRules.length === 0 ? "human-review" : "rejected", failedRules, inputCode: "boundary-proposal-v1", schemaVersion: "runbook.synthetic-policy-result.v1" };
}

function payloadsFor(charter: CreatorCharter): CapsulePayloadMember[] {
  const result = evaluateSyntheticBoundary(charter.policy);
  const changed = charter.fork.changedRule;
  const summary = changed === null ? "Synthetic seed: the boundary proposal reaches human review under the declared policy." : `Synthetic fork: ${changed.path} changes ${changed.from} to ${changed.to}; the same boundary proposal is rejected.`;
  return [
    { path: "payload/charter.json", role: "charter", mediaType: "application/json", bytes: serializeJcs(charter) },
    { path: "payload/claims.json", role: "claims", mediaType: "application/json", bytes: serializeJcs({ claims: [], dataClass: "synthetic", schemaVersion: "runbook.creator-claims.v1" }) },
    { path: "payload/disclosures.json", role: "disclosures", mediaType: "application/json", bytes: serializeJcs({ dataClass: "synthetic", limitations: ["self-asserted key and time", "fixed synthetic inputs only", "no account, trade, return, recommendation, or broker record", "no identity, continuity, completeness, skill, suitability, or compliance assurance"], schemaVersion: "runbook.creator-disclosures.v1" }) },
    { path: "payload/events.ndjson", role: "events", mediaType: "application/x-ndjson", bytes: new Uint8Array() },
    { path: "payload/outcomes.json", role: "outcomes", mediaType: "application/json", bytes: serializeJcs(result) },
    { path: "payload/report.html", role: "report", mediaType: "text/html;charset=utf-8", bytes: utf8(`<!doctype html><meta charset="utf-8"><title>Runbook synthetic policy test</title><main><h1>SYNTHETIC POLICY TEST</h1><p>${summary}</p><p>No trade occurred. No broker, execution, performance, identity, or completeness claim.</p></main>`) },
  ];
}

async function sha256Hex(bytes: Uint8Array, subtle: SubtleCrypto) {
  const digest = new Uint8Array(await subtle.digest("SHA-256", new Uint8Array(bytes)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function exactPayloadProfile(receipt: ProofVerificationReceipt, charter: CreatorCharter, subtle: SubtleCrypto) {
  const expected = payloadsFor(charter);
  if (receipt.members.filter((member) => member.path.startsWith("payload/")).length !== expected.length) return false;
  for (const payload of expected) {
    const member = receipt.members.find((candidate) => candidate.path === payload.path);
    if (member?.status !== "valid" || member.bytes !== payload.bytes.byteLength || member.sha256 !== await sha256Hex(payload.bytes, subtle)) return false;
  }
  return true;
}

type PrepareCommon = { checkpointSequence: number; createdAt: string; experimentId: string; publicKeySpkiDer: Uint8Array; subtle?: SubtleCrypto };

export function prepareCreatorSeed(input: PrepareCommon): Promise<PreparedProofCapsule> {
  const { subtle, ...common } = input;
  const charter = createCreatorSeedCharter();
  return prepareProofCapsule({ ...common, dataClass: "synthetic", eventChain: { eventCount: 0, headHash: EMPTY_EVENT_HEAD }, lineage: { relation: "root", parents: [] }, payloads: payloadsFor(charter) }, subtle === undefined ? {} : { subtle });
}

export async function openVerifiedCreatorSeed(archive: Uint8Array, options: { subtle?: SubtleCrypto } = {}): Promise<VerifiedCreatorSeed> {
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) fail("creator.crypto-unavailable");
  const receipt = await verifyProofCapsule(new Uint8Array(archive), { subtle });
  if (!receipt.valid || receipt.capsuleId !== CREATOR_SEED_CAPSULE_ID || receipt.authorKeyId !== CREATOR_SEED_AUTHOR_KEY_ID
    || receipt.lineage.relation !== "root" || receipt.lineage.parents.length !== 0
    || !await exactPayloadProfile(receipt, createCreatorSeedCharter(), subtle)) fail("creator.seed-verification-failed");
  const token: VerifiedCreatorSeed = Object.freeze({ capsuleId: CREATOR_SEED_CAPSULE_ID, receipt });
  VERIFIED_SEEDS.add(token);
  return token;
}

export async function prepareCreatorFork(input: PrepareCommon & { choice: CreatorForkChoice; parent: VerifiedCreatorSeed }): Promise<PreparedCreatorFork> {
  if (!VERIFIED_SEEDS.has(input.parent)) fail("creator.parent-not-verified");
  const charter = deriveCreatorFork(createCreatorSeedCharter(), input.choice);
  const { subtle, choice, parent, ...common } = input;
  const prepared = await prepareProofCapsule({ ...common, dataClass: "synthetic", eventChain: { eventCount: 0, headHash: EMPTY_EVENT_HEAD }, lineage: { relation: "derived", parents: [parent.capsuleId] }, payloads: payloadsFor(charter) }, subtle === undefined ? {} : { subtle });
  const result = Object.freeze({ charter, prepared });
  PREPARED_FORKS.set(result, { choice, parent });
  return result;
}

function receiptBase(parent: ProofVerificationReceipt, child: ProofVerificationReceipt, checks: CreatorForkReceipt["checks"], changedRule: CreatorChangedRule | null): CreatorForkReceipt {
  return { checks, childCapsuleId: child.capsuleId, changedRule, limitations: LIMITATIONS, parentCapsuleId: parent.capsuleId, schemaVersion: CREATOR_FORK_RECEIPT_SCHEMA, valid: Object.values(checks).every(Boolean) };
}

async function verifyReceipts(
  parent: ProofVerificationReceipt,
  child: ProofVerificationReceipt,
  childStatement: ProofCapsuleStatementMetadata | null,
  subtle: SubtleCrypto,
) {
  const parentCoreValid = parent.valid && parent.capsuleId === CREATOR_SEED_CAPSULE_ID && parent.authorKeyId === CREATOR_SEED_AUTHOR_KEY_ID
    && parent.lineage.relation === "root" && parent.lineage.parents.length === 0 && await exactPayloadProfile(parent, createCreatorSeedCharter(), subtle);
  const childCoreValid = child.valid;
  const childNamesExactParent = child.lineage.relation === "derived" && child.lineage.parents.length === 1 && child.lineage.parents[0] === CREATOR_SEED_CAPSULE_ID;
  let matched: { charter: CreatorCharter; changedRule: CreatorChangedRule } | null = null;
  for (const choice of Object.keys(CHANGES) as CreatorForkChoice[]) {
    const charter = deriveCreatorFork(createCreatorSeedCharter(), choice);
    if (await exactPayloadProfile(child, charter, subtle)) {
      if (matched !== null) fail("creator.profile-ambiguous");
      matched = { charter, changedRule: CHANGES[choice] };
    }
  }
  const fixedSyntheticProfile = matched !== null && childStatement?.dataClass === "synthetic"
    && childStatement.eventChain.algorithm === "runbook-jsonl-chain-v1"
    && childStatement.eventChain.eventCount === 0
    && childStatement.eventChain.headHash === EMPTY_EVENT_HEAD;
  const exactOneAllowedRuleChanged = matched !== null;
  const result = matched === null ? null : evaluateSyntheticBoundary(matched.charter.policy);
  const policyDeltaRecomputed = result?.decision === "rejected" && result.failedRules.length === 1 && result.failedRules[0] === matched?.changedRule.path
    && evaluateSyntheticBoundary(createCreatorSeedCharter().policy).decision === "human-review";
  return receiptBase(parent, child, { childCoreValid, childNamesExactParent, exactOneAllowedRuleChanged, fixedSyntheticProfile, parentCoreValid, policyDeltaRecomputed }, matched?.changedRule ?? null);
}

export async function verifyCreatorForkArchives(parentArchive: Uint8Array, childArchive: Uint8Array, options: { subtle?: SubtleCrypto } = {}) {
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) fail("creator.crypto-unavailable");
  const parentBytes = new Uint8Array(parentArchive);
  const childBytes = new Uint8Array(childArchive);
  const [parent, child] = await Promise.all([
    verifyProofCapsule(parentBytes, { subtle }),
    verifyProofCapsule(childBytes, { subtle }),
  ]);
  return verifyReceipts(parent, child, inspectProofCapsuleStatement(childBytes), subtle);
}

export async function verifyPreparedCreatorFork(input: { childArchive: Uint8Array; fork: PreparedCreatorFork; parentArchive: Uint8Array; subtle?: SubtleCrypto }) {
  const state = PREPARED_FORKS.get(input.fork);
  if (state === undefined || !VERIFIED_SEEDS.has(state.parent)) fail("creator.prepared-fork-invalid");
  const receipt = await verifyCreatorForkArchives(input.parentArchive, input.childArchive, input.subtle === undefined ? {} : { subtle: input.subtle });
  if (receipt.childCapsuleId !== input.fork.prepared.capsuleId || receipt.changedRule === null || JSON.stringify(receipt.changedRule) !== JSON.stringify(CHANGES[state.choice])) {
    return { ...receipt, checks: { ...receipt.checks, childCoreValid: false }, valid: false };
  }
  return receipt;
}

export function serializeCreatorForkReceipt(receipt: CreatorForkReceipt) { return serializeJcs(receipt); }
