import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunnerIdentityV2 } from "@runbook/financial-dossier-harness/private/runner";
import { ProcessFrameError } from "./framing.js";
import { ownPinnedTargetModule } from "./owned-target.js";
import { ProcessBridgeRunError, runFinance000Process } from "./run.js";

const MODES = [
  "success",
  "nonzero",
  "signal",
  "timeout",
  "stdout-limit",
  "stderr-limit",
  "partial",
  "trailing",
  "post-conclusion",
  "direction",
  "sequence",
  "conclusion-nonzero",
] as const;
type Mode = (typeof MODES)[number];

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const digest = (label: string) => sha(`hostile-process-test:${label}`);
const identity: RunnerIdentityV2 = Object.freeze({
  adapterBundleSha256: digest("adapter"),
  channelContractSha256: digest("channel"),
  corpusManifestSha256: digest("corpus"),
  dossierRunNonce: digest("run"),
  publicConfigurationSha256: digest("config"),
  runnerArtifactSha256: digest("runner"),
});

const templatePath = fileURLToPath(
  new URL("./fixtures/hostile-target-template.mjs", import.meta.url),
);
const template = readFileSync(templatePath, "utf8");
let fixtureDirectory = "";
const fixturePaths = new Map<Mode, string>();

beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "runbook-process-hostile-"));
  for (const mode of MODES) {
    const source = template.replace("__RUNBOOK_HOSTILE_MODE__", mode);
    const path = join(fixtureDirectory, `${mode}.mjs`);
    writeFileSync(path, source, { encoding: "utf8", mode: 0o600 });
    fixturePaths.set(mode, path);
  }
});

afterAll(() => {
  if (fixtureDirectory !== "") rmSync(fixtureDirectory, { recursive: true, force: true });
});

function targetFor(mode: Mode) {
  const path = fixturePaths.get(mode);
  if (path === undefined) throw new Error(`hostile.fixture-missing:${mode}`);
  const bytes = new Uint8Array(readFileSync(path));
  return ownPinnedTargetModule(path, sha(bytes));
}

async function expectNoCompletedRun(
  mode: Exclude<Mode, "success">,
  timeoutMilliseconds = 3_000,
): Promise<Error> {
  const outcome = await runFinance000Process({
    identity,
    target: targetFor(mode),
    timeoutMilliseconds,
  }).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  expect(outcome.status).toBe("rejected");
  if (outcome.status === "fulfilled") {
    throw new Error(`hostile.mode-unexpectedly-completed:${mode}`);
  }
  expect(outcome.reason).toBeInstanceOf(Error);
  expect(
    outcome.reason instanceof ProcessBridgeRunError ||
      outcome.reason instanceof ProcessFrameError,
  ).toBe(true);
  expect(outcome.reason).not.toHaveProperty("sealedTrial");
  expect(outcome.reason).not.toHaveProperty("attempt");
  return outcome.reason as Error;
}

describe("finance-000 process bridge hostile completion boundary", () => {
  it("uses fresh CSPRNG-bound sessions and archives diagnostics by digest only", async () => {
    const first = await runFinance000Process({ identity, target: targetFor("success") });
    const second = await runFinance000Process({ identity, target: targetFor("success") });

    expect(first.sealedTrial.disposition).toBe("proceed");
    expect(first.attempt.sessionBindingSha256).not.toBe(second.attempt.sessionBindingSha256);
    expect(first.runnerToTargetTranscriptBytes).not.toEqual(second.runnerToTargetTranscriptBytes);
    expect(first.attempt.stdoutByteCount).toBeGreaterThan(0);
    expect(first.attempt.stderrByteCount).toBeGreaterThan(0);

    const returnedArchiveBytes = [
      first.attemptBytes,
      first.sealedTrialBytes,
      first.runnerToTargetTranscriptBytes,
      first.targetToRunnerTranscriptBytes,
    ];
    const returnedArchiveText = returnedArchiveBytes
      .map((bytes) => new TextDecoder().decode(bytes))
      .join("\n");
    expect(returnedArchiveText).not.toContain("HOSTILE_ARCHIVE_SENTINEL");
    expect(returnedArchiveText).not.toContain("HOSTILE_STDOUT_SENTINEL");
    expect(returnedArchiveText).not.toContain("HOSTILE_STDERR_SENTINEL");
    expect(returnedArchiveText).not.toContain(fixtureDirectory);
    expect(returnedArchiveText).not.toContain(templatePath);
  }, 15_000);

  it.each([
    ["nonzero", 3_000],
    ["signal", 3_000],
    ["timeout", 150],
    ["stdout-limit", 3_000],
    ["stderr-limit", 3_000],
    ["partial", 3_000],
    ["trailing", 3_000],
    ["post-conclusion", 3_000],
    ["direction", 3_000],
    ["sequence", 3_000],
    ["conclusion-nonzero", 3_000],
  ] as const)("returns no trial for hostile %s completion", async (mode, timeout) => {
    await expectNoCompletedRun(mode, timeout);
  }, 10_000);

  it("distinguishes clean protocol followed by a nonzero exit from completion", async () => {
    const error = await expectNoCompletedRun("conclusion-nonzero");
    expect(error).toMatchObject({ code: "bridge.child-exit-invalid" });
  });

  it("rejects a signaled child after staging its otherwise valid conclusion", async () => {
    const error = await expectNoCompletedRun("signal");
    expect(error).toMatchObject({ code: "bridge.child-exit-invalid" });
  });

  it.each(["stdout-limit", "stderr-limit"] as const)(
    "fails closed on the %s diagnostic cap",
    async (mode) => {
      const error = await expectNoCompletedRun(mode);
      expect(error).toMatchObject({ code: "bridge.diagnostic-limit" });
    },
  );

  it("fails closed when the target misses the process deadline", async () => {
    const error = await expectNoCompletedRun("timeout", 150);
    expect(error).toMatchObject({ code: "bridge.timeout" });
  });

  it.each(["partial", "trailing"] as const)(
    "rejects %s target-channel bytes as a truncated frame",
    async (mode) => {
      const error = await expectNoCompletedRun(mode);
      expect(error).toMatchObject({ code: "bridge.frame-truncated" });
    },
  );

  it("rejects target post-conclusion frames before committing the staged conclusion", async () => {
    const error = await expectNoCompletedRun("post-conclusion");
    expect(error).toMatchObject({ code: "bridge.target-post-conclusion-output" });
  });

  it("rejects a runner-direction frame emitted on the target channel", async () => {
    const error = await expectNoCompletedRun("direction");
    expect(error).toMatchObject({ code: "bridge.frame-contract-invalid" });
  });

  it("rejects a target frame with a valid shape but invalid sequence", async () => {
    const error = await expectNoCompletedRun("sequence");
    expect(error).toMatchObject({ code: "bridge.ready-invalid" });
  });
});
