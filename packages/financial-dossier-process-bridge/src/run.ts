import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import {
  FRAME_SCHEMA,
  canonicalizeAdapterJcs,
  createRunnerToTargetFrameV2,
  type RunnerToTargetFrameV2,
  type TargetToRunnerFrameV2,
} from "@runbook/financial-dossier-adapter";
import { sha256AdapterJcs } from "@runbook/financial-dossier-adapter";
import {
  ObservedHostSessionV2,
  RunnerOwnedRecoveryJournalV2,
  type RunnerIdentityV2,
  type SealedHostTrialV2,
} from "@runbook/financial-dossier-harness/private/runner";
import { CommonSubjectAlgorithmV2 } from "./common-subject.js";
import { encodeRunnerFrame, ProcessFrameError, TargetFrameDecoder } from "./framing.js";
import { copyOwnedTargetBytes, type OwnedPinnedTargetModule } from "./owned-target.js";
import {
  bindProcessAttempt,
  serializeProcessAttempt,
  sha256ProcessBytes,
  verifyAttemptedCrashProcessAttempt,
  verifyCompletedProcessAttempt,
} from "./process-attempt.js";
import {
  FINANCE_030_CRASH_BRANCHES,
  PROCESS_ATTEMPT_LIMITATIONS,
  PROCESS_ATTEMPT_SCHEMA,
  PROCESS_BRIDGE_ATTEMPTED_CRASH_PROFILE,
  PROCESS_BRIDGE_PROFILE,
  PROCESS_BRIDGED_PRIMARY_CRASH_BRANCHES,
  PROCESS_BRIDGED_RECOVER_TRIAL_IDS,
  PROCESS_BRIDGED_SCENARIO_IDS,
  attemptedCrashEventProgram,
  completedEventProgram,
  MAX_COMPLETED_REQUEST_COUNT,
  type AttemptedCrashProcessRunV2,
  type CompletedProcessRunV2,
  type Finance030CrashBranch,
  type ProcessBridgedPrimaryCrashBranch,
  type ProcessBridgedRecoverTrialId,
  type ProcessBridgedScenarioId,
  type ProcessAttemptV2,
  type ProcessEventCode,
} from "./types.js";

const DEFAULT_TIMEOUT_MILLISECONDS = 3_000;
const MAX_DIAGNOSTIC_BYTES = 65_536;
const textEncoder = new TextEncoder();

export class ProcessBridgeRunError extends Error {
  override readonly name = "ProcessBridgeRunError";
  constructor(readonly code: string, options?: ErrorOptions) {
    super(code, options);
  }
}

export type RunCompletedProcessInput = Readonly<{
  identity: RunnerIdentityV2;
  target: OwnedPinnedTargetModule;
  scenarioId: ProcessBridgedScenarioId;
  timeoutMilliseconds?: number;
}>;

/** @deprecated Prefer RunCompletedProcessInput with scenarioId. */
export type RunFinance000ProcessInput = Readonly<{
  identity: RunnerIdentityV2;
  target: OwnedPinnedTargetModule;
  timeoutMilliseconds?: number;
}>;

/**
 * Host-seeded recover-mode process input. The recovery journal must already
 * reflect the corresponding host-only primary crash branch; this runner does
 * not perform kill/crash semantics.
 */
export type RunFinance030RecoverProcessInput = Readonly<{
  identity: RunnerIdentityV2;
  target: OwnedPinnedTargetModule;
  trialId: ProcessBridgedRecoverTrialId;
  recoveryJournal: RunnerOwnedRecoveryJournalV2;
  proposalNonce: string;
  runnerSecretNonce: string;
  timeoutMilliseconds?: number;
}>;

/**
 * Process-bridged primary crash input. Only before-claim is shipped; the runner
 * injects crash at submit-action and kills the child without writing a result.
 */
export type RunFinance030PrimaryCrashProcessInput = Readonly<{
  identity: RunnerIdentityV2;
  target: OwnedPinnedTargetModule;
  branch: ProcessBridgedPrimaryCrashBranch;
  proposalNonce?: string;
  runnerSecretNonce?: string;
  recoveryJournal?: RunnerOwnedRecoveryJournalV2;
  timeoutMilliseconds?: number;
}>;

type SessionScenarioId = ProcessBridgedScenarioId | "finance-030-crash-around-idempotency-claim";

type InternalRunInput = Readonly<{
  identity: RunnerIdentityV2;
  target: OwnedPinnedTargetModule;
  scenarioId: SessionScenarioId;
  trialId: "primary" | ProcessBridgedRecoverTrialId;
  recoveryJournal: RunnerOwnedRecoveryJournalV2 | null;
  sessionNonce: string;
  proposalNonce: string;
  runnerSecretNonce: string;
  timeoutMilliseconds?: number;
}>;

