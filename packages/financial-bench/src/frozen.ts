import { runFinancialBench, serializeBenchRunReceipt } from "./bench.js";
import { getSyntheticV0ScenarioDefinitions, SYNTHETIC_V0_CORPUS_JCS } from "./fixtures.js";
import { canonicalizeJcs, sha256Jcs, sha256Utf8 } from "./canonical.js";
import {
  BENCH_CORPUS_MANIFEST_SCHEMA,
  BENCH_PROFILE,
  type BenchRunReceipt,
  type FinancialBenchCorpusManifest,
  type ScenarioId,
} from "./types.js";
import { FinancialBenchValidationError, parseBenchRunReceipt } from "./validate.js";

const REQUIRED_SCENARIO_IDS = [
  "scenario-01-wrong-account",
  "scenario-04-undocumented-tool",
  "scenario-05-mutation-capability-drift",
  "scenario-06-incompatible-schema-drift",
] as const satisfies readonly ScenarioId[];

// These pins are deliberately independent of receipt generation. Updating a
// scenario requires an explicit corpus-version review and pin change.
const PINNED_CORPUS_SHA256 = "50237521416134b941f924c4222d43bf4ed9b6ff2b81f810ef2a03f88bc15c12";
const PINNED_SCENARIO_DIGESTS = [
  { scenarioDefinitionSha256: "860d4176394c1b61a0c26b01f7137e362fbb1359e7f470c4d88374899579bddb", scenarioId: "scenario-01-wrong-account" },
  { scenarioDefinitionSha256: "b296e529e8fb024d9370fb572af717fc88b85e29c82495c5237652bd9261cd26", scenarioId: "scenario-04-undocumented-tool" },
  { scenarioDefinitionSha256: "9f80f05c8342dadb727b1bf6528d3b94a87aa3bb7fa046cef722a58cfcc4fa83", scenarioId: "scenario-05-mutation-capability-drift" },
  { scenarioDefinitionSha256: "9fbb8b0ba1675d72a827c2bc0288690b2f0bfac630fe2ac4af9dd48b0d0651fd", scenarioId: "scenario-06-incompatible-schema-drift" },
] as const;
const PINNED_MANIFEST_SHA256 = "7c36694e0ef17059bffe3f82f2b6da5089934b76eb5da53acd5085dd1ae95087";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const SYNTHETIC_V0_CORPUS_MANIFEST: FinancialBenchCorpusManifest = deepFreeze({
  corpusId: BENCH_PROFILE,
  corpusSha256: PINNED_CORPUS_SHA256,
  profileVersion: BENCH_PROFILE,
  scenarioDefinitions: PINNED_SCENARIO_DIGESTS,
  schemaVersion: BENCH_CORPUS_MANIFEST_SCHEMA,
});

export const SYNTHETIC_V0_CORPUS_MANIFEST_SHA256 = PINNED_MANIFEST_SHA256;

function frozenCorpus() {
  const definitions = getSyntheticV0ScenarioDefinitions();
  if (sha256Utf8(SYNTHETIC_V0_CORPUS_JCS) !== PINNED_CORPUS_SHA256
    || definitions.length !== REQUIRED_SCENARIO_IDS.length
    || definitions.some((definition, index) => definition.scenarioId !== REQUIRED_SCENARIO_IDS[index]
      || sha256Jcs(definition) !== PINNED_SCENARIO_DIGESTS[index]?.scenarioDefinitionSha256)
    || sha256Jcs(SYNTHETIC_V0_CORPUS_MANIFEST) !== PINNED_MANIFEST_SHA256) {
    throw new FinancialBenchValidationError("bench.frozen-corpus-integrity-failed");
  }
  return definitions;
}

/** Runs exactly the pinned four-scenario corpus and marks that exact coverage. */
export function runFrozenSyntheticV0Bench(): BenchRunReceipt {
  const generic = runFinancialBench(frozenCorpus());
  const receipt: BenchRunReceipt = {
    ...generic,
    coverage: {
      class: "frozen-synthetic-v0-complete",
      corpusManifestSha256: SYNTHETIC_V0_CORPUS_MANIFEST_SHA256,
      requiredScenarioIds: [...REQUIRED_SCENARIO_IDS],
    },
  };
  return parseBenchRunReceipt(receipt);
}

/**
 * Validates exact frozen-profile proof, not merely a structurally valid or
 * self-consistent generic receipt. The returned value is a fresh owned copy.
 */
export function parseFrozenSyntheticV0BenchReceipt(value: unknown): BenchRunReceipt {
  const parsed = parseBenchRunReceipt(value);
  if (canonicalizeJcs(parsed) !== serializeBenchRunReceipt(runFrozenSyntheticV0Bench())) {
    throw new FinancialBenchValidationError("receipt.frozen-profile-mismatch");
  }
  return parsed;
}
