/**
 * Meta-learning for curriculum: derive candidate synthetic scenarios from
 * ledger preflight failures so the process lab can grow smarter.
 *
 * Ledger-derived scenarios are still synthetic labels for process training —
 * not market truth, not trading performance, not broker enforcement.
 */

import { riskPolicySchema, tradeProposalSchema } from "@runbook/engine/schema";
import type { RiskPolicy, TradeProposal } from "@runbook/engine/schema";
import {
  CURRICULUM_TAGS,
  PRODUCT_SURFACE,
  SHADOW_CURRICULUM,
  type CurriculumScenario,
  type CurriculumTag,
} from "./curriculum.js";
import {
  evaluateCharterAgainstScenarios,
  type ShadowCurriculumReport,
} from "./evaluate-charter.js";

/**
 * Pure SHA-256 (sync) — no node:crypto so the lab works in browser adapters.
 * Used only for deterministic candidate ids.
 */
function sha256Hex(message: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const padLen = (withOne % 64 <= 56 ? 56 : 120) - (withOne % 64);
  const total = withOne + padLen + 8;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  // SHA-256 length is 64-bit big-endian; messages here are short so high word is 0.
  view.setUint32(total - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j += 1) {
      const s0 = rotr(w[j - 15]!, 7) ^ rotr(w[j - 15]!, 18) ^ (w[j - 15]! >>> 3);
      const s1 = rotr(w[j - 2]!, 17) ^ rotr(w[j - 2]!, 19) ^ (w[j - 2]! >>> 10);
      w[j] = (w[j - 16]! + s0 + w[j - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let j = 0; j < 64; j += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j]! + w[j]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, "0"))
    .join("");
}

export const MAX_LEDGER_CANDIDATES = 20 as const;
export const MAX_MERGED_CURRICULUM_SIZE = 40 as const;

export type CurriculumScenarioSource = "synthetic-closed" | "ledger-derived";

/** Minimal event shape accepted from ledger or offline fixtures. */
export type MinimalLedgerEvent = {
  type: string;
  payload: Record<string, unknown>;
  experimentId?: string;
  occurredAt?: string;
};

export type CurriculumCandidate = CurriculumScenario & {
  source: "ledger-derived";
  /** Proposal id that produced this candidate (never credentials). */
  derivedFromProposalId: string;
  /** Failed hard check ids observed at preflight (when available). */
  failedHardCheckIds: string[];
};

export type MergedCurriculumScenario = CurriculumScenario & {
  source: CurriculumScenarioSource;
};

export const META_CURRICULUM_LIMITATIONS = [
  "ledger-derived-labels-are-synthetic-process-labels-not-market-truth",
  "not-trading-performance",
  "not-capital-allocation",
  "not-broker-enforcement",
  "no-composite-safety-or-skill-score",
  "offline-analysis-does-not-mutate-ledger",
  "max-candidates-and-merged-size-bounded",
] as const;

const CREDENTIAL_KEY_PATTERN =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|auth|bearer|password|passphrase|private[_-]?key|client[_-]?secret|credential|secret|session[_-]?(?:id|key|token)|account[_-]?(?:id|number)|routing[_-]?number|cookie)$/i;

const CREDENTIAL_VALUE_PATTERN =
  /\b(?:api[ _-]?key|password|secret|token|bearer|credential)\b["']?\s*(?:=|:)\s*["']?[^\s"',;]{8,}/i;

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i;

