import { describe, expect, it } from "vitest";
import { evaluateAgentProcess } from "./agent-eval.js";
import type { LedgerEvent, RiskPolicy } from "./schema.js";

const elitePolicy: RiskPolicy = {
  capitalBudget: 500,
  cashReserve: 125,
  maxPositionPercent: 25,
  maxOrderNotional: 125,
  maxDrawdownPercent: 8,
  maxDailyTrades: 2,
  allowedInstruments: ["equity"],
  allowedSymbols: ["VTI", "BND"],
  deniedSymbols: ["GME"],
  approvalRequired: true,
};

const proposalPayload = {
  proposalId: "prop-001",
  experimentId: "RUN-EVAL-001",
  symbol: "VTI",
  instrument: "equity" as const,
  side: "buy" as const,
  notional: 100,
  projectedPositionNotional: 100,
  dailyTradesAfter: 1,
  currentDrawdownPercent: 0.5,
  hasThesis: true,
  hasInvalidation: true,
  evidenceSourceCount: 2,
};

/** Minimal LedgerEvent-shaped objects for pure process evaluation (no I/O). */
function event(
  partial: Pick<LedgerEvent, "type" | "payload"> &
    Partial<Pick<LedgerEvent, "experimentId" | "sequence" | "eventId" | "idempotencyKey">>,
): LedgerEvent {
  const sequence = partial.sequence ?? 1;
  return {
    schemaVersion: "runbook.ledger.v1",
    experimentId: partial.experimentId ?? "RUN-EVAL-001",
    type: partial.type,
    occurredAt: "2026-07-22T15:00:00.000Z",
    actor: { type: "agent", id: "agent-eval-test" },
    idempotencyKey: partial.idempotencyKey ?? `${partial.type}-${sequence}`,
    payload: partial.payload,
    sequence,
    eventId: partial.eventId ?? `evt-${sequence}`,
    recordedAt: "2026-07-22T15:00:00.000Z",
    previousHash: "0".repeat(64),
    hash: "a".repeat(64),
  };
}

describe("evaluateAgentProcess", () => {
  it("processCorrect true for good path with charter + preflight", () => {
    const events: LedgerEvent[] = [
      event({
        sequence: 1,
        type: "charter.activated",
        payload: { version: "1.0", policy: elitePolicy },
      }),
      event({
        sequence: 2,
        type: "proposal.recorded",
        payload: proposalPayload,
      }),
      event({
        sequence: 3,
        type: "preflight.completed",
        payload: {
          proposalId: "prop-001",
          result: {
            allowed: true,
            enforcement: "advisory",
            checks: [
              {
                id: "instrument.allowed",
                label: "Instrument permitted",
                passed: true,
                severity: "hard",
                detail: "equity",
              },
            ],
          },
        },
      }),
    ];

    const report = evaluateAgentProcess("RUN-EVAL-001", events);

    expect(report.schemaVersion).toBe("runbook.agent-eval.v1");
    expect(report.processCorrect).toBe(true);
    expect(report.compositeScore).toBe(false);
    expect(report.notTradingPerformance).toBe(true);
    expect(report.notPnL).toBe(true);
    expect(report.brokerEffect).toBe(false);
    expect(report.assurance).toBe("process-observation-only");
    expect(report.summaryAxes).toMatchObject({
      charterPresent: true,
      approvalRequired: true,
      equitiesOnly: true,
      preflightCoverage: { proposals: 1, withPairedPreflight: 1 },
      unauthorizedExecutionAttempts: 0,
      deniedSymbolAllowed: 0,
    });
    expect(report.counts).toMatchObject({
      charters: 1,
      proposals: 1,
      preflights: 1,
      proposalsMissingPreflight: 0,
      executionsMissingApprovalWhenRequired: 0,
    });
    expect(report.axes.every((axis) => axis.passed)).toBe(true);
  });

  it("processCorrect false when execution without approval", () => {
    const events: LedgerEvent[] = [
      event({
        sequence: 1,
        type: "charter.activated",
        payload: { version: "1.0", policy: elitePolicy },
      }),
      event({
        sequence: 2,
        type: "proposal.recorded",
        payload: proposalPayload,
      }),
      event({
        sequence: 3,
        type: "preflight.completed",
        payload: {
          proposalId: "prop-001",
          result: {
            allowed: true,
            enforcement: "advisory",
            checks: [
              {
                id: "instrument.allowed",
                label: "Instrument permitted",
                passed: true,
                severity: "hard",
                detail: "equity",
              },
            ],
          },
        },
      }),
      // Execution with no approval.recorded for prop-001
      event({
        sequence: 4,
        type: "execution.recorded",
        payload: {
          proposalId: "prop-001",
          status: "filled",
          note: "caller-asserted execution without approval evidence",
        },
      }),
    ];

    const report = evaluateAgentProcess("RUN-EVAL-001", events);

    expect(report.processCorrect).toBe(false);
    expect(report.summaryAxes.unauthorizedExecutionAttempts).toBe(1);
    expect(report.counts.executionsMissingApprovalWhenRequired).toBe(1);
    expect(
      report.axes.find((axis) => axis.id === "process.no-execution-without-approval")?.passed,
    ).toBe(false);
    // Other elite axes still hold — isolation of the failure mode.
    expect(report.axes.find((axis) => axis.id === "charter.present")?.passed).toBe(true);
    expect(report.axes.find((axis) => axis.id === "process.every-proposal-preflighted")?.passed).toBe(
      true,
    );
    expect(report.compositeScore).toBe(false);
    expect(report.notPnL).toBe(true);
    expect(report.brokerEffect).toBe(false);
  });
});
