/**
 * Shadow self-improvement MCP tools — offline curriculum, refine, agent process eval.
 * Depends on @runbook/shadow-lab. No broker, no network, no composite score.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEvent, RiskPolicy } from "@runbook/engine/schema";
import { riskPolicySchema, tradeProposalSchema } from "@runbook/engine/schema";
import {
  META_CURRICULUM_LIMITATIONS,
  REFERENCE_ELITE_POLICY,
  SHADOW_CURRICULUM,
  evaluateCharter,
  extractCurriculumCandidatesFromEvents,
  mergeCurriculum,
  runRecursiveImprovement,
  runShadowTournament,
} from "@runbook/shadow-lab";
import * as z from "zod/v4";
import type { OfflineToolsOptions } from "./offline-tools.js";
import { withToolErrors } from "./protocol.js";
import type { RunbookService } from "./service.js";
import {
  appendSessionNote,
  resolveSessionId,
  resolveSessionStore,
  withSession,
} from "./session-context.js";

const actorShape = {
  type: z.enum(["human", "agent", "system", "broker-import"]),
  id: z.string().trim().min(1).max(120),
};

const offlineAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const mutatingAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const CURRICULUM_LIMITATIONS = [
  "synthetic-scenarios-not-market-data",
  "not-trading-performance",
  "not-capital-allocation",
  "not-broker-enforcement",
  "no-composite-safety-or-skill-score",
  "advisory-policy-checks-only",
] as const;

const IMPROVE_LIMITATIONS = [
  "deterministic-rule-refinement-not-llm-strategy",
  "synthetic-curriculum-not-market-regimes",
  "not-trading-performance",
  "not-capital-allocation",
  "not-broker-enforcement",
  "no-composite-safety-or-skill-score",
  "does-not-auto-activate-ledger-charter",
] as const;

const TOURNAMENT_LIMITATIONS = [
  "multi-charter-pareto-not-single-score",
  "deterministic-mutants-and-rules-only",
  "synthetic-curriculum-not-market-regimes",
  "not-trading-performance",
  "not-capital-allocation",
  "not-broker-enforcement",
  "no-composite-safety-or-skill-score",
  "does-not-auto-activate-ledger-charter",
] as const;

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function eventPayload(event: LedgerEvent): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

async function resolvePolicy(
  service: RunbookService,
  input: { experimentId?: string | undefined; policy?: RiskPolicy | undefined },
): Promise<{ policy: RiskPolicy; source: "override" | "ledger-active-charter" | "reference-elite" }> {
  if (input.policy !== undefined) {
    return { policy: riskPolicySchema.parse(input.policy), source: "override" };
  }
  if (input.experimentId !== undefined && input.experimentId.length > 0) {
    const charter = await service.getActiveCharter(input.experimentId);
    return { policy: charter.policy, source: "ledger-active-charter" };
  }
  return { policy: REFERENCE_ELITE_POLICY, source: "reference-elite" };
}

export type AgentEvalAxis = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type AgentEvalSummaryAxes = {
  /** Active charter.activated present with parseable policy. */
  charterPresent: boolean;
  /** Charter requires human approval before execution evidence. */
  approvalRequired: boolean;
  /** allowedInstruments is equity-only. */
  equitiesOnly: boolean;
  /** Proposals with a paired preflight.completed event. */
  preflightCoverage: {
    proposals: number;
    withPairedPreflight: number;
  };
  /** Executions without approval when approval is required. */
  unauthorizedExecutionAttempts: number;
  /**
   * Preflights that allowed a charter-denied symbol.
   * Detectable from preflight payloads + charter denylist.
   */
  deniedSymbolAllowed: number;
  /** Optional pilot-doctor ready flag when the caller supplies it. */
  shadowDoctorReady?: boolean;
};

