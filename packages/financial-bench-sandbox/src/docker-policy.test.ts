import { describe, expect, it } from "vitest";
import {
  normalizeAndVerifyDockerInspection,
  SandboxPolicyError,
} from "./docker-policy.js";
import { SANDBOX_LAUNCHER_SOURCE } from "./launcher.js";
import { SANDBOX_RUNTIME_IMAGE, SANDBOX_RUNTIME_IMAGE_ID } from "./profile.js";

const runLabel = "a".repeat(64) + ".0";
const launchBinding = "b".repeat(64);

function fixture(
  deviceRequests: null | readonly unknown[] = null,
  runtime: Readonly<{ architecture: "amd64" | "arm64"; imageId: string }> = {
    architecture: "arm64",
    imageId: SANDBOX_RUNTIME_IMAGE_ID,
  },
) {
  return {
    container: {
      AppArmorProfile: "",
      Config: {
        Cmd: ["-i", "/usr/local/bin/node", "--permission", "--disable-warning=ExperimentalWarning", "-e", SANDBOX_LAUNCHER_SOURCE],
        Entrypoint: ["/usr/bin/env"],
        Hostname: "runbook-sut",
        Image: SANDBOX_RUNTIME_IMAGE,
        Labels: {
          "runbook.sandbox-binding": launchBinding,
          "runbook.sandbox-run": runLabel,
        },
        OpenStdin: true,
        User: "65532:65532",
        Volumes: null,
      },
      HostConfig: {
        Binds: null,
        CapAdd: null,
        CapDrop: ["ALL"],
        Devices: [],
        DeviceRequests: deviceRequests,
        IpcMode: "none",
        LogConfig: { Type: "none" },
        Memory: 268435456,
        MemorySwap: 268435456,
        NanoCpus: 250000000,
        NetworkMode: "none",
        PidMode: "",
        PidsLimit: 16,
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges=true", "seccomp=builtin"],
        UTSMode: "",
        Ulimits: [{ Hard: 64, Name: "nofile", Soft: 64 }],
        UsernsMode: "",
      },
      Id: "c".repeat(64),
      Image: runtime.imageId,
      Mounts: [],
    },
    image: {
      Architecture: runtime.architecture,
      Id: runtime.imageId,
      Os: "linux",
      RepoDigests: [
        "node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2",
      ],
    },
  };
}

describe("Docker policy inspection", () => {
  it.each([null, []] as const)("normalizes Docker DeviceRequests shape %j", (shape) => {
    const value = fixture(shape);
    expect(() => normalizeAndVerifyDockerInspection(
      value.container,
      value.image,
      runLabel,
      launchBinding,
      SANDBOX_LAUNCHER_SOURCE,
    )).not.toThrow();
  });

  it.each([
    ["arm64", "sha256:262aa4f3ae295c90861c34b4319f74feda309a2342e0439d4017be78427b97c0"],
    ["amd64", "sha256:bd168dc5d9d77ba5687dc7a31cc0f507c35b66c1d6af5f910154d3881df7c0ee"],
  ] as const)("accepts the exact %s platform config image ID", (architecture, imageId) => {
    const value = fixture(null, { architecture, imageId });
    expect(() => normalizeAndVerifyDockerInspection(
      value.container,
      value.image,
      runLabel,
      launchBinding,
      SANDBOX_LAUNCHER_SOURCE,
    )).not.toThrow();
  });

  it("rejects extra security options, capabilities, and unconfined AppArmor", () => {
    for (const mutate of [
      (value: ReturnType<typeof fixture>) => value.container.HostConfig.SecurityOpt.push("apparmor=unconfined"),
      (value: ReturnType<typeof fixture>) => { value.container.HostConfig.CapAdd = ["NET_ADMIN"] as never; },
      (value: ReturnType<typeof fixture>) => { value.container.AppArmorProfile = "unconfined"; },
    ]) {
      const value = fixture();
      mutate(value);
      expect(() => normalizeAndVerifyDockerInspection(
        value.container,
        value.image,
        runLabel,
        launchBinding,
        SANDBOX_LAUNCHER_SOURCE,
      )).toThrow(SandboxPolicyError);
    }
  });
});
