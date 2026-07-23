import { canonicalize, FileLedger, type LedgerVerification } from "@runbook/engine/ledger";
import { evaluateProposal, type PreflightResult } from "@runbook/engine/policy";
import {
  type JsonValue,
  type LedgerActor,
  type LedgerEvent,
  type RiskPolicy,
  type TradeProposal,
  riskPolicySchema,
  tradeProposalSchema,
} from "@runbook/engine/schema";

export type CreateExperimentInput = {
  experimentId: string;
  name: string;
  question: string;
  benchmark: string;
  observationDays: number;
  policy: RiskPolicy;
  actor: LedgerActor;
  occurredAt: string;
};

export type RecordApprovalInput = {
  experimentId: string;
  proposalId: string;
  approved: boolean;
  reason: string;
  actor: LedgerActor & { type: "human" };
  occurredAt: string;
  expiresAt?: string | undefined;
  idempotencyKey: string;
};

export type RecordExecutionInput = {
  experimentId: string;
  proposalId: string;
  source: "robinhood-mcp" | "robinhood-csv" | "manual" | "alpaca-paper";
  brokerEventId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity?: number | undefined;
  notional?: number | undefined;
  actor: LedgerActor;
  occurredAt: string;
  note?: string | undefined;
};

export type ExecutionEvidenceStatus = "control-evidence-consistent" | "policy-violation" | "evidence-ambiguous";

export type ExecutionEvidenceAssessment = {
  status: ExecutionEvidenceStatus;
  codes: string[];
  charterHash: string | null;
  proposalHash: string | null;
  preflightHash: string | null;
  approvalHash: string | null;
  scope: "caller-owned-observation-only";
  brokerTruthEstablished: false;
  humanAuthorityEstablished: false;
  authorizationEstablished: false;
};

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function asPayload(value: unknown): Record<string, JsonValue> {
  const json = asJsonValue(value);
  if (json === null || Array.isArray(json) || typeof json !== "object") {
    throw new Error("Ledger payload must be an object.");
  }
  return json;
}

function eventPayload(event: LedgerEvent) {
  return event.payload as Record<string, JsonValue>;
}

export class RunbookService {
  readonly ledger: FileLedger;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(ledger: FileLedger) {
    this.ledger = ledger;
  }

  async createExperiment(input: CreateExperimentInput) {
    return this.withMutationLock(async () => {
      const policy = riskPolicySchema.parse(input.policy);
      const experiment = await this.ledger.append({
        experimentId: input.experimentId,
        type: "experiment.created",
        occurredAt: input.occurredAt,
        actor: input.actor,
        idempotencyKey: `experiment:${input.experimentId}`,
        payload: asPayload({
          name: input.name,
          question: input.question,
          benchmark: input.benchmark.toUpperCase(),
          observationDays: input.observationDays,
        }),
      });
      const charter = await this.ledger.append({
        experimentId: input.experimentId,
        type: "charter.activated",
        occurredAt: input.occurredAt,
        actor: input.actor,
        idempotencyKey: `charter:${input.experimentId}:v1`,
        payload: asPayload({ version: "1.0", policy }),
      });
      return { experiment: experiment.event, charter: charter.event };
    });
  }

  async preflight(rawProposal: TradeProposal, actor: LedgerActor, occurredAt: string) {
    return this.withMutationLock(async () => {
      const proposal = tradeProposalSchema.parse(rawProposal);
      const charter = await this.getActiveCharter(proposal.experimentId);
      const result = evaluateProposal(charter.policy, proposal);
      const proposalEvent = await this.ledger.append({
        experimentId: proposal.experimentId,
        type: "proposal.recorded",
        occurredAt,
        actor,
        idempotencyKey: `proposal:${proposal.proposalId}`,
        payload: asPayload(proposal),
      });
      const preflightEvent = await this.ledger.append({
        experimentId: proposal.experimentId,
        type: "preflight.completed",
        occurredAt,
        actor: { type: "system", id: "runbook-policy-v1" },
        idempotencyKey: `preflight:${proposal.proposalId}:policy-v1`,
        payload: asPayload({
          proposalId: proposal.proposalId,
          result,
          charterHash: charter.event.hash,
          proposalHash: proposalEvent.event.hash,
        }),
      });
      return { result, proposalEvent: proposalEvent.event, preflightEvent: preflightEvent.event };
    });
  }

