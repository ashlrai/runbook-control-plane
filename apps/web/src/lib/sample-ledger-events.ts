/**
 * Embedded sample ledger events for browser Process Theater agent-eval.
 * Source: packages/mcp/examples/sample-ledger-events.json
 *
 * Sample rows are type+payload only. Minimal LedgerEvent wrappers are synthesized
 * so evaluateAgentProcess can type-check; agent-eval only reads experimentId/type/payload.
 * Wrappers are not a verified hash chain.
 */

import type { LedgerEvent, LedgerEventType } from "@runbook/engine/schema";

/** Experiment id used by the embedded sample fixture. */
export const EXPERIMENT_ID = "RUN-META-SAMPLE" as const;

type SampleRow = {
  type: LedgerEventType;
  experimentId: string;
  payload: Record<string, unknown>;
};

/**
 * Content of packages/mcp/examples/sample-ledger-events.json (type/payload only).
 * Keep in sync with that fixture when it changes.
 */
export const SAMPLE_LEDGER_EVENT_ROWS: readonly SampleRow[] = [
  {
    type: "charter.activated",
    experimentId: EXPERIMENT_ID,
    payload: {
      version: "1.0",
      policy: {
        capitalBudget: 500,
        cashReserve: 125,
        maxPositionPercent: 25,
        maxOrderNotional: 125,
        maxDrawdownPercent: 8,
        maxDailyTrades: 2,
        allowedInstruments: ["equity"],
        allowedSymbols: ["VTI", "BND", "VXUS"],
        deniedSymbols: ["GME", "AMC", "BBBY"],
        approvalRequired: true,
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-bbby-deny",
      experimentId: EXPERIMENT_ID,
      symbol: "BBBY",
      instrument: "equity",
      side: "buy",
      notional: 75,
      projectedPositionNotional: 75,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-bbby-deny",
      result: {
        allowed: false,
        enforcement: "advisory",
        checks: [
          {
            id: "symbol.not-denied",
            passed: false,
            severity: "hard",
            label: "symbol.not-denied",
            detail: "BBBY is denied",
          },
          {
            id: "instrument.allowed",
            passed: true,
            severity: "hard",
            label: "instrument.allowed",
            detail: "ok",
          },
        ],
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-qqq-opt-deny",
      experimentId: EXPERIMENT_ID,
      symbol: "QQQ",
      instrument: "option",
      side: "buy",
      notional: 80,
      projectedPositionNotional: 80,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-qqq-opt-deny",
      result: {
        allowed: false,
        enforcement: "advisory",
        checks: [
          {
            id: "instrument.allowed",
            passed: false,
            severity: "hard",
            label: "instrument.allowed",
            detail: "option blocked",
          },
        ],
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-oversize-vxus",
      experimentId: EXPERIMENT_ID,
      symbol: "VXUS",
      instrument: "equity",
      side: "buy",
      notional: 750,
      projectedPositionNotional: 750,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-oversize-vxus",
      result: {
        allowed: false,
        enforcement: "advisory",
        checks: [
          {
            id: "order.notional",
            passed: false,
            severity: "hard",
            label: "order.notional",
            detail: "oversize",
          },
        ],
      },
    },
  },
  {
    type: "proposal.recorded",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-clean-vti",
      experimentId: EXPERIMENT_ID,
      symbol: "VTI",
      instrument: "equity",
      side: "buy",
      notional: 50,
      projectedPositionNotional: 50,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 1,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 2,
    },
  },
  {
    type: "preflight.completed",
    experimentId: EXPERIMENT_ID,
    payload: {
      proposalId: "sample-clean-vti",
      result: {
        allowed: true,
        enforcement: "advisory",
        checks: [
          {
            id: "symbol.not-denied",
            passed: true,
            severity: "hard",
            label: "symbol.not-denied",
            detail: "ok",
          },
          {
            id: "instrument.allowed",
            passed: true,
            severity: "hard",
            label: "instrument.allowed",
            detail: "ok",
          },
        ],
      },
    },
  },
];

const PLACEHOLDER_HASH = "0".repeat(64);
const SAMPLE_OCCURRED_AT = "2026-07-21T12:00:00.000Z";

/**
 * Minimal LedgerEvent wrappers around sample rows.
 * Hash/sequence fields are synthetic placeholders — not a real hash chain.
 */
export function wrapSampleLedgerEvents(
  rows: readonly SampleRow[] = SAMPLE_LEDGER_EVENT_ROWS,
): LedgerEvent[] {
  let previousHash = PLACEHOLDER_HASH;
  return rows.map((row, index) => {
    const sequence = index + 1;
    // Deterministic placeholder digests — not a verified hash chain.
    const hash = `${String(sequence).padStart(2, "0")}${"a".repeat(62)}`.slice(0, 64);
    const event: LedgerEvent = {
      schemaVersion: "runbook.ledger.v1",
      experimentId: row.experimentId,
      type: row.type,
      sequence,
      eventId: `evt-sample-${sequence}`,
      occurredAt: SAMPLE_OCCURRED_AT,
      recordedAt: SAMPLE_OCCURRED_AT,
      actor: { type: "system", id: "sample-ledger-fixture" },
      idempotencyKey: `sample-ledger-${sequence}`,
      previousHash,
      hash,
      payload: row.payload as LedgerEvent["payload"],
    };
    previousHash = hash;
    return event;
  });
}

/** Fully wrapped sample events ready for evaluateAgentProcess. */
export const SAMPLE_LEDGER_EVENTS: readonly LedgerEvent[] = wrapSampleLedgerEvents();
