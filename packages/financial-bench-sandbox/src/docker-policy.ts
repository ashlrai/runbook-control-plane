import { canonicalizeJcs } from "./canonical.js";
import {
  isAllowedSandboxRuntimeIdentity,
  SANDBOX_INSPECTION_POLICY,
  SANDBOX_RUNTIME_IMAGE,
  SANDBOX_RUNTIME_PLATFORM_IDENTITIES,
} from "./profile.js";
import type {
  SandboxInspectionSnapshotV1,
  SandboxRuntimeEvidenceV1,
} from "./types.js";

export const SANDBOX_RUN_LABEL = "runbook.sandbox-run" as const;

type Inspect = Record<string, any>;

export type NormalizedDockerInspection = SandboxInspectionSnapshotV1;

export class SandboxPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SandboxPolicyError";
  }
}

export function normalizeAndVerifyRuntimeImageInspection(
  image: unknown,
): SandboxRuntimeEvidenceV1 {
  if (image === null || typeof image !== "object" || Array.isArray(image)) {
    throw new SandboxPolicyError("policy.image-inspection-invalid");
  }
  const value = image as Inspect;
  const architecture = String(value.Architecture ?? "");
  const imageId = String(value.Id ?? "");
  if (
    value.Os !== "linux" ||
    !isAllowedSandboxRuntimeIdentity(architecture, imageId) ||
    !Array.isArray(value.RepoDigests) ||
    !value.RepoDigests.some(
      (digest: unknown) =>
        typeof digest === "string" &&
        digest.endsWith(`@${SANDBOX_RUNTIME_IMAGE.split("@")[1]}`),
    )
  ) {
    throw new SandboxPolicyError("policy.runtime-image-identity-mismatch");
  }
  const descriptorDigest = value.ImageManifestDescriptor?.digest;
  if (
    descriptorDigest !== undefined &&
    descriptorDigest !==
      `sha256:${SANDBOX_RUNTIME_PLATFORM_IDENTITIES[architecture].platformManifestSha256}`
  ) {
    throw new SandboxPolicyError("policy.runtime-manifest-identity-mismatch");
  }
  return Object.freeze({
    architecture,
    imageId,
    imageReference: SANDBOX_RUNTIME_IMAGE,
    operatingSystem: "linux" as const,
  });
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalizeJcs(left) === canonicalizeJcs(right);
}

export function normalizeAndVerifyDockerInspection(
  container: unknown,
  image: unknown,
  expectedRunLabel: string,
  expectedLaunchBindingSha256?: string,
  expectedLauncherSource?: string,
): NormalizedDockerInspection {
  if (container === null || typeof container !== "object" || Array.isArray(container)) {
    throw new SandboxPolicyError("policy.container-inspection-invalid");
  }
  if (image === null || typeof image !== "object" || Array.isArray(image)) {
    throw new SandboxPolicyError("policy.image-inspection-invalid");
  }
  const value = container as Inspect;
  const runtime = normalizeAndVerifyRuntimeImageInspection(image);
  const host = value.HostConfig as Inspect | undefined;
  const config = value.Config as Inspect | undefined;
  if (host === undefined || config === undefined) {
    throw new SandboxPolicyError("policy.inspection-incomplete");
  }
  const security = Array.isArray(host.SecurityOpt) ? host.SecurityOpt : [];
  const ulimits = Array.isArray(host.Ulimits) ? host.Ulimits : [];
  const nofile = ulimits.find((item: Inspect) => item?.Name === "nofile");
  const labels = config.Labels as Inspect | undefined;
  const inspection: SandboxInspectionSnapshotV1 = {
    capabilitiesDropped: host.CapDrop,
    cpuNanoCpus: host.NanoCpus,
    devices: host.Devices,
    hostname: config.Hostname,
    ipcMode: host.IpcMode,
    logDriver: host.LogConfig?.Type,
    memoryBytes: host.Memory,
    memorySwapBytes: host.MemorySwap,
    mounts: value.Mounts,
    networkMode: host.NetworkMode,
    noNewPrivileges: security.includes("no-new-privileges=true"),
    pidMode: host.PidMode,
    pidsLimit: host.PidsLimit,
    privileged: host.Privileged,
    readOnlyRootFilesystem: host.ReadonlyRootfs,
    seccompProfile: security.includes("seccomp=builtin") ? "builtin" : null,
    user: config.User,
  } as SandboxInspectionSnapshotV1;
  if (!equal(inspection, SANDBOX_INSPECTION_POLICY)) {
    throw new SandboxPolicyError("policy.inspect-mismatch");
  }
  if (
    value.Image !== runtime.imageId ||
    config.Image !== SANDBOX_RUNTIME_IMAGE ||
    !equal(config.Entrypoint, ["/usr/bin/env"]) ||
    config.OpenStdin !== true ||
    labels?.[SANDBOX_RUN_LABEL] !== expectedRunLabel ||
    (expectedLaunchBindingSha256 !== undefined &&
      labels?.["runbook.sandbox-binding"] !== expectedLaunchBindingSha256) ||
    (expectedLauncherSource !== undefined &&
      !equal(config.Cmd, [
        "-i",
        "/usr/local/bin/node",
        "--permission",
        "--disable-warning=ExperimentalWarning",
        "-e",
        expectedLauncherSource,
      ])) ||
    !equal([...security].sort(), ["no-new-privileges=true", "seccomp=builtin"].sort()) ||
    !(host.CapAdd === null || equal(host.CapAdd, [])) ||
    !["", "docker-default"].includes(String(value.AppArmorProfile ?? "")) ||
    host.Binds !== null ||
    host.Privileged !== false ||
    host.PidMode !== "" ||
    host.UTSMode !== "" ||
    host.UsernsMode !== "" ||
    !equal(host.Devices, []) ||
    !(host.DeviceRequests === null || equal(host.DeviceRequests, [])) ||
    config.Volumes !== null
  ) {
    throw new SandboxPolicyError("policy.forbidden-surface-present");
  }
  if (nofile?.Hard !== 64 || nofile?.Soft !== 64) {
    throw new SandboxPolicyError("policy.ulimit-mismatch");
  }
  return Object.freeze(inspection);
}

export function dockerCreateArguments(input: {
  launchBindingSha256: string;
  launcherSource: string;
  runLabel: string;
}): readonly string[] {
  return [
    "create",
    "--pull=never",
    "--interactive",
    "--network=none",
    "--read-only",
    "--ipc=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--security-opt=seccomp=builtin",
    "--user=65532:65532",
    "--pids-limit=16",
    "--memory=256m",
    "--memory-swap=256m",
    "--cpus=0.25",
    "--ulimit=nofile=64:64",
    "--hostname=runbook-sut",
    "--log-driver=none",
    `--label=${SANDBOX_RUN_LABEL}=${input.runLabel}`,
    `--label=runbook.sandbox-binding=${input.launchBindingSha256}`,
    "--stop-timeout=1",
    "--entrypoint=/usr/bin/env",
    SANDBOX_RUNTIME_IMAGE,
    "-i",
    "/usr/local/bin/node",
    "--permission",
    "--disable-warning=ExperimentalWarning",
    "-e",
    input.launcherSource,
  ];
}