type ExitRecord = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;

class EventLog {
  readonly values: Array<Readonly<{ code: ProcessEventCode; sequence: number }>> = [];
  add(code: ProcessEventCode): void {
    this.values.push(Object.freeze({ code, sequence: this.values.length }));
  }
}

class DigestingDiagnostic {
  readonly hash = createHash("sha256");
  byteCount = 0;
  overflow = false;
  push(chunk: Uint8Array): void {
    this.byteCount += chunk.byteLength;
    if (this.byteCount > MAX_DIAGNOSTIC_BYTES) {
      this.overflow = true;
      throw new ProcessBridgeRunError("bridge.diagnostic-limit");
    }
    this.hash.update(chunk);
  }
  digest(): string { return this.hash.digest("hex"); }
}

class TargetFrameQueue {
  readonly decoder = new TargetFrameDecoder();
  readonly chunks: Uint8Array[] = [];
  #frames: TargetToRunnerFrameV2[] = [];
  #waiters: Array<{
    resolve: (frame: TargetToRunnerFrameV2) => void;
    reject: (error: Error) => void;
  }> = [];
  #ended = false;
  #error: Error | null = null;

  constructor(stream: Readable) {
    stream.on("data", (chunk: Buffer) => {
      if (this.#error !== null) return;
      const owned = Uint8Array.from(chunk);
      this.chunks.push(owned);
      try {
        for (const frame of this.decoder.push(owned)) this.#deliver(frame);
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error("bridge.frame-error"));
      }
    });
    stream.once("error", (error) => this.#fail(error));
    stream.once("end", () => {
      if (this.#error !== null) return;
      try {
        this.decoder.finish();
        this.#ended = true;
        this.#rejectWaiters(new ProcessBridgeRunError("bridge.target-premature-eof"));
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error("bridge.frame-truncated"));
      }
    });
  }

  async next(): Promise<TargetToRunnerFrameV2> {
    if (this.#frames.length > 0) return this.#frames.shift()!;
    if (this.#error !== null) throw this.#error;
    if (this.#ended) throw new ProcessBridgeRunError("bridge.target-premature-eof");
    return await new Promise<TargetToRunnerFrameV2>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  assertCleanEof(): void {
    if (this.#error !== null) throw this.#error;
    if (!this.#ended || this.#frames.length !== 0) {
      throw new ProcessBridgeRunError("bridge.target-post-conclusion-output");
    }
  }

  #deliver(frame: TargetToRunnerFrameV2): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#frames.push(frame);
    else waiter.resolve(frame);
  }
  #fail(error: Error): void {
    this.#error = error;
    this.#rejectWaiters(error);
  }
  #rejectWaiters(error: Error): void {
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function write(stream: Writable, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(Buffer.from(bytes), (error) => error === null || error === undefined
      ? resolve()
      : reject(new ProcessBridgeRunError("bridge.channel-write-failed", { cause: error })));
  });
}

function closeWriter(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => error === null || error === undefined
      ? resolve()
      : reject(new ProcessBridgeRunError("bridge.channel-close-failed", { cause: error })));
  });
}

function killProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct child. The run still fails closed.
    }
  }
  try { child.kill("SIGKILL"); } catch { /* best effort followed by close wait */ }
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new ProcessBridgeRunError("bridge.timeout"));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProcessBridgeRunError("bridge.timeout")), remaining);
    timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function exactEventProgram(events: EventLog, requestCount: number): void {
  const expected = completedEventProgram(requestCount);
  if (events.values.length !== expected.length ||
      events.values.some((event, index) => event.code !== expected[index])) {
    throw new ProcessBridgeRunError("bridge.internal-event-program-invalid");
  }
}

function exactAttemptedCrashEventProgram(
  events: EventLog,
  completedRequestResultPairs: number,
): void {
  const expected = attemptedCrashEventProgram(completedRequestResultPairs);
  if (events.values.length !== expected.length ||
      events.values.some((event, index) => event.code !== expected[index])) {
    throw new ProcessBridgeRunError("bridge.internal-event-program-invalid");
  }
}

function assertProcessBridgedScenario(scenarioId: string): asserts scenarioId is ProcessBridgedScenarioId {
  if (!(PROCESS_BRIDGED_SCENARIO_IDS as readonly string[]).includes(scenarioId)) {
    throw new ProcessBridgeRunError("bridge.scenario-unsupported");
  }
}

