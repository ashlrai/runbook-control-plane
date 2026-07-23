import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SANDBOX_ADAPTER_CONTRACT_SHA256,
  SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
  serializeSandboxPublicConfiguration,
  verifySandboxEvidenceBytes,
} from "./index.js";
import { runFinancialBenchDockerSandboxV1 } from "./run.js";
import { ownRegularFile } from "./owned-input.js";
import { runFinancialBenchDockerSandboxWithOwnedRunnerV1 } from "./run.js";
import { createDockerSandboxSession } from "./docker-runtime.js";

const enabled = process.env.RUNBOOK_DOCKER_INTEGRATION === "1";
const fixturePath = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const testRunnerArtifact = () =>
  ownRegularFile(fileURLToPath(new URL("./run.ts", import.meta.url)), {
    maxBytes: 16 * 1024 * 1024,
  });

describe.skipIf(!enabled)("Docker sandbox integration", () => {
  it("runs the reference adapter in five fresh hardened containers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "runbook-sandbox-integration-"));
    const configPath = join(directory, "configuration.json");
    writeFileSync(configPath, serializeSandboxPublicConfiguration({
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: "reference-adapter",
      configurationId: "reference-v1",
      mode: "broker-disconnected-synthetic",
      schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
    }));
    const adapterBundlePath = fixturePath("reference-adapter.mjs");
    const adapterBytes = await import("node:fs/promises").then((fs) => fs.readFile(adapterBundlePath));
    const expectedAdapterBundleSha256 = createHash("sha256").update(adapterBytes).digest("hex");
    const output = await runFinancialBenchDockerSandboxWithOwnedRunnerV1({
      adapterBundlePath,
      expectedAdapterBundleSha256,
      publicConfigurationPath: configPath,
    }, testRunnerArtifact());
    expect(output.receipt.counts).toEqual({ fail: 0, pass: 5, unsupported: 0 });
    expect(output.receipt.sessionSummary).toEqual({
      cleanupComplete: 5,
      freshSessions: 5,
      orphanAuditsPassed: 5,
    });
    expect(new Set(output.evidence.sessions.map((session) => session.executionNonce)).size).toBe(5);
    expect(output.evidence.runtime.architecture).toMatch(/^(amd64|arm64)$/);
    expect(verifySandboxEvidenceBytes(output.evidenceBytes).valid).toBe(true);
    expect(basename(adapterBundlePath)).toBe("reference-adapter.mjs");
  }, 60_000);

  it("keeps deny-all evidence valid while reporting the failed calibration", async () => {
    const directory = mkdtempSync(join(tmpdir(), "runbook-sandbox-deny-all-"));
    const configPath = join(directory, "configuration.json");
    writeFileSync(configPath, serializeSandboxPublicConfiguration({
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: "deny-all-adapter",
      configurationId: "deny-all-v1",
      mode: "broker-disconnected-synthetic",
      schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
    }));
    const adapterBundlePath = fixturePath("deny-all-adapter.mjs");
    const adapterBytes = await import("node:fs/promises").then((fs) => fs.readFile(adapterBundlePath));
    const output = await runFinancialBenchDockerSandboxWithOwnedRunnerV1({
      adapterBundlePath,
      expectedAdapterBundleSha256: createHash("sha256").update(adapterBytes).digest("hex"),
      publicConfigurationPath: configPath,
    }, testRunnerArtifact());
    expect(verifySandboxEvidenceBytes(output.evidenceBytes).valid).toBe(true);
    expect(output.receipt.counts.fail).toBeGreaterThanOrEqual(1);
    expect(output.receipt.results[0]).toMatchObject({
      scenarioId: "scenario-00-allowed-baseline",
      status: "fail",
    });
    expect(output.receipt.sessionSummary).toEqual({
      cleanupComplete: 5,
      freshSessions: 5,
      orphanAuditsPassed: 5,
    });
  }, 60_000);

  it("makes env, host filesystem, child process, and external network probes fail closed", async () => {
    const adapterBundlePath = fixturePath("escape-probe-adapter.mjs");
    const bytes = await import("node:fs/promises").then((fs) => fs.readFile(adapterBundlePath));
    const directory = mkdtempSync(join(tmpdir(), "runbook-sandbox-probe-"));
    const configPath = join(directory, "configuration.json");
    writeFileSync(configPath, serializeSandboxPublicConfiguration({
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: "escape-probe-adapter",
      configurationId: "escape-probe-v1",
      mode: "broker-disconnected-synthetic",
      schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
    }));
    const output = await runFinancialBenchDockerSandboxWithOwnedRunnerV1({
      adapterBundlePath,
      expectedAdapterBundleSha256: createHash("sha256").update(bytes).digest("hex"),
      publicConfigurationPath: configPath,
    }, testRunnerArtifact());
    expect(output.innerHarness.receipt.results.every((result) => result.status !== "unsupported")).toBe(true);
    expect(output.innerHarness.evidence.scenarioEvidence.every((scenario) =>
      scenario.observations.every((observation) => observation.type !== "target-timeout")
    )).toBe(true);
    expect(output.evidence.sessions.every((session) => session.cleanupComplete)).toBe(true);
  }, 60_000);

  it("hard-kills and reaps a CPU-loop adapter without leaving an orphan", async () => {
    const adapterPath = fixturePath("cpu-loop-adapter.mjs");
    const adapter = ownRegularFile(adapterPath, { maxBytes: 32 * 1024 * 1024 });
    const directory = mkdtempSync(join(tmpdir(), "runbook-sandbox-loop-"));
    const configPath = join(directory, "configuration.json");
    const publicConfiguration = {
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: "cpu-loop-adapter",
      configurationId: "cpu-loop-v1",
      mode: "broker-disconnected-synthetic" as const,
      schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
    };
    writeFileSync(configPath, serializeSandboxPublicConfiguration(publicConfiguration));
    const configuration = ownRegularFile(configPath, { maxBytes: 2048 });
    const runner = testRunnerArtifact();
    const session = await createDockerSandboxSession({
      adapter,
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      configuration,
      hostRunnerSha256: runner.sha256,
      ordinal: 0,
      publicConfiguration,
    });
    const controller = new AbortController();
    const targetPromise = session.target.run({} as never, {
      approvalRequestsSupported: true,
      call: async () => { throw new Error("unexpected-call"); },
      requestApproval: async () => { throw new Error("unexpected-approval"); },
      toolNames: ["preview_order"],
    }, controller.signal).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    const record = await session.close();
    await targetPromise;
    expect(record.processOutcome).toBe("force-killed");
    expect(record.cleanupComplete).toBe(true);
    expect(record.orphanAuditPassed).toBe(true);
  }, 30_000);

  it("acknowledges trusted bootstrap before import and rejects top-level frame spoofing", async () => {
    const adapter = ownRegularFile(fixturePath("top-level-spoof-adapter.mjs"), {
      maxBytes: 32 * 1024 * 1024,
    });
    const directory = mkdtempSync(join(tmpdir(), "runbook-sandbox-spoof-"));
    const configPath = join(directory, "configuration.json");
    const publicConfiguration = {
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: "top-level-spoof-adapter",
      configurationId: "top-level-spoof-v1",
      mode: "broker-disconnected-synthetic" as const,
      schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
    };
    writeFileSync(configPath, serializeSandboxPublicConfiguration(publicConfiguration));
    const runner = testRunnerArtifact();
    await expect(createDockerSandboxSession({
      adapter,
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      configuration: ownRegularFile(configPath, { maxBytes: 2048 }),
      hostRunnerSha256: runner.sha256,
      ordinal: 0,
      publicConfiguration,
    })).rejects.toThrow();
  }, 30_000);

  it("removes the container before surfacing a post-ready protocol failure", async () => {
    const adapter = ownRegularFile(fixturePath("post-ready-spoof-adapter.mjs"), {
      maxBytes: 32 * 1024 * 1024,
    });
    const directory = mkdtempSync(join(tmpdir(), "runbook-sandbox-post-ready-spoof-"));
    const configPath = join(directory, "configuration.json");
    const publicConfiguration = {
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: "post-ready-spoof-adapter",
      configurationId: "post-ready-spoof-v1",
      mode: "broker-disconnected-synthetic" as const,
      schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
    };
    writeFileSync(configPath, serializeSandboxPublicConfiguration(publicConfiguration));
    const runner = testRunnerArtifact();
    const session = await createDockerSandboxSession({
      adapter,
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      configuration: ownRegularFile(configPath, { maxBytes: 2048 }),
      hostRunnerSha256: runner.sha256,
      ordinal: 0,
      publicConfiguration,
    });
    await expect(session.target.run({ binding: {} } as never, {
      approvalRequestsSupported: true,
      call: async () => { throw new Error("unexpected-call"); },
      requestApproval: async () => { throw new Error("unexpected-approval"); },
      toolNames: ["preview_order"],
    }, new AbortController().signal)).rejects.toThrow();
    await expect(session.close()).rejects.toThrow();
    expect(execFileSync("docker", [
      "ps", "-a", "--filter", "label=runbook.sandbox-run", "--format", "{{.ID}}",
    ], { encoding: "utf8" }).trim()).toBe("");
  }, 30_000);

  it("rejects a valid decision followed by a nonzero container exit and still removes it", async () => {
    const adapter = ownRegularFile(fixturePath("nonzero-exit-adapter.mjs"), {
      maxBytes: 32 * 1024 * 1024,
    });
    const directory = mkdtempSync(join(tmpdir(), "runbook-sandbox-nonzero-exit-"));
    const configPath = join(directory, "configuration.json");
    const publicConfiguration = {
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: "nonzero-exit-adapter",
      configurationId: "nonzero-exit-v1",
      mode: "broker-disconnected-synthetic" as const,
      schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
    };
    writeFileSync(configPath, serializeSandboxPublicConfiguration(publicConfiguration));
    const runner = testRunnerArtifact();
    const session = await createDockerSandboxSession({
      adapter,
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      configuration: ownRegularFile(configPath, { maxBytes: 2048 }),
      hostRunnerSha256: runner.sha256,
      ordinal: 0,
      publicConfiguration,
    });
    await session.target.run({ binding: {} } as never, {
      approvalRequestsSupported: true,
      call: async () => { throw new Error("unexpected-call"); },
      requestApproval: async () => { throw new Error("unexpected-approval"); },
      toolNames: ["preview_order"],
    }, new AbortController().signal);
    const firstClose = session.close();
    expect(session.close()).toBe(firstClose);
    await expect(firstClose).rejects.toThrow("session.container-exited-nonzero");
    expect(execFileSync("docker", [
      "ps", "-a", "--filter", "label=runbook.sandbox-run", "--format", "{{.ID}}",
    ], { encoding: "utf8" }).trim()).toBe("");
  }, 30_000);
});
