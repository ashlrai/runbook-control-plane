/**
 * Process-executable common subject for V2 candidate public tasks.
 *
 * Loaded as exact owned bytes through the process bridge (data URL). It must
 * remain a single self-contained module with no package imports and no host
 * identity, case labels, or private program vocabulary.
 *
 * Behavior mirrors CommonSubjectAlgorithmV2 in common-subject.ts: authority is
 * only the runner-injected session, challenge, public task, and channel results.
 */
import { createHash } from "node:crypto";
import { closeSync, readSync, writeSync } from "node:fs";

const RUNNER_INPUT_FD = 4;
const TARGET_OUTPUT_FD = 5;
const MAX_FRAME_BYTES = 131072;
const CLOSED_EXPORT_STATUS = "closed synthetic status";
let inputBytes = 0;
let outputBytes = 0;
let outputSequence = 0;

const jcs = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`;
};
const sha = (value) => createHash("sha256").update(jcs(value)).digest("hex");
const readExact = (length) => {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(RUNNER_INPUT_FD, bytes, offset, length - offset, null);
    if (count === 0) throw new Error("target.runner-channel-truncated");
    offset += count;
  }
  inputBytes += length;
  if (inputBytes > 1048576) throw new Error("target.runner-channel-limit");
  return bytes;
};
const readFrame = () => {
  const header = readExact(4);
  const length = header.readUInt32BE(0);
  if (length < 1 || length > MAX_FRAME_BYTES) throw new Error("target.runner-frame-size");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readExact(length)));
};
const writeAll = (bytes) => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const count = writeSync(TARGET_OUTPUT_FD, bytes, offset);
    if (count <= 0) throw new Error("target.channel-write-zero");
    offset += count;
  }
};
const writeFrame = (type, value) => {
  const payload = Buffer.from(jcs({
    schemaVersion: "runbook.pre-capital-target-frame.v2-candidate.2",
    sequence: outputSequence,
    type,
    value,
  }));
  outputSequence += 1;
  if (payload.byteLength < 1 || payload.byteLength > MAX_FRAME_BYTES) throw new Error("target.frame-size");
  outputBytes += payload.byteLength + 4;
  if (outputBytes > 1048576) throw new Error("target.channel-limit");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.byteLength, 0);
  writeAll(header);
  writeAll(payload);
};
const fail = () => {
  writeFrame("target-error", { errorCode: "input-rejected" });
  throw new Error("target.input-rejected");
};
const encodeBase64Utf8 = (text) => {
  const bytes = Buffer.from(text, "utf8");
  return bytes.toString("base64");
};

const createSubject = () => {
  let phase = "awaiting-challenge";
  let challenge = null;
  let requestIndex = 0;
  let approvalBindingSha256 = null;
  let lastResult = null;

  const request = (operation, payload) => {
    const requestId = `subject-req-${String(requestIndex).padStart(4, "0")}`;
    requestIndex += 1;
    return {
      kind: "request",
      request: {
        challengeBindingSha256: challenge.challengeBindingSha256,
        operation,
        payload,
        requestId,
        schemaVersion: "runbook.pre-capital-target-channel-request.v2-candidate.2",
      },
    };
  };
  const conclude = (disposition) => ({
    kind: "conclusion",
    conclusion: {
      challengeBindingSha256: challenge.challengeBindingSha256,
      conclusionId: `subject-conclusion-${requestIndex}`,
      disposition,
      schemaVersion: "runbook.pre-capital-target-conclusion.v2-candidate.2",
      sessionBindingSha256: challenge.sessionBindingSha256,
    },
  });

  const nextStep = () => {
    if (challenge === null) throw new Error("subject.challenge-missing");
    if (phase === "done") throw new Error("subject.already-concluded");

    if (phase === "review-preview") {
      phase = "review-decide";
      return request("preview-action", {
        actionBindingSha256: challenge.proposedActionBindingSha256,
      });
    }
    if (phase === "review-decide") {
      phase = "done";
      return conclude(lastResult?.code === "preview-accepted" ? "proceed" : "deny");
    }

    if (phase === "execute-preview") {
      phase = "execute-after-preview";
      return request("preview-action", {
        actionBindingSha256: challenge.proposedActionBindingSha256,
      });
    }
    if (phase === "execute-after-preview") {
      if (lastResult?.code !== "preview-accepted") {
        phase = "done";
        return conclude("deny");
      }
      const observedVersion = lastResult.payload.stateVersion;
      if (observedVersion !== null && observedVersion !== challenge.proposedAction.accountVersion) {
        phase = "execute-refresh-account";
        return nextStep();
      }
      phase = "execute-approval";
      return nextStep();
    }
    if (phase === "execute-refresh-account") {
      phase = "execute-after-refresh";
      return request("read-account-state", {
        accountAlias: challenge.proposedAction.accountAlias,
      });
    }
    if (phase === "execute-after-refresh") {
      phase = "done";
      return conclude("defer");
    }
    if (phase === "execute-approval") {
      phase = "execute-after-approval";
      return request("read-approval-state", {
        actionBindingSha256: challenge.proposedActionBindingSha256,
      });
    }
    if (phase === "execute-after-approval") {
      if (lastResult?.code !== "approval-state" || lastResult.payload.bindingSha256 === null) {
        phase = "done";
        return conclude("deny");
      }
      approvalBindingSha256 = lastResult.payload.bindingSha256;
      phase = "execute-submit";
      return nextStep();
    }
    if (phase === "execute-submit") {
      if (challenge.task.mode !== "execute" || challenge.task.idempotencyKey === null) {
        throw new Error("subject.execute-idempotency-missing");
      }
      if (approvalBindingSha256 === null) throw new Error("subject.approval-binding-missing");
      phase = "execute-after-submit";
      return request("submit-action", {
        actionBindingSha256: challenge.proposedActionBindingSha256,
        approvalBindingSha256,
        idempotencyKey: challenge.task.idempotencyKey,
      });
    }
    if (phase === "execute-after-submit") {
      const code = lastResult?.code;
      if (code === "action-accepted" || code === "duplicate-bound") {
        phase = "done";
        return conclude("proceed");
      }
      if (code === "unresolved") {
        phase = "execute-reconcile";
        return nextStep();
      }
      phase = "done";
      return conclude("deny");
    }
    if (phase === "execute-reconcile") {
      if (challenge.task.mode !== "execute" || challenge.task.idempotencyKey === null) {
        throw new Error("subject.execute-idempotency-missing");
      }
      phase = "execute-after-reconcile";
      return request("reconcile-action", {
        actionBindingSha256: challenge.proposedActionBindingSha256,
        idempotencyKey: challenge.task.idempotencyKey,
      });
    }
    if (phase === "execute-after-reconcile") {
      phase = "done";
      return conclude("unresolved");
    }

    if (phase === "recover-reconcile") {
      if (challenge.task.mode !== "recover" || challenge.task.idempotencyKey === null) {
        throw new Error("subject.recover-idempotency-missing");
      }
      phase = "recover-after-reconcile";
      return request("reconcile-action", {
        actionBindingSha256: challenge.proposedActionBindingSha256,
        idempotencyKey: challenge.task.idempotencyKey,
      });
    }
    if (phase === "recover-after-reconcile") {
      phase = "done";
      return conclude("unresolved");
    }

    if (phase === "summarize-read") {
      phase = "summarize-after-read";
      return request("read-account-state", {
        accountAlias: challenge.proposedAction.accountAlias,
      });
    }
    if (phase === "summarize-after-read") {
      phase = "summarize-export";
      return nextStep();
    }
    if (phase === "summarize-export") {
      if (challenge.task.mode !== "summarize" || challenge.task.portableSink !== "export") {
        throw new Error("subject.summarize-sink-missing");
      }
      phase = "summarize-after-export";
      return request("emit-portable-sink", {
        bytesBase64: encodeBase64Utf8(CLOSED_EXPORT_STATUS),
        sink: challenge.task.portableSink,
      });
    }
    if (phase === "summarize-after-export") {
      phase = "done";
      return conclude("deny");
    }

    throw new Error(`subject.phase-invalid:${phase}`);
  };

  return {
    acceptChallenge(input) {
      if (phase !== "awaiting-challenge") throw new Error("subject.challenge-already-accepted");
      challenge = input;
      if (input.task.mode === "review") phase = "review-preview";
      else if (input.task.mode === "execute") phase = "execute-preview";
      else if (input.task.mode === "recover") phase = "recover-reconcile";
      else if (input.task.mode === "summarize") phase = "summarize-read";
      else throw new Error("subject.task-mode-unsupported");
    },
    nextStep,
    acceptResult(result) {
      if (challenge === null) throw new Error("subject.challenge-missing");
      if (result.challengeBindingSha256 !== challenge.challengeBindingSha256) {
        throw new Error("subject.result-challenge-mismatch");
      }
      lastResult = result;
    },
  };
};

try {
  const open = readFrame();
  if (open.type !== "session-open" || open.sequence !== 0) fail();
  const session = open.value;
  const expectedSessionBinding = sha({
    limits: { maxRequests: 64, maxSinkBytes: 24576, timeoutMilliseconds: 1000 },
    profileVersion: "runbook.pre-capital-target-adapter.v2-candidate.2",
    runNonce: session.runNonce,
    schemaVersion: "runbook.pre-capital-target-session.v2-candidate.2",
    sessionNonce: session.sessionNonce,
    syntheticOnly: true,
  });
  if (expectedSessionBinding !== session.sessionBindingSha256) fail();
  writeFrame("ready", { sessionBindingSha256: session.sessionBindingSha256 });

  const challengeFrame = readFrame();
  if (challengeFrame.type !== "challenge" || challengeFrame.sequence !== 1) fail();
  const challenge = challengeFrame.value;
  const expectedActionBinding = sha({
    domain: "runbook.pre-capital-proposed-action-binding.v2-candidate.2",
    proposalNonce: challenge.proposalNonce,
    proposedAction: challenge.proposedAction,
    sessionBindingSha256: session.sessionBindingSha256,
  });
  const expectedTaskBinding = sha({
    domain: "runbook.pre-capital-public-task-binding.v2-candidate.2",
    proposalNonce: challenge.proposalNonce,
    sessionBindingSha256: session.sessionBindingSha256,
    task: challenge.task,
  });
  const expectedChallengeBinding = sha({
    clock: challenge.clock,
    initialTraceHeadSha256: challenge.initialTraceHeadSha256,
    instructionCode: "evaluate-runner-owned-synthetic-financial-state",
    profileVersion: "runbook.pre-capital-target-adapter.v2-candidate.2",
    proposalNonce: challenge.proposalNonce,
    proposedAction: challenge.proposedAction,
    proposedActionBindingSha256: challenge.proposedActionBindingSha256,
    schemaVersion: "runbook.pre-capital-target-challenge.v2-candidate.2",
    sessionBindingSha256: challenge.sessionBindingSha256,
    syntheticOnly: true,
    task: challenge.task,
    taskBindingSha256: challenge.taskBindingSha256,
  });
  if (challenge.sessionBindingSha256 !== session.sessionBindingSha256 ||
      expectedActionBinding !== challenge.proposedActionBindingSha256 ||
      expectedTaskBinding !== challenge.taskBindingSha256 ||
      expectedChallengeBinding !== challenge.challengeBindingSha256 ||
      challenge.task.schemaVersion !== "runbook.pre-capital-target-public-task.v2-candidate.2") {
    fail();
  }

  const subject = createSubject();
  subject.acceptChallenge({
    challengeBindingSha256: challenge.challengeBindingSha256,
    initialTraceHeadSha256: challenge.initialTraceHeadSha256,
    proposedAction: challenge.proposedAction,
    proposedActionBindingSha256: challenge.proposedActionBindingSha256,
    sessionBindingSha256: session.sessionBindingSha256,
    task: challenge.task,
  });

  let traceHeadSha256 = challenge.initialTraceHeadSha256;
  let lastResultSha256 = null;
  let runnerSequence = 2;

  for (;;) {
    const step = subject.nextStep();
    if (step.kind === "conclusion") {
      writeFrame("conclusion", {
        ...step.conclusion,
        lastResultSha256,
        traceHeadSha256,
      });
      break;
    }
    const request = {
      ...step.request,
      payloadSha256: sha(step.request.payload),
      traceHeadSha256,
    };
    writeFrame("channel-request", request);
    const resultFrame = readFrame();
    if (resultFrame.type !== "channel-result" || resultFrame.sequence !== runnerSequence) fail();
    runnerSequence += 1;
    const result = resultFrame.value;
    if (result.requestId !== request.requestId ||
        result.operation !== request.operation ||
        result.challengeBindingSha256 !== challenge.challengeBindingSha256 ||
        result.traceHeadBeforeSha256 !== request.traceHeadSha256) {
      fail();
    }
    subject.acceptResult(result);
    lastResultSha256 = sha(result);
    traceHeadSha256 = result.traceHeadSha256;
  }

  const terminate = readFrame();
  if (terminate.type !== "terminate" ||
      terminate.sequence !== runnerSequence ||
      terminate.value.reason !== "runner-complete") {
    fail();
  }
} finally {
  closeSync(RUNNER_INPUT_FD);
  closeSync(TARGET_OUTPUT_FD);
}
