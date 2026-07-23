import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import type { RiskPolicy, TradeProposal } from "@runbook/engine/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";

const occurredAt = "2026-07-21T14:00:00.000Z";
const experimentId = "RUN-OFFLINE-001";
const actor = { type: "human" as const, id: "mason" };

const shadowManifest = {
  schemaVersion: "runbook.shadow-pilot.v1" as const,
  experimentId,
  mode: "shadow" as const,
  brokerageConnection: "disconnected" as const,
  dataSource: "synthetic" as const,
  orderExecution: "disabled" as const,
  capitalAtRisk: 0 as const,
  publication: "manual-human-reviewed" as const,
  operatorAttestations: {
    noBrokerCredentials: true as const,
    noBrokerOrderTools: true as const,
    noLiveExecutionImports: true as const,
    noAutomatedPublishing: true as const,
  },
};

const policy: RiskPolicy = {
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

const proposal: TradeProposal = {
  proposalId: "offline-proposal-001",
  experimentId,
  symbol: "VTI",
  instrument: "equity",
  side: "buy",
  notional: 100,
  projectedPositionNotional: 100,
  dailyTradesAfter: 1,
  currentDrawdownPercent: 0.5,
  hasThesis: true,
  hasInvalidation: true,
  evidenceSourceCount: 2,
};

async function createHarness(workspaceRoot?: string) {
  const directory = await mkdtemp(join(tmpdir(), "runbook-mcp-offline-"));
  const ledger = new FileLedger(directory, "offline-test");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service, {
    dataDir: directory,
    ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
  });
  const client = new Client({ name: "runbook-offline-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, directory, ledger, server, service };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as Record<string, unknown>;
}

describe("offline MCP tools", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness("/workspace/runbook");
  });

  afterEach(async () => {
    await harness.client.close();
    await harness.server.close();
    await rm(harness.directory, { recursive: true, force: true });
  });

  it("advertises offline analysis tools as read-only and closed-world", async () => {
    const listed = await harness.client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const name of [
      "runbook_verify_capsule",
      "runbook_diff_capabilities",
      "runbook_admit_capabilities",
      "runbook_verify_capability_snapshot",
      "runbook_inspect_public_auth_metadata",
      "runbook_pilot_doctor",
      "runbook_export_public_snapshot",
    ]) {
      expect(names).toContain(name);
      expect(listed.tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
    }
  });

  it("verifies the valid capsule fixture and reports invalid for the tampered fixture", async () => {
    const valid = await harness.client.callTool({
      name: "runbook_verify_capsule",
      arguments: { fixtureId: "capsule.minimal-root" },
    });
    expect(valid.isError).toBeFalsy();
    expect(structured(valid)).toMatchObject({
      valid: true,
      brokerEffect: false,
      assurance: "self-asserted-author-key-integrity",
      fixtureId: "capsule.minimal-root",
    });
    expect((structured(valid).verification as { valid: boolean }).valid).toBe(true);

    const tampered = await harness.client.callTool({
      name: "runbook_verify_capsule",
      arguments: { fixtureId: "capsule.minimal-tampered" },
    });
    expect(tampered.isError).toBeFalsy();
    expect(structured(tampered)).toMatchObject({
      valid: false,
      brokerEffect: false,
    });
    expect((structured(tampered).verification as { valid: boolean }).valid).toBe(false);
  });

  it("diffs trading-45 → trading-50 with material additions", async () => {
    const result = await harness.client.callTool({
      name: "runbook_diff_capabilities",
      arguments: {
        baselineFixtureId: "registry.trading-45",
        candidateFixtureId: "registry.trading-50",
      },
    });
    expect(result.isError).toBeFalsy();
    const body = structured(result);
    expect(body.brokerEffect).toBe(false);
    expect(body.materialChangeCount).toBe(5);
    const diff = body.diff as {
      changes: Array<{ changedFields: string[] }>;
      materialChangeIds: string[];
    };
    expect(diff.materialChangeIds).toHaveLength(5);
    expect(diff.changes.every((change) => change.changedFields.includes("capability-added"))).toBe(true);
  });

  it("rejects trading-50-risk-correction under the public-docs review policy", async () => {
    const result = await harness.client.callTool({
      name: "runbook_admit_capabilities",
      arguments: {
        baselineFixtureId: "registry.trading-50",
        candidateFixtureId: "registry.trading-50-risk-correction",
        policyFixtureId: "registry.policy.public-docs-review-required",
        evaluatedAtDeclared: "2026-07-22T07:10:00Z",
      },
    });
    expect(result.isError).toBeFalsy();
    const body = structured(result);
    expect(body).toMatchObject({
      outcome: "reject",
      brokerEffect: false,
      doesNotGrantBrokerPermission: true,
      assurance: "offline-reviewed-claim-analysis",
    });
    const receipt = body.receipt as { outcome: string; checks: Array<{ code: string; passed: boolean }> };
    expect(receipt.outcome).toBe("reject");
    expect(receipt.checks.some((check) => check.code === "unknown-risk-absent" && !check.passed)).toBe(true);
  });

  it("verifies a capability snapshot fixture and inspects public-auth raw metadata", async () => {
    const snapshot = await harness.client.callTool({
      name: "runbook_verify_capability_snapshot",
      arguments: { fixtureId: "registry.trading-45" },
    });
    expect(snapshot.isError).toBeFalsy();
    expect(structured(snapshot)).toMatchObject({
      valid: true,
      brokerEffect: false,
      errorCode: null,
    });

    const auth = await harness.client.callTool({
      name: "runbook_inspect_public_auth_metadata",
      arguments: { fixtureId: "public-auth.trading-authorization-server" },
    });
    expect(auth.isError).toBeFalsy();
    expect(structured(auth)).toMatchObject({
      sourceId: "robinhood-trading-authorization-server",
      profileValid: true,
      brokerEffect: false,
      assurance: "offline-fixture-or-operator-capture-analysis",
    });
    expect((structured(auth).findings as unknown[]).length).toBe(0);
  });

  it("returns structured fixture.unknown for unknown fixtureId", async () => {
    const result = await harness.client.callTool({
      name: "runbook_verify_capsule",
      arguments: { fixtureId: "registry.does-not-exist" },
    });
    expect(result.isError).toBe(true);
    expect(structured(result)).toMatchObject({
      schemaVersion: "runbook.mcp-error.v1",
      code: "fixture.unknown",
      brokerEffect: false,
      retryable: false,
    });
  });

  it("runs pilot-doctor after create+preflight and exports a public snapshot", async () => {
    await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Offline pilot",
        question: "Can offline tools diagnose a shadow experiment?",
        benchmark: "VTI",
        observationDays: 30,
        policy,
        actor,
        occurredAt,
      },
    });
    await harness.client.callTool({
      name: "runbook_preflight_trade",
      arguments: {
        proposal,
        actor,
        occurredAt: "2026-07-21T14:05:00.000Z",
      },
    });

    const manifestPath = join(harness.directory, "shadow-pilot.manifest.json");
    await writeFile(manifestPath, JSON.stringify(shadowManifest), { mode: 0o600 });

    const doctor = await harness.client.callTool({
      name: "runbook_pilot_doctor",
      arguments: {
        manifestPath,
        dataDir: harness.directory,
        workspaceRoot: "/workspace/runbook",
      },
    });
    expect(doctor.isError).toBeFalsy();
    const doctorBody = structured(doctor);
    expect(doctorBody).toMatchObject({
      ready: true,
      brokerEffect: false,
      assurance: "local-attestation-and-ledger-only",
      report: {
        schemaVersion: "runbook.pilot-doctor.v1",
        profile: "shadow-no-broker",
        experimentId,
        ready: true,
      },
    });

    const exported = await harness.client.callTool({
      name: "runbook_export_public_snapshot",
      arguments: {
        experimentId,
        generatedAt: "2026-07-21T15:00:00.000Z",
      },
    });
    expect(exported.isError).toBeFalsy();
    expect(structured(exported)).toMatchObject({
      brokerEffect: false,
      assurance: "local-tamper-evidence-only",
      snapshot: {
        schemaVersion: "runbook.public-snapshot.v1",
        experimentId,
        projection: { independentlyVerifiable: false },
      },
    });
  });
});