function assertRecoverTrialId(trialId: string): asserts trialId is ProcessBridgedRecoverTrialId {
  if (!(PROCESS_BRIDGED_RECOVER_TRIAL_IDS as readonly string[]).includes(trialId)) {
    throw new ProcessBridgeRunError("bridge.recover-trial-unsupported");
  }
}

function assertPrimaryCrashBranch(
  branch: string,
): asserts branch is ProcessBridgedPrimaryCrashBranch {
  if (!(PROCESS_BRIDGED_PRIMARY_CRASH_BRANCHES as readonly string[]).includes(branch)) {
    throw new ProcessBridgeRunError("bridge.primary-crash-branch-unsupported");
  }
}

function assertHexNonce(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new ProcessBridgeRunError(code);
}

/**
 * Host-only: drive the common subject through a finance-030 primary crash so
 * the recovery journal holds the branch head that a recover-mode process run
 * must continue from. Does not spawn a child process.
 */
export function hostSeedFinance030PrimaryCrash(
  identity: RunnerIdentityV2,
  branch: Finance030CrashBranch,
  proposalNonce: string,
  runnerSecretNonce: string,
): Readonly<{
  journal: RunnerOwnedRecoveryJournalV2;
  primary: SealedHostTrialV2;
  branch: Finance030CrashBranch;
  recoveryTrialId: ProcessBridgedRecoverTrialId;
}> {
  if (!(FINANCE_030_CRASH_BRANCHES as readonly string[]).includes(branch)) {
    throw new ProcessBridgeRunError("bridge.crash-branch-unsupported");
  }
  assertHexNonce(proposalNonce, "bridge.proposal-nonce-invalid");
  assertHexNonce(runnerSecretNonce, "bridge.runner-secret-nonce-invalid");
  const journal = new RunnerOwnedRecoveryJournalV2();
  const session = new ObservedHostSessionV2(
    "finance-030-crash-around-idempotency-claim",
    `${branch}-primary`,
    identity,
    randomBytes(32).toString("hex"),
    proposalNonce,
    runnerSecretNonce,
    journal,
  );
  const subject = new CommonSubjectAlgorithmV2();
  subject.acceptChallenge({
    challengeBindingSha256: session.context.challengeBindingSha256,
    initialTraceHeadSha256: session.context.initialTraceHeadSha256,
    proposedAction: session.context.proposedAction,
    proposedActionBindingSha256: session.context.actionBindingSha256,
    sessionBindingSha256: session.context.sessionBindingSha256,
    task: session.context.task,
  });
  for (let guard = 0; guard < 16; guard += 1) {
    const step = subject.nextStep();
    if (step.kind === "conclusion") {
      throw new ProcessBridgeRunError("bridge.host-seed-unexpected-conclusion");
    }
    const request = subject.materializeRequest(
      step,
      session.targetTraceHeadSha256,
      (payload) => sha256AdapterJcs(payload),
    );
    if (request.operation === "submit-action") {
      session.ingestRequestAndInjectCrash(request);
      const primary = session.seal("injected-crash");
      return Object.freeze({
        journal,
        primary,
        branch,
        recoveryTrialId: `${branch}-recovery` as ProcessBridgedRecoverTrialId,
      });
    }
    const result = session.ingestRequest(request);
    subject.acceptResult(result);
  }
  throw new ProcessBridgeRunError("bridge.host-seed-step-limit");
}

function canonicalTrialBytes(trial: SealedHostTrialV2): Uint8Array {
  // The trial is produced from runner-owned frozen values. The process verifier
  // re-owns and checks these exact bytes before relating them to the attempt.
  return textEncoder.encode(canonicalizeAdapterJcs(trial));
}

/**
 * Run one process-bridged completed lifecycle. The runner loops request↔result
 * until the target concludes, then terminates and commits only after clean EOF
 * and a successful reaped child exit.
 */
export async function runCompletedProcess(
  input: RunCompletedProcessInput,
): Promise<CompletedProcessRunV2> {
  assertProcessBridgedScenario(input.scenarioId);
  return runCompletedProcessLifecycle({
    identity: input.identity,
    target: input.target,
    scenarioId: input.scenarioId,
    trialId: "primary",
    recoveryJournal: null,
    sessionNonce: randomBytes(32).toString("hex"),
    proposalNonce: randomBytes(32).toString("hex"),
    runnerSecretNonce: randomBytes(32).toString("hex"),
    ...(input.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: input.timeoutMilliseconds }
      : {}),
  });
}

/**
 * Process-bridge one finance-030 recovery trial under the completed multi-request
 * grammar. Callers must seed the journal first via host-only primary crash
 * (`hostSeedFinance030PrimaryCrash`) or process-bridged before-claim primary
 * (`runFinance030PrimaryCrashProcess`), and share proposal/secret nonces.
 */
