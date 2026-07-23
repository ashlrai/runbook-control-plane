import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  FinancialBenchTargetV1,
  HarnessStimulusV1,
  RunnerOwnedInstrumentedChannelsV1,
} from "@runbook/financial-bench-harness";
import { canonicalizeJcs } from "./canonical.js";
import {
  dockerCreateArguments,
  normalizeAndVerifyDockerInspection,
  normalizeAndVerifyRuntimeImageInspection,
  SANDBOX_RUN_LABEL,
  type NormalizedDockerInspection,
} from "./docker-policy.js";
import { SANDBOX_LAUNCHER_SHA256, SANDBOX_LAUNCHER_SOURCE } from "./launcher.js";
import {
  SANDBOX_INSPECTION_POLICY,
  SANDBOX_POLICY_SHA256,
  SANDBOX_RUNTIME_IMAGE,
} from "./profile.js";
import type {
  SandboxEvidenceV1,
  SandboxPublicConfigurationV1,
  SandboxRuntimeEvidenceV1,
} from "./types.js";
import { sandboxLaunchBindingSha256 } from "./verify.js";
import {
  bootstrapBytes,
  encodeCanonicalFrame,
  LengthPrefixedFrameDecoder,
  MAX_STDERR_BYTES,
  SandboxProtocolError,
} from "./protocol.js";
import type { OwnedInput } from "./owned-input.js";

const CREATE_TIMEOUT_MS = 10_000;
const INSPECT_TIMEOUT_MS = 5_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const CLOSE_GRACE_MS = 250;
const KILL_TIMEOUT_MS = 5_000;
const REMOVE_TIMEOUT_MS = 5_000;
const COMMAND_OUTPUT_LIMIT = 256 * 1024;

export type SandboxSessionProcessOutcome =
  | "exited-zero"
  | "force-killed";

export type DockerSandboxSessionRecord = Readonly<{
  cleanupComplete: true;
  diagnosticSha256: string;
  environmentAcknowledgement: Readonly<{
    adapterContractSha256: string;
    bundleSha256: string;
    executionNonce: string;
    launchBindingSha256: string;
    publicConfigurationSha256: string;
  }>;
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
  processOutcome: SandboxSessionProcessOutcome;
}>;

type CommandResult = Readonly<{
  exitCode: number;
  stderr: Uint8Array;
  stdout: Uint8Array;
}>;

export class SandboxRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SandboxRuntimeError";
  }
}

function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedCommand(
  args: readonly string[],
  timeoutMs: number,
  allowFailure = false,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [...args], {
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finishError = (code: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new SandboxRuntimeError(code));
    };
    const timer = setTimeout(() => finishError("docker.command-timeout"), timeoutMs);
    child.once("error", () => finishError("docker.command-spawn-failed"));
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > COMMAND_OUTPUT_LIMIT) finishError("docker.command-output-limit");
      else stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > COMMAND_OUTPUT_LIMIT) finishError("docker.command-output-limit");
      else stderr.push(Buffer.from(chunk));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        exitCode: code ?? -1,
        stderr: new Uint8Array(Buffer.concat(stderr)),
        stdout: new Uint8Array(Buffer.concat(stdout)),
      };
      if (!allowFailure && result.exitCode !== 0) {
        reject(new SandboxRuntimeError("docker.command-failed"));
      } else resolve(result);
    });
  });
}

function strictUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SandboxRuntimeError("docker.output-invalid-utf8");
  }
}

