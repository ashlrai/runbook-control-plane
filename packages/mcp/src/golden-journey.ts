/**
 * Protocol-level golden shadow-pilot journey shared by CLI and tests.
 * Creates a private ledger dir, runs discover → create → preflight → hard-stop →
 * verify → pilot-doctor → offline demos, emits runbook.golden-journey-receipt.v1.
 */

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import { MONOREPO_ROOT } from "./fixture-catalog.js";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";
import { TOOL_NAMES } from "./surface.js";

export const GOLDEN_JOURNEY_RECEIPT_SCHEMA = "runbook.golden-journey-receipt.v1" as const;

const occurredAt = "2026-07-21T14:00:00.000Z";
const experimentId = "RUN-SHADOW-001";
const actor = { type: "agent" as const, id: "golden-shadow-agent" };

const policy = {
  capitalBudget: 500,
  cashReserve: 125,
  maxPositionPercent: 25,
  maxOrderNotional: 125,
  maxDrawdownPercent: 8,
  maxDailyTrades: 2,
  allowedInstruments: ["equity" as const],
  allowedSymbols: ["VTI", "BND"],
  deniedSymbols: ["GME"],
  approvalRequired: true,
};

const proposal = {
  proposalId: "shadow-proposal-001",
  experimentId,
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

export type GoldenJourneyReceipt = {
  schemaVersion: typeof GOLDEN_JOURNEY_RECEIPT_SCHEMA;
  experimentId: string;
  eventCount: number;
  ledgerValid: boolean;
  pilotDoctorReady: boolean;
  offlineDemos: {
    capabilityDriftMaterialChanges: number;
    riskCorrectionOutcome: string;
    capsuleValid: boolean;
    capsuleTamperedValid: boolean;
    publicAuthProfileValid: boolean;
  };
  hardStopObserved: boolean;
  brokerExecutionTools: [];
  assurance: string[];
  compositeScore: false;
  success: boolean;
  dataDir: string;
  toolCount: number;
  errors: string[];
};

export type GoldenJourneyOptions = Readonly<{
  /** Absolute private data directory. When omitted, a temp dir is created. */
  dataDir?: string;
  /** Workspace root for pilot-doctor (absolute). Defaults to monorepo root. */
  workspaceRoot?: string;
  /** When true and dataDir was auto-created, leave it on disk. Default false. */
  keepTempDir?: boolean;
}>;

export type GoldenJourneyResult = Readonly<{
  receipt: GoldenJourneyReceipt;
  /** Absolute data directory used for the journey. */
  dataDir: string;
  /** True when this module created a temporary directory. */
  tempDirCreated: boolean;
  exitCode: 0 | 1;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function runGoldenJourney(
  options: GoldenJourneyOptions = {},
): Promise<GoldenJourneyResult> {
  const errors: string[] = [];
  let tempDirCreated = false;
  let directory: string;

  if (options.dataDir !== undefined && options.dataDir.length > 0) {
    if (!isAbsolute(options.dataDir)) {
      throw new Error("Runbook golden-journey --data-dir must be absolute.");
    }
    directory = resolve(options.dataDir);
  } else {
    directory = await mkdtemp(join(tmpdir(), "runbook-golden-"));
    tempDirCreated = true;
  }

  await chmod(directory, 0o700).catch(() => {
    // Existing operator dirs may already be private; continue.
  });

  const workspaceRoot =
    options.workspaceRoot !== undefined && options.workspaceRoot.length > 0
      ? resolve(options.workspaceRoot)
      : MONOREPO_ROOT;
  if (!isAbsolute(workspaceRoot)) {
    throw new Error("Runbook golden-journey workspace root must be absolute.");
  }

  const ledger = new FileLedger(directory, "shadow-pilot");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service, {
    dataDir: directory,
    workspaceRoot,
  });
  const client = new Client({ name: "golden-journey", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  let receipt: GoldenJourneyReceipt = {
    schemaVersion: GOLDEN_JOURNEY_RECEIPT_SCHEMA,
    experimentId,
    eventCount: 0,
    ledgerValid: false,
    pilotDoctorReady: false,
    offlineDemos: {
      capabilityDriftMaterialChanges: 0,
      riskCorrectionOutcome: "unknown",
      capsuleValid: false,
      capsuleTamperedValid: true,
      publicAuthProfileValid: false,
    },
    hardStopObserved: true,
    brokerExecutionTools: [],
    assurance: [
      "local-tamper-evidence-only",
      "local-attestation-and-ledger-only",
      "offline-reviewed-claim-analysis",
      "self-asserted-author-key-integrity",
      "offline-fixture-or-operator-capture-analysis",
    ],
    compositeScore: false,
    success: false,
    dataDir: directory,
    toolCount: 0,
    errors: [],
  };

  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    // 1. Inventory freeze
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    receipt = { ...receipt, toolCount: toolNames.length };
    for (const required of [
      "runbook_create_experiment",
      "runbook_preflight_trade",
      "runbook_verify_ledger",
      "runbook_pilot_doctor",
      "runbook_diff_capabilities",
      "runbook_admit_capabilities",
      "runbook_verify_capsule",
      "runbook_list_surface",
    ]) {
      if (!toolNames.includes(required)) {
        errors.push(`missing-tool:${required}`);
      }
    }
    if (toolNames.some((n) => n.includes("place_") || n.includes("cancel_"))) {
      errors.push("broker-execution-tool-present");
    }
    for (const name of TOOL_NAMES) {
      if (!toolNames.includes(name)) {
        errors.push(`inventory-gap:${name}`);
      }
    }
    if (toolNames.length !== TOOL_NAMES.length) {
      errors.push(`tool-count-mismatch:listed=${toolNames.length}:expected=${TOOL_NAMES.length}`);
    }

    // 2. Boundary resource
    const boundary = await client.readResource({ uri: "runbook://docs/boundary" });
    const boundaryText = boundary.contents.map((c) => ("text" in c ? c.text : "")).join("");
    if (!/advisory/i.test(boundaryText) || !/credential/i.test(boundaryText)) {
      errors.push("boundary-resource-incomplete");
    }

    // 3. Create experiment
    const created = await client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Golden Shadow Pilot",
        question: "Can a disconnected shadow pilot record advisory preflight evidence?",
        benchmark: "VTI",
        observationDays: 90,
        policy,
        actor,
        occurredAt,
      },
    });
    if (created.isError) errors.push("create-experiment-failed");
    const createdBody = asRecord(created.structuredContent);
    if (createdBody.enforcement !== "advisory") errors.push("create-enforcement-not-advisory");

    // 4. Preflight
    const preflight = await client.callTool({
      name: "runbook_preflight_trade",
      arguments: { proposal, actor, occurredAt },
    });
    if (preflight.isError) errors.push("preflight-failed");
    const preflightBody = asRecord(preflight.structuredContent);
    if (preflightBody.allowed !== true) errors.push("preflight-not-allowed");
    if (preflightBody.enforcement !== "advisory") errors.push("preflight-enforcement-not-advisory");

    // 5. HARD STOP — do not call approval or execution (enforced by not calling them)

    // 6. Verify ledger
    const verification = await client.callTool({
      name: "runbook_verify_ledger",
      arguments: {},
    });
    const verificationBody = asRecord(verification.structuredContent);
    const eventCount = typeof verificationBody.eventCount === "number" ? verificationBody.eventCount : 0;
    const ledgerValid = verificationBody.valid === true && eventCount === 4;
    if (!ledgerValid) errors.push("ledger-verify-failed");
    receipt = {
      ...receipt,
      eventCount,
      ledgerValid: verificationBody.valid === true,
    };
    if (eventCount !== 4) errors.push(`unexpected-event-count:${eventCount}`);

    // 7. Pilot doctor
    const manifestPath = join(directory, "shadow-pilot.manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
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
      }),
      { mode: 0o600 },
    );

    const doctor = await client.callTool({
      name: "runbook_pilot_doctor",
      arguments: {
        manifestPath,
        dataDir: directory,
        workspaceRoot,
      },
    });
    const doctorBody = asRecord(doctor.structuredContent);
    const pilotDoctorReady = doctor.isError !== true && doctorBody.ready === true;
    if (!pilotDoctorReady) errors.push("pilot-doctor-not-ready");
    receipt = { ...receipt, pilotDoctorReady };

    // 8. Offline frontier demos
    const diff = await client.callTool({
      name: "runbook_diff_capabilities",
      arguments: {
        baselineFixtureId: "registry.trading-45",
        candidateFixtureId: "registry.trading-50",
      },
    });
    const diffBody = asRecord(diff.structuredContent);
    const materialCount =
      typeof diffBody.materialChangeCount === "number" ? diffBody.materialChangeCount : 0;
    if (diff.isError || materialCount !== 5) {
      errors.push(`capability-drift-unexpected:${materialCount}`);
    }

    const admit = await client.callTool({
      name: "runbook_admit_capabilities",
      arguments: {
        baselineFixtureId: "registry.trading-50",
        candidateFixtureId: "registry.trading-50-risk-correction",
        policyFixtureId: "registry.policy.public-docs-review-required",
        evaluatedAtDeclared: "2026-07-22T07:10:00Z",
      },
    });
    const admitBody = asRecord(admit.structuredContent);
    const receiptOutcome = asRecord(admitBody.receipt).outcome;
    const outcome =
      typeof admitBody.outcome === "string"
        ? admitBody.outcome
        : typeof receiptOutcome === "string"
          ? receiptOutcome
          : "unknown";
    if (admit.isError || outcome !== "reject" || admitBody.doesNotGrantBrokerPermission !== true) {
      errors.push(`risk-correction-unexpected:${outcome}`);
    }

    const validCapsule = await client.callTool({
      name: "runbook_verify_capsule",
      arguments: { fixtureId: "capsule.minimal-root" },
    });
    const validCapsuleBody = asRecord(validCapsule.structuredContent);
    const capsuleValid = validCapsule.isError !== true && validCapsuleBody.valid === true;
    if (!capsuleValid) errors.push("capsule-valid-failed");

    const tamperedCapsule = await client.callTool({
      name: "runbook_verify_capsule",
      arguments: { fixtureId: "capsule.minimal-tampered" },
    });
    const tamperedBody = asRecord(tamperedCapsule.structuredContent);
    const capsuleTamperedValid = tamperedBody.valid === true;
    if (tamperedCapsule.isError || capsuleTamperedValid) {
      errors.push("capsule-tampered-unexpected");
    }

    const publicAuth = await client.callTool({
      name: "runbook_inspect_public_auth_metadata",
      arguments: { fixtureId: "public-auth.trading-authorization-server" },
    });
    const publicAuthBody = asRecord(publicAuth.structuredContent);
    const publicAuthProfileValid =
      publicAuth.isError !== true && publicAuthBody.profileValid === true;
    if (!publicAuthProfileValid) errors.push("public-auth-inspect-failed");

    const success = errors.length === 0;
    receipt = {
      ...receipt,
      offlineDemos: {
        capabilityDriftMaterialChanges: materialCount,
        riskCorrectionOutcome: outcome,
        capsuleValid,
        capsuleTamperedValid,
        publicAuthProfileValid,
      },
      hardStopObserved: true,
      brokerExecutionTools: [],
      compositeScore: false,
      success,
      errors: [...errors],
    };

    return {
      receipt,
      dataDir: directory,
      tempDirCreated,
      exitCode: success ? 0 : 1,
    };
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    if (tempDirCreated && options.keepTempDir !== true) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
