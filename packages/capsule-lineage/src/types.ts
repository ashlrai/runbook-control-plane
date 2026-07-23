export const LINEAGE_ANALYSIS_SCHEMA = "runbook.proof-lineage-analysis.v1" as const;
export const LINEAGE_VERIFIER_PROFILE = "runbook.proof-capsule.v1" as const;

export type LineageRelation = "root" | "derived" | "corrects" | "supersedes";
export type LineageCoreStatus = "valid" | "invalid";
export type LineageEdgeStatus = "resolved" | "missing";
export type LineageKeyRelationship =
  | "same-self-asserted-key"
  | "different-self-asserted-key"
  | "not-evaluated";

export type LineageArtifact = Readonly<{
  archiveSha256: string;
  authorKeyId: string | null;
  byteLength: number;
  capsuleId: string | null;
  coreErrorCodes: readonly string[];
  coreReceiptSha256: string;
  coreStatus: LineageCoreStatus;
  /** Verified immutable lineage metadata; withheld for core-invalid artifacts. */
  parents: readonly string[];
  relation: LineageRelation | null;
}>;

export type LineageNode = Readonly<{
  authorKeyId: string;
  capsuleId: string;
  parents: readonly string[];
  relation: LineageRelation;
  transportSha256: readonly string[];
}>;

export type LineageEdge = Readonly<{
  childCapsuleId: string;
  keyRelationship: LineageKeyRelationship;
  parentCapsuleId: string;
  relation: Exclude<LineageRelation, "root">;
  status: LineageEdgeStatus;
}>;

export type LineageKeyGroup = Readonly<{
  authorKeyId: string;
  capsuleIds: readonly string[];
}>;

export type LineageCycle = Readonly<{ capsuleIds: readonly string[] }>;

export type LineageErrorFinding =
  | Readonly<{ capsuleIds: readonly string[]; code: "lineage.cycle" }>
  | Readonly<{ capsuleId: string; code: "lineage.identity-conflict" }>;

export type LineageWarningFinding =
  | Readonly<{
      childCapsuleId: string;
      code: "lineage.parent-missing";
      parentCapsuleId: string;
    }>
  | Readonly<{
      capsuleId: string;
      code: "lineage.transport-alias";
      transportSha256: readonly string[];
    }>;

export type LineageAnalysisCounts = Readonly<{
  capsuleNodes: number;
  coreInvalidArtifacts: number;
  coreValidArtifacts: number;
  cycleComponents: number;
  identityConflicts: number;
  keyGroups: number;
  missingEdges: number;
  resolvedEdges: number;
  transportAliases: number;
  uniqueTransports: number;
}>;

export type LineageAnalysisReceipt = Readonly<{
  analysisComplete: true;
  artifacts: readonly LineageArtifact[];
  counts: LineageAnalysisCounts;
  cycles: readonly LineageCycle[];
  edges: readonly LineageEdge[];
  findings: Readonly<{
    errors: readonly LineageErrorFinding[];
    warnings: readonly LineageWarningFinding[];
  }>;
  keyGroups: readonly LineageKeyGroup[];
  limitations: readonly [
    "receipt-is-unsigned-local-analysis",
    "selected-set-does-not-prove-complete-history",
    "declared-lineage-does-not-prove-parent-consent-causality-or-correctness",
    "shared-self-asserted-key-does-not-prove-identity-control-continuity-or-common-authorship",
    "correction-or-supersession-does-not-revoke-or-erase",
    "analysis-does-not-prove-independent-time-broker-activity-performance-skill-suitability-or-compliance",
    "metadata-hashes-capsule-ids-key-ids-and-lineage-can-correlate-artifacts",
  ];
  nodes: readonly LineageNode[];
  schemaVersion: "runbook.proof-lineage-analysis.v1";
  verifierProfile: "runbook.proof-capsule.v1";
}>;

export type LineageAnalysisErrorCode =
  | "input.batch-count-limit"
  | "input.batch-size-limit"
  | "input.empty"
  | "input.size-limit"
  | "input.read-failed"
  | "output.size-limit";

export class LineageAnalysisError extends Error {
  readonly name = "LineageAnalysisError";

  constructor(readonly code: LineageAnalysisErrorCode) {
    super(code);
  }
}

export type LineageAnalysisOptions = Readonly<{ subtle?: SubtleCrypto }>;

export type VerifiedTransportMetadata = Readonly<{
  archiveSha256: string;
  authorKeyId: string | null;
  byteLength: number;
  capsuleId: string | null;
  coreErrorCodes: readonly string[];
  coreReceiptSha256: string;
  coreValid: boolean;
  parents: readonly string[];
  relation: LineageRelation | null;
}>;
