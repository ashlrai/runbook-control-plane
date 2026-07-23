import { canonicalizeJcs, ownUint8Array, sha256Bytes, sha256Jcs } from "./canonical.js";
import {
  DOSSIER_CASE_DEFINITIONS, DOSSIER_CORPUS_MANIFEST_SHA256, getPrivateCase, getPublicChallenge,
  getReferenceResponse, isAcceptedResponse,
} from "./corpus.js";
import {
  DOSSIER_PROFILE_VERSION, EVIDENCE_SCHEMA, RECEIPT_SCHEMA, RESPONSE_SCHEMA,
  type CaseEvidence, type CaseResult, type DossierEvidence, type DossierReceipt, type PublicChallenge,
  type RecoveryState, type TargetEvaluator, type TargetResponse,
} from "./types.js";
import { DossierValidationError, assertCaseResultAxes, parseDossierEvidence, parseDossierReceiptStructural, parseTargetResponse, responseDigestIsValid, serializeEvidence } from "./validate.js";

const LIMITATIONS = [
  "synthetic-target-declared-semantic-responses-only",
  "fixed-corpus-hardcoding-remains-possible",
  "pure-semantic-foundation-does-not-evidence-sandbox-execution",
  "control-pass-means-target-declared-semantic-response-conformance-only",
  "not-certification-audit-opinion-compliance-or-production-authorization",
] as const;

function sameChallenge(actual: PublicChallenge, ordinal: number): boolean {
  return canonicalizeJcs(actual) === canonicalizeJcs(getPublicChallenge(ordinal));
}

export const referenceEvaluator: TargetEvaluator = (challenge) => {
  const ordinal = DOSSIER_CASE_DEFINITIONS.findIndex(({ scenarioId }) => scenarioId === challenge.scenarioId);
  if (ordinal < 0 || !sameChallenge(challenge as PublicChallenge, ordinal)) throw new DossierValidationError("challenge.invalid");
  return getReferenceResponse(ordinal);
};

const basicResponse = (disposition: TargetResponse["declaredDisposition"]): TargetResponse => ({
  schemaVersion: RESPONSE_SCHEMA, declaredDisposition:disposition,
  declaredOutcomeClass: disposition === "proceed" ? "accepted-preview" : "denied",
  declaredMutationAttempts:0,
  declaredAcceptedPreviews: disposition === "proceed" ? 1 : 0,
  declaredAcceptedMutationEffects:0,
  declaredBindingsInvalidated:false, declaredRefreshRequired:false, declaredReconciliationRequired:false, declaredConflictPreserved:false,
  declaredPortableSinkClass:"not-modeled", declaredAuthorityNote:"none", declaredRecoveryStates:["none"],
});
export const denyAllEvaluator: TargetEvaluator = () => basicResponse("deny");
export const alwaysAllowEvaluator: TargetEvaluator = () => basicResponse("proceed");

/** Trusted implementation-fixture generator only. Never invoke an adversarial target in this realm. */
export function runDossierCore(evaluator: TargetEvaluator): { evidence: DossierEvidence; evidenceBytes: Uint8Array; receipt: DossierReceipt; receiptBytes: Uint8Array } {
  const results: CaseEvidence[] = DOSSIER_CASE_DEFINITIONS.map((definition, ordinal) => {
    const challenge = getPublicChallenge(ordinal);
    const response = parseTargetResponse(evaluator(Object.freeze(structuredClone(challenge))));
    return {
      scenarioId: definition.scenarioId, ordinal, family: definition.family, conditionCodes: [...definition.conditionCodes],
      scenarioDefinitionSha256: definition.scenarioDefinitionSha256, stimulusSha256: definition.stimulusSha256,
      privateOracleSha256: definition.privateOracleSha256, responseSha256: sha256Jcs(response), response,
      orderedDeclarationSha256: sha256Jcs([response]),
    };
  });
  const evidence: DossierEvidence = { schemaVersion:EVIDENCE_SCHEMA, profileVersion:DOSSIER_PROFILE_VERSION, corpusManifestSha256:DOSSIER_CORPUS_MANIFEST_SHA256, results };
  const evidenceBytes = new TextEncoder().encode(serializeEvidence(evidence));
  const receipt = replayDossierEvidenceBytes(evidenceBytes);
  return { evidence, evidenceBytes, receipt, receiptBytes: new TextEncoder().encode(canonicalizeJcs(receipt)) };
}

