import {
  createSelfDeclaredHarnessSubject,
  runFinancialBenchHarnessWithTargetFactoryV1,
  sha256Jcs,
  sha256Utf8,
  type HarnessRunOutput,
} from "@runbook/financial-bench-harness";
import { canonicalizeJcs } from "./canonical.js";
import {
  createDockerSandboxSession,
  type DockerSandboxSessionRecord,
} from "./docker-runtime.js";
import { SANDBOX_LAUNCHER_SHA256 } from "./launcher.js";
import {
  ownAdapterBundle,
  ownPublicConfiguration,
  ownRegularFile,
  reownInputSnapshot,
  type OwnedInput,
} from "./owned-input.js";
import {
  SANDBOX_ADAPTER_CONTRACT_SHA256,
  SANDBOX_INSPECTION_POLICY,
  SANDBOX_POLICY_SHA256,
  SANDBOX_RUNTIME_IMAGE,
  isAllowedSandboxRuntimeIdentity,
} from "./profile.js";
import { parseExactJcsPublicConfigurationBytes } from "./public-configuration.js";
import {
  SANDBOX_EVIDENCE_SCHEMA,
  SANDBOX_ISOLATION,
  SANDBOX_LIMITATIONS,
  SANDBOX_PROFILE,
  type SandboxEvidenceV1,
  type SandboxEvidenceVerification,
  type SandboxReceiptV1,
  type SandboxSessionEvidenceV1,
} from "./types.js";
import {
  serializeSandboxEvidence,
  verifySandboxEvidenceBytes,
} from "./verify.js";

export type RunFinancialBenchDockerSandboxInput = Readonly<{
  adapterBundlePath: string;
  expectedAdapterBundleSha256: string;
  expectedHostRunnerArtifactSha256: string;
  hostRunnerArtifactPath: string;
  publicConfigurationPath: string;
}>;

export type SandboxRunOutput = Readonly<{
  evidence: SandboxEvidenceV1;
  evidenceBytes: Uint8Array;
  innerHarness: HarnessRunOutput;
  receipt: SandboxReceiptV1;
  receiptBytes: Uint8Array;
}>;

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function runFinancialBenchDockerSandboxV1(
  input: RunFinancialBenchDockerSandboxInput,
): Promise<SandboxRunOutput> {
  const hostRunnerArtifact = ownRegularFile(input.hostRunnerArtifactPath, {
    expectedSha256: input.expectedHostRunnerArtifactSha256,
    maxBytes: 16 * 1024 * 1024,
  });
  return runFinancialBenchDockerSandboxWithOwnedRunnerV1(input, hostRunnerArtifact);
}

