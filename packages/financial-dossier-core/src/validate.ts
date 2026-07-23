import { canonicalizeJcs, sha256Jcs } from "./canonical.js";
import {
  COVERAGE_STATUSES, DOMAIN_DISPOSITIONS, DOSSIER_PROFILE_VERSION, EVIDENCE_SCHEMA, OUTCOME_CLASSES,
  RECEIPT_SCHEMA, RECOVERY_STATES, RESPONSE_SCHEMA,
  type CaseEvidence, type CaseResult, type CorpusManifest, type DossierEvidence, type DossierReceipt, type TargetResponse,
} from "./types.js";
import {
  DOSSIER_CORPUS_MANIFEST,
  DOSSIER_CORPUS_MANIFEST_JCS,
} from "./corpus.js";

export class DossierValidationError extends Error {
  override readonly name = "DossierValidationError";
  constructor(readonly code: string) { super(code); }
}

export function parseCorpusManifest(value: unknown): CorpusManifest {
  let actual: string;
  try {
    actual = canonicalizeJcs(value);
  } catch {
    throw new DossierValidationError("manifest.invalid");
  }
  if (actual !== DOSSIER_CORPUS_MANIFEST_JCS) {
    throw new DossierValidationError("manifest.invalid");
  }
  return structuredClone(DOSSIER_CORPUS_MANIFEST);
}

function record(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DossierValidationError(code);
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) throw new DossierValidationError(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) throw new DossierValidationError(code);
  for (const descriptor of Object.values(descriptors))
    if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) throw new DossierValidationError(code);
  const actual = Object.keys(descriptors).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) throw new DossierValidationError(code);
  return Object.fromEntries(actual.map((key) => [key, descriptors[key]?.value]));
}

const oneOf = <T extends string>(value: unknown, values: readonly T[], code: string): T => {
  if (typeof value !== "string" || !values.includes(value as T)) throw new DossierValidationError(code);
  return value as T;
};
const text = (value: unknown, code: string): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) throw new DossierValidationError(code);
  return value;
};
const digest = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new DossierValidationError(code);
  return value;
};
const count = (value: unknown, code: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new DossierValidationError(code);
  return value as number;
};
const bool = (value: unknown, code: string): boolean => {
  if (typeof value !== "boolean") throw new DossierValidationError(code);
  return value;
};
function stringList(value: unknown, code: string, maximum = 32): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new DossierValidationError(code);
  const result = value.map((item) => text(item, code));
  if (new Set(result).size !== result.length) throw new DossierValidationError(code);
  return result;
}

export function parseTargetResponse(value: unknown): TargetResponse {
  const source = record(value, ["schemaVersion","declaredDisposition","declaredOutcomeClass","declaredMutationAttempts","declaredAcceptedPreviews","declaredAcceptedMutationEffects","declaredBindingsInvalidated","declaredRefreshRequired","declaredReconciliationRequired","declaredConflictPreserved","declaredPortableSinkClass","declaredAuthorityNote","declaredRecoveryStates"], "response.invalid");
  if (source.schemaVersion !== RESPONSE_SCHEMA) throw new DossierValidationError("response.invalid");
  const recoveryStates = stringList(source.declaredRecoveryStates, "response.invalid", 3).map((item) => oneOf(item, RECOVERY_STATES, "response.invalid"));
  if (recoveryStates.length < 1) throw new DossierValidationError("response.invalid");
  return {
    schemaVersion: RESPONSE_SCHEMA,
    declaredDisposition: oneOf(source.declaredDisposition, DOMAIN_DISPOSITIONS, "response.invalid"),
    declaredOutcomeClass: oneOf(source.declaredOutcomeClass, OUTCOME_CLASSES, "response.invalid"),
    declaredMutationAttempts: count(source.declaredMutationAttempts, "response.invalid"),
    declaredAcceptedPreviews: count(source.declaredAcceptedPreviews, "response.invalid"),
    declaredAcceptedMutationEffects: count(source.declaredAcceptedMutationEffects, "response.invalid"),
    declaredBindingsInvalidated: bool(source.declaredBindingsInvalidated, "response.invalid"),
    declaredRefreshRequired: bool(source.declaredRefreshRequired, "response.invalid"),
    declaredReconciliationRequired: bool(source.declaredReconciliationRequired, "response.invalid"),
    declaredConflictPreserved: bool(source.declaredConflictPreserved, "response.invalid"),
    declaredPortableSinkClass: oneOf(source.declaredPortableSinkClass, ["clean","canary-detected","not-modeled"] as const, "response.invalid"),
    declaredAuthorityNote: oneOf(source.declaredAuthorityNote, ["none","source-limited","no-prediction"] as const, "response.invalid"),
    declaredRecoveryStates: recoveryStates,
  };
}

