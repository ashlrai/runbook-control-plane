import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLedger } from "@runbook/engine/ledger";
import type { RiskPolicy } from "@runbook/engine/schema";
import { afterEach, describe, expect, it } from "vitest";
import { diagnoseShadowPilot, shadowPilotManifestSchema } from "./pilot-doctor.js";
import { RunbookService } from "./service.js";

const experimentId = "RUN-SHADOW-001";
const occurredAt = "2026-07-21T18:00:00.000Z";
const manifest = shadowPilotManifestSchema.parse({
  schemaVersion: "runbook.shadow-pilot.v1",
  experimentId,
  mode: "shadow",
  brokerageConnection: "disconnected",
  dataSource: "synthetic",
  orderExecution: "disabled",
  capitalAtRisk: 0,
  publication: "manual-human-reviewed",
  operatorAttestations: {
    noBrokerCredentials: true,
    noBrokerOrderTools: true,
    noLiveExecutionImports: true,
    noAutomatedPublishing: true,
  },
});

const safePolicy: RiskPolicy = {
  capitalBudget: 500,
  cashReserve: 250,
  maxPositionPercent: 10,
  maxOrderNotional: 50,
  maxDrawdownPercent: 5,
  maxDailyTrades: 1,
  allowedInstruments: ["equity"],
  allowedSymbols: ["VTI"],
  deniedSymbols: [],
  approvalRequired: true,
};

const directories: string[] = [];

