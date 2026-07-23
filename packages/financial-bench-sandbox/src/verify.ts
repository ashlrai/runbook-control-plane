import {
  canonicalizeJcs,
  jcsBytes,
  sha256Jcs,
  sha256Utf8,
  verifyHarnessEvidenceBytes,
  parseExactJcsEvidenceBytes,
  type HarnessEvidenceV1,
  type HarnessReceiptV1,
} from "@runbook/financial-bench-harness";
import {
  SANDBOX_ADAPTER_CONTRACT_SHA256,
  SANDBOX_INSPECTION_POLICY,
  SANDBOX_LAUNCHER_SHA256,
  SANDBOX_POLICY_SHA256,
  SANDBOX_RUNTIME_IMAGE,
  isAllowedSandboxRuntimeIdentity,
} from "./profile.js";
import {
  SandboxValidationError,
  serializeSandboxPublicConfiguration,
} from "./public-configuration.js";
import {
  SANDBOX_LAUNCH_BINDING_SCHEMA,
  SANDBOX_RECEIPT_SCHEMA,
  type SandboxEvidenceV1,
  type SandboxEvidenceVerification,
  type SandboxReceiptV1,
  type SandboxSessionEvidenceV1,
  type SandboxVerifierOptions,
} from "./types.js";
import {
  parseExactJcsSandboxEvidenceBytes,
  parseSandboxEvidence,
} from "./validate.js";

const fail = (code: string): never => {
  throw new SandboxValidationError(code);
};

export function sandboxLaunchBindingSha256(
  evidence: Pick<
    SandboxEvidenceV1,
    "adapter" | "policy" | "publicConfiguration" | "runner" | "runtime"
  >,
  session: Pick<SandboxSessionEvidenceV1, "executionNonce" | "ordinal">,
): string {
  return sha256Jcs({
    adapterContractSha256: evidence.adapter.adapterContractSha256,
    bundleSha256: evidence.adapter.bundleSha256,
    executionNonce: session.executionNonce,
    hostRunnerSha256: evidence.runner.hostRunnerSha256,
    launcherSha256: evidence.runner.launcherSha256,
    ordinal: session.ordinal,
    policySha256: evidence.policy.policySha256,
    publicConfigurationSha256: evidence.publicConfiguration.bytesSha256,
    runtimeImageId: evidence.runtime.imageId,
    schemaVersion: SANDBOX_LAUNCH_BINDING_SCHEMA,
  });
}

function assertSame(left: unknown, right: unknown, code: string) {
  if (canonicalizeJcs(left) !== canonicalizeJcs(right)) fail(code);
}

function verifyInnerHarness(evidence: SandboxEvidenceV1): {
  evidence: HarnessEvidenceV1;
  receipt: HarnessReceiptV1;
} {
  const encoder = new TextEncoder();
  const innerEvidenceBytes = encoder.encode(evidence.innerHarness.evidenceJson);
  if (
    sha256Utf8(evidence.innerHarness.evidenceJson) !==
    evidence.innerHarness.evidenceSha256
  ) {
    fail("evidence.inner-evidence-digest-mismatch");
  }
  const verification = verifyHarnessEvidenceBytes(innerEvidenceBytes);
  if (
    !verification.valid ||
    verification.receipt === null ||
    verification.receiptBytes === null
  ) {
    fail("evidence.inner-verification-failed");
  }
  const verifiedReceipt = verification.receipt as HarnessReceiptV1;
  const verifiedReceiptBytes = verification.receiptBytes as Uint8Array;
  const computedReceiptJson = new TextDecoder("utf-8", { fatal: true }).decode(
    verifiedReceiptBytes,
  );
  if (computedReceiptJson !== evidence.innerHarness.receiptJson) {
    fail("evidence.inner-receipt-mismatch");
  }
  if (
    sha256Utf8(evidence.innerHarness.receiptJson) !==
    evidence.innerHarness.receiptSha256
  ) {
    fail("evidence.inner-receipt-digest-mismatch");
  }
  return {
    evidence: parseExactJcsEvidenceBytes(innerEvidenceBytes),
    receipt: verifiedReceipt,
  };
}