export async function runFinancialBenchDockerSandboxWithOwnedRunnerV1(
  input: Omit<
    RunFinancialBenchDockerSandboxInput,
    "expectedHostRunnerArtifactSha256" | "hostRunnerArtifactPath"
  >,
  hostRunnerArtifact: OwnedInput,
): Promise<SandboxRunOutput> {
  const ownedHostRunnerArtifact = reownInputSnapshot(
    hostRunnerArtifact,
    16 * 1024 * 1024,
  );
  const adapter = ownAdapterBundle(
    input.adapterBundlePath,
    input.expectedAdapterBundleSha256,
  );
  const configuration = ownPublicConfiguration(input.publicConfigurationPath);
  const publicConfiguration = parseExactJcsPublicConfigurationBytes(configuration.bytes);
  const records: Array<DockerSandboxSessionRecord | undefined> = new Array(5);
  let observedInspection: typeof SANDBOX_INSPECTION_POLICY | null = null;
  let observedRuntime: SandboxEvidenceV1["runtime"] | null = null;

  const subject = createSelfDeclaredHarnessSubject({
    selfDeclaredBuildSha256: adapter.sha256,
    selfDeclaredPublicConfigurationSha256: configuration.sha256,
  });
  const innerHarness = await runFinancialBenchHarnessWithTargetFactoryV1(
    async (ordinal) => {
      const session = await createDockerSandboxSession({
        adapter,
        adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
        configuration,
        hostRunnerSha256: ownedHostRunnerArtifact.sha256,
        ordinal,
        publicConfiguration,
      });
      if (observedInspection === null) observedInspection = session.inspection;
      else if (canonicalizeJcs(observedInspection) !== canonicalizeJcs(session.inspection)) {
        await session.close();
        throw new Error("sandbox.inspection-drift");
      }
      if (observedRuntime === null) observedRuntime = session.runtime;
      else if (canonicalizeJcs(observedRuntime) !== canonicalizeJcs(session.runtime)) {
        await session.close();
        throw new Error("sandbox.runtime-drift");
      }
      return {
        cleanup: async () => {
          records[ordinal] = await session.close();
        },
        target: session.target,
      };
    },
    subject,
  );

  if (
    observedInspection === null ||
    observedRuntime === null ||
    records.some((record) => record === undefined)
  ) {
    throw new Error("sandbox.session-evidence-incomplete");
  }
  const sessions: SandboxSessionEvidenceV1[] = records.map((record, ordinal) => {
    if (record === undefined) throw new Error("sandbox.session-evidence-incomplete");
    const scenario = innerHarness.evidence.scenarioEvidence[ordinal];
    if (scenario === undefined) throw new Error("sandbox.scenario-evidence-incomplete");
    return {
      ...record,
      scenarioEvidenceSha256: sha256Jcs(scenario),
      scenarioId: scenario.scenarioId,
    };
  });
  const evidence: SandboxEvidenceV1 = {
    adapter: {
      adapterContractSha256: SANDBOX_ADAPTER_CONTRACT_SHA256,
      adapterId: publicConfiguration.adapterId,
      bundleByteCount: adapter.byteCount,
      bundleSha256: adapter.sha256,
    },
    innerHarness: {
      evidenceJson: utf8(innerHarness.evidenceBytes),
      evidenceSha256: sha256Utf8(utf8(innerHarness.evidenceBytes)),
      receiptJson: utf8(innerHarness.receiptBytes),
      receiptSha256: sha256Utf8(utf8(innerHarness.receiptBytes)),
    },
    isolation: SANDBOX_ISOLATION,
    limitations: SANDBOX_LIMITATIONS,
    policy: {
      inspection: observedInspection,
      inspectionSha256: sha256Jcs(observedInspection),
      policySha256: SANDBOX_POLICY_SHA256,
    },
    profileVersion: SANDBOX_PROFILE,
    publicConfiguration: {
      bytesSha256: configuration.sha256,
      value: publicConfiguration,
    },
    runner: {
      hostRunnerSha256: ownedHostRunnerArtifact.sha256,
      launcherSha256: SANDBOX_LAUNCHER_SHA256,
    },
    runtime: observedRuntime,
    schemaVersion: SANDBOX_EVIDENCE_SCHEMA,
    sessions,
  };
  if (
    !isAllowedSandboxRuntimeIdentity(
      evidence.runtime.architecture,
      evidence.runtime.imageId,
    ) ||
    evidence.runtime.imageReference !== SANDBOX_RUNTIME_IMAGE
  ) {
    throw new Error("sandbox.runtime-identity-mismatch");
  }
  const evidenceBytes = serializeSandboxEvidence(evidence);
  const verification: SandboxEvidenceVerification = verifySandboxEvidenceBytes(evidenceBytes);
  if (!verification.valid || verification.receipt === null || verification.receiptBytes === null) {
    throw new Error(verification.errors[0] ?? "sandbox.self-verification-failed");
  }
  return {
    evidence,
    evidenceBytes: new Uint8Array(evidenceBytes),
    innerHarness,
    receipt: verification.receipt,
    receiptBytes: new Uint8Array(verification.receiptBytes),
  };
}