export async function runFinance030RecoverProcess(
  input: RunFinance030RecoverProcessInput,
): Promise<CompletedProcessRunV2> {
  assertRecoverTrialId(input.trialId);
  assertHexNonce(input.proposalNonce, "bridge.proposal-nonce-invalid");
  assertHexNonce(input.runnerSecretNonce, "bridge.runner-secret-nonce-invalid");
  if (!(input.recoveryJournal instanceof RunnerOwnedRecoveryJournalV2)) {
    throw new ProcessBridgeRunError("bridge.recovery-journal-invalid");
  }
  return runCompletedProcessLifecycle({
    identity: input.identity,
    target: input.target,
    scenarioId: "finance-030-crash-around-idempotency-claim",
    trialId: input.trialId,
    recoveryJournal: input.recoveryJournal,
    sessionNonce: randomBytes(32).toString("hex"),
    proposalNonce: input.proposalNonce,
    runnerSecretNonce: input.runnerSecretNonce,
    ...(input.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: input.timeoutMilliseconds }
      : {}),
  });
}

/**
 * Process-bridge one finance-030 primary crash trial under the attempted-crash
 * grammar. Ships before-claim only: common subject runs through preview and
 * approval, host injects crash on submit-action without writing a channel-result,
 * then the runner kills the process group and seals terminalClass injected-crash.
 */
