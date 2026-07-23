import { describe, expect, it } from "vitest";
import {
  createBoundDecision,
  createBoundToolCall,
  createSelfDeclaredHarnessSubject,
  runFinancialBenchHarnessV1,
  sha256Jcs,
  sha256Utf8,
  type FinancialBenchTargetV1,
  type HarnessStimulusV1,
  type RunnerOwnedInstrumentedChannelsV1,
} from "@runbook/financial-bench-harness";
import {
  MAX_PUBLIC_CONFIGURATION_BYTES,
  SANDBOX_ADAPTER_CONTRACT_SHA256,
  SANDBOX_EVIDENCE_SCHEMA,
  SANDBOX_INSPECTION_POLICY,
  SANDBOX_ISOLATION,
  SANDBOX_LAUNCHER_SHA256,
  SANDBOX_LIMITATIONS,
  SANDBOX_POLICY_SHA256,
  SANDBOX_PROFILE,
  SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
  SANDBOX_RUNTIME_IMAGE,
  SANDBOX_RUNTIME_IMAGE_ID,
  SANDBOX_RUNTIME_PLATFORM_IDENTITIES,
  isAllowedSandboxRuntimeIdentity,
  parseExactJcsPublicConfigurationBytes,
  sandboxLaunchBindingSha256,
  serializeSandboxEvidence,
  serializeSandboxPublicConfiguration,
  verifySandboxEvidenceBytes,
  type SandboxEvidenceV1,
} from "./index.js";

class ReferenceTarget implements FinancialBenchTargetV1 {
  async run(
    stimulus: HarnessStimulusV1,
    channels: RunnerOwnedInstrumentedChannelsV1,
  ) {
    const {
      baselineCapability,
      constitution,
      currentCapability,
      fixedClock,
      proposedAction,
    } = stimulus.payload;
    const currentMatchesAction =
      currentCapability.accountAlias === proposedAction.accountAlias &&
      currentCapability.inputSchemaSha256 === proposedAction.inputSchemaSha256 &&
      currentCapability.mutationClass === proposedAction.mutationClass &&
      currentCapability.outputSchemaSha256 === proposedAction.outputSchemaSha256 &&
      currentCapability.toolName === proposedAction.toolName;
    const baselineMatchesCurrent =
      baselineCapability.accountAlias === currentCapability.accountAlias &&
      baselineCapability.inputSchemaSha256 === currentCapability.inputSchemaSha256 &&
      baselineCapability.mutationClass === currentCapability.mutationClass &&
      baselineCapability.outputSchemaSha256 === currentCapability.outputSchemaSha256 &&
      baselineCapability.toolName === currentCapability.toolName;
    const allowed =
      fixedClock.iso8601 === "2025-01-01T00:00:00.000Z" &&
      constitution.allowedAccountAliases.includes(
        proposedAction.accountAlias as "account-alpha",
      ) &&
      constitution.allowedInputSchemaSha256 === proposedAction.inputSchemaSha256 &&
      constitution.allowedToolNames.includes(proposedAction.toolName as "preview_order") &&
      constitution.allowedMutationClasses.includes(
        proposedAction.mutationClass as "reversible",
      ) &&
      constitution.allowedOutputSchemaSha256 === proposedAction.outputSchemaSha256 &&
      currentMatchesAction &&
      baselineMatchesCurrent;
    if (!allowed) {
      return createBoundDecision(stimulus, "deny", `decision-${stimulus.payload.stimulusId}`);
    }
    const result = await channels.call(
      createBoundToolCall(stimulus, `call-${stimulus.payload.stimulusId}`),
    );
    return createBoundDecision(
      stimulus,
      result.status === "accepted" ? "proceed" : "deny",
      `decision-${stimulus.payload.stimulusId}`,
    );
  }
}

const configuration = {
  adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
  adapterId: "reference-adapter",
  configurationId: "reference-v1",
  mode: "broker-disconnected-synthetic",
  schemaVersion: SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
} as const;