function verifyBindings(evidence: SandboxEvidenceV1, inner: HarnessEvidenceV1) {
  if (evidence.runner.launcherSha256 !== SANDBOX_LAUNCHER_SHA256) {
    fail("evidence.launcher-digest-mismatch");
  }
  const publicConfigurationBytes = serializeSandboxPublicConfiguration(
    evidence.publicConfiguration.value,
  );
  const publicConfigurationJson = new TextDecoder("utf-8", { fatal: true }).decode(
    publicConfigurationBytes,
  );
  if (
    sha256Utf8(publicConfigurationJson) !== evidence.publicConfiguration.bytesSha256
  ) {
    fail("evidence.public-configuration-digest-mismatch");
  }
  if (
    evidence.adapter.adapterContractSha256 !== SANDBOX_ADAPTER_CONTRACT_SHA256 ||
    evidence.adapter.adapterContractSha256 !==
      evidence.publicConfiguration.value.adapterContractSha256 ||
    evidence.adapter.adapterId !== evidence.publicConfiguration.value.adapterId
  ) {
    fail("evidence.adapter-binding-mismatch");
  }
  if (
    inner.subjectDeclaration.adapterContractSha256 !==
      evidence.adapter.adapterContractSha256 ||
    inner.subjectDeclaration.selfDeclaredBuildSha256 !== evidence.adapter.bundleSha256 ||
    inner.subjectDeclaration.selfDeclaredPublicConfigurationSha256 !==
      evidence.publicConfiguration.bytesSha256
  ) {
    fail("evidence.inner-subject-binding-mismatch");
  }
  if (evidence.policy.policySha256 !== SANDBOX_POLICY_SHA256) {
    fail("evidence.policy-digest-mismatch");
  }
  if (
    evidence.policy.inspectionSha256 !== sha256Jcs(evidence.policy.inspection) ||
    canonicalizeJcs(evidence.policy.inspection) !==
      canonicalizeJcs(SANDBOX_INSPECTION_POLICY)
  ) {
    fail("evidence.inspection-binding-mismatch");
  }
  if (
    evidence.runtime.imageReference !== SANDBOX_RUNTIME_IMAGE ||
    !isAllowedSandboxRuntimeIdentity(
      evidence.runtime.architecture,
      evidence.runtime.imageId,
    )
  ) {
    fail("evidence.runtime-identity-mismatch");
  }

  const nonces = new Set<string>();
  evidence.sessions.forEach((session, ordinal) => {
    if (nonces.has(session.executionNonce)) fail("evidence.session-nonce-reused");
    nonces.add(session.executionNonce);
    const expectedLaunchBinding = sandboxLaunchBindingSha256(evidence, session);
    if (session.launchBindingSha256 !== expectedLaunchBinding) {
      fail("evidence.launch-binding-mismatch");
    }
    const acknowledgement = session.environmentAcknowledgement;
    if (
      acknowledgement.adapterContractSha256 !== evidence.adapter.adapterContractSha256 ||
      acknowledgement.bundleSha256 !== evidence.adapter.bundleSha256 ||
      acknowledgement.publicConfigurationSha256 !==
        evidence.publicConfiguration.bytesSha256 ||
      acknowledgement.executionNonce !== session.executionNonce ||
      acknowledgement.launchBindingSha256 !== session.launchBindingSha256
    ) {
      fail("evidence.environment-acknowledgement-mismatch");
    }
    const scenarioEvidence = inner.scenarioEvidence[ordinal];
    if (
      scenarioEvidence === undefined ||
      scenarioEvidence.scenarioId !== session.scenarioId ||
      sha256Jcs(scenarioEvidence) !== session.scenarioEvidenceSha256
    ) {
      fail("evidence.session-scenario-binding-mismatch");
    }
  });
}

function receiptFromEvidence(
  evidence: SandboxEvidenceV1,
  evidenceBytes: Uint8Array,
  innerReceipt: HarnessReceiptV1,
): SandboxReceiptV1 {
  return {
    analysisComplete: true,
    counts: innerReceipt.counts,
    coverage: {
      hostileCatalog: 30,
      hostileEvaluated: 4,
      hostileUnevaluated: 26,
      positiveCalibrationEvaluated: 1,
    },
    evidenceSha256: sha256Utf8(
      new TextDecoder("utf-8", { fatal: true }).decode(evidenceBytes),
    ),
    isolation: evidence.isolation,
    limitations: evidence.limitations,
    profileVersion: evidence.profileVersion,
    results: innerReceipt.results,
    sandboxBindings: {
      adapterBundleSha256: evidence.adapter.bundleSha256,
      hostRunnerSha256: evidence.runner.hostRunnerSha256,
      innerEvidenceSha256: evidence.innerHarness.evidenceSha256,
      innerReceiptSha256: evidence.innerHarness.receiptSha256,
      launcherSha256: evidence.runner.launcherSha256,
      policySha256: evidence.policy.policySha256,
      publicConfigurationSha256: evidence.publicConfiguration.bytesSha256,
      runtimeImageId: evidence.runtime.imageId,
    },
    schemaVersion: SANDBOX_RECEIPT_SCHEMA,
    sessionSummary: {
      cleanupComplete: 5,
      freshSessions: 5,
      orphanAuditsPassed: 5,
    },
  };
}

export function serializeSandboxEvidence(value: unknown): Uint8Array {
  return jcsBytes(parseSandboxEvidence(value));
}

export function serializeSandboxReceipt(value: SandboxReceiptV1): Uint8Array {
  return jcsBytes(value);
}

export function verifySandboxEvidenceBytes(
  bytes: Uint8Array,
  options: SandboxVerifierOptions = {},
): SandboxEvidenceVerification {
  try {
    if (
      options.expectedHostRunnerSha256 !== undefined &&
      !/^[0-9a-f]{64}$/.test(options.expectedHostRunnerSha256)
    ) {
      fail("verifier.expected-host-runner-digest-invalid");
    }
    const ownedBytes = new Uint8Array(bytes);
    const evidence = parseExactJcsSandboxEvidenceBytes(ownedBytes);
    if (
      options.expectedHostRunnerSha256 !== undefined &&
      evidence.runner.hostRunnerSha256 !== options.expectedHostRunnerSha256
    ) {
      fail("evidence.host-runner-trust-policy-mismatch");
    }
    const inner = verifyInnerHarness(evidence);
    verifyBindings(evidence, inner.evidence);
    const receipt = receiptFromEvidence(evidence, ownedBytes, inner.receipt);
    const receiptBytes = serializeSandboxReceipt(receipt);
    return { errors: [], receipt, receiptBytes, valid: true };
  } catch (error) {
    const code =
      error instanceof SandboxValidationError
        ? error.code
        : "evidence.verification-failed";
    return { errors: [code], receipt: null, receiptBytes: null, valid: false };
  }
}