  async recordApproval(input: RecordApprovalInput) {
    // Snapshot the caller-supplied actor before entering the async mutation queue so
    // a direct caller cannot pass the check and then mutate the object before append.
    const assertedActor = input.actor as LedgerActor;
    const actorType = assertedActor.type;
    const actorId = assertedActor.id;
    if (actorType !== "human") {
      throw new Error("Only a caller-asserted human actor can record an approval decision.");
    }
    const humanActor = { type: "human" as const, id: actorId };

    return this.withMutationLock(async () => {
      const preflight = await this.findPreflight(input.experimentId, input.proposalId);
      const result = preflight.payload.result as unknown as PreflightResult;
      if (input.approved && !result.allowed) {
        throw new Error("Cannot record an approval for a proposal that failed a hard policy control.");
      }
      return (
        await this.ledger.append({
          experimentId: input.experimentId,
          type: "approval.recorded",
          occurredAt: input.occurredAt,
          actor: humanActor,
          idempotencyKey: input.idempotencyKey,
          payload: asPayload({
            proposalId: input.proposalId,
            approved: input.approved,
            reason: input.reason,
            preflightHash: preflight.event.hash,
            ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
          }),
        })
      ).event;
    });
  }

  async recordExecution(input: RecordExecutionInput) {
    return this.withMutationLock(async () => {
      const events = await this.ledger.list(input.experimentId);
      const evidence = this.assessExecutionEvidence(events, input);

      return (
        await this.ledger.append({
          experimentId: input.experimentId,
          type: "execution.recorded",
          occurredAt: input.occurredAt,
          actor: input.actor,
          idempotencyKey: `execution:${input.source}:${input.brokerEventId}`,
          payload: asPayload({
            proposalId: input.proposalId,
            source: input.source,
            brokerEventId: input.brokerEventId,
            symbol: input.symbol.toUpperCase(),
            side: input.side,
            ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
            ...(input.notional === undefined ? {} : { notional: input.notional }),
            ...(input.note === undefined ? {} : { note: input.note }),
            evidence,
          }),
        })
      ).event;
    });
  }

  listEvents(experimentId?: string): Promise<LedgerEvent[]> {
    return this.ledger.list(experimentId);
  }

  snapshot(experimentId?: string) {
    return this.ledger.snapshot(experimentId);
  }

  verify(): Promise<LedgerVerification> {
    return this.ledger.verify();
  }

  /**
   * Load the latest charter.activated policy for an experiment.
   * Public for offline shadow curriculum / improve tools.
   */
  async getActiveCharter(experimentId: string): Promise<{ event: LedgerEvent; policy: RiskPolicy; version: string }> {
    const events = await this.ledger.list(experimentId);
    const charter = events.filter((event) => event.type === "charter.activated").at(-1);
    if (!charter) throw new Error(`No active charter found for experiment ${experimentId}.`);
    const payload = eventPayload(charter);
    const version = typeof payload.version === "string" ? payload.version : "unknown";
    return { event: charter, policy: riskPolicySchema.parse(payload.policy), version };
  }

