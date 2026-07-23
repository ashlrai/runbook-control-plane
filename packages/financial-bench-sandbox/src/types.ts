import type {
  HarnessReceiptV1,
  HarnessScenarioId,
  HarnessScenarioResultV1,
} from "@runbook/financial-bench-harness";

export const SANDBOX_PROFILE = "runbook.financial-agent-sandbox-target.v1" as const;
export const SANDBOX_EVIDENCE_SCHEMA =
  "runbook.financial-agent-sandbox-evidence.v1" as const;
export const SANDBOX_RECEIPT_SCHEMA =
  "runbook.financial-agent-sandbox-receipt.v1" as const;
export const SANDBOX_PUBLIC_CONFIGURATION_SCHEMA =
  "runbook.financial-agent-sandbox-public-configuration.v1" as const;
export const SANDBOX_LAUNCH_BINDING_SCHEMA =
  "runbook.financial-agent-sandbox-launch-binding.v1" as const;
export const SANDBOX_ISOLATION =
  "runner-observed-oci-container-network-none-read-only-v1" as const;

export type SandboxPublicConfigurationV1 = Readonly<{
  adapterContractSha256: string;
  adapterId: string;
  configurationId: string;
  mode: "broker-disconnected-synthetic";
  schemaVersion: typeof SANDBOX_PUBLIC_CONFIGURATION_SCHEMA;
}>;

export type SandboxAdapterEvidenceV1 = Readonly<{
  adapterContractSha256: string;
  adapterId: string;
  bundleByteCount: number;
  bundleSha256: string;
}>;

export type SandboxRuntimeEvidenceV1 = Readonly<{
  architecture: string;
  imageId: string;
  imageReference: string;
  operatingSystem: "linux";
}>;

export type SandboxInspectionSnapshotV1 = Readonly<{
  capabilitiesDropped: readonly ["ALL"];
  cpuNanoCpus: 250000000;
  devices: readonly [];
  hostname: "runbook-sut";
  ipcMode: "none";
  logDriver: "none";
  memoryBytes: 268435456;
  memorySwapBytes: 268435456;
  mounts: readonly [];
  networkMode: "none";
  noNewPrivileges: true;
  pidMode: "";
  pidsLimit: 16;
  privileged: false;
  readOnlyRootFilesystem: true;
  seccompProfile: "builtin";
  user: "65532:65532";
}>;

export type SandboxPolicyEvidenceV1 = Readonly<{
  inspection: SandboxInspectionSnapshotV1;
  inspectionSha256: string;
  policySha256: string;
}>;

export type SandboxEnvironmentAcknowledgementV1 = Readonly<{
  adapterContractSha256: string;
  bundleSha256: string;
  publicConfigurationSha256: string;
  executionNonce: string;
  launchBindingSha256: string;
}>;

export type SandboxProcessOutcome =
  | "exited-zero"
  | "force-killed";

export type SandboxSessionEvidenceV1 = Readonly<{
  cleanupComplete: true;
  diagnosticSha256: string;
  environmentAcknowledgement: SandboxEnvironmentAcknowledgementV1;
  executionNonce: string;
  launchBindingSha256: string;
  lifecycle: readonly [
    "created",
    "policy-inspected",
    "ready",
    "scenario-closed",
    "removed",
  ];
  ordinal: number;
  orphanAuditPassed: true;
  processOutcome: SandboxProcessOutcome;
  scenarioEvidenceSha256: string;
  scenarioId: HarnessScenarioId;
}>;

export type SandboxInnerHarnessEvidenceV1 = Readonly<{
  evidenceJson: string;
  evidenceSha256: string;
  receiptJson: string;
  receiptSha256: string;
}>;

export type SandboxEvidenceV1 = Readonly<{
  adapter: SandboxAdapterEvidenceV1;
  innerHarness: SandboxInnerHarnessEvidenceV1;
  isolation: typeof SANDBOX_ISOLATION;
  limitations: typeof SANDBOX_LIMITATIONS;
  policy: SandboxPolicyEvidenceV1;
  profileVersion: typeof SANDBOX_PROFILE;
  publicConfiguration: Readonly<{
    bytesSha256: string;
    value: SandboxPublicConfigurationV1;
  }>;
  runner: Readonly<{
    hostRunnerSha256: string;
    launcherSha256: string;
  }>;
  runtime: SandboxRuntimeEvidenceV1;
  schemaVersion: typeof SANDBOX_EVIDENCE_SCHEMA;
  sessions: readonly SandboxSessionEvidenceV1[];
}>;

export const SANDBOX_LIMITATIONS = [
  "synthetic-one-calibration-plus-four-of-thirty-hostile-cases-only",
  "exact-runner-observed-bundle-and-public-configuration-not-source-or-production-provenance",
  "bundle-bytes-omitted-and-absence-of-embedded-secrets-not-proven",
  "runner-observed-docker-isolation-not-independent-or-hardware-attestation",
  "docker-container-is-not-a-dedicated-per-run-vm-and-shares-a-kernel-boundary",
  "external-network-denied-while-loopback-remains-available",
  "no-broker-account-order-execution-credential-or-capital-used",
  "fixed-corpus-behavior-does-not-prove-generalization-or-resistance-to-hardcoding",
  "no-production-build-deployment-model-provider-or-behavioral-equivalence-proven",
  "scenario-outcomes-are-not-a-composite-score-grade-certification-or-readiness-guarantee",
  "receipt-does-not-prove-safety-compliance-suitability-performance-profitability-or-future-behavior",
  "same-project-verifier-agreement-is-not-independent-interoperability",
  "host-runner-digest-is-unsigned-runner-observation-and-self-measurement-not-authenticated-runner-identity",
] as const;

export type SandboxReceiptV1 = Readonly<{
  analysisComplete: true;
  counts: HarnessReceiptV1["counts"];
  coverage: Readonly<{
    hostileCatalog: 30;
    hostileEvaluated: 4;
    hostileUnevaluated: 26;
    positiveCalibrationEvaluated: 1;
  }>;
  evidenceSha256: string;
  isolation: typeof SANDBOX_ISOLATION;
  limitations: typeof SANDBOX_LIMITATIONS;
  profileVersion: typeof SANDBOX_PROFILE;
  results: readonly HarnessScenarioResultV1[];
  sandboxBindings: Readonly<{
    adapterBundleSha256: string;
    hostRunnerSha256: string;
    innerEvidenceSha256: string;
    innerReceiptSha256: string;
    launcherSha256: string;
    policySha256: string;
    publicConfigurationSha256: string;
    runtimeImageId: string;
  }>;
  schemaVersion: typeof SANDBOX_RECEIPT_SCHEMA;
  sessionSummary: Readonly<{
    cleanupComplete: 5;
    freshSessions: 5;
    orphanAuditsPassed: 5;
  }>;
}>;

export type SandboxEvidenceVerification = Readonly<{
  errors: readonly string[];
  receipt: SandboxReceiptV1 | null;
  receiptBytes: Uint8Array | null;
  valid: boolean;
}>;

export type SandboxVerifierOptions = Readonly<{
  /** Optional trust policy supplied independently of the portable evidence. */
  expectedHostRunnerSha256?: string;
}>;
