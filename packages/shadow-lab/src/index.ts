/**
 * @runbook/shadow-lab — Shadow Process Laboratory
 *
 * Charter / process self-improvement for financial agents.
 * Zero capital. No broker. No credentials. No place_order. No Social.
 * Multi-axis metrics only — never a composite "agent is safe" score.
 */

export {
  CURRICULUM_ID,
  CURRICULUM_TAGS,
  PRODUCT_SURFACE,
  REFERENCE_ELITE_EQUITY_POLICY,
  REFERENCE_ELITE_POLICY,
  SHADOW_CURRICULUM,
  SYNTHETIC_CURRICULUM,
  WEAK_STARTER_POLICY,
  curriculumScenarioCount,
  curriculumScenarioIds,
  curriculumTagSet,
  type CurriculumScenario,
  type CurriculumTag,
} from "./curriculum.js";

export {
  evaluateCharter,
  evaluateCharterAgainstCurriculum,
  evaluateCharterAgainstScenarios,
  type ScenarioEvaluation,
  type ShadowCurriculumMetrics,
  type ShadowCurriculumReport,
  type TagCoverageEntry,
} from "./evaluate-charter.js";

export {
  collectDeltas,
  proposeRefinement,
  runRecursiveImprovement,
  type PolicyDelta,
  type RationaleCode,
  type ShadowRecursiveImprovement,
  type ShadowRefinementGeneration,
} from "./refine.js";

export {
  MAX_LEDGER_CANDIDATES,
  MAX_MERGED_CURRICULUM_SIZE,
  META_CURRICULUM_LIMITATIONS,
  candidateIdFromProposalId,
  evaluateCharterAgainstMergedCurriculum,
  extractCurriculumCandidatesFromEvents,
  mergeCurriculum,
  notionalBucket,
  proposalFingerprint,
  stripCredentialShapedNotes,
  tagsFromFailedCheckIds,
  type CurriculumCandidate,
  type CurriculumScenarioSource,
  type MergedCurriculumScenario,
  type MinimalLedgerEvent,
} from "./meta-curriculum.js";

export {
  TOURNAMENT_SCHEMA_VERSION,
  buildDeterministicMutant,
  buildTournamentSeeds,
  computeParetoFront,
  dominates,
  runShadowTournament,
  type RunShadowTournamentOptions,
  type ShadowTournamentReport,
  type TournamentCandidate,
  type TournamentLineage,
  type TournamentSeedKind,
} from "./tournament.js";

export {
  normalizeOperatorScenario,
  mergeOperatorScenarios,
  evaluateOperatorAugmentedCurriculum,
  type OperatorScenarioDraft,
} from "./operator-scenario.js";
