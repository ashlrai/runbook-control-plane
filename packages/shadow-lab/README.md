# `@runbook/shadow-lab`

**Shadow Process Laboratory** — charter / process self-improvement for financial agents.

This package improves **RiskPolicy charter quality** against a frozen synthetic curriculum. It is not a trading bot, not an investment skill scorer, and not a live-capital system.

## Product truth (non-negotiable)

| Claim | Reality |
| --- | --- |
| What it improves | Charter / process quality (allowlists, denylists, notional caps, drawdown stops) |
| Capital | Always `$0` — no funding path |
| Broker | None — no credentials, no `place_order`, no Social |
| Enforcement | Always `advisory` — refinements never execute orders |
| Scores | Multi-axis metrics only (`hardFalseAllows`, `hardFalseDenies`, `advisoryGaps`, tag coverage). **No composite "agent is safe" grade.** |
| Returns | Never claimed, never measured, never optimized |

Name the product surface carefully: **Shadow Process Laboratory** / **Charter self-improvement** — never "best trader bot".

## Capabilities

1. **Synthetic curriculum** — closed set of adversarial + constructive trade proposals labeled under a *reference elite equity charter* (equity-only, approval-required, VTI/BND/VXUS allowlist, GME/AMC denied, tight notional/drawdown). Labels encode process correctness, not return quality.

2. **Evaluate charter** — run `evaluateProposal` from `@runbook/engine` for each scenario. Emit `runbook.shadow-curriculum-report.v1` with separate axes (no composite).

3. **Deterministic refine** — propose policy deltas from the report (no LLM): tighten denylists, strip options/crypto, shrink notional/position caps, restore allowlists for clean equities, set `approvalRequired`. One generation at a time; `runRecursiveImprovement` loops until fixed point or `maxGenerations` (default 5). Emits `runbook.shadow-refinement-generation.v1` / `runbook.shadow-recursive-improvement.v1`.

4. **Meta-curriculum (ledger-derived)** — `extractCurriculumCandidatesFromEvents` turns hard-denied (and charter-denylist false-allow) proposal/preflight pairs into synthetic deny scenarios (max 20). `mergeCurriculum` dedupes by proposal fingerprint and caps total size (40), marking `synthetic-closed` vs `ledger-derived`. Labels remain process-training labels — **not market truth**. MCP: `runbook_expand_curriculum_from_ledger` (offline; does not mutate ledger).

5. **Multi-charter tournament** — seed WEAK_STARTER + REFERENCE_ELITE + N deterministic mutants; evaluate + recursively improve each; emit Pareto front on `hardFalseAllows` vs `hardFalseDenies` as `runbook.shadow-tournament.v1` (no composite score). Root demo: `pnpm demo:tournament`.

## Use

```ts
import {
  REFERENCE_ELITE_POLICY,
  WEAK_STARTER_POLICY,
  evaluateCharter,
  proposeRefinement,
  runRecursiveImprovement,
  extractCurriculumCandidatesFromEvents,
  mergeCurriculum,
  runShadowTournament,
} from "@runbook/shadow-lab";

const report = evaluateCharter(REFERENCE_ELITE_POLICY);
// report.metrics.hardFalseAllows === 0 under the reference charter

const generation = proposeRefinement(WEAK_STARTER_POLICY);
const recursive = runRecursiveImprovement(WEAK_STARTER_POLICY, 5);
// Still advisory. capital: 0. brokerEffect: false.

// Meta-curriculum: ledger preflight fails → synthetic deny scenarios (process labels only)
const candidates = extractCurriculumCandidatesFromEvents(ledgerEvents);
const merged = mergeCurriculum(candidates); // caps + fingerprint dedupe

// Multi-charter Pareto tournament (weak + elite + mutants)
const tournament = runShadowTournament({ maxGenerations: 4, mutantCount: 6, seed: 1 });
// tournament.schemaVersion === "runbook.shadow-tournament.v1"
// tournament.paretoFront minimizes hardFalseAllows, then hardFalseDenies
```

CLI / script:

```sh
pnpm --filter @runbook/shadow-lab build
pnpm --filter @runbook/shadow-lab tournament -- --generations 4 --mutants 6 --seed 1
# or via MCP CLI after mcp build:
# runbook shadow-tournament [--generations N] [--mutants N] [--seed N]
# root: pnpm demo:tournament
```

## Metrics (axes only)

| Axis | Meaning |
| --- | --- |
| `hardFalseAllows` | Allowed when curriculum says deny — **critical process failure** |
| `hardFalseDenies` | Denied when curriculum says allow — over-restriction |
| `advisoryGaps` | Advisory check failed on a scenario the curriculum marks allow |
| tag coverage | Per-tag scenario counts and axis breakdowns |

There is intentionally **no** overall grade, safety score, or "agent is ready" flag.

## Safety boundary

- Synthetic proposals only; fixed curriculum IDs and labels.
- Depends only on `@runbook/engine` policy evaluation + schema types.
- Never imports broker SDKs, credentials, or Social surfaces.
- Refinement mutates an in-memory `RiskPolicy` object for lab comparison — it does not activate a live charter, fund an account, or authorize execution.
- Assurance: `synthetic-curriculum-process-quality-only`.

## Verify

```sh
pnpm --filter @runbook/shadow-lab test
pnpm --filter @runbook/shadow-lab typecheck
pnpm --filter @runbook/shadow-lab build
```
