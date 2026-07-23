import { describe, expect, it } from "vitest";
import { evaluateAgentProcess } from "@runbook/engine/agent-eval";
import {
  EXPERIMENT_ID,
  SAMPLE_LEDGER_EVENTS,
  SAMPLE_LEDGER_EVENT_ROWS,
  wrapSampleLedgerEvents,
} from "./sample-ledger-events";

describe("sample-ledger-events", () => {
  it("embeds the MCP sample experiment id and proposal/preflight pairs", () => {
    expect(EXPERIMENT_ID).toBe("RUN-META-SAMPLE");
    expect(SAMPLE_LEDGER_EVENT_ROWS.length).toBe(9);
    const proposals = SAMPLE_LEDGER_EVENT_ROWS.filter((e) => e.type === "proposal.recorded");
    const preflights = SAMPLE_LEDGER_EVENT_ROWS.filter((e) => e.type === "preflight.completed");
    expect(proposals).toHaveLength(4);
    expect(preflights).toHaveLength(4);
  });

  it("synthesizes LedgerEvent wrappers with required chain fields", () => {
    const events = wrapSampleLedgerEvents();
    expect(events).toHaveLength(SAMPLE_LEDGER_EVENT_ROWS.length);
    for (const [index, event] of events.entries()) {
      expect(event.schemaVersion).toBe("runbook.ledger.v1");
      expect(event.sequence).toBe(index + 1);
      expect(event.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(event.previousHash).toMatch(/^[a-f0-9]{64}$/);
      expect(event.experimentId).toBe(EXPERIMENT_ID);
      expect(event.actor.id).toBe("sample-ledger-fixture");
    }
    expect(SAMPLE_LEDGER_EVENTS).toHaveLength(events.length);
  });

  it("evaluates process-correct on the sample without a composite score", () => {
    const report = evaluateAgentProcess(EXPERIMENT_ID, [...SAMPLE_LEDGER_EVENTS]);
    expect(report.schemaVersion).toBe("runbook.agent-eval.v1");
    expect(report.processCorrect).toBe(true);
    expect(report.compositeScore).toBe(false);
    expect(report.notTradingPerformance).toBe(true);
    expect(report.notPnL).toBe(true);
    expect(report.brokerEffect).toBe(false);
    expect(report.assurance).toBe("process-observation-only");
    expect(report.axes.every((axis) => axis.passed)).toBe(true);
    expect(report.limitations).toContain("no-composite-safety-or-skill-score");
  });
});