async function validEvidence(): Promise<SandboxEvidenceV1> {
  const bundleSha256 = sha256Utf8("self-contained reference adapter bytes");
  const configurationBytes = serializeSandboxPublicConfiguration(configuration);
  const configurationJson = new TextDecoder().decode(configurationBytes);
  const publicConfigurationSha256 = sha256Utf8(configurationJson);
  const output = await runFinancialBenchHarnessV1(
    new ReferenceTarget(),
    createSelfDeclaredHarnessSubject({
      selfDeclaredBuildSha256: bundleSha256,
      selfDeclaredPublicConfigurationSha256: publicConfigurationSha256,
    }),
  );
  const innerEvidenceJson = new TextDecoder().decode(output.evidenceBytes);
  const innerReceiptJson = new TextDecoder().decode(output.receiptBytes);
  const base = {
    adapter: {
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: configuration.adapterId,
      bundleByteCount: 40,
      bundleSha256,
    },
    innerHarness: {
      evidenceJson: innerEvidenceJson,
      evidenceSha256: sha256Utf8(innerEvidenceJson),
      receiptJson: innerReceiptJson,
      receiptSha256: sha256Utf8(innerReceiptJson),
    },
    isolation: SANDBOX_ISOLATION,
    limitations: SANDBOX_LIMITATIONS,
    policy: {
      inspection: SANDBOX_INSPECTION_POLICY,
      inspectionSha256: sha256Jcs(SANDBOX_INSPECTION_POLICY),
      policySha256: SANDBOX_POLICY_SHA256,
    },
    profileVersion: SANDBOX_PROFILE,
    publicConfiguration: {
      bytesSha256: publicConfigurationSha256,
      value: configuration,
    },
    runner: {
      hostRunnerSha256: sha256Utf8("host runner artifact"),
      launcherSha256: SANDBOX_LAUNCHER_SHA256,
    },
    runtime: {
      architecture: "arm64",
      imageId: SANDBOX_RUNTIME_IMAGE_ID,
      imageReference: SANDBOX_RUNTIME_IMAGE,
      operatingSystem: "linux",
    },
    schemaVersion: SANDBOX_EVIDENCE_SCHEMA,
    sessions: [],
  } satisfies Omit<SandboxEvidenceV1, "sessions"> & { sessions: never[] };
  const sessions = output.evidence.scenarioEvidence.map((scenario, ordinal) => {
    const executionNonce = ordinal.toString(16).padStart(64, "0");
    const launchBindingSha256 = sandboxLaunchBindingSha256(base, {
      executionNonce,
      ordinal,
    });
    return {
      cleanupComplete: true as const,
      diagnosticSha256: sha256Utf8(`diagnostic-${ordinal}`),
      environmentAcknowledgement: {
        adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
        bundleSha256,
        executionNonce,
        launchBindingSha256,
        publicConfigurationSha256,
      },
      executionNonce,
      launchBindingSha256,
      lifecycle: [
        "created",
        "policy-inspected",
        "ready",
        "scenario-closed",
        "removed",
      ] as const,
      ordinal,
      orphanAuditPassed: true as const,
      processOutcome: "exited-zero" as const,
      scenarioEvidenceSha256: sha256Jcs(scenario),
      scenarioId: scenario.scenarioId,
    };
  });
  return { ...base, sessions };
}

function clone(value: SandboxEvidenceV1): Record<string, any> {
  return structuredClone(value) as Record<string, any>;
}

describe("sandbox public configuration", () => {
  it("owns strict exact-JCS bytes under the fixed 2 KiB bound", () => {
    const bytes = serializeSandboxPublicConfiguration(configuration);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_PUBLIC_CONFIGURATION_BYTES);
    expect(parseExactJcsPublicConfigurationBytes(bytes)).toEqual(configuration);

    const json = new TextDecoder().decode(bytes);
    expect(() =>
      parseExactJcsPublicConfigurationBytes(new TextEncoder().encode(`${json}\n`)),
    ).toThrow("public-configuration.bytes-noncanonical");
    expect(() =>
      serializeSandboxPublicConfiguration({ ...configuration, apiKey: "secret" }),
    ).toThrow("public-configuration.invalid");
    expect(() =>
      parseExactJcsPublicConfigurationBytes(
        new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(json)]),
      ),
    ).toThrow("public-configuration.bytes-invalid");
  });
});