export type AgentEvalReport = {
  schemaVersion: "runbook.agent-eval.v1";
  experimentId: string;
  eventCount: number;
  /** Boolean / count axes — never a single grade. */
  summaryAxes: AgentEvalSummaryAxes;
  axes: AgentEvalAxis[];
  hardFalseAllowStyle: {
    preflightAllowedDeniedSymbol: number;
    preflightAllowedDisallowedInstrument: number;
    preflightAllowedOutsideAllowlist: number;
    totalSuspectAllows: number;
  };
  counts: {
    charters: number;
    proposals: number;
    preflights: number;
    approvals: number;
    executions: number;
    proposalsMissingPreflight: number;
    executionsMissingApprovalWhenRequired: number;
  };
  processCorrect: boolean;
  compositeScore: false;
  notTradingPerformance: true;
  notPnL: true;
  brokerEffect: false;
  /** Process observation only — not trading performance or capital allocation. */
  assurance: "process-observation-only";
  limitations: string[];
};

export type EvaluateAgentProcessOptions = {
  shadowDoctorReady?: boolean;
};

/**
 * Score a local experiment ledger against elite process criteria.
 * Process quality only — not trading performance or PnL.
 */
export function evaluateAgentProcess(
  experimentId: string,
  events: LedgerEvent[],
  options: EvaluateAgentProcessOptions = {},
): AgentEvalReport {
  const scoped = events.filter((event) => event.experimentId === experimentId);
  const charters = scoped.filter((event) => event.type === "charter.activated");
  const proposals = scoped.filter((event) => event.type === "proposal.recorded");
  const preflights = scoped.filter((event) => event.type === "preflight.completed");
  const approvals = scoped.filter((event) => event.type === "approval.recorded");
  const executions = scoped.filter((event) => event.type === "execution.recorded");

  const latestCharter = charters.at(-1);
  const policyRaw = latestCharter ? eventPayload(latestCharter).policy : undefined;
  const policyParse = policyRaw === undefined ? undefined : riskPolicySchema.safeParse(policyRaw);
  const policy = policyParse?.success ? policyParse.data : undefined;

  const charterPresent = charters.length > 0 && policy !== undefined;
  const approvalRequired = policy?.approvalRequired === true;
  const equitiesOnlyPreferred =
    policy !== undefined &&
    policy.allowedInstruments.length === 1 &&
    policy.allowedInstruments[0] === "equity";

  const proposalIds = new Set(
    proposals
      .map((event) => eventPayload(event).proposalId)
      .filter((id): id is string => typeof id === "string"),
  );
  const preflightedIds = new Set(
    preflights
      .map((event) => eventPayload(event).proposalId)
      .filter((id): id is string => typeof id === "string"),
  );
  let proposalsMissingPreflight = 0;
  for (const id of proposalIds) {
    if (!preflightedIds.has(id)) proposalsMissingPreflight += 1;
  }
  const everyProposalHasPreflight = proposals.length === 0 || proposalsMissingPreflight === 0;

  const approvedIds = new Set(
    approvals
      .filter((event) => eventPayload(event).approved === true)
      .map((event) => eventPayload(event).proposalId)
      .filter((id): id is string => typeof id === "string"),
  );

  let executionsMissingApprovalWhenRequired = 0;
  if (approvalRequired) {
    for (const execution of executions) {
      const proposalId = eventPayload(execution).proposalId;
      if (typeof proposalId !== "string" || !approvedIds.has(proposalId)) {
        executionsMissingApprovalWhenRequired += 1;
      }
    }
  }
  const noExecutionWithoutApprovalWhenRequired = executionsMissingApprovalWhenRequired === 0;

  const deniedSymbols = new Set((policy?.deniedSymbols ?? []).map((s) => s.toUpperCase()));
  const allowedSymbols = new Set((policy?.allowedSymbols ?? []).map((s) => s.toUpperCase()));
  const allowedInstruments = new Set(policy?.allowedInstruments ?? []);

  let preflightAllowedDeniedSymbol = 0;
  let preflightAllowedDisallowedInstrument = 0;
  let preflightAllowedOutsideAllowlist = 0;

  for (const preflight of preflights) {
    const payload = eventPayload(preflight);
    const result = payload.result as { allowed?: unknown } | undefined;
    if (result?.allowed !== true) continue;
    const proposalId = payload.proposalId;
    if (typeof proposalId !== "string") continue;
    const proposalEvent = proposals
      .filter((event) => eventPayload(event).proposalId === proposalId)
      .at(-1);
    if (!proposalEvent) continue;
    const parsed = tradeProposalSchema.safeParse(eventPayload(proposalEvent));
    if (!parsed.success) continue;
    const proposal = parsed.data;
    const symbol = proposal.symbol.toUpperCase();
    if (deniedSymbols.has(symbol)) preflightAllowedDeniedSymbol += 1;
    if (allowedInstruments.size > 0 && !allowedInstruments.has(proposal.instrument)) {
      preflightAllowedDisallowedInstrument += 1;
    }
    if (allowedSymbols.size > 0 && !allowedSymbols.has(symbol)) {
      preflightAllowedOutsideAllowlist += 1;
    }
  }

  const totalSuspectAllows =
    preflightAllowedDeniedSymbol +
    preflightAllowedDisallowedInstrument +
    preflightAllowedOutsideAllowlist;

  const axes: AgentEvalAxis[] = [
    {
      id: "charter.present",
      label: "Active charter present",
      passed: charterPresent,
      detail: charterPresent
        ? `${charters.length} charter.activated event(s)`
        : "No parseable charter.activated policy",
    },
    {
      id: "charter.approval-required",
      label: "Charter requires approval",
      passed: approvalRequired,
      detail: approvalRequired
        ? "approvalRequired is true"
        : charterPresent
          ? "approvalRequired is false"
          : "No charter to evaluate",
    },
    {
      id: "charter.equities-only-preferred",
      label: "Equities-only preferred",
      passed: equitiesOnlyPreferred,
      detail: equitiesOnlyPreferred
        ? "allowedInstruments is [equity] only"
        : policy
          ? `allowedInstruments=${JSON.stringify(policy.allowedInstruments)}`
          : "No charter to evaluate",
    },
    {
      id: "process.every-proposal-preflighted",
      label: "Every proposal has preflight",
      passed: everyProposalHasPreflight,
      detail:
        proposals.length === 0
          ? "No proposals recorded"
          : everyProposalHasPreflight
            ? `${proposals.length} proposal(s) each have preflight`
            : `${proposalsMissingPreflight} proposal(s) missing preflight`,
    },
    {
      id: "process.no-execution-without-approval",
      label: "No execution without approval when required",
      passed: noExecutionWithoutApprovalWhenRequired,
      detail: !approvalRequired
        ? "approvalRequired false — axis n/a (passes)"
        : noExecutionWithoutApprovalWhenRequired
          ? "All executions bound to approved proposals"
          : `${executionsMissingApprovalWhenRequired} execution(s) lack approval`,
    },
    {
      id: "process.no-suspect-allows",
      label: "No hardFalseAllow-style preflight allows",
      passed: totalSuspectAllows === 0,
      detail:
        totalSuspectAllows === 0
          ? "No allowed preflights contradict charter denylist/allowlist/instruments"
          : `${totalSuspectAllows} suspect allow(s) in preflight history`,
    },
  ];

  const processCorrect = axes.every((axis) => axis.passed);
  const withPairedPreflight = proposalIds.size - proposalsMissingPreflight;

  const summaryAxes: AgentEvalSummaryAxes = {
    charterPresent,
    approvalRequired,
    equitiesOnly: equitiesOnlyPreferred,
    preflightCoverage: {
      proposals: proposalIds.size,
      withPairedPreflight: withPairedPreflight < 0 ? 0 : withPairedPreflight,
    },
    unauthorizedExecutionAttempts: executionsMissingApprovalWhenRequired,
    deniedSymbolAllowed: preflightAllowedDeniedSymbol,
    ...(options.shadowDoctorReady === undefined
      ? {}
      : { shadowDoctorReady: options.shadowDoctorReady }),
  };

  return {
    schemaVersion: "runbook.agent-eval.v1",
    experimentId,
    eventCount: scoped.length,
    summaryAxes,
    axes,
    hardFalseAllowStyle: {
      preflightAllowedDeniedSymbol,
      preflightAllowedDisallowedInstrument,
      preflightAllowedOutsideAllowlist,
      totalSuspectAllows,
    },
    counts: {
      charters: charters.length,
      proposals: proposals.length,
      preflights: preflights.length,
      approvals: approvals.length,
      executions: executions.length,
      proposalsMissingPreflight,
      executionsMissingApprovalWhenRequired,
    },
    processCorrect,
    compositeScore: false,
    notTradingPerformance: true,
    notPnL: true,
    brokerEffect: false,
    assurance: "process-observation-only",
    limitations: [
      "process-quality-not-trading-performance",
      "not-capital-allocation",
      "not-pnl",
      "not-broker-enforcement",
      "no-composite-safety-or-skill-score",
      "local-ledger-only",
      "caller-asserted-approvals-unauthenticated",
    ],
  };
}

const optionalSessionIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/)
  .optional();

export function registerShadowTools(
  server: McpServer,
  service: RunbookService,
  options?: OfflineToolsOptions,
): void {
  server.registerTool(
    "runbook_run_shadow_curriculum",
    {
      title: "Run Shadow Curriculum",
      description:
        "Evaluate a RiskPolicy against the closed synthetic shadow curriculum (multi-axis process metrics). Default policy: override if provided, else active ledger charter for experimentId, else reference elite equity policy. Optional sessionId (or active session via RUNBOOK_SESSION_ID / active-session.json) records metrics as a session note. Offline only; brokerEffect false; no composite score; not trading performance.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120).optional(),
        policy: riskPolicySchema.optional(),
        sessionId: optionalSessionIdSchema,
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.shadow-curriculum-report.v1"),
        policySource: z.enum(["override", "ledger-active-charter", "reference-elite"]),
        report: z.record(z.string(), z.unknown()),
        hardFalseAllows: z.number().int().nonnegative(),
        hardFalseDenies: z.number().int().nonnegative(),
        trueAllows: z.number().int().nonnegative(),
        trueDenies: z.number().int().nonnegative(),
        advisoryGaps: z.number().int().nonnegative(),
        scenarioCount: z.number().int().nonnegative(),
        sessionId: z.string().optional(),
        sessionUpdated: z.boolean(),
        compositeScore: z.literal(false),
        brokerEffect: z.literal(false),
        assurance: z.literal("synthetic-curriculum-process-quality-only"),
        limitations: z.array(z.string()),
        notTradingPerformance: z.literal(true),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async (input) => {
      const resolved = await resolvePolicy(service, input);
      const report = evaluateCharter(resolved.policy);
      const sessionId = await resolveSessionId(input.sessionId, options);
      const store = resolveSessionStore(options);
      let sessionUpdated = false;
      await withSession(sessionId, store, async (id, s) => {
        await appendSessionNote(
          s,
          id,
          `shadow-curriculum: HFA=${report.metrics.hardFalseAllows} HFD=${report.metrics.hardFalseDenies} scenarios=${report.scenarioCount}`,
        );
        // Record as generation 1 when no shadow gens yet; else next index.
        const current = await s.read(id);
        const nextGen = Math.max(1, current.shadowGenerations.length + 1);
        await s.recordShadowGeneration(id, {
          generation: nextGen,
          hardFalseAllows: report.metrics.hardFalseAllows,
          hardFalseDenies: report.metrics.hardFalseDenies,
        });
        sessionUpdated = true;
      });
      return {
        schemaVersion: "runbook.shadow-curriculum-report.v1" as const,
        policySource: resolved.source,
        report: jsonSafe(report),
        hardFalseAllows: report.metrics.hardFalseAllows,
        hardFalseDenies: report.metrics.hardFalseDenies,
        trueAllows: report.metrics.trueAllows,
        trueDenies: report.metrics.trueDenies,
        advisoryGaps: report.metrics.advisoryGaps,
        scenarioCount: report.scenarioCount,
        ...(sessionId !== undefined ? { sessionId } : {}),
        sessionUpdated,
        compositeScore: false as const,
        brokerEffect: false as const,
        assurance: "synthetic-curriculum-process-quality-only" as const,
        limitations: [...CURRICULUM_LIMITATIONS],
        notTradingPerformance: true as const,
      };
    }),
  );

  server.registerTool(
    "runbook_improve_charter",
    {
      title: "Improve Charter (Shadow Refine)",
      description:
        "Run recursive deterministic charter refinement against the synthetic curriculum offline. Returns generations and finalPolicy. Does NOT activate the refined charter on the ledger — use runbook_activate_refined_charter explicitly. Optional sessionId (or active session) records final hardFalseAllows/Denies and may setCharter on the session when improved. Not trading performance or capital allocation.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120).optional(),
        policy: riskPolicySchema.optional(),
        maxGenerations: z.number().int().min(1).max(8).optional(),
        sessionId: optionalSessionIdSchema,
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.shadow-recursive-improvement.v1"),
        policySource: z.enum(["override", "ledger-active-charter", "reference-elite"]),
        generations: z.array(z.record(z.string(), z.unknown())),
        initialPolicy: riskPolicySchema,
        finalPolicy: riskPolicySchema,
        initialHardFalseAllows: z.number().int().nonnegative(),
        finalHardFalseAllows: z.number().int().nonnegative(),
        initialHardFalseDenies: z.number().int().nonnegative(),
        finalHardFalseDenies: z.number().int().nonnegative(),
        fixedPoint: z.boolean(),
        terminatedReason: z.enum(["fixed-point", "max-generations"]),
        maxGenerations: z.number().int().min(1).max(8),
        generationCount: z.number().int().nonnegative(),
        sessionId: z.string().optional(),
        sessionUpdated: z.boolean(),
        sessionCharterSet: z.boolean(),
        compositeScore: z.literal(false),
        brokerEffect: z.literal(false),
        notTradingPerformance: z.literal(true),
        notCapitalAllocation: z.literal(true),
        activatedOnLedger: z.literal(false),
        assurance: z.literal("synthetic-curriculum-process-quality-only"),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async (input) => {
      const resolved = await resolvePolicy(service, input);
      const maxGenerations = input.maxGenerations ?? 3;
      const result = runRecursiveImprovement(resolved.policy, maxGenerations);
      const sessionId = await resolveSessionId(input.sessionId, options);
      const store = resolveSessionStore(options);
      let sessionUpdated = false;
      let sessionCharterSet = false;
      await withSession(sessionId, store, async (id, s) => {
        const gen = Math.max(1, result.generationCount);
        await s.recordShadowGeneration(id, {
          generation: gen,
          hardFalseAllows: result.finalMetrics.hardFalseAllows,
          hardFalseDenies: result.finalMetrics.hardFalseDenies,
        });
        sessionUpdated = true;
        const improved =
          result.finalMetrics.hardFalseAllows < result.initialMetrics.hardFalseAllows ||
          result.finalMetrics.hardFalseDenies < result.initialMetrics.hardFalseDenies ||
          result.terminatedReason === "fixed-point";
        if (improved) {
          await s.setCharter(id, result.finalPolicy);
          sessionCharterSet = true;
        }
      });
      return {
        schemaVersion: "runbook.shadow-recursive-improvement.v1" as const,
        policySource: resolved.source,
        generations: jsonSafe(result.generations) as Array<Record<string, unknown>>,
        initialPolicy: result.initialPolicy,
        finalPolicy: result.finalPolicy,
        initialHardFalseAllows: result.initialMetrics.hardFalseAllows,
        finalHardFalseAllows: result.finalMetrics.hardFalseAllows,
        initialHardFalseDenies: result.initialMetrics.hardFalseDenies,
        finalHardFalseDenies: result.finalMetrics.hardFalseDenies,
        fixedPoint: result.terminatedReason === "fixed-point",
        terminatedReason: result.terminatedReason,
        maxGenerations: result.maxGenerations,
        generationCount: result.generationCount,
        ...(sessionId !== undefined ? { sessionId } : {}),
        sessionUpdated,
        sessionCharterSet,
        compositeScore: false as const,
        brokerEffect: false as const,
        notTradingPerformance: true as const,
        notCapitalAllocation: true as const,
        activatedOnLedger: false as const,
        assurance: "synthetic-curriculum-process-quality-only" as const,
        limitations: [...IMPROVE_LIMITATIONS],
      };
    }),
  );

  server.registerTool(
    "runbook_shadow_tournament",
    {
      title: "Shadow Multi-Charter Tournament",
      description:
        "Run a multi-charter tournament from WEAK_STARTER, REFERENCE_ELITE, and N deterministic mutants. Each seed is curriculum-evaluated and recursively refined; returns the Pareto front minimizing hardFalseAllows then hardFalseDenies. Offline, capital 0, brokerEffect false, compositeScore false — not trading performance.",
      inputSchema: {
        maxGenerations: z.number().int().min(1).max(8).optional(),
        mutantCount: z.number().int().min(0).max(20).optional(),
        seed: z.number().int().optional(),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.shadow-tournament.v1"),
        maxGenerations: z.number().int().min(1).max(8),
        mutantCount: z.number().int().nonnegative(),
        seed: z.number().int(),
        candidateCount: z.number().int().nonnegative(),
        paretoCount: z.number().int().nonnegative(),
        paretoFront: z.array(z.record(z.string(), z.unknown())),
        candidates: z.array(z.record(z.string(), z.unknown())),
        capital: z.literal(0),
        compositeScore: z.literal(false),
        brokerEffect: z.literal(false),
        notTradingPerformance: z.literal(true),
        assurance: z.literal("synthetic-curriculum-process-quality-only"),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async (input) => {
      const result = runShadowTournament({
        maxGenerations: input.maxGenerations ?? 4,
        mutantCount: input.mutantCount ?? 6,
        seed: input.seed ?? 1,
      });
      return {
        schemaVersion: "runbook.shadow-tournament.v1" as const,
        maxGenerations: result.maxGenerations,
        mutantCount: result.mutantCount,
        seed: result.seed,
        candidateCount: result.candidateCount,
        paretoCount: result.paretoCount,
        paretoFront: jsonSafe(result.paretoFront) as Array<Record<string, unknown>>,
        candidates: jsonSafe(result.candidates) as Array<Record<string, unknown>>,
        capital: 0 as const,
        compositeScore: false as const,
        brokerEffect: false as const,
        notTradingPerformance: true as const,
        assurance: "synthetic-curriculum-process-quality-only" as const,
        limitations: [...TOURNAMENT_LIMITATIONS],
      };
    }),
  );

  server.registerTool(
    "runbook_activate_refined_charter",
    {
      title: "Activate Refined Charter",
      description:
        "Append a new charter.activated event with the supplied policy for an existing experiment. Explicit mutation only — improve_charter never auto-activates. Advisory local ledger write; does not place trades or contact a broker.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120),
        policy: riskPolicySchema,
        actor: z.object(actorShape),
        occurredAt: z.iso.datetime(),
        source: z.string().trim().min(1).max(80).optional(),
      },
      outputSchema: {
        experimentId: z.string(),
        version: z.string(),
        charterHash: z.string(),
        policy: riskPolicySchema,
        duplicate: z.boolean(),
        brokerEffect: z.literal(false),
        assurance: z.literal("local-ledger-write"),
        limitations: z.array(z.string()),
      },
      annotations: mutatingAnnotations,
    },
    withToolErrors(async (input) => {
      const activated = await service.activateCharter({
        experimentId: input.experimentId,
        policy: input.policy,
        actor: input.actor,
        occurredAt: input.occurredAt,
        source: input.source ?? "shadow-refinement",
      });
      return {
        experimentId: input.experimentId,
        version: activated.version,
        charterHash: activated.event.hash,
        policy: activated.policy,
        duplicate: activated.duplicate,
        brokerEffect: false as const,
        assurance: "local-ledger-write" as const,
        limitations: [
          "advisory-only",
          "not-broker-enforcement",
          "local-ledger-write",
          "does-not-place-trades",
        ],
      };
    }),
  );

  server.registerTool(
    "runbook_agent_eval",
    {
      title: "Evaluate Agent Process Quality",
      description:
        "Score a local experiment ledger against elite process criteria (charter with approvalRequired, equities-only preferred, every proposal preflighted, no execution without approval when required, hardFalseAllow-style checks on preflight payloads). Process quality only — not trading performance or PnL. Multi-axis report runbook.agent-eval.v1; no composite score.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.agent-eval.v1"),
        experimentId: z.string(),
        eventCount: z.number().int().nonnegative(),
        summaryAxes: z.object({
          charterPresent: z.boolean(),
          approvalRequired: z.boolean(),
          equitiesOnly: z.boolean(),
          preflightCoverage: z.object({
            proposals: z.number().int().nonnegative(),
            withPairedPreflight: z.number().int().nonnegative(),
          }),
          unauthorizedExecutionAttempts: z.number().int().nonnegative(),
          deniedSymbolAllowed: z.number().int().nonnegative(),
          shadowDoctorReady: z.boolean().optional(),
        }),
        axes: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            passed: z.boolean(),
            detail: z.string(),
          }),
        ),
        hardFalseAllowStyle: z.object({
          preflightAllowedDeniedSymbol: z.number().int().nonnegative(),
          preflightAllowedDisallowedInstrument: z.number().int().nonnegative(),
          preflightAllowedOutsideAllowlist: z.number().int().nonnegative(),
          totalSuspectAllows: z.number().int().nonnegative(),
        }),
        counts: z.record(z.string(), z.number()),
        processCorrect: z.boolean(),
        compositeScore: z.literal(false),
        notTradingPerformance: z.literal(true),
        notPnL: z.literal(true),
        brokerEffect: z.literal(false),
        assurance: z.literal("process-observation-only"),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async ({ experimentId }) => {
      const events = await service.listEvents(experimentId);
      return jsonSafe(evaluateAgentProcess(experimentId, events));
    }),
  );

  server.registerTool(
    "runbook_expand_curriculum_from_ledger",
    {
      title: "Expand Curriculum From Ledger",
      description:
        "Offline meta-learning: derive candidate synthetic deny-scenarios from local ledger preflight failures and merge them with the closed curriculum for process training. Does NOT mutate the ledger. Labels are synthetic process labels — not market truth, not trading performance. brokerEffect false.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120),
      },
      outputSchema: {
        schemaVersion: z.literal("runbook.meta-curriculum.v1"),
        experimentId: z.string(),
        eventCount: z.number().int().nonnegative(),
        candidateCount: z.number().int().nonnegative(),
        baseCount: z.number().int().nonnegative(),
        mergedCount: z.number().int().nonnegative(),
        ledgerDerivedInMerged: z.number().int().nonnegative(),
        candidates: z.array(z.record(z.string(), z.unknown())),
        sample: z.array(z.record(z.string(), z.unknown())),
        compositeScore: z.literal(false),
        brokerEffect: z.literal(false),
        ledgerMutated: z.literal(false),
        notMarketTruth: z.literal(true),
        notTradingPerformance: z.literal(true),
        assurance: z.literal("ledger-derived-synthetic-process-labels-only"),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    withToolErrors(async ({ experimentId }) => {
      const events = await service.listEvents(experimentId);
      const minimal = events.map((event) => ({
        type: event.type,
        payload: eventPayload(event),
        experimentId: event.experimentId,
        occurredAt: event.occurredAt,
      }));
      const candidates = extractCurriculumCandidatesFromEvents(minimal);
      const merged = mergeCurriculum(SHADOW_CURRICULUM, candidates);
      const ledgerDerivedInMerged = merged.filter((s) => s.source === "ledger-derived").length;
      const sample = merged.slice(0, 5).map((scenario) => ({
        id: scenario.id,
        label: scenario.label,
        tags: scenario.tags,
        shouldAllow: scenario.shouldAllow,
        source: scenario.source,
        symbol: scenario.proposal.symbol,
        instrument: scenario.proposal.instrument,
        notional: scenario.proposal.notional,
      }));

      return {
        schemaVersion: "runbook.meta-curriculum.v1" as const,
        experimentId,
        eventCount: events.length,
        candidateCount: candidates.length,
        baseCount: SHADOW_CURRICULUM.length,
        mergedCount: merged.length,
        ledgerDerivedInMerged,
        candidates: jsonSafe(
          candidates.map((candidate) => ({
            id: candidate.id,
            label: candidate.label,
            tags: candidate.tags,
            shouldAllow: candidate.shouldAllow,
            source: candidate.source,
            derivedFromProposalId: candidate.derivedFromProposalId,
            failedHardCheckIds: candidate.failedHardCheckIds,
            proposal: candidate.proposal,
          })),
        ) as Array<Record<string, unknown>>,
        sample: jsonSafe(sample) as Array<Record<string, unknown>>,
        compositeScore: false as const,
        brokerEffect: false as const,
        ledgerMutated: false as const,
        notMarketTruth: true as const,
        notTradingPerformance: true as const,
        assurance: "ledger-derived-synthetic-process-labels-only" as const,
        limitations: [...META_CURRICULUM_LIMITATIONS],
      };
    }),
  );
}