export async function runFinance030PrimaryCrashProcess(
  input: RunFinance030PrimaryCrashProcessInput,
): Promise<AttemptedCrashProcessRunV2> {
  assertPrimaryCrashBranch(input.branch);
  const proposalNonce = input.proposalNonce ?? randomBytes(32).toString("hex");
  const runnerSecretNonce = input.runnerSecretNonce ?? randomBytes(32).toString("hex");
  assertHexNonce(proposalNonce, "bridge.proposal-nonce-invalid");
  assertHexNonce(runnerSecretNonce, "bridge.runner-secret-nonce-invalid");
  const recoveryJournal = input.recoveryJournal ?? new RunnerOwnedRecoveryJournalV2();
  if (!(recoveryJournal instanceof RunnerOwnedRecoveryJournalV2)) {
    throw new ProcessBridgeRunError("bridge.recovery-journal-invalid");
  }

  const timeout = input.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000) {
    throw new ProcessBridgeRunError("bridge.timeout-invalid");
  }
  const targetBytes = copyOwnedTargetBytes(input.target);
  const loaderBytes = new Uint8Array(readFileSync(new URL("./loader.mjs", import.meta.url)));
  let loaderSource: string;
  try {
    loaderSource = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(loaderBytes);
  } catch (error) {
    throw new ProcessBridgeRunError("bridge.loader-utf8-invalid", { cause: error });
  }
  const deadline = Date.now() + timeout;
  const trialId = `${input.branch}-primary` as const;
  const session = new ObservedHostSessionV2(
    "finance-030-crash-around-idempotency-claim",
    trialId,
    input.identity,
    randomBytes(32).toString("hex"),
    proposalNonce,
    runnerSecretNonce,
    recoveryJournal,
    input.target.sha256,
  );
  const [sessionOpen, challenge] = session.deriveImmutableOpeningFrames();
  const events = new EventLog();
  const runnerChunks: Uint8Array[] = [];
  events.add("target-owned");

  const child = spawn(process.execPath, [
    "--no-warnings",
    "--input-type=module",
    "--eval",
    loaderSource,
  ], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: {},
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  events.add("spawned");
  const stdout = new DigestingDiagnostic();
  const stderr = new DigestingDiagnostic();
  let streamFailure: ProcessBridgeRunError | null = null;
  const failStream = (code: string, error: Error): void => {
    streamFailure ??= error instanceof ProcessBridgeRunError
      ? error
      : new ProcessBridgeRunError(code, { cause: error });
    killProcessGroup(child);
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    try { stdout.push(chunk); } catch (error) {
      failStream("bridge.diagnostic-stream-invalid", error as Error);
    }
  });
  child.stdout!.on("error", (error) => failStream("bridge.diagnostic-stream-error", error));
  child.stderr!.on("data", (chunk: Buffer) => {
    try { stderr.push(chunk); } catch (error) {
      failStream("bridge.diagnostic-stream-invalid", error as Error);
    }
  });
  child.stderr!.on("error", (error) => failStream("bridge.diagnostic-stream-error", error));
  const extraStdio = child.stdio as unknown as Array<Readable | Writable | null | undefined>;
  const moduleWriter = extraStdio[3] as Writable;
  const runnerWriter = extraStdio[4] as Writable;
  const targetReader = extraStdio[5] as Readable;
  moduleWriter.on("error", (error) => failStream("bridge.channel-stream-error", error));
  runnerWriter.on("error", (error) => failStream("bridge.channel-stream-error", error));
  const targetQueue = new TargetFrameQueue(targetReader);
  const exitPromise = new Promise<ExitRecord>((resolve, reject) => {
    child.once("error", (error) => reject(new ProcessBridgeRunError("bridge.spawn-failed", { cause: error })));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const closePromise = new Promise<void>((resolve) => child.once("close", () => resolve()));

  let runnerSequence = 0;
  const send = async (frame: RunnerToTargetFrameV2): Promise<void> => {
    const bytes = encodeRunnerFrame(frame);
    runnerChunks.push(bytes);
    await withDeadline(write(runnerWriter, bytes), deadline);
  };

  let killAttempted = false;
  try {
    await withDeadline(write(moduleWriter, targetBytes), deadline);
    await withDeadline(closeWriter(moduleWriter), deadline);
    events.add("target-bytes-written");
    await send(sessionOpen);
    runnerSequence = 1;
    events.add("session-open-written");

    const ready = await withDeadline(targetQueue.next(), deadline);
    if (ready.sequence !== 0 || ready.type !== "ready" ||
        ready.value.sessionBindingSha256 !== session.context.sessionBindingSha256) {
      throw new ProcessBridgeRunError("bridge.ready-invalid");
    }
    events.add("ready-received");
    await send(challenge);
    runnerSequence = 2;
    events.add("challenge-written");

    // Complete preview + approval pairs, then inject crash on submit-action.
    let completedPairs = 0;
    let targetSequence = 1;
    let crashed = false;
    while (!crashed) {
      const frame = await withDeadline(targetQueue.next(), deadline);
      if (frame.sequence !== targetSequence) {
        throw new ProcessBridgeRunError("bridge.target-sequence-invalid");
      }
      if (frame.type !== "channel-request") {
        throw new ProcessBridgeRunError("bridge.target-frame-unexpected");
      }
      if (completedPairs >= MAX_COMPLETED_REQUEST_COUNT - 1) {
        throw new ProcessBridgeRunError("bridge.request-limit");
      }
      targetSequence += 1;
      events.add("request-received");

      if (frame.value.operation === "submit-action") {
        // Fail closed on any pre-crash stream fault before mutating the journal.
        if (streamFailure !== null) throw streamFailure;
        // Host crash boundary: observe submit, advance journal, no channel-result.
        session.ingestRequestAndInjectCrash(frame.value);
        killAttempted = true;
        killProcessGroup(child);
        events.add("kill-attempted");
        crashed = true;
        break;
      }

      const result = session.ingestRequest(frame.value);
      const resultFrame = createRunnerToTargetFrameV2({
        schemaVersion: FRAME_SCHEMA,
        sequence: runnerSequence,
        type: "channel-result",
        value: result,
      });
      await send(resultFrame);
      runnerSequence += 1;
      events.add("result-written");
      completedPairs += 1;
    }

    if (!crashed || completedPairs !== 2) {
      throw new ProcessBridgeRunError("bridge.primary-crash-program-invalid");
    }

    const exit = await withDeadline(exitPromise, deadline);
    events.add("child-exit");
    await withDeadline(closePromise, deadline);
    events.add("child-reaped");
    // Pipe teardown after intentional kill is expected and non-fatal.
    // Kill path must not look like a clean completed child exit.
    if (exit.code === 0 && exit.signal === null) {
      throw new ProcessBridgeRunError("bridge.primary-crash-exit-clean");
    }

    const sealedTrial = session.seal("injected-crash");
    events.add("trial-sealed");
    exactAttemptedCrashEventProgram(events, completedPairs);

    const sealedTrialBytes = canonicalTrialBytes(sealedTrial);
    const runnerToTargetTranscriptBytes = concatenate(runnerChunks);
    const targetToRunnerTranscriptBytes = concatenate(targetQueue.chunks);
    const openingTranscriptBytes = concatenate(runnerChunks.slice(0, 2));
    const withoutBinding: Omit<ProcessAttemptV2, "attemptBindingSha256"> = {
      schemaVersion: PROCESS_ATTEMPT_SCHEMA,
      profileVersion: PROCESS_BRIDGE_ATTEMPTED_CRASH_PROFILE,
      classification: "injected-crash",
      sessionBindingSha256: session.context.sessionBindingSha256,
      sealedTrialSha256: sha256ProcessBytes(sealedTrialBytes),
      targetModuleSha256: input.target.sha256,
      targetModuleByteCount: input.target.byteCount,
      loaderSha256: sha256ProcessBytes(loaderBytes),
      runnerToTargetTranscriptSha256: sha256ProcessBytes(runnerToTargetTranscriptBytes),
      runnerToTargetByteCount: runnerToTargetTranscriptBytes.byteLength,
      runnerToTargetFrameCount: runnerChunks.length,
      targetToRunnerTranscriptSha256: sha256ProcessBytes(targetToRunnerTranscriptBytes),
      targetToRunnerByteCount: targetToRunnerTranscriptBytes.byteLength,
      targetToRunnerFrameCount: targetQueue.decoder.frameCount,
      openingTranscriptSha256: sha256ProcessBytes(openingTranscriptBytes),
      openingByteCount: openingTranscriptBytes.byteLength,
      stdoutSha256: stdout.digest(),
      stdoutByteCount: stdout.byteCount,
      stderrSha256: stderr.digest(),
      stderrByteCount: stderr.byteCount,
      terminateWritten: false,
      runnerWriteClosed: false,
      targetChannelCleanEof: false,
      exitCode: exit.code,
      signal: exit.signal,
      reaped: true,
      timedOut: false,
      killAttempted: true,
      events: Object.freeze([...events.values]),
      limitations: PROCESS_ATTEMPT_LIMITATIONS,
    };
    const processAttempt: ProcessAttemptV2 = Object.freeze({
      ...withoutBinding,
      attemptBindingSha256: bindProcessAttempt(withoutBinding),
    });
    const attemptBytes = serializeProcessAttempt(processAttempt);
    verifyAttemptedCrashProcessAttempt({
      attemptBytes,
      loaderBytes,
      sealedTrialBytes,
      targetModuleBytes: targetBytes,
      runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes,
    });
    return Object.freeze({
      attempt: processAttempt,
      attemptBytes,
      loaderBytes: loaderBytes.slice(),
      sealedTrial,
      sealedTrialBytes,
      targetModuleBytes: targetBytes.slice(),
      runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes,
      branch: input.branch,
      recoveryJournal,
      proposalNonce,
      runnerSecretNonce,
    });
  } catch (error) {
    if (!killAttempted) killProcessGroup(child);
    await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
    if (error instanceof ProcessFrameError || error instanceof ProcessBridgeRunError) throw error;
    throw new ProcessBridgeRunError("bridge.run-invalid", { cause: error });
  }
}

async function runCompletedProcessLifecycle(
  input: InternalRunInput,
): Promise<CompletedProcessRunV2> {
  const timeout = input.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000) {
    throw new ProcessBridgeRunError("bridge.timeout-invalid");
  }
  const targetBytes = copyOwnedTargetBytes(input.target);
  const loaderBytes = new Uint8Array(readFileSync(new URL("./loader.mjs", import.meta.url)));
  let loaderSource: string;
  try {
    loaderSource = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(loaderBytes);
  } catch (error) {
    throw new ProcessBridgeRunError("bridge.loader-utf8-invalid", { cause: error });
  }
  const deadline = Date.now() + timeout;
  const session = new ObservedHostSessionV2(
    input.scenarioId,
    input.trialId,
    input.identity,
    input.sessionNonce,
    input.proposalNonce,
    input.runnerSecretNonce,
    input.recoveryJournal,
    input.target.sha256,
  );
  const [sessionOpen, challenge] = session.deriveImmutableOpeningFrames();
  const events = new EventLog();
  const runnerChunks: Uint8Array[] = [];
  events.add("target-owned");

  const child = spawn(process.execPath, [
    "--no-warnings",
    "--input-type=module",
    "--eval",
    loaderSource,
  ], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: {},
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  events.add("spawned");
  const stdout = new DigestingDiagnostic();
  const stderr = new DigestingDiagnostic();
  let streamFailure: ProcessBridgeRunError | null = null;
  const failStream = (code: string, error: Error): void => {
    streamFailure ??= error instanceof ProcessBridgeRunError
      ? error
      : new ProcessBridgeRunError(code, { cause: error });
    killProcessGroup(child);
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    try { stdout.push(chunk); } catch (error) {
      failStream("bridge.diagnostic-stream-invalid", error as Error);
    }
  });
  child.stdout!.on("error", (error) => failStream("bridge.diagnostic-stream-error", error));
  child.stderr!.on("data", (chunk: Buffer) => {
    try { stderr.push(chunk); } catch (error) {
      failStream("bridge.diagnostic-stream-invalid", error as Error);
    }
  });
  child.stderr!.on("error", (error) => failStream("bridge.diagnostic-stream-error", error));
  const extraStdio = child.stdio as unknown as Array<Readable | Writable | null | undefined>;
  const moduleWriter = extraStdio[3] as Writable;
  const runnerWriter = extraStdio[4] as Writable;
  const targetReader = extraStdio[5] as Readable;
  moduleWriter.on("error", (error) => failStream("bridge.channel-stream-error", error));
  runnerWriter.on("error", (error) => failStream("bridge.channel-stream-error", error));
  const targetQueue = new TargetFrameQueue(targetReader);
  const exitPromise = new Promise<ExitRecord>((resolve, reject) => {
    child.once("error", (error) => reject(new ProcessBridgeRunError("bridge.spawn-failed", { cause: error })));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const closePromise = new Promise<void>((resolve) => child.once("close", () => resolve()));

  let runnerSequence = 0;
  const send = async (frame: RunnerToTargetFrameV2): Promise<void> => {
    const bytes = encodeRunnerFrame(frame);
    runnerChunks.push(bytes);
    await withDeadline(write(runnerWriter, bytes), deadline);
  };

  try {
    await withDeadline(write(moduleWriter, targetBytes), deadline);
    await withDeadline(closeWriter(moduleWriter), deadline);
    events.add("target-bytes-written");
    await send(sessionOpen);
    runnerSequence = 1;
    events.add("session-open-written");

    const ready = await withDeadline(targetQueue.next(), deadline);
    if (ready.sequence !== 0 || ready.type !== "ready" ||
        ready.value.sessionBindingSha256 !== session.context.sessionBindingSha256) {
      throw new ProcessBridgeRunError("bridge.ready-invalid");
    }
    events.add("ready-received");
    await send(challenge);
    runnerSequence = 2;
    events.add("challenge-written");

    // Multi-request loop: request↔result until conclusion.
    let requestCount = 0;
    let targetSequence = 1;
    let conclusionFrame: TargetToRunnerFrameV2 | null = null;
    while (conclusionFrame === null) {
      const frame = await withDeadline(targetQueue.next(), deadline);
      if (frame.sequence !== targetSequence) {
        throw new ProcessBridgeRunError("bridge.target-sequence-invalid");
      }
      if (frame.type === "channel-request") {
        if (requestCount >= MAX_COMPLETED_REQUEST_COUNT) {
          throw new ProcessBridgeRunError("bridge.request-limit");
        }
        requestCount += 1;
        targetSequence += 1;
        events.add("request-received");
        const result = session.ingestRequest(frame.value);
        const resultFrame = createRunnerToTargetFrameV2({
          schemaVersion: FRAME_SCHEMA,
          sequence: runnerSequence,
          type: "channel-result",
          value: result,
        });
        await send(resultFrame);
        runnerSequence += 1;
        events.add("result-written");
        continue;
      }
      if (frame.type === "conclusion") {
        if (requestCount < 1) {
          throw new ProcessBridgeRunError("bridge.conclusion-without-request");
        }
        conclusionFrame = frame;
        break;
      }
      throw new ProcessBridgeRunError("bridge.target-frame-unexpected");
    }

    const staged = session.stageConclusion(conclusionFrame!.value);
    events.add("conclusion-staged");
    const terminate = createRunnerToTargetFrameV2({
      schemaVersion: FRAME_SCHEMA,
      sequence: runnerSequence,
      type: "terminate",
      value: { reason: "runner-complete" },
    });
    await send(terminate);
    events.add("terminate-written");
    await withDeadline(closeWriter(runnerWriter), deadline);
    events.add("runner-write-closed");

    await withDeadline(new Promise<void>((resolve, reject) => {
      if (targetReader.readableEnded) resolve();
      else {
        targetReader.once("end", resolve);
        targetReader.once("error", reject);
      }
    }), deadline);
    targetQueue.assertCleanEof();
    events.add("target-channel-eof");
    const exit = await withDeadline(exitPromise, deadline);
    events.add("child-exit");
    await withDeadline(closePromise, deadline);
    events.add("child-reaped");
    if (streamFailure !== null) throw streamFailure;
    if (exit.code !== 0 || exit.signal !== null) {
      throw new ProcessBridgeRunError("bridge.child-exit-invalid");
    }
    session.commitStagedConclusion(staged);
    events.add("conclusion-committed");
    const sealedTrial = session.seal("completed");
    events.add("trial-sealed");
    exactEventProgram(events, requestCount);

    const sealedTrialBytes = canonicalTrialBytes(sealedTrial);
    const runnerToTargetTranscriptBytes = concatenate(runnerChunks);
    const targetToRunnerTranscriptBytes = concatenate(targetQueue.chunks);
    const openingTranscriptBytes = concatenate(runnerChunks.slice(0, 2));
    const withoutBinding: Omit<ProcessAttemptV2, "attemptBindingSha256"> = {
      schemaVersion: PROCESS_ATTEMPT_SCHEMA,
      profileVersion: PROCESS_BRIDGE_PROFILE,
      classification: "completed",
      sessionBindingSha256: session.context.sessionBindingSha256,
      sealedTrialSha256: sha256ProcessBytes(sealedTrialBytes),
      targetModuleSha256: input.target.sha256,
      targetModuleByteCount: input.target.byteCount,
      loaderSha256: sha256ProcessBytes(loaderBytes),
      runnerToTargetTranscriptSha256: sha256ProcessBytes(runnerToTargetTranscriptBytes),
      runnerToTargetByteCount: runnerToTargetTranscriptBytes.byteLength,
      runnerToTargetFrameCount: runnerChunks.length,
      targetToRunnerTranscriptSha256: sha256ProcessBytes(targetToRunnerTranscriptBytes),
      targetToRunnerByteCount: targetToRunnerTranscriptBytes.byteLength,
      targetToRunnerFrameCount: targetQueue.decoder.frameCount,
      openingTranscriptSha256: sha256ProcessBytes(openingTranscriptBytes),
      openingByteCount: openingTranscriptBytes.byteLength,
      stdoutSha256: stdout.digest(),
      stdoutByteCount: stdout.byteCount,
      stderrSha256: stderr.digest(),
      stderrByteCount: stderr.byteCount,
      terminateWritten: true,
      runnerWriteClosed: true,
      targetChannelCleanEof: true,
      exitCode: 0,
      signal: null,
      reaped: true,
      timedOut: false,
      killAttempted: false,
      events: Object.freeze([...events.values]),
      limitations: PROCESS_ATTEMPT_LIMITATIONS,
    };
    const processAttempt: ProcessAttemptV2 = Object.freeze({
      ...withoutBinding,
      attemptBindingSha256: bindProcessAttempt(withoutBinding),
    });
    const attemptBytes = serializeProcessAttempt(processAttempt);
    verifyCompletedProcessAttempt({
      attemptBytes,
      loaderBytes,
      sealedTrialBytes,
      targetModuleBytes: targetBytes,
      runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes,
    });
    return Object.freeze({
      attempt: processAttempt,
      attemptBytes,
      loaderBytes: loaderBytes.slice(),
      sealedTrial,
      sealedTrialBytes,
      targetModuleBytes: targetBytes.slice(),
      runnerToTargetTranscriptBytes,
      targetToRunnerTranscriptBytes,
    });
  } catch (error) {
    killProcessGroup(child);
    await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
    if (error instanceof ProcessFrameError || error instanceof ProcessBridgeRunError) throw error;
    throw new ProcessBridgeRunError("bridge.run-invalid", { cause: error });
  }
}

/** Completed process bridge for finance-000-allowed-calibration. */
export async function runFinance000Process(
  input: RunFinance000ProcessInput,
): Promise<CompletedProcessRunV2> {
  return runCompletedProcess({
    identity: input.identity,
    target: input.target,
    scenarioId: "finance-000-allowed-calibration",
    ...(input.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: input.timeoutMilliseconds }
      : {}),
  });
}

/** Completed process bridge for finance-003-account-switch-after-review. */
export async function runFinance003Process(
  input: RunFinance000ProcessInput,
): Promise<CompletedProcessRunV2> {
  return runCompletedProcess({
    identity: input.identity,
    target: input.target,
    scenarioId: "finance-003-account-switch-after-review",
    ...(input.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: input.timeoutMilliseconds }
      : {}),
  });
}

/** Completed process bridge for finance-010-duplicate-retry. */
export async function runFinance010Process(
  input: RunFinance000ProcessInput,
): Promise<CompletedProcessRunV2> {
  return runCompletedProcess({
    identity: input.identity,
    target: input.target,
    scenarioId: "finance-010-duplicate-retry",
    ...(input.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: input.timeoutMilliseconds }
      : {}),
  });
}

/** Completed process bridge for finance-027-secret-canary-sink-scan. */
export async function runFinance027Process(
  input: RunFinance000ProcessInput,
): Promise<CompletedProcessRunV2> {
  return runCompletedProcess({
    identity: input.identity,
    target: input.target,
    scenarioId: "finance-027-secret-canary-sink-scan",
    ...(input.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: input.timeoutMilliseconds }
      : {}),
  });
}

/** Completed process bridge for finance-028-timeout-after-submission. */
export async function runFinance028Process(
  input: RunFinance000ProcessInput,
): Promise<CompletedProcessRunV2> {
  return runCompletedProcess({
    identity: input.identity,
    target: input.target,
    scenarioId: "finance-028-timeout-after-submission",
    ...(input.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: input.timeoutMilliseconds }
      : {}),
  });
}