function deriveResult(item: CaseEvidence, ordinal: number): CaseResult {
  const definition = DOSSIER_CASE_DEFINITIONS[ordinal];
  if (definition === undefined) throw new DossierValidationError("evidence.case-extra");
  const accepted = isAcceptedResponse(ordinal, item.response);
  const unsupported = accepted && item.response.declaredDisposition === "unsupported";
  const coverageStatus = unsupported ? "unsupported" as const : "evaluated" as const;
  const controlStatus = unsupported ? null : accepted ? "pass" as const : "fail" as const;
  const result: CaseResult = {
    scenarioId:item.scenarioId, ordinal, family:item.family, conditionCodes:[...item.conditionCodes],
    deviationCodes: accepted ? [] : [definition.deviationCode], coverageStatus, controlStatus,
    domainDisposition:item.response.declaredDisposition, evidenceBasis:"target-declaration",
    declaredAcceptedPreviewCount:item.response.declaredAcceptedPreviews,
    declaredAcceptedMutationEffectCount:item.response.declaredAcceptedMutationEffects,
    declaredReconciliationState: item.response.declaredRecoveryStates.at(-1) ?? "none", evidenceSha256:sha256Jcs(item),
  };
  assertCaseResultAxes(result);
  return result;
}

export function replayDossierEvidenceBytes(input: Uint8Array): DossierReceipt {
  let ownedBytes: Uint8Array;
  let text: string;
  try {
    ownedBytes = ownUint8Array(input, 1_000_000);
    text = new TextDecoder("utf-8", { fatal:true }).decode(ownedBytes);
  } catch { throw new DossierValidationError("evidence.bytes-invalid"); }
  let unknown: unknown;
  try { unknown = JSON.parse(text); } catch { throw new DossierValidationError("evidence.json-invalid"); }
  if (canonicalizeJcs(unknown) !== text) throw new DossierValidationError("evidence.bytes-not-canonical");
  const evidence = parseDossierEvidence(unknown);
  if (evidence.corpusManifestSha256 !== DOSSIER_CORPUS_MANIFEST_SHA256) throw new DossierValidationError("evidence.manifest-substituted");
  evidence.results.forEach((item, ordinal) => {
    const expected = getPrivateCase(ordinal).definition;
    if (item.ordinal !== ordinal || item.scenarioId !== expected.scenarioId) throw new DossierValidationError("evidence.case-order-invalid");
    if (item.family !== expected.family || canonicalizeJcs(item.conditionCodes) !== canonicalizeJcs(expected.conditionCodes) ||
      item.scenarioDefinitionSha256 !== expected.scenarioDefinitionSha256 || item.stimulusSha256 !== expected.stimulusSha256 ||
      item.privateOracleSha256 !== expected.privateOracleSha256) throw new DossierValidationError("evidence.case-substituted");
    if (!responseDigestIsValid(item)) throw new DossierValidationError("evidence.observation-substituted");
  });
  const results = evidence.results.map(deriveResult);
  const counts = {
    evaluated:results.filter((r) => r.coverageStatus === "evaluated").length,
    unsupported:results.filter((r) => r.coverageStatus === "unsupported").length,
    notEvaluable:results.filter((r) => r.coverageStatus === "not-evaluable").length,
    unrun:results.filter((r) => r.coverageStatus === "unrun").length,
    skipped:results.filter((r) => r.coverageStatus === "skipped").length,
    infrastructureError:results.filter((r) => r.coverageStatus === "infrastructure-error").length,
    controlPass:results.filter((r) => r.controlStatus === "pass").length,
    controlFail:results.filter((r) => r.controlStatus === "fail").length,
    controlNull:results.filter((r) => r.controlStatus === null).length,
  };
  return {
    schemaVersion:RECEIPT_SCHEMA, profileVersion:DOSSIER_PROFILE_VERSION, corpusManifestSha256:DOSSIER_CORPUS_MANIFEST_SHA256,
    evidenceSha256:sha256Bytes(ownedBytes),
    coverageComplete: results.length === 31 && results.every((r) => r.coverageStatus === "evaluated"),
    counts, results, limitations:[...LIMITATIONS],
  };
}

export function verifyDossierReceiptAgainstEvidence(
  receipt: unknown,
  evidenceBytes: Uint8Array,
): DossierReceipt {
  const parsed = parseDossierReceiptStructural(receipt);
  const derived = replayDossierEvidenceBytes(evidenceBytes);
  if (canonicalizeJcs(parsed) !== canonicalizeJcs(derived)) {
    throw new DossierValidationError("receipt.evidence-mismatch");
  }
  return parsed;
}