  /**
   * Append a new charter.activated event with the refined policy.
   * Does not rewrite history; previous charters remain for evidence.
   * Idempotent: same policy body + source under a stable key returns the prior event.
   * If the latest charter already matches the policy, returns it without a new append.
   */
  async activateCharter(input: {
    experimentId: string;
    policy: RiskPolicy;
    actor: LedgerActor;
    occurredAt: string;
    /** Optional moniker recorded in payload (e.g. shadow-refinement). */
    source?: string | undefined;
  }): Promise<{ event: LedgerEvent; version: string; policy: RiskPolicy; duplicate: boolean }> {
    return this.withMutationLock(async () => {
      const policy = riskPolicySchema.parse(input.policy);
      const events = await this.ledger.list(input.experimentId);
      const priorCharters = events.filter((event) => event.type === "charter.activated");
      const hasExperiment = events.some((event) => event.type === "experiment.created");
      if (priorCharters.length === 0 && !hasExperiment) {
        throw new Error(`No active charter found for experiment ${input.experimentId}.`);
      }

      const latest = priorCharters.at(-1);
      if (latest) {
        const latestPolicy = riskPolicySchema.safeParse(eventPayload(latest).policy);
        if (
          latestPolicy.success &&
          canonicalize(asJsonValue(latestPolicy.data)) === canonicalize(asJsonValue(policy))
        ) {
          const version =
            typeof eventPayload(latest).version === "string"
              ? (eventPayload(latest).version as string)
              : "unknown";
          return { event: latest, version, policy: latestPolicy.data, duplicate: true };
        }
      }

      const nextMajor = priorCharters.length + 1;
      const version = `${nextMajor}.0`;
      const charter = await this.ledger.append({
        experimentId: input.experimentId,
        type: "charter.activated",
        occurredAt: input.occurredAt,
        actor: input.actor,
        idempotencyKey: `charter:${input.experimentId}:v${nextMajor}`,
        payload: asPayload({
          version,
          policy,
          source: input.source ?? "shadow-refinement",
        }),
      });
      return { event: charter.event, version, policy, duplicate: charter.duplicate };
    });
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private assessExecutionEvidence(events: LedgerEvent[], input: RecordExecutionInput): ExecutionEvidenceAssessment {
    const violations = new Set<string>();
    const ambiguities = new Set<string>();
    const executionTime = Date.parse(input.occurredAt);

    const matchingBrokerEvents = events.filter((event) => (
      event.type === "execution.recorded" && eventPayload(event).brokerEventId === input.brokerEventId
    ));
    const claimedSources = new Set<unknown>([
      input.source,
      ...matchingBrokerEvents.map((event) => eventPayload(event).source),
    ]);
    if (claimedSources.size > 1) ambiguities.add("execution-source-ambiguous");
    if (matchingBrokerEvents.some((event) => {
      const payload = eventPayload(event);
      return payload.proposalId !== input.proposalId ||
        payload.symbol !== input.symbol.toUpperCase() ||
        payload.side !== input.side;
    })) {
      ambiguities.add("execution-identity-ambiguous");
    }

    const proposals = events.filter((event) => (
      event.type === "proposal.recorded" && eventPayload(event).proposalId === input.proposalId
    ));
    if (proposals.length === 0) ambiguities.add("proposal-missing");
    if (proposals.length > 1) ambiguities.add("proposal-ambiguous");
    const proposalEvent = proposals.length === 1 ? proposals[0] : undefined;
    const parsedProposal = proposalEvent
      ? tradeProposalSchema.safeParse(eventPayload(proposalEvent))
      : undefined;
    if (parsedProposal && !parsedProposal.success) ambiguities.add("proposal-invalid");
    const proposal = parsedProposal?.success ? parsedProposal.data : undefined;
    if (proposal) {
      if (
        proposal.experimentId !== input.experimentId ||
        proposal.symbol !== input.symbol.toUpperCase() ||
        proposal.side !== input.side
      ) {
        violations.add("execution-binding-mismatch");
      }
      if (proposalEvent && Date.parse(proposalEvent.occurredAt) > executionTime) {
        violations.add("proposal-after-execution");
      }
      if (input.notional !== undefined && input.notional > proposal.notional) {
        violations.add("execution-notional-exceeds-proposal");
      }
      if (input.notional === undefined) ambiguities.add("execution-notional-unverifiable");
    }

    const eligibleCharters = events.filter((event) => (
      event.type === "charter.activated" && Date.parse(event.occurredAt) <= executionTime
    ));
    const latestCharterTime = Math.max(...eligibleCharters.map((event) => Date.parse(event.occurredAt)));
    const latestCharters = eligibleCharters.filter((event) => Date.parse(event.occurredAt) === latestCharterTime);
    if (eligibleCharters.length === 0) ambiguities.add("charter-missing");
    if (latestCharters.length > 1) ambiguities.add("charter-ambiguous");
    const charterEvent = latestCharters.length === 1 ? latestCharters[0] : undefined;
    const parsedPolicy = charterEvent
      ? riskPolicySchema.safeParse(eventPayload(charterEvent).policy)
      : undefined;
    if (parsedPolicy && !parsedPolicy.success) ambiguities.add("charter-invalid");
    const policy = parsedPolicy?.success ? parsedPolicy.data : undefined;

    const matchingPreflights = events.filter((event) => (
      event.type === "preflight.completed" &&
      eventPayload(event).proposalId === input.proposalId
    ));
    const preflights = matchingPreflights.filter((event) => Date.parse(event.occurredAt) <= executionTime);
    if (preflights.length === 0) ambiguities.add("preflight-missing");
    if (preflights.length === 0 && matchingPreflights.length > 0) {
      violations.add("preflight-after-execution");
    }

    const decisions = events.filter((event) => (
      event.type === "approval.recorded" &&
      eventPayload(event).proposalId === input.proposalId &&
      Date.parse(event.occurredAt) <= executionTime
    ));
    const nonHumanDecisions = decisions.filter((event) => event.actor.type !== "human");
    if (nonHumanDecisions.length > 0) violations.add("approval-actor-not-human");
    const humanDecisions = decisions.filter((event) => event.actor.type === "human");
    const invalidDecisions = decisions.filter((event) => typeof eventPayload(event).approved !== "boolean");
    if (invalidDecisions.length > 0) ambiguities.add("approval-record-invalid");
    const denials = decisions.filter((event) => eventPayload(event).approved === false);
    if (denials.length > 0) violations.add("approval-denied");

    const approvals = humanDecisions.filter((event) => eventPayload(event).approved === true);
    const boundApprovals = approvals.filter((approval) => (
      preflights.some((preflight) => preflight.hash === eventPayload(approval).preflightHash)
    ));
    if (approvals.length > 0 && boundApprovals.length === 0) violations.add("approval-binding-mismatch");
    if (approvals.length > 1 || (approvals.length > 0 && denials.length > 0)) {
      ambiguities.add("approval-state-ambiguous");
    }

    const approvalEvent = boundApprovals.length === 1 ? boundApprovals[0] : undefined;
    const preflightEvent = approvalEvent
      ? preflights.find((event) => event.hash === eventPayload(approvalEvent).preflightHash)
      : preflights.length === 1 ? preflights[0] : undefined;
    if (preflights.length > 1 && !approvalEvent) ambiguities.add("preflight-ambiguous");

    if (preflightEvent) {
      const preflightPayload = eventPayload(preflightEvent);
      const result = preflightPayload.result as { allowed?: unknown } | undefined;
      if (result?.allowed === false) violations.add("preflight-denied");
      if (result?.allowed !== true && result?.allowed !== false) ambiguities.add("preflight-result-invalid");
      if (typeof preflightPayload.proposalHash !== "string") {
        ambiguities.add("preflight-proposal-binding-missing");
      } else if (proposalEvent && preflightPayload.proposalHash !== proposalEvent.hash) {
        violations.add("preflight-proposal-binding-mismatch");
      }
      if (typeof preflightPayload.charterHash !== "string") {
        ambiguities.add("preflight-policy-binding-missing");
      } else if (charterEvent && preflightPayload.charterHash !== charterEvent.hash) {
        violations.add("policy-changed-after-preflight");
      }
      if (proposalEvent && Date.parse(preflightEvent.occurredAt) < Date.parse(proposalEvent.occurredAt)) {
        violations.add("preflight-before-proposal");
      }
      if (charterEvent && Date.parse(preflightEvent.occurredAt) < Date.parse(charterEvent.occurredAt)) {
        violations.add("preflight-before-charter");
      }
      if (proposal && policy && result?.allowed === true) {
        const recomputed = evaluateProposal(policy, proposal);
        let storedResult: JsonValue | undefined;
        try {
          storedResult = asJsonValue(preflightPayload.result);
        } catch {
          ambiguities.add("preflight-result-invalid");
        }
        if (storedResult !== undefined && canonicalize(storedResult) !== canonicalize(asJsonValue(recomputed))) {
          violations.add("preflight-result-mismatch");
        }
      }
    }

    if (policy?.approvalRequired) {
      if (approvals.length === 0) violations.add("approval-missing");
      if (approvals.length > 0) ambiguities.add("human-authority-unverified");
      if (approvalEvent) {
        const approvalPayload = eventPayload(approvalEvent);
        const approvalTime = Date.parse(approvalEvent.occurredAt);
        if (preflightEvent && approvalTime < Date.parse(preflightEvent.occurredAt)) {
          violations.add("approval-before-preflight");
        }
        const expiresAt = approvalPayload.expiresAt;
        if (typeof expiresAt !== "string") {
          ambiguities.add("approval-expiry-unverifiable");
        } else {
          const expiryTime = Date.parse(expiresAt);
          if (!Number.isFinite(expiryTime) || expiryTime <= approvalTime) {
            ambiguities.add("approval-window-invalid");
          } else if (expiryTime <= executionTime) {
            violations.add("approval-expired");
          }
        }
      }
    }

    const status: ExecutionEvidenceStatus = violations.size > 0
      ? "policy-violation"
      : ambiguities.size > 0
        ? "evidence-ambiguous"
        : "control-evidence-consistent";
    return {
      status,
      codes: [...violations, ...ambiguities].sort(),
      charterHash: charterEvent?.hash ?? null,
      proposalHash: proposalEvent?.hash ?? null,
      preflightHash: preflightEvent?.hash ?? null,
      approvalHash: approvalEvent?.hash ?? null,
      scope: "caller-owned-observation-only",
      brokerTruthEstablished: false,
      humanAuthorityEstablished: false,
      authorizationEstablished: false,
    };
  }

  private async findPreflight(experimentId: string, proposalId: string) {
    const event = (await this.ledger.list(experimentId))
      .filter(
        (candidate) =>
          candidate.type === "preflight.completed" &&
          eventPayload(candidate).proposalId === proposalId,
      )
      .at(-1);
    if (!event) throw new Error(`No preflight record found for proposal ${proposalId}.`);
    return { event, payload: eventPayload(event) };
  }
}
