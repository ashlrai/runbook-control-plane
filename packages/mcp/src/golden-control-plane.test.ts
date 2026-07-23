/**
 * Golden control-plane full journey — freezes the 10-step protocol:
 * session create → pin inventory → check inventory → improve charter →
 * record shadow → create experiment → bind → signed approval demo →
 * attach dossier → export pack.
 *
 * Protocol-level (InMemory MCP client), same style as golden-recursive-elite.
 * Process evidence only — never place_*; never returns claims.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileLedger } from "@runbook/engine/ledger";
import type { RiskPolicy } from "@runbook/engine/schema";
import { ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES } from "@runbook/session";
import { WEAK_STARTER_POLICY } from "@runbook/shadow-lab";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROMPT_NAMES } from "./prompts.js";
import { STATIC_RESOURCE_URIS } from "./resources.js";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";
import { TOOL_NAMES } from "./surface.js";

const PLAYBOOK_URI = "runbook://playbooks/control-plane-session";
const FULL_PROMPT = "runbook_control_plane_full";
const sessionId = "CPS-GOLDEN-001";
const experimentId = "RUN-CPS-GOLDEN-001";
const actor = { type: "agent" as const, id: "cps-golden-agent" };
const occurredAt = "2026-07-22T21:00:00.000Z";

const SESSION_TOOL_NAMES = [
  "runbook_session_create",
  "runbook_session_pin_inventory",
  "runbook_session_check_inventory",
  "runbook_session_bind_experiment",
  "runbook_session_record_shadow",
  "runbook_session_attach_dossier",
  "runbook_session_export",
  "runbook_approval_create_signed",
  "runbook_approval_verify",
] as const;

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-mcp-cps-golden-"));
  const ledger = new FileLedger(directory, "cps-golden");
  const service = new RunbookService(ledger);
  const server = createRunbookServer(service, { dataDir: directory });
  const client = new Client({ name: "runbook-cps-golden", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, directory, server, service };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as Record<string, unknown>;
}

describe("golden control plane full journey", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.client.close();
    await harness.server.close();
    await rm(harness.directory, { recursive: true, force: true });
  });

  it("freezes the full control-plane journey (process evidence only)", async () => {
    // --- Discovery: playbook resource + full prompt + closed surface ---
    const listed = await harness.client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([...SESSION_TOOL_NAMES]));
    expect(toolNames).toEqual(expect.arrayContaining([...TOOL_NAMES]));
    expect(toolNames.some((name) => name.startsWith("place_"))).toBe(false);
    expect(toolNames.some((name) => name.startsWith("cancel_"))).toBe(false);
    expect(listed.tools.every((tool) => tool.annotations?.openWorldHint === false)).toBe(true);

    const surface = await harness.client.callTool({
      name: "runbook_list_surface",
      arguments: {},
    });
    expect(surface.isError).not.toBe(true);
    expect(structured(surface)).toMatchObject({
      schemaVersion: "runbook.surface-inventory.v1",
      brokerExecutionTools: [],
      openWorldHint: false,
    });
    expect(structured(surface).resourceUris as string[]).toContain(PLAYBOOK_URI);
    expect(structured(surface).prompts as string[]).toContain(FULL_PROMPT);

    const resources = await harness.client.listResources();
    const resourceUris = resources.resources.map((r) => r.uri);
    expect(resourceUris).toContain(PLAYBOOK_URI);
    expect(STATIC_RESOURCE_URIS).toContain(PLAYBOOK_URI);

    const playbook = await harness.client.readResource({ uri: PLAYBOOK_URI });
    const playbookText = playbook.contents
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
    expect(playbookText).toMatch(/session create/i);
    expect(playbookText).toMatch(/pin inventory/i);
    expect(playbookText).toMatch(/check inventory/i);
    expect(playbookText).toMatch(/improve charter/i);
    expect(playbookText).toMatch(/record shadow/i);
    expect(playbookText).toMatch(/create experiment/i);
    expect(playbookText).toMatch(/bind/i);
    expect(playbookText).toMatch(/signed approval/i);
    expect(playbookText).toMatch(/attach dossier/i);
    expect(playbookText).toMatch(/export pack/i);
    expect(playbookText).toMatch(/NEVER broker/i);
    expect(playbookText).toMatch(/runbook_session_bind_experiment/);
    expect(playbookText).not.toMatch(/place_equity_order/);

    const prompts = await harness.client.listPrompts();
    const promptNames = prompts.prompts.map((p) => p.name);
    expect(promptNames).toContain(FULL_PROMPT);
    expect(PROMPT_NAMES).toContain(FULL_PROMPT);

    const fullPrompt = await harness.client.getPrompt({
      name: FULL_PROMPT,
      arguments: {
        sessionId,
        experimentId,
        maxGenerations: "4",
      },
    });
    const promptText = fullPrompt.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");
    expect(promptText).toContain(PLAYBOOK_URI);
    expect(promptText).toContain(sessionId);
    expect(promptText).toContain(experimentId);
    expect(promptText).toMatch(/runbook_session_create/);
    expect(promptText).toMatch(/runbook_session_pin_inventory/);
    expect(promptText).toMatch(/runbook_session_check_inventory/);
    expect(promptText).toMatch(/runbook_improve_charter/);
    expect(promptText).toMatch(/runbook_session_record_shadow/);
    expect(promptText).toMatch(/runbook_create_experiment/);
    expect(promptText).toMatch(/runbook_session_bind_experiment/);
    expect(promptText).toMatch(/runbook_approval_create_signed/);
    expect(promptText).toMatch(/runbook_session_attach_dossier/);
    expect(promptText).toMatch(/runbook_session_export/);
    expect(promptText).toMatch(/NEVER broker/i);
    expect(promptText).toMatch(/NEVER returns/i);

    // --- 1. session create ---
    const created = await harness.client.callTool({
      name: "runbook_session_create",
      arguments: {
        sessionId,
        label: "Golden control plane full journey",
        policy: WEAK_STARTER_POLICY,
        inventoryEnforcement: "fail-closed",
      },
    });
    expect(created.isError).not.toBe(true);
    expect(structured(created)).toMatchObject({
      schemaVersion: "runbook.session-create.v1",
      sessionId,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });

    // --- 2. pin inventory ---
    const pinned = await harness.client.callTool({
      name: "runbook_session_pin_inventory",
      arguments: { sessionId },
    });
    expect(pinned.isError).not.toBe(true);
    expect(structured(pinned)).toMatchObject({
      schemaVersion: "runbook.session-pin-inventory.v1",
      toolCount: 50,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    expect(String(structured(pinned).toolSetSha256)).toHaveLength(64);

    // --- 3. check inventory (ok subset + fail-closed unknown) ---
    const okCheck = await harness.client.callTool({
      name: "runbook_session_check_inventory",
      arguments: {
        sessionId,
        observedToolNames: ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES.slice(0, 5),
      },
    });
    expect(okCheck.isError).not.toBe(true);
    expect(structured(okCheck)).toMatchObject({
      schemaVersion: "runbook.inventory-check.v1",
      ok: true,
      enforcement: "fail-closed",
      brokerEffect: false,
      compositeScore: false,
    });

    const failCheck = await harness.client.callTool({
      name: "runbook_session_check_inventory",
      arguments: {
        sessionId,
        observedToolNames: [
          ...ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES.slice(0, 3),
          "place_crypto_order_unknown",
        ],
      },
    });
    expect(failCheck.isError).not.toBe(true);
    expect(structured(failCheck)).toMatchObject({
      ok: false,
      enforcement: "fail-closed",
      brokerEffect: false,
    });
    expect(structured(failCheck).unknownTools as string[]).toContain("place_crypto_order_unknown");

    // --- 4. improve charter (weak → HFA 0) ---
    const improve = await harness.client.callTool({
      name: "runbook_improve_charter",
      arguments: { policy: WEAK_STARTER_POLICY, maxGenerations: 8 },
    });
    expect(improve.isError).not.toBe(true);
    const improveBody = structured(improve);
    expect(improveBody).toMatchObject({
      schemaVersion: "runbook.shadow-recursive-improvement.v1",
      policySource: "override",
      activatedOnLedger: false,
      compositeScore: false,
      brokerEffect: false,
      notTradingPerformance: true,
      notCapitalAllocation: true,
    });
    expect(improveBody.initialHardFalseAllows as number).toBeGreaterThan(0);
    expect(improveBody.finalHardFalseAllows).toBe(0);

    const finalPolicy = improveBody.finalPolicy as RiskPolicy;
    expect(finalPolicy.approvalRequired).toBe(true);

    const setCharter = await harness.client.callTool({
      name: "runbook_session_set_charter",
      arguments: { sessionId, policy: finalPolicy },
    });
    expect(setCharter.isError).not.toBe(true);
    const charterDigest = String(structured(setCharter).charterDigest);
    expect(charterDigest).toHaveLength(64);

    // --- 5. record shadow ---
    const shadow = await harness.client.callTool({
      name: "runbook_session_record_shadow",
      arguments: {
        sessionId,
        generation: Math.max(1, (improveBody.generations as unknown[]).length),
        hardFalseAllows: improveBody.finalHardFalseAllows as number,
        hardFalseDenies: (improveBody.finalHardFalseDenies as number) ?? 0,
      },
    });
    expect(shadow.isError).not.toBe(true);
    expect(structured(shadow)).toMatchObject({
      schemaVersion: "runbook.session-record-shadow.v1",
      lastShadowHardFalseAllows: 0,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });

    // --- 6. create experiment ---
    const experiment = await harness.client.callTool({
      name: "runbook_create_experiment",
      arguments: {
        experimentId,
        name: "Golden control plane experiment",
        question: "Does the control-plane full journey freeze process evidence end-to-end?",
        benchmark: "VTI",
        observationDays: 30,
        policy: finalPolicy,
        actor,
        occurredAt,
      },
    });
    expect(experiment.isError).not.toBe(true);
    expect(structured(experiment)).toMatchObject({
      experimentId,
      enforcement: "advisory",
      brokerEffect: false,
    });
    const charterHash = String(structured(experiment).charterHash);
    expect(charterHash).toHaveLength(64);

    // --- 7. bind ---
    const bound = await harness.client.callTool({
      name: "runbook_session_bind_experiment",
      arguments: {
        sessionId,
        experimentId,
        ledgerHeadHash: charterHash,
      },
    });
    expect(bound.isError).not.toBe(true);
    expect(structured(bound)).toMatchObject({
      schemaVersion: "runbook.session-bind-experiment.v1",
      sessionId,
      experimentId,
      ledgerHeadHash: charterHash,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });
    const boundSession = structured(bound).session as Record<string, unknown>;
    expect(boundSession.experimentId).toBe(experimentId);

    // --- 8. signed approval demo ---
    const proposalDigest = "a".repeat(64);
    const signed = await harness.client.callTool({
      name: "runbook_approval_create_signed",
      arguments: {
        sessionId,
        experimentId,
        proposalId: "cps-golden-prop-001",
        proposalDigest,
        charterDigest,
        approved: true,
        decidedAt: "2026-07-22T21:05:00.000Z",
      },
    });
    expect(signed.isError).not.toBe(true);
    const signedBody = structured(signed);
    expect(signedBody).toMatchObject({
      schemaVersion: "runbook.approval-create-signed.v1",
      privateKeyPersisted: false,
      humanAuthorityEstablished: false,
      authorizationEstablished: false,
      brokerEffect: false,
      assurance: "local-device-key-attestation-only",
    });
    expect(String(signedBody.publicKeySpkiBase64).length).toBeGreaterThan(20);

    const verified = await harness.client.callTool({
      name: "runbook_approval_verify",
      arguments: {
        intent: signedBody.intent,
        publicKeySpkiBase64: signedBody.publicKeySpkiBase64,
      },
    });
    expect(verified.isError).not.toBe(true);
    expect(structured(verified)).toMatchObject({
      schemaVersion: "runbook.approval-verify.v1",
      valid: true,
      humanAuthorityEstablished: false,
      authorizationEstablished: false,
      brokerEffect: false,
      assurance: "local-device-key-attestation-only",
    });

    // --- 9. attach dossier ---
    const dossier = await harness.client.callTool({
      name: "runbook_session_attach_dossier",
      arguments: {
        sessionId,
        kind: "status-snapshot",
        summary:
          "Architecture-slice control-plane evidence only; not certification or composite safety grade.",
        scenarioIds: ["finance-000-allowed-calibration"],
        processBridgedCount: 0,
      },
    });
    expect(dossier.isError).not.toBe(true);
    expect(structured(dossier)).toMatchObject({
      schemaVersion: "runbook.session-attach-dossier.v1",
      attachmentCount: 1,
      brokerEffect: false,
      compositeScore: false,
      capitalAtRisk: 0,
    });

    // --- 10. export pack ---
    const exported = await harness.client.callTool({
      name: "runbook_session_export",
      arguments: { sessionId },
    });
    expect(exported.isError).not.toBe(true);
    expect(structured(exported)).toMatchObject({
      schemaVersion: "runbook.session-export.v1",
      brokerEffect: false,
      compositeScore: false,
      notTradingPerformance: true,
    });
    const pack = structured(exported).pack as Record<string, unknown>;
    expect(pack.schemaVersion).toBe("runbook.session-evidence-pack.v1");
    expect(pack.brokerEffect).toBe(false);
    expect(pack.compositeScore).toBe(false);
    expect(pack.notTradingPerformance).toBe(true);
    expect(pack.assurance).toBe("local-control-plane-export-only");
    const packSession = pack.session as Record<string, unknown>;
    expect(packSession.sessionId).toBe(sessionId);
    expect(packSession.experimentId).toBe(experimentId);
    expect(packSession.capitalAtRisk).toBe(0);
    expect(packSession.lastShadowHardFalseAllows).toBe(0);
    expect((packSession.dossierAttachments as unknown[]).length).toBe(1);

    // --- NEVER broker / never returns: inventory + claim flags ---
    expect(structured(surface).brokerExecutionTools).toEqual([]);
    expect(toolNames.some((name) => /place_|cancel_/.test(name))).toBe(false);
    expect(improveBody.notTradingPerformance).toBe(true);
    expect(improveBody.notCapitalAllocation).toBe(true);
    expect(improveBody.compositeScore).toBe(false);
    expect(structured(verified).humanAuthorityEstablished).toBe(false);
    expect(structured(verified).authorizationEstablished).toBe(false);
  });
});