async function harness(policy: RiskPolicy = safePolicy) {
  const directory = await mkdtemp(join(tmpdir(), "runbook-doctor-"));
  directories.push(directory);
  const service = new RunbookService(new FileLedger(directory, "pilot"));
  await service.createExperiment({
    experimentId,
    name: "Shadow pilot",
    question: "Can the workflow preserve its declared boundary?",
    benchmark: "VTI",
    observationDays: 30,
    policy,
    actor: { type: "human", id: "operator" },
    occurredAt,
  });
  return { directory, service };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("diagnoseShadowPilot", () => {
  it("passes a broker-disconnected, zero-capital, equity-only shadow experiment", async () => {
    const { directory, service } = await harness();
    const report = await diagnoseShadowPilot({
      manifest,
      service,
      dataDir: directory,
      workspaceRoot: "/workspace/runbook",
      environment: {},
    });

    expect(report.ready).toBe(true);
    expect(report.assurance).toBe("local-attestation-and-ledger-only");
    expect(report.checks.filter((item) => item.severity === "blocking").every((item) => item.passed)).toBe(true);
    expect(report.checks.find((item) => item.id === "storage.owner-private")).toMatchObject({ passed: true });
    expect(report.checks.find((item) => item.id === "ledger.file-owner-private")).toMatchObject({ passed: true });
    expect(report.checks.find((item) => item.id === "ledger.lock-owner-private")).toMatchObject({ passed: true });
    expect(report.checks.find((item) => item.id === "workflow.shadow-evidence")).toMatchObject({
      passed: false,
      severity: "advisory",
    });
    expect(report.nextActions).toEqual([
      expect.stringContaining("do not connect a broker"),
    ]);
  });

  it("reports shadow evidence after a deterministic preflight without weakening readiness", async () => {
    const { directory, service } = await harness();
    await service.preflight({
      proposalId: "shadow-proposal-001",
      experimentId,
      symbol: "VTI",
      instrument: "equity",
      side: "buy",
      notional: 25,
      projectedPositionNotional: 25,
      dailyTradesAfter: 1,
      currentDrawdownPercent: 0,
      hasThesis: true,
      hasInvalidation: true,
      evidenceSourceCount: 1,
    }, { type: "agent", id: "shadow-agent" }, occurredAt);

    const report = await diagnoseShadowPilot({
      manifest,
      service,
      dataDir: directory,
      workspaceRoot: "/workspace/runbook",
      environment: {},
    });

    expect(report.ready).toBe(true);
    expect(report.checks.find((item) => item.id === "workflow.shadow-evidence")).toMatchObject({
      passed: true,
      severity: "advisory",
    });
    expect(report.nextActions).toEqual([
      expect.stringContaining("metadata-only snapshot"),
    ]);
  });

  it("fails closed on unsafe storage, credential-shaped environment state, policy drift, and execution records", async () => {
    const unsafePolicy: RiskPolicy = {
      ...safePolicy,
      allowedInstruments: ["equity", "option"],
      approvalRequired: false,
    };
    const { service } = await harness(unsafePolicy);
    await service.ledger.append({
      experimentId,
      type: "execution.recorded",
      occurredAt,
      actor: { type: "broker-import", id: "manual-import" },
      idempotencyKey: "execution:manual:unexpected",
      payload: { source: "manual", brokerEventId: "unexpected" },
    });

    const report = await diagnoseShadowPilot({
      manifest,
      service,
      dataDir: "/workspace/runbook/private-ledger",
      workspaceRoot: "/workspace/runbook",
      environment: { ROBINHOOD_ACCESS_TOKEN: "do-not-echo-this-secret" },
    });

    expect(report.ready).toBe(false);
    expect(report.checks.filter((item) => !item.passed).map((item) => item.id)).toEqual(expect.arrayContaining([
      "environment.no-broker-credentials",
      "storage.outside-workspace",
      "charter.approval-required",
      "charter.equity-only",
      "experiment.no-executions",
    ]));
    expect(JSON.stringify(report)).not.toContain("do-not-echo-this-secret");
  });

  it("rejects undeclared manifest fields so credentials cannot be smuggled into the readiness artifact", () => {
    expect(() => shadowPilotManifestSchema.parse({
      ...manifest,
      robinhoodToken: "must-not-be-accepted",
    })).toThrow();
  });

  it("blocks readiness when the owned data directory has mode 0755", async () => {
    const { directory, service } = await harness();
    await chmod(directory, 0o755);

    const report = await diagnoseShadowPilot({
      manifest,
      service,
      dataDir: directory,
      workspaceRoot: "/workspace/runbook",
      environment: {},
    });

    expect(report.ready).toBe(false);
    expect(report.checks.find((item) => item.id === "storage.owner-private")).toMatchObject({
      passed: false,
      severity: "blocking",
      detail: expect.stringContaining("mode 0755 permits group or other access"),
    });
    expect(report.checks.find((item) => item.id === "ledger.integrity")).toMatchObject({ passed: false });
  });

  it("blocks readiness when the ledger file has mode 0644", async () => {
    const { directory, service } = await harness();
    await chmod(service.ledger.path, 0o644);

    const report = await diagnoseShadowPilot({
      manifest,
      service,
      dataDir: directory,
      workspaceRoot: "/workspace/runbook",
      environment: {},
    });

    expect(report.ready).toBe(false);
    expect(report.checks.find((item) => item.id === "ledger.file-owner-private")).toMatchObject({
      passed: false,
      severity: "blocking",
      detail: expect.stringContaining("mode 0644 permits group or other access"),
    });
    expect(report.checks.find((item) => item.id === "ledger.integrity")).toMatchObject({ passed: false });
  });

  it("blocks readiness when a present writer lock has mode 0644", async () => {
    const { directory, service } = await harness();
    await writeFile(service.ledger.lockPath, "stale", { mode: 0o644 });
    await chmod(service.ledger.lockPath, 0o644);

    const report = await diagnoseShadowPilot({
      manifest,
      service,
      dataDir: directory,
      workspaceRoot: "/workspace/runbook",
      environment: {},
    });

    expect(report.ready).toBe(false);
    expect(report.checks.find((item) => item.id === "ledger.lock-owner-private")).toMatchObject({
      passed: false,
      severity: "blocking",
      detail: expect.stringContaining("mode 0644 permits group or other access"),
    });
    expect(report.checks.find((item) => item.id === "ledger.integrity")).toMatchObject({ passed: false });
  });

  it("matches proposal and preflight identities instead of trusting event counts", async () => {
    const { directory, service } = await harness();
    await service.ledger.append({
      experimentId,
      type: "proposal.recorded",
      occurredAt,
      actor: { type: "agent", id: "shadow-agent" },
      idempotencyKey: "proposal:proposal-a",
      payload: { proposalId: "proposal-a" },
    });
    await service.ledger.append({
      experimentId,
      type: "preflight.completed",
      occurredAt,
      actor: { type: "system", id: "test-policy" },
      idempotencyKey: "preflight:proposal-b",
      payload: { proposalId: "proposal-b" },
    });

    const report = await diagnoseShadowPilot({
      manifest,
      service,
      dataDir: directory,
      workspaceRoot: "/workspace/runbook",
      environment: {},
    });

    expect(report.ready).toBe(false);
    expect(report.checks.find((item) => item.id === "experiment.preflights-paired")).toMatchObject({
      passed: false,
      severity: "blocking",
    });
  });
});