function isCredentialShapedText(value: string): boolean {
  if (CREDENTIAL_VALUE_PATTERN.test(value)) return true;
  if (PRIVATE_KEY_PATTERN.test(value)) return true;
  if (/\b(?:sk_live_|sk_test_|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{8,}\b/.test(value)) return true;
  return false;
}

/**
 * Strip credential-shaped notes/strings from a free-form field.
 * Returns undefined when the value is missing or credential-shaped.
 */
export function stripCredentialShapedNotes(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (isCredentialShapedText(trimmed)) return undefined;
  return trimmed;
}

function payloadOf(event: MinimalLedgerEvent): Record<string, unknown> {
  const payload = event.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload;
}

/** Deterministic candidate id from proposalId (stable hash prefix). */
export function candidateIdFromProposalId(proposalId: string): string {
  const digest = sha256Hex(`ledger-cand:${proposalId}`);
  return `ledger-cand-${digest.slice(0, 12)}`;
}

/**
 * Notional / projected-position bucket for fingerprint stability.
 * Coarse buckets avoid near-duplicate scenarios differing by $1.
 */
export function notionalBucket(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  if (value <= 125) return 125;
  if (value <= 200) return 200;
  if (value <= 500) return 500;
  if (value <= 1_000) return 1_000;
  if (value <= 5_000) return 5_000;
  return 10_000;
}

/**
 * Proposal fingerprint used for merge deduplication.
 * (symbol, instrument, notional bucket, flags)
 */
export function proposalFingerprint(proposal: TradeProposal): string {
  return [
    proposal.symbol.toUpperCase(),
    proposal.instrument,
    proposal.side,
    String(notionalBucket(proposal.notional)),
    String(notionalBucket(proposal.projectedPositionNotional)),
    proposal.hasThesis ? "thesis" : "no-thesis",
    proposal.hasInvalidation ? "inv" : "no-inv",
    proposal.evidenceSourceCount === 0 ? "ev0" : "ev+",
    proposal.dailyTradesAfter > 2 ? "daily+" : "daily0",
    proposal.currentDrawdownPercent >= 8 ? "dd+" : "dd0",
  ].join("|");
}

function scenarioFingerprint(scenario: CurriculumScenario): string {
  return proposalFingerprint(scenario.proposal);
}

type PolicyCheckLike = {
  id: string;
  passed: boolean;
  severity?: string;
};

function asChecks(value: unknown): PolicyCheckLike[] {
  if (!Array.isArray(value)) return [];
  const out: PolicyCheckLike[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.passed !== "boolean") continue;
    out.push({
      id: record.id,
      passed: record.passed,
      ...(typeof record.severity === "string" ? { severity: record.severity } : {}),
    });
  }
  return out;
}

/**
 * Map failed policy check ids → curriculum tags when possible;
 * otherwise fall back to ledger-observed-deny.
 */
export function tagsFromFailedCheckIds(
  failedIds: readonly string[],
  proposal: TradeProposal,
): CurriculumTag[] {
  const tags = new Set<CurriculumTag>();

  for (const id of failedIds) {
    switch (id) {
      case "instrument.allowed":
        if (proposal.instrument === "option") tags.add("options-blocked");
        else if (proposal.instrument === "crypto") tags.add("crypto-blocked");
        else tags.add("ledger-observed-deny");
        break;
      case "symbol.not-denied":
        tags.add("denied-symbol");
        break;
      case "symbol.allowed":
        tags.add("empty-symbol-stress");
        break;
      case "order.notional":
      case "capital.deployable":
        tags.add("oversize-order");
        break;
      case "position.cap":
        tags.add("oversize-position");
        break;
      case "trades.daily":
        tags.add("daily-cap");
        break;
      case "drawdown.stop":
        tags.add("drawdown-halt");
        break;
      case "decision.complete":
        if (!proposal.hasThesis) tags.add("missing-thesis");
        if (!proposal.hasInvalidation) tags.add("missing-invalidation");
        if (proposal.hasThesis && proposal.hasInvalidation) tags.add("ledger-observed-deny");
        break;
      case "evidence.present":
        tags.add("zero-evidence");
        break;
      default:
        tags.add("ledger-observed-deny");
        break;
    }
  }

  if (tags.size === 0) tags.add("ledger-observed-deny");
  // Stable order matching CURRICULUM_TAGS then any remainder.
  const ordered = CURRICULUM_TAGS.filter((tag) => tags.has(tag));
  return ordered.length > 0 ? [...ordered] : ["ledger-observed-deny"];
}

function sanitizeProposalPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) continue;
    if (key === "notes" || key === "note") {
      // Never forward credential-shaped free text into synthetic scenarios.
      const safe = stripCredentialShapedNotes(value);
      if (safe !== undefined) {
        // Notes are not part of TradeProposal; drop entirely for scenario safety.
      }
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function parseProposalFromPayload(payload: Record<string, unknown>): TradeProposal | undefined {
  const cleaned = sanitizeProposalPayload(payload);
  const parsed = tradeProposalSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : undefined;
}

function latestCharterDeniedSymbols(events: readonly MinimalLedgerEvent[]): Set<string> {
  const denied = new Set<string>();
  const charters = events.filter((event) => event.type === "charter.activated");
  const latest = charters.at(-1);
  if (!latest) return denied;
  const policyRaw = payloadOf(latest).policy;
  const policyParse = riskPolicySchema.safeParse(policyRaw);
  if (!policyParse.success) return denied;
  for (const symbol of policyParse.data.deniedSymbols) {
    denied.add(symbol.toUpperCase());
  }
  return denied;
}

function labelForCandidate(proposal: TradeProposal, tags: readonly string[]): string {
  return `Ledger-derived deny: ${proposal.symbol} ${proposal.instrument} (${tags.join(", ")})`;
}

function buildCandidate(
  proposal: TradeProposal,
  tags: CurriculumTag[],
  failedHardCheckIds: string[],
): CurriculumCandidate {
  // Scenario proposal uses a deterministic synthetic proposalId (not the raw ledger id length).
  const id = candidateIdFromProposalId(proposal.proposalId);
  return {
    id,
    label: labelForCandidate(proposal, tags),
    tags,
    shouldAllow: false,
    proposal: {
      ...proposal,
      // Keep original proposal fields for process training; experiment id is synthetic.
      experimentId: "CURRICULUM-LEDGER",
      proposalId: `curr-${id}`,
    },
    source: "ledger-derived",
    derivedFromProposalId: proposal.proposalId,
    failedHardCheckIds: [...failedHardCheckIds].sort(),
  };
}

/**
 * Extract candidate synthetic deny-scenarios from ledger proposal/preflight pairs.
 *
 * Rules:
 * - Hard-denied preflight → shouldAllow:false, tags from failed hard check ids
 * - Preflight allowed a charter-denied symbol (or failed symbol.not-denied) → shouldAllow:false
 * - Max 20 candidates; deterministic ids from proposalId hash
 * - Never include broker credentials; strip credential-shaped notes
 */
export function extractCurriculumCandidatesFromEvents(
  events: readonly MinimalLedgerEvent[],
): CurriculumCandidate[] {
  const proposalsById = new Map<string, TradeProposal>();
  const preflightsById = new Map<
    string,
    { allowed: boolean; checks: PolicyCheckLike[]; sequence: number }
  >();

  let sequence = 0;
  for (const event of events) {
    sequence += 1;
    const payload = payloadOf(event);

    if (event.type === "proposal.recorded") {
      const proposal = parseProposalFromPayload(payload);
      if (proposal) proposalsById.set(proposal.proposalId, proposal);
      continue;
    }

    if (event.type === "preflight.completed") {
      const proposalId = payload.proposalId;
      if (typeof proposalId !== "string" || proposalId.length === 0) continue;
      const result = payload.result as { allowed?: unknown; checks?: unknown } | undefined;
      const allowed = result?.allowed === true;
      const checks = asChecks(result?.checks);
      // Keep the latest preflight for each proposalId (higher sequence wins).
      preflightsById.set(proposalId, { allowed, checks, sequence });
    }
  }

  const deniedSymbols = latestCharterDeniedSymbols(events);
  const candidates: CurriculumCandidate[] = [];
  const seenIds = new Set<string>();

  // Deterministic walk order: sorted proposal ids.
  const proposalIds = [...proposalsById.keys()].sort((a, b) => a.localeCompare(b));

  for (const proposalId of proposalIds) {
    if (candidates.length >= MAX_LEDGER_CANDIDATES) break;
    const proposal = proposalsById.get(proposalId);
    const preflight = preflightsById.get(proposalId);
    if (!proposal || !preflight) continue;

    const failedHard = preflight.checks
      .filter((check) => check.passed === false && (check.severity === "hard" || check.severity === undefined))
      .map((check) => check.id);

    // Prefer severity=hard when present; if severity omitted, treat failed checks as hard-ish.
    const failedHardStrict = preflight.checks
      .filter((check) => check.passed === false && check.severity === "hard")
      .map((check) => check.id);
    const failedHardIds = failedHardStrict.length > 0 ? failedHardStrict : failedHard;

    const symbolNotDeniedFailed = preflight.checks.some(
      (check) => check.id === "symbol.not-denied" && check.passed === false,
    );
    const symbolDeniedByCharter = deniedSymbols.has(proposal.symbol.toUpperCase());

    const hardDenied = preflight.allowed === false;
    const allowedButShouldDeny =
      preflight.allowed === true && (symbolDeniedByCharter || symbolNotDeniedFailed);

    if (!hardDenied && !allowedButShouldDeny) continue;

    let tags: CurriculumTag[];
    let failedForRecord: string[];

    if (hardDenied) {
      failedForRecord = failedHardIds;
      tags = tagsFromFailedCheckIds(failedHardIds, proposal);
    } else {
      // Allowed but contradicts denylist / symbol.not-denied.
      failedForRecord = symbolNotDeniedFailed
        ? ["symbol.not-denied"]
        : ["symbol.not-denied", "ledger-charter-denied"];
      tags = ["denied-symbol", "ledger-observed-deny"];
    }

    const candidate = buildCandidate(proposal, tags, failedForRecord);
    if (seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);
    candidates.push(candidate);
  }

  // Stable sort by id for deterministic output.
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return candidates.slice(0, MAX_LEDGER_CANDIDATES);
}

/**
 * Merge base (closed synthetic) curriculum with ledger-derived candidates.
 * Deduplicates by proposal fingerprint; prefers synthetic-closed over ledger-derived.
 * Caps total size (default 40). Marks source on every scenario.
 */
export function mergeCurriculum(
  base: readonly CurriculumScenario[],
  candidates: readonly CurriculumCandidate[] | readonly CurriculumScenario[],
  options?: { maxSize?: number },
): MergedCurriculumScenario[] {
  const maxSize = options?.maxSize ?? MAX_MERGED_CURRICULUM_SIZE;
  const merged: MergedCurriculumScenario[] = [];
  const seen = new Set<string>();

  const push = (scenario: CurriculumScenario, source: CurriculumScenarioSource): void => {
    if (merged.length >= maxSize) return;
    const fp = scenarioFingerprint(scenario);
    if (seen.has(fp)) return;
    seen.add(fp);
    merged.push({
      id: scenario.id,
      label: scenario.label,
      tags: [...scenario.tags] as CurriculumTag[],
      shouldAllow: scenario.shouldAllow,
      proposal: scenario.proposal,
      source,
    });
  };

  for (const scenario of base) {
    push(scenario, "synthetic-closed");
  }

  for (const candidate of candidates) {
    const source: CurriculumScenarioSource =
      "source" in candidate && candidate.source === "ledger-derived"
        ? "ledger-derived"
        : "ledger-derived";
    push(candidate, source);
  }

  return merged;
}

/**
 * Convenience: evaluate a policy against base curriculum merged with
 * optional ledger-derived candidates extracted from events.
 *
 * When events are omitted, evaluates the closed synthetic curriculum only.
 */
export function evaluateCharterAgainstMergedCurriculum(
  policy: RiskPolicy,
  events?: readonly MinimalLedgerEvent[],
): ShadowCurriculumReport {
  const candidates =
    events === undefined ? [] : extractCurriculumCandidatesFromEvents(events);
  const merged = mergeCurriculum(SHADOW_CURRICULUM, candidates);
  const scenarios: CurriculumScenario[] = merged.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    tags: scenario.tags,
    shouldAllow: scenario.shouldAllow,
    proposal: scenario.proposal,
  }));

  const ledgerDerivedCount = merged.filter((s) => s.source === "ledger-derived").length;
  const report = evaluateCharterAgainstScenarios(policy, scenarios);

  return {
    ...report,
    note:
      `${report.note} Merged curriculum: ${merged.length} scenarios ` +
      `(${merged.length - ledgerDerivedCount} synthetic-closed` +
      (ledgerDerivedCount > 0 ? ` + ${ledgerDerivedCount} ledger-derived` : "") +
      "). Ledger-derived labels are synthetic process labels for training — not market truth.",
  };
}

export { PRODUCT_SURFACE };