function parseCaseEvidence(value: unknown): CaseEvidence {
  const source = record(value, ["scenarioId","ordinal","family","conditionCodes","scenarioDefinitionSha256","stimulusSha256","privateOracleSha256","responseSha256","response","orderedDeclarationSha256"], "evidence.case-invalid");
  const family = source.family === null ? null : oneOf(source.family, ["account-privacy","capability","freshness","sizing-order","approval","options","concurrency","policy","evidence-privacy","recovery"] as const, "evidence.case-invalid");
  const response = parseTargetResponse(source.response);
  return {
    scenarioId: text(source.scenarioId, "evidence.case-invalid") as CaseEvidence["scenarioId"], ordinal: count(source.ordinal, "evidence.case-invalid"), family,
    conditionCodes: stringList(source.conditionCodes, "evidence.case-invalid"),
    scenarioDefinitionSha256: digest(source.scenarioDefinitionSha256, "evidence.case-invalid"), stimulusSha256: digest(source.stimulusSha256, "evidence.case-invalid"),
    privateOracleSha256: digest(source.privateOracleSha256, "evidence.case-invalid"), responseSha256: digest(source.responseSha256, "evidence.case-invalid"),
    response, orderedDeclarationSha256: digest(source.orderedDeclarationSha256, "evidence.case-invalid"),
  };
}

export function parseDossierEvidence(value: unknown): DossierEvidence {
  const source = record(value, ["schemaVersion","profileVersion","corpusManifestSha256","results"], "evidence.invalid");
  if (source.schemaVersion !== EVIDENCE_SCHEMA || source.profileVersion !== DOSSIER_PROFILE_VERSION || !Array.isArray(source.results) || source.results.length !== 31)
    throw new DossierValidationError("evidence.invalid");
  return { schemaVersion: EVIDENCE_SCHEMA, profileVersion: DOSSIER_PROFILE_VERSION,
    corpusManifestSha256: digest(source.corpusManifestSha256, "evidence.invalid"), results: source.results.map(parseCaseEvidence) };
}

export function assertCaseResultAxes(result: CaseResult): void {
  oneOf(result.coverageStatus, COVERAGE_STATUSES, "receipt.axes-invalid");
  if (result.coverageStatus === "evaluated") {
    if (result.controlStatus !== "pass" && result.controlStatus !== "fail") throw new DossierValidationError("receipt.axes-invalid");
  } else if (result.controlStatus !== null) throw new DossierValidationError("receipt.axes-invalid");
}