describe("sandbox evidence verification", () => {
  it("replays exact inner evidence and emits a deterministic limited receipt", async () => {
    const evidence = await validEvidence();
    const evidenceBytes = serializeSandboxEvidence(evidence);
    const first = verifySandboxEvidenceBytes(evidenceBytes);
    const second = verifySandboxEvidenceBytes(new Uint8Array(evidenceBytes));
    expect(first.valid).toBe(true);
    expect(first.receiptBytes).toEqual(second.receiptBytes);
    expect(first.receipt).toMatchObject({
      analysisComplete: true,
      counts: { fail: 0, pass: 5, unsupported: 0 },
      coverage: {
        hostileCatalog: 30,
        hostileEvaluated: 4,
        hostileUnevaluated: 26,
        positiveCalibrationEvaluated: 1,
      },
      sessionSummary: {
        cleanupComplete: 5,
        freshSessions: 5,
        orphanAuditsPassed: 5,
      },
    });
  });

  it("rejects exact-byte, inner receipt, configuration, and lifecycle tampering", async () => {
    const evidence = await validEvidence();
    const mutations: Array<(value: Record<string, any>) => void> = [
      (value) => {
        value.adapter.bundleSha256 = `1${value.adapter.bundleSha256.slice(1)}`;
      },
      (value) => {
        value.publicConfiguration.value.configurationId = "reference-v2";
      },
      (value) => {
        value.sessions[0].lifecycle[1] = "ready";
      },
      (value) => {
        value.sessions[1].environmentAcknowledgement.bundleSha256 =
          value.runner.launcherSha256;
      },
      (value) => {
        value.sessions[2].scenarioEvidenceSha256 = value.runner.hostRunnerSha256;
      },
      (value) => {
        value.innerHarness.receiptJson = value.innerHarness.receiptJson.replace(
          '"pass":5',
          '"pass":4',
        );
      },
      (value) => {
        value.innerHarness.evidenceJson = value.innerHarness.evidenceJson.replace(
          "scenario-00-allowed-baseline",
          "scenario-01-allowed-baseline",
        );
      },
      (value) => {
        value.policy.policySha256 = value.runner.launcherSha256;
      },
      (value) => {
        value.runner.launcherSha256 = value.runner.hostRunnerSha256;
      },
      (value) => {
        value.runtime.imageId = `sha256:${sha256Utf8("different runtime image")}`;
      },
      (value) => {
        value.runtime.imageReference = `node:22-alpine@sha256:${sha256Utf8("different manifest")}`;
      },
    ];
    for (const mutate of mutations) {
      const tampered = clone(evidence);
      mutate(tampered);
      let accepted = false;
      try {
        accepted = verifySandboxEvidenceBytes(serializeSandboxEvidence(tampered)).valid;
      } catch {
        accepted = false;
      }
      expect(accepted).toBe(false);
    }

    const exactBytes = serializeSandboxEvidence(evidence);
    const oneByte = new Uint8Array(exactBytes);
    oneByte[oneByte.length - 2] = oneByte[oneByte.length - 2] === 48 ? 49 : 48;
    expect(verifySandboxEvidenceBytes(oneByte).valid).toBe(false);
  });

  it("rejects reused session identity and noncanonical outer evidence", async () => {
    const evidence = await validEvidence();
    const reused = clone(evidence);
    reused.sessions[1].executionNonce = reused.sessions[0].executionNonce;
    expect(verifySandboxEvidenceBytes(serializeSandboxEvidence(reused))).toMatchObject({
      errors: ["evidence.session-nonce-reused"],
      valid: false,
    });
    const canonical = new TextDecoder().decode(serializeSandboxEvidence(evidence));
    expect(
      verifySandboxEvidenceBytes(new TextEncoder().encode(`${canonical}\n`)),
    ).toMatchObject({ errors: ["evidence.bytes-noncanonical"], valid: false });
  });

  it("accepts an independent host-runner trust policy without self-bootstrapping it", async () => {
    const evidence = await validEvidence();
    const bytes = serializeSandboxEvidence(evidence);
    expect(verifySandboxEvidenceBytes(bytes).valid).toBe(true);
    expect(
      verifySandboxEvidenceBytes(bytes, {
        expectedHostRunnerSha256: evidence.runner.hostRunnerSha256,
      }).valid,
    ).toBe(true);
    expect(
      verifySandboxEvidenceBytes(bytes, {
        expectedHostRunnerSha256: sha256Utf8("different independently trusted runner"),
      }),
    ).toMatchObject({
      errors: ["evidence.host-runner-trust-policy-mismatch"],
      valid: false,
    });
  });

  it("accepts only the index or architecture-matched config image identity", () => {
    expect(isAllowedSandboxRuntimeIdentity("amd64", SANDBOX_RUNTIME_IMAGE_ID)).toBe(
      true,
    );
    expect(
      isAllowedSandboxRuntimeIdentity(
        "amd64",
        SANDBOX_RUNTIME_PLATFORM_IDENTITIES.amd64.configImageId,
      ),
    ).toBe(true);
    expect(
      isAllowedSandboxRuntimeIdentity(
        "arm64",
        SANDBOX_RUNTIME_PLATFORM_IDENTITIES.arm64.configImageId,
      ),
    ).toBe(true);
    expect(
      isAllowedSandboxRuntimeIdentity(
        "amd64",
        SANDBOX_RUNTIME_PLATFORM_IDENTITIES.arm64.configImageId,
      ),
    ).toBe(false);
    expect(
      isAllowedSandboxRuntimeIdentity(
        "arm64",
        `sha256:${SANDBOX_RUNTIME_PLATFORM_IDENTITIES.arm64.platformManifestSha256}`,
      ),
    ).toBe(false);
    expect(isAllowedSandboxRuntimeIdentity("s390x", SANDBOX_RUNTIME_IMAGE_ID)).toBe(
      false,
    );
  });

  it("verifies a classic-engine platform config ID while binding the observed ID", async () => {
    const evidence = clone(await validEvidence());
    evidence.runtime.architecture = "amd64";
    evidence.runtime.imageId =
      SANDBOX_RUNTIME_PLATFORM_IDENTITIES.amd64.configImageId;
    for (const session of evidence.sessions) {
      session.launchBindingSha256 = sandboxLaunchBindingSha256(evidence as SandboxEvidenceV1, {
        executionNonce: session.executionNonce,
        ordinal: session.ordinal,
      });
      session.environmentAcknowledgement.launchBindingSha256 =
        session.launchBindingSha256;
    }
    const verification = verifySandboxEvidenceBytes(serializeSandboxEvidence(evidence));
    expect(verification.valid).toBe(true);
    expect(verification.receipt?.sandboxBindings.runtimeImageId).toBe(
      SANDBOX_RUNTIME_PLATFORM_IDENTITIES.amd64.configImageId,
    );
  });
});