function parseSingleJson(bytes: Uint8Array): Record<string, any> {
  try {
    const parsed = JSON.parse(strictUtf8(bytes)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, any>;
  } catch {
    throw new SandboxRuntimeError("docker.inspect-invalid-json");
  }
}

type DockerTerminalState = Readonly<{
  dead: boolean;
  error: string;
  exitCode: number;
  finishedAt: string;
  oomKilled: boolean;
  running: boolean;
}>;

function parseDockerTerminalState(value: Record<string, any>): DockerTerminalState {
  const state = value.State;
  if (
    state === null ||
    typeof state !== "object" ||
    typeof state.Dead !== "boolean" ||
    typeof state.Error !== "string" ||
    !Number.isInteger(state.ExitCode) ||
    typeof state.FinishedAt !== "string" ||
    typeof state.OOMKilled !== "boolean" ||
    typeof state.Running !== "boolean"
  ) {
    throw new SandboxRuntimeError("cleanup.terminal-state-invalid");
  }
  return Object.freeze({
    dead: state.Dead,
    error: state.Error,
    exitCode: state.ExitCode,
    finishedAt: state.FinishedAt,
    oomKilled: state.OOMKilled,
    running: state.Running,
  });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (canonicalizeJcs(Object.keys(value).sort()) !== canonicalizeJcs([...keys].sort())) {
    throw new SandboxProtocolError("protocol.unknown-frame-field");
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SandboxRuntimeError(code)), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export type CreateDockerSandboxSessionInput = Readonly<{
  adapter: OwnedInput;
  adapterContractSha256: string;
  configuration: OwnedInput;
  hostRunnerSha256: string;
  ordinal: number;
  publicConfiguration: SandboxPublicConfigurationV1;
}>;

export type DockerSandboxSession = Readonly<{
  inspection: NormalizedDockerInspection;
  runtime: SandboxRuntimeEvidenceV1;
  target: FinancialBenchTargetV1;
  close(): Promise<DockerSandboxSessionRecord>;
}>;

export async function createDockerSandboxSession(
  input: CreateDockerSandboxSessionInput,
): Promise<DockerSandboxSession> {
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0 || input.ordinal > 4) {
    throw new SandboxRuntimeError("session.ordinal-invalid");
  }
  const initialImageInspection = await boundedCommand(
    ["image", "inspect", "--format={{json .}}", SANDBOX_RUNTIME_IMAGE],
    INSPECT_TIMEOUT_MS,
  );
  const initialImageValue = parseSingleJson(initialImageInspection.stdout);
  const initialRuntime = normalizeAndVerifyRuntimeImageInspection(initialImageValue);
  const executionNonce = randomBytes(32).toString("hex");
  const launchIdentity: Pick<
    SandboxEvidenceV1,
    "adapter" | "policy" | "publicConfiguration" | "runner" | "runtime"
  > = {
    adapter: {
      adapterContractSha256: input.adapterContractSha256,
      adapterId: input.publicConfiguration.adapterId,
      bundleByteCount: input.adapter.byteCount,
      bundleSha256: input.adapter.sha256,
    },
    policy: {
      inspection: SANDBOX_INSPECTION_POLICY,
      inspectionSha256: sha256Bytes(canonicalizeJcs(SANDBOX_INSPECTION_POLICY)),
      policySha256: SANDBOX_POLICY_SHA256,
    },
    publicConfiguration: {
      bytesSha256: input.configuration.sha256,
      value: input.publicConfiguration,
    },
    runner: {
      hostRunnerSha256: input.hostRunnerSha256,
      launcherSha256: SANDBOX_LAUNCHER_SHA256,
    },
    runtime: initialRuntime,
  };
  const launchBindingSha256 = sandboxLaunchBindingSha256(launchIdentity, {
    executionNonce,
    ordinal: input.ordinal,
  });
  const runLabel = `${executionNonce}.${input.ordinal}`;
  let containerId: string | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let inspection: NormalizedDockerInspection | null = null;
  let runtime: SandboxRuntimeEvidenceV1 | null = null;
  let readyAcknowledgement: DockerSandboxSessionRecord["environmentAcknowledgement"] | null = null;
  let adapterReady = false;
  let closed = false;
  let closePromise: Promise<DockerSandboxSessionRecord> | null = null;
  let decisionResolve: ((value: unknown) => void) | null = null;
  let decisionReject: ((error: unknown) => void) | null = null;
  let activeChannels: RunnerOwnedInstrumentedChannelsV1 | null = null;
  let activeRun = false;
  let protocolState:
    | "await-bootstrap"
    | "await-ready"
    | "await-stimulus"
    | "running"
    | "terminal"
    | "closing" = "await-bootstrap";
  let expectedRpcSequence = 0;
  let protocolFailure: unknown = null;
  let processExited = false;
  let processExitCode: number | null = null;
  let processKilled = false;
  let attachSignal: NodeJS.Signals | null = null;
  let attachStarted = false;
  let resolveAttachClosed: (() => void) | null = null;
  const attachClosed = new Promise<void>((resolve) => {
    resolveAttachClosed = resolve;
  });
  const diagnostics: Buffer[] = [];
  let diagnosticBytes = 0;
  let processing = Promise.resolve();
  let attachHandlers: ((running: ChildProcessWithoutNullStreams) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    const decoder = new LengthPrefixedFrameDecoder();
    const rejectAll = (error: unknown) => {
      protocolFailure ??= error;
      reject(error);
      decisionReject?.(error);
    };
    const writeFrame = (value: unknown) => {
      if (child === null || child.stdin.destroyed) throw new SandboxRuntimeError("session.stdin-closed");
      child.stdin.write(encodeCanonicalFrame(value));
    };
    const processFrame = async (frame: Record<string, unknown>) => {
      if (frame.executionNonce !== executionNonce || frame.launchBindingSha256 !== launchBindingSha256) {
        throw new SandboxProtocolError("protocol.binding-mismatch");
      }
      if (frame.type === "bootstrap-ack") {
        exactKeys(frame, ["adapterContractSha256", "bundleSha256", "configurationSha256", "executionNonce", "launchBindingSha256", "schemaVersion", "type"]);
        if (
          protocolState !== "await-bootstrap" ||
          readyAcknowledgement !== null ||
          frame.schemaVersion !== "runbook.financial-agent-sandbox-protocol-bootstrap-ack.v1" ||
          frame.adapterContractSha256 !== input.adapterContractSha256 ||
          frame.bundleSha256 !== input.adapter.sha256 ||
          frame.configurationSha256 !== input.configuration.sha256
        ) throw new SandboxProtocolError("protocol.ready-invalid");
        readyAcknowledgement = Object.freeze({
          adapterContractSha256: input.adapterContractSha256,
          bundleSha256: input.adapter.sha256,
          executionNonce,
          launchBindingSha256,
          publicConfigurationSha256: input.configuration.sha256,
        });
        protocolState = "await-ready";
        return;
      }
      if (frame.type === "ready") {
        exactKeys(frame, ["executionNonce", "launchBindingSha256", "schemaVersion", "type"]);
        if (
          protocolState !== "await-ready" ||
          readyAcknowledgement === null ||
          adapterReady ||
          frame.schemaVersion !== "runbook.financial-agent-sandbox-protocol-ready.v1"
        ) throw new SandboxProtocolError("protocol.ready-invalid");
        adapterReady = true;
        protocolState = "await-stimulus";
        resolve();
        return;
      }
      if (frame.type === "tool-call" || frame.type === "approval-request") {
        exactKeys(frame, ["executionNonce", "input", "launchBindingSha256", "requestId", "schemaVersion", "type"]);
        const expectedRequestId = `rpc-${String(expectedRpcSequence).padStart(4, "0")}`;
        if (
          !activeRun ||
          activeChannels === null ||
          (protocolState !== "running" && protocolState !== "terminal") ||
          frame.schemaVersion !== "runbook.financial-agent-sandbox-protocol-rpc.v1" ||
          frame.requestId !== expectedRequestId
        ) {
          throw new SandboxProtocolError("protocol.rpc-invalid");
        }
        expectedRpcSequence += 1;
        const result = frame.type === "tool-call"
          ? await activeChannels.call(frame.input)
          : await activeChannels.requestApproval(frame.input);
        writeFrame({
          executionNonce,
          launchBindingSha256,
          requestId: frame.requestId,
          result,
          schemaVersion: "runbook.financial-agent-sandbox-protocol-rpc.v1",
          type: frame.type === "tool-call" ? "tool-result" : "approval-result",
        });
        return;
      }
      if (frame.type === "decision") {
        exactKeys(frame, ["decision", "executionNonce", "launchBindingSha256", "ok", "schemaVersion", "type"]);
        if (
          !activeRun ||
          protocolState !== "running" ||
          frame.schemaVersion !== "runbook.financial-agent-sandbox-protocol-decision.v1" ||
          typeof frame.ok !== "boolean"
        ) {
          throw new SandboxProtocolError("protocol.decision-invalid");
        }
        protocolState = "terminal";
        if (frame.ok) decisionResolve?.(frame.decision);
        else decisionReject?.(new SandboxRuntimeError("adapter.run-failed"));
        decisionResolve = null;
        decisionReject = null;
        return;
      }
      throw new SandboxProtocolError("protocol.message-type-invalid");
    };
    attachHandlers = (running: ChildProcessWithoutNullStreams) => {
      running.stdout.on("data", (chunk: Buffer) => {
        try {
          for (const frame of decoder.push(new Uint8Array(chunk))) {
            processing = processing.then(() => processFrame(frame));
            processing.catch(rejectAll);
          }
        } catch (error) {
          rejectAll(error);
        }
      });
      running.stderr.on("data", (chunk: Buffer) => {
        const remaining = MAX_STDERR_BYTES - diagnosticBytes;
        if (remaining > 0) {
          const owned = Buffer.from(chunk.subarray(0, remaining));
          diagnostics.push(owned);
          diagnosticBytes += owned.byteLength;
        }
        if (chunk.byteLength > remaining) rejectAll(new SandboxRuntimeError("session.stderr-limit-exceeded"));
      });
      running.once("error", () => rejectAll(new SandboxRuntimeError("session.attach-failed")));
      running.once("close", (code, signal) => {
        processExited = true;
        processExitCode = code;
        attachSignal = signal;
        resolveAttachClosed?.();
        resolveAttachClosed = null;
        try { decoder.finish(); } catch (error) { rejectAll(error); }
        if (protocolState === "closing" && decisionReject !== null) {
          const rejectDecision = decisionReject;
          decisionResolve = null;
          decisionReject = null;
          rejectDecision(new SandboxRuntimeError("session.closed-by-runner"));
        } else if (!adapterReady || decisionReject !== null) {
          rejectAll(new SandboxRuntimeError("session.exited-before-terminal"));
        }
      });
    };
  });

  const auditAndRecoverByLabel = async (settleWindowMs = 0): Promise<void> => {
    const deadline = Date.now() + settleWindowMs;
    do {
      const listing = await boundedCommand(
        ["ps", "-a", "--filter", `label=${SANDBOX_RUN_LABEL}=${runLabel}`, "--format", "{{.ID}}"],
        INSPECT_TIMEOUT_MS,
      );
      const ids = strictUtf8(listing.stdout).trim().split("\n").filter(Boolean);
      for (const id of ids) {
        if (!/^[0-9a-f]{12,64}$/.test(id)) {
          throw new SandboxRuntimeError("cleanup.recovery-id-invalid");
        }
        const inspected = await boundedCommand(
          ["inspect", "--format={{json .}}", id],
          INSPECT_TIMEOUT_MS,
        );
        const value = parseSingleJson(inspected.stdout);
        if (
          value.Config?.Labels?.[SANDBOX_RUN_LABEL] !== runLabel ||
          value.Config?.Labels?.["runbook.sandbox-binding"] !== launchBindingSha256
        ) {
          throw new SandboxRuntimeError("cleanup.recovery-identity-mismatch");
        }
        await boundedCommand(["rm", "--force", String(value.Id)], REMOVE_TIMEOUT_MS);
      }
      if (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } while (Date.now() < deadline);
    const audit = await boundedCommand(
      ["ps", "-a", "--filter", `label=${SANDBOX_RUN_LABEL}=${runLabel}`, "--format", "{{.ID}}"],
      INSPECT_TIMEOUT_MS,
    );
    if (strictUtf8(audit.stdout).trim() !== "") {
      throw new SandboxRuntimeError("cleanup.orphan-present");
    }
  };

  const safeCleanup = async (force: boolean): Promise<SandboxSessionProcessOutcome> => {
    if (containerId === null) throw new SandboxRuntimeError("cleanup.container-id-missing");
    let cleanupFailure: unknown = null;
    let killCommandFailed = false;
    if (!processExited) {
      if (!force) {
        await new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS));
      }
      if (!processExited) {
        try {
          const killed = await boundedCommand(["kill", containerId], KILL_TIMEOUT_MS, true);
          if (killed.exitCode !== 0) killCommandFailed = true;
          else processKilled = true;
        } catch {
          // The attach stream can report exit after Docker has already made the
          // container terminal. Defer classifying a failed kill until inspect
          // distinguishes that benign race from a still-running container. A
          // command infrastructure failure must not bypass removal and audit.
          killCommandFailed = true;
        }
      }
    }
    if (attachStarted) {
      try {
        await withTimeout(attachClosed, KILL_TIMEOUT_MS, "cleanup.attach-not-reaped");
      } catch (error) {
        child?.kill("SIGKILL");
        try {
          await withTimeout(attachClosed, KILL_TIMEOUT_MS, "cleanup.attach-not-reaped");
        } catch {
          cleanupFailure ??= error;
        }
      }
      try {
        await withTimeout(processing, KILL_TIMEOUT_MS, "cleanup.processing-not-settled");
      } catch (error) {
        cleanupFailure ??= error;
      }
      if (protocolFailure !== null) cleanupFailure ??= protocolFailure;
    }
    let processOutcome: SandboxSessionProcessOutcome | null = null;
    try {
      const beforeRemove = await boundedCommand(
        ["inspect", "--format={{json .}}", containerId],
        INSPECT_TIMEOUT_MS,
      );
      const inspected = parseSingleJson(beforeRemove.stdout);
      if (
        inspected.Config?.Labels?.[SANDBOX_RUN_LABEL] !== runLabel ||
        inspected.Config?.Labels?.["runbook.sandbox-binding"] !== launchBindingSha256 ||
        inspected.Id !== containerId
      ) {
        throw new SandboxRuntimeError("cleanup.identity-mismatch");
      }
      const terminal = parseDockerTerminalState(inspected);
      if (terminal.running) {
        throw new SandboxRuntimeError(
          killCommandFailed ? "cleanup.kill-failed" : "cleanup.container-still-running",
        );
      }
      if (terminal.dead) throw new SandboxRuntimeError("cleanup.container-dead-state");
      if (terminal.oomKilled) throw new SandboxRuntimeError("session.container-oom-killed");
      if (terminal.error !== "") throw new SandboxRuntimeError("session.container-runtime-error");
      if (terminal.finishedAt === "" || terminal.finishedAt.startsWith("0001-01-01")) {
        throw new SandboxRuntimeError("cleanup.finished-at-invalid");
      }
      if (attachSignal !== null || processExitCode === null || processExitCode !== terminal.exitCode) {
        throw new SandboxRuntimeError("cleanup.exit-observation-mismatch");
      }
      if (terminal.exitCode === 0 && !processKilled) {
        processOutcome = "exited-zero";
      } else if (terminal.exitCode === 137 && processKilled) {
        processOutcome = "force-killed";
      } else if (terminal.exitCode !== 0) {
        throw new SandboxRuntimeError("session.container-exited-nonzero");
      } else {
        throw new SandboxRuntimeError("cleanup.kill-observation-mismatch");
      }
    } catch (error) {
      cleanupFailure ??= error;
    }
    try {
      await boundedCommand(["rm", "--force", containerId], REMOVE_TIMEOUT_MS);
    } catch (error) {
      cleanupFailure ??= error;
    }
    try {
      await auditAndRecoverByLabel();
    } catch (error) {
      if (cleanupFailure !== null) {
        throw new AggregateError(
          [cleanupFailure, error],
          "sandbox.direct-and-label-cleanup-failed",
        );
      }
      throw error;
    }
    if (cleanupFailure !== null) throw cleanupFailure;
    if (processOutcome === null) throw new SandboxRuntimeError("cleanup.process-outcome-missing");
    return processOutcome;
  };

  try {
    const created = await boundedCommand(
      dockerCreateArguments({ launchBindingSha256, launcherSource: SANDBOX_LAUNCHER_SOURCE, runLabel }),
      CREATE_TIMEOUT_MS,
    );
    containerId = strictUtf8(created.stdout).trim();
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new SandboxRuntimeError("docker.container-id-invalid");
    const [containerInspection, imageInspection] = await Promise.all([
      boundedCommand(["inspect", "--format={{json .}}", containerId], INSPECT_TIMEOUT_MS),
      boundedCommand(
        ["image", "inspect", "--format={{json .}}", SANDBOX_RUNTIME_IMAGE],
        INSPECT_TIMEOUT_MS,
      ),
    ]);
    const containerValue = parseSingleJson(containerInspection.stdout);
    const imageValue = parseSingleJson(imageInspection.stdout);
    inspection = normalizeAndVerifyDockerInspection(
      containerValue,
      imageValue,
      runLabel,
      launchBindingSha256,
      SANDBOX_LAUNCHER_SOURCE,
    );
    runtime = normalizeAndVerifyRuntimeImageInspection(imageValue);
    if (canonicalizeJcs(runtime) !== canonicalizeJcs(initialRuntime)) {
      throw new SandboxRuntimeError("sandbox.runtime-image-drift");
    }
    child = spawn("docker", ["start", "--attach", "--interactive", containerId], {
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    attachStarted = true;
    if (attachHandlers === undefined) throw new SandboxRuntimeError("session.internal-handler-missing");
    attachHandlers(child);
    child.stdin.write(bootstrapBytes({
      adapterByteCount: input.adapter.byteCount,
      adapterContractSha256: input.adapterContractSha256,
      adapterSha256: input.adapter.sha256,
      configurationByteCount: input.configuration.byteCount,
      configurationSha256: input.configuration.sha256,
      executionNonce,
      launchBindingSha256,
      schemaVersion: "runbook.financial-agent-sandbox-protocol-init.v1",
      type: "init",
    }, input.adapter.bytes, input.configuration.bytes));
    await withTimeout(readyPromise, HANDSHAKE_TIMEOUT_MS, "session.handshake-timeout");
  } catch (error) {
    if (containerId !== null) {
      try { await safeCleanup(true); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "sandbox.start-and-cleanup-failed");
      }
    } else {
      try { await auditAndRecoverByLabel(2_000); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "sandbox.create-and-recovery-failed");
      }
    }
    throw error;
  }

  const target: FinancialBenchTargetV1 = Object.freeze({
    async run(
      stimulus: HarnessStimulusV1,
      channels: RunnerOwnedInstrumentedChannelsV1,
      signal: AbortSignal,
    ): Promise<unknown> {
      if (
        activeRun ||
        closed ||
        child === null ||
        protocolState !== "await-stimulus"
      ) throw new SandboxRuntimeError("session.run-state-invalid");
      if (signal.aborted) throw new SandboxRuntimeError("session.run-aborted-before-start");
      activeRun = true;
      protocolState = "running";
      activeChannels = channels;
      const result = new Promise<unknown>((resolve, reject) => {
        decisionResolve = resolve;
        decisionReject = reject;
      });
      child.stdin.write(encodeCanonicalFrame({
        executionNonce,
        launchBindingSha256,
        schemaVersion: "runbook.financial-agent-sandbox-protocol-stimulus.v1",
        stimulus,
        type: "stimulus",
      }));
      return result;
    },
  });

  return Object.freeze({
    inspection: inspection as NormalizedDockerInspection,
    runtime: runtime as SandboxRuntimeEvidenceV1,
    target,
    close(): Promise<DockerSandboxSessionRecord> {
      if (closePromise !== null) return closePromise;
      closed = true;
      closePromise = (async () => {
        let preCleanupFailure: unknown = null;
        try {
          await withTimeout(processing, 1_000, "cleanup.processing-not-settled");
        } catch (error) {
          preCleanupFailure = error;
        }
        protocolState = "closing";
        let processOutcome: SandboxSessionProcessOutcome;
        try {
          processOutcome = await safeCleanup(false);
        } catch (cleanupError) {
          if (preCleanupFailure !== null) {
            throw new AggregateError(
              [preCleanupFailure, cleanupError],
              "sandbox.protocol-and-cleanup-failed",
            );
          }
          throw cleanupError;
        }
        if (preCleanupFailure !== null) throw preCleanupFailure;
        activeChannels = null;
        const acknowledgement = readyAcknowledgement;
        if (acknowledgement === null) throw new SandboxRuntimeError("session.ready-missing");
        if (protocolFailure !== null) throw protocolFailure;
        return Object.freeze({
          cleanupComplete: true as const,
          diagnosticSha256: sha256Bytes(Buffer.concat(diagnostics)),
          environmentAcknowledgement: acknowledgement,
          executionNonce,
          launchBindingSha256,
          lifecycle: ["created", "policy-inspected", "ready", "scenario-closed", "removed"] as const,
          ordinal: input.ordinal,
          orphanAuditPassed: true as const,
          processOutcome,
        });
      })();
      return closePromise;
    },
  });
}