/** Structural parser only. Use verifyDossierReceiptAgainstEvidence for trust decisions. */
export function parseDossierReceiptStructural(value: unknown): DossierReceipt {
  const source = record(value, ["schemaVersion","profileVersion","corpusManifestSha256","evidenceSha256","coverageComplete","counts","results","limitations"], "receipt.invalid");
  if (source.schemaVersion !== RECEIPT_SCHEMA || source.profileVersion !== DOSSIER_PROFILE_VERSION || !Array.isArray(source.results) || source.results.length !== 31)
    throw new DossierValidationError("receipt.invalid");
  const countsSource = record(source.counts, ["evaluated","unsupported","notEvaluable","unrun","skipped","infrastructureError","controlPass","controlFail","controlNull"], "receipt.invalid");
  const results = source.results.map((value): CaseResult => {
    const item = record(value, ["scenarioId","ordinal","family","conditionCodes","deviationCodes","coverageStatus","controlStatus","domainDisposition","evidenceBasis","declaredAcceptedPreviewCount","declaredAcceptedMutationEffectCount","declaredReconciliationState","evidenceSha256"], "receipt.result-invalid");
    const family = item.family === null ? null : oneOf(item.family, ["account-privacy","capability","freshness","sizing-order","approval","options","concurrency","policy","evidence-privacy","recovery"] as const, "receipt.result-invalid");
    const result: CaseResult = {
      scenarioId:text(item.scenarioId, "receipt.result-invalid") as CaseResult["scenarioId"], ordinal:count(item.ordinal, "receipt.result-invalid"), family,
      conditionCodes:stringList(item.conditionCodes, "receipt.result-invalid"), deviationCodes:stringList(item.deviationCodes, "receipt.result-invalid"),
      coverageStatus:oneOf(item.coverageStatus, COVERAGE_STATUSES, "receipt.result-invalid"),
      controlStatus:item.controlStatus === null ? null : oneOf(item.controlStatus, ["pass","fail"] as const, "receipt.result-invalid"),
      domainDisposition:oneOf(item.domainDisposition, DOMAIN_DISPOSITIONS, "receipt.result-invalid"), evidenceBasis:oneOf(item.evidenceBasis,["target-declaration"] as const,"receipt.result-invalid"),
      declaredAcceptedPreviewCount:count(item.declaredAcceptedPreviewCount, "receipt.result-invalid"),
      declaredAcceptedMutationEffectCount:count(item.declaredAcceptedMutationEffectCount, "receipt.result-invalid"),
      declaredReconciliationState:oneOf(item.declaredReconciliationState, RECOVERY_STATES, "receipt.result-invalid"), evidenceSha256:digest(item.evidenceSha256, "receipt.result-invalid"),
    };
    assertCaseResultAxes(result); return result;
  });
  const counts = {
    evaluated:count(countsSource.evaluated,"receipt.invalid"), unsupported:count(countsSource.unsupported,"receipt.invalid"),
    notEvaluable:count(countsSource.notEvaluable,"receipt.invalid"), unrun:count(countsSource.unrun,"receipt.invalid"), skipped:count(countsSource.skipped,"receipt.invalid"),
    infrastructureError:count(countsSource.infrastructureError,"receipt.invalid"), controlPass:count(countsSource.controlPass,"receipt.invalid"),
    controlFail:count(countsSource.controlFail,"receipt.invalid"), controlNull:count(countsSource.controlNull,"receipt.invalid"),
  };
  if (counts.evaluated + counts.unsupported + counts.notEvaluable + counts.unrun + counts.skipped + counts.infrastructureError !== 31 ||
    counts.controlPass + counts.controlFail + counts.controlNull !== 31) throw new DossierValidationError("receipt.counts-invalid");
  const derivedCounts = {
    evaluated:results.filter((r) => r.coverageStatus === "evaluated").length, unsupported:results.filter((r) => r.coverageStatus === "unsupported").length,
    notEvaluable:results.filter((r) => r.coverageStatus === "not-evaluable").length, unrun:results.filter((r) => r.coverageStatus === "unrun").length,
    skipped:results.filter((r) => r.coverageStatus === "skipped").length, infrastructureError:results.filter((r) => r.coverageStatus === "infrastructure-error").length,
    controlPass:results.filter((r) => r.controlStatus === "pass").length, controlFail:results.filter((r) => r.controlStatus === "fail").length,
    controlNull:results.filter((r) => r.controlStatus === null).length,
  };
  if (canonicalizeJcs(counts) !== canonicalizeJcs(derivedCounts)) throw new DossierValidationError("receipt.counts-invalid");
  if (source.coverageComplete !== results.every((result) => result.coverageStatus === "evaluated")) throw new DossierValidationError("receipt.coverage-invalid");
  return { schemaVersion:RECEIPT_SCHEMA, profileVersion:DOSSIER_PROFILE_VERSION,
    corpusManifestSha256:digest(source.corpusManifestSha256,"receipt.invalid"), evidenceSha256:digest(source.evidenceSha256,"receipt.invalid"),
    coverageComplete:bool(source.coverageComplete,"receipt.invalid"), counts, results, limitations:stringList(source.limitations,"receipt.invalid",16) };
}

export function responseDigestIsValid(item: CaseEvidence): boolean {
  return item.responseSha256 === sha256Jcs(item.response) && item.orderedDeclarationSha256 === sha256Jcs([item.response]);
}

export function serializeEvidence(evidence: DossierEvidence): string { return canonicalizeJcs(evidence); }
export function serializeReceipt(receipt: DossierReceipt): string { return canonicalizeJcs(receipt); }
