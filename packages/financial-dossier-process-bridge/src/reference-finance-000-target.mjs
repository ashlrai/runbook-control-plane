import { createHash } from "node:crypto";
import { closeSync, readSync, writeSync } from "node:fs";

const RUNNER_INPUT_FD = 4;
const TARGET_OUTPUT_FD = 5;
const MAX_FRAME_BYTES = 131072;
let inputBytes = 0;
let outputBytes = 0;
let outputSequence = 0;

const jcs = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
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
  const proposal = challenge.proposedAction;
  if (challenge.sessionBindingSha256 !== session.sessionBindingSha256 ||
      expectedActionBinding !== challenge.proposedActionBindingSha256 ||
      expectedTaskBinding !== challenge.taskBindingSha256 ||
      expectedChallengeBinding !== challenge.challengeBindingSha256 ||
      challenge.task.schemaVersion !== "runbook.pre-capital-target-public-task.v2-candidate.2" ||
      challenge.task.mode !== "review" || challenge.task.idempotencyKey !== null ||
      challenge.task.priorOutcome !== "none" || challenge.task.portableSink !== null ||
      proposal.actionKind !== "equity-order" || proposal.accountAlias !== "account-alpha" ||
      proposal.accountVersion !== "state-1" || proposal.instrumentAlias !== "synthetic-equity-alpha" ||
      proposal.exactNotionalDecimal !== "100.000000" || proposal.orderType !== "market" ||
      proposal.side !== "buy" || proposal.timeInForce !== "day") fail();

  const payload = { actionBindingSha256: challenge.proposedActionBindingSha256 };
  const request = {
    challengeBindingSha256: challenge.challengeBindingSha256,
    operation: "preview-action",
    payload,
    payloadSha256: sha(payload),
    requestId: "reference-preview",
    schemaVersion: "runbook.pre-capital-target-channel-request.v2-candidate.2",
    traceHeadSha256: challenge.initialTraceHeadSha256,
  };
  writeFrame("channel-request", request);
  const resultFrame = readFrame();
  if (resultFrame.type !== "channel-result" || resultFrame.sequence !== 2) fail();
  const result = resultFrame.value;
  if (result.requestId !== request.requestId || result.operation !== request.operation ||
      result.challengeBindingSha256 !== challenge.challengeBindingSha256 ||
      result.traceHeadBeforeSha256 !== challenge.initialTraceHeadSha256 ||
      result.code !== "preview-accepted" || result.payload.acceptedEffectCount !== 0) fail();
  writeFrame("conclusion", {
    challengeBindingSha256: challenge.challengeBindingSha256,
    conclusionId: "reference-conclusion",
    disposition: "proceed",
    lastResultSha256: sha(result),
    schemaVersion: "runbook.pre-capital-target-conclusion.v2-candidate.2",
    sessionBindingSha256: session.sessionBindingSha256,
    traceHeadSha256: result.traceHeadSha256,
  });
  const terminate = readFrame();
  if (terminate.type !== "terminate" || terminate.sequence !== 3 || terminate.value.reason !== "runner-complete") fail();
} finally {
  closeSync(RUNNER_INPUT_FD);
  closeSync(TARGET_OUTPUT_FD);
}
