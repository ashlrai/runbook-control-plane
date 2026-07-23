import { FINANCIAL_BENCH_ADAPTER_CONTRACT_SHA256 } from "@runbook/financial-bench-harness";
import { sha256Jcs } from "./canonical.js";
import {
  SANDBOX_ISOLATION,
  SANDBOX_LIMITATIONS,
  type SandboxInspectionSnapshotV1,
} from "./types.js";

export const MAX_ADAPTER_BUNDLE_BYTES = 32 * 1024 * 1024;
export const MAX_PUBLIC_CONFIGURATION_BYTES = 2 * 1024;
export const MAX_BEHAVIORAL_FRAME_BYTES = 32 * 1024;
export const SANDBOX_ADAPTER_CONTRACT_SHA256 =
  FINANCIAL_BENCH_ADAPTER_CONTRACT_SHA256;
export const SANDBOX_RUNTIME_IMAGE =
  "node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2" as const;
export const SANDBOX_RUNTIME_IMAGE_ID =
  "sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2" as const;
export const SANDBOX_RUNTIME_PLATFORM_IDENTITIES = {
  amd64: {
    configImageId:
      "sha256:bd168dc5d9d77ba5687dc7a31cc0f507c35b66c1d6af5f910154d3881df7c0ee",
    platformManifestSha256:
      "b74031b4a37cdbbccaf7bf378a733f09eabbba02ec26bf98054779067d7815c9",
  },
  arm64: {
    configImageId:
      "sha256:262aa4f3ae295c90861c34b4319f74feda309a2342e0439d4017be78427b97c0",
    platformManifestSha256:
      "d51cff2c0fd04139135ac4e5c6aa0bb5b4101bcba296655905480004538e6d31",
  },
} as const;

export type SandboxRuntimeArchitecture =
  keyof typeof SANDBOX_RUNTIME_PLATFORM_IDENTITIES;

export function isAllowedSandboxRuntimeIdentity(
  architecture: string,
  imageId: string,
): architecture is SandboxRuntimeArchitecture {
  if (architecture !== "amd64" && architecture !== "arm64") return false;
  return (
    imageId === SANDBOX_RUNTIME_IMAGE_ID ||
    imageId === SANDBOX_RUNTIME_PLATFORM_IDENTITIES[architecture].configImageId
  );
}
/** SHA-256 of the exact reviewed `node -e` launcher source bytes. */
export const SANDBOX_LAUNCHER_SHA256 =
  "ba6ea55b93d448f22ff13944f8a9ef2b5454829c7d9159cf6b514487f69824fc" as const;

export const SANDBOX_INSPECTION_POLICY: SandboxInspectionSnapshotV1 = {
  capabilitiesDropped: ["ALL"],
  cpuNanoCpus: 250000000,
  devices: [],
  hostname: "runbook-sut",
  ipcMode: "none",
  logDriver: "none",
  memoryBytes: 268435456,
  memorySwapBytes: 268435456,
  mounts: [],
  networkMode: "none",
  noNewPrivileges: true,
  pidMode: "",
  pidsLimit: 16,
  privileged: false,
  readOnlyRootFilesystem: true,
  seccompProfile: "builtin",
  user: "65532:65532",
};

export const SANDBOX_POLICY_DECLARATION = {
  container: {
    capabilitiesDropped: ["ALL"],
    cpuNanoCpus: 250000000,
    entrypoint: ["/usr/bin/env"],
    environmentMode: "env-clear",
    hostname: "runbook-sut",
    ipcMode: "none",
    logDriver: "none",
    memoryBytes: 268435456,
    memorySwapBytes: 268435456,
    networkMode: "none",
    noNewPrivileges: true,
    nodeArguments: [
      "/usr/local/bin/node",
      "--permission",
      "--disable-warning=ExperimentalWarning",
      "-e",
    ],
    launcherSha256: SANDBOX_LAUNCHER_SHA256,
    openStdin: true,
    pidsLimit: 16,
    privileged: false,
    readOnlyRootFilesystem: true,
    runtimeImageReference: SANDBOX_RUNTIME_IMAGE,
    runtimePlatformIdentities: SANDBOX_RUNTIME_PLATFORM_IDENTITIES,
    seccompProfile: "builtin",
    stopTimeoutSeconds: 1,
    ulimitNofile: { hard: 64, soft: 64 },
    user: "65532:65532",
  },
  isolation: SANDBOX_ISOLATION,
  limitations: SANDBOX_LIMITATIONS,
  normalizedInspection: SANDBOX_INSPECTION_POLICY,
  protocol: {
    adapterBundleBytesMax: MAX_ADAPTER_BUNDLE_BYTES,
    behavioralFrameBytesMax: MAX_BEHAVIORAL_FRAME_BYTES,
    bootstrap: "exact-jcs-init-then-raw-length-prefixed-adapter-and-configuration",
    publicConfigurationBytesMax: MAX_PUBLIC_CONFIGURATION_BYTES,
  },
  schemaVersion: "runbook.financial-agent-sandbox-policy.v1",
} as const;

export const SANDBOX_POLICY_SHA256 = sha256Jcs(SANDBOX_POLICY_DECLARATION);
