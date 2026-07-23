import { createHash } from "node:crypto";
import { closeSync, readSync, writeSync } from "node:fs";

const MODE = "__RUNBOOK_HOSTILE_MODE__";
const RUNNER_INPUT_FD = 4;
const TARGET_OUTPUT_FD = 5;
const MAX_FRAME_BYTES = 131072;
const ARCHIVE_SENTINEL = "HOSTILE_ARCHIVE_SENTINEL_target_source_must_not_escape";
const STDOUT_SENTINEL = "HOSTILE_STDOUT_SENTINEL_must_be_digest_only";
const STDERR_SENTINEL = "HOSTILE_STDERR_SENTINEL_must_be_digest_only";
let outputSequence = 0;

const jcs = (value) => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`)
    .join(",")}}`;
};

const sha = (value) => createHash("sha256").update(jcs(value)).digest("hex");

const readExact = (length) => {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(RUNNER_INPUT_FD, bytes, offset, length - offset, null);
    if (count === 0) throw new Error("hostile.runner-channel-truncated");
    offset += count;
  }
  return bytes;
};

const readFrame = () => {
  const header = readExact(4);
  const length = header.readUInt32BE(0);
  if (length < 1 || length > MAX_FRAME_BYTES) throw new Error("hostile.runner-frame-size");
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readExact(length)),
  );
};

const writeAll = (descriptor, bytes) => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const count = writeSync(descriptor, bytes, offset);
    if (count <= 0) throw new Error("hostile.channel-write-zero");
    offset += count;
  }
};

const writeRawFrame = (frame) => {
  const payload = Buffer.from(jcs(frame));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.byteLength, 0);
  writeAll(TARGET_OUTPUT_FD, header);
  writeAll(TARGET_OUTPUT_FD, payload);
};

const writeFrame = (type, value, sequence = outputSequence) => {
  writeRawFrame({
    schemaVersion: "runbook.pre-capital-target-frame.v2-candidate.2",
    sequence,
    type,
    value,
  });
  outputSequence += 1;
};

const fail = () => {
  writeFrame("target-error", { errorCode: "input-rejected" });
  throw new Error("hostile.input-rejected");
};

try {
  if (MODE === "nonzero") {
    process.exitCode = 7;
  } else if (MODE === "timeout") {
    readFrame();
    await new Promise(() => setInterval(() => {}, 1000));
  } else {
    const open = readFrame();
    if (open.type !== "session-open" || open.sequence !== 0) fail();

    if (MODE === "partial") {
      writeAll(TARGET_OUTPUT_FD, Buffer.from([0, 0]));
    } else if (MODE === "direction") {
      writeRawFrame(open);
    } else if (MODE === "sequence") {
      writeFrame("ready", { sessionBindingSha256: open.value.sessionBindingSha256 }, 1);
    } else {
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
      if (
        challenge.sessionBindingSha256 !== session.sessionBindingSha256 ||
        expectedActionBinding !== challenge.proposedActionBindingSha256 ||
        expectedTaskBinding !== challenge.taskBindingSha256 ||
        challenge.task?.mode !== "review" ||
        expectedChallengeBinding !== challenge.challengeBindingSha256
      ) {
        fail();
      }

      const payload = { actionBindingSha256: challenge.proposedActionBindingSha256 };
      const request = {
        challengeBindingSha256: challenge.challengeBindingSha256,
        operation: "preview-action",
        payload,
        payloadSha256: sha(payload),
        requestId: "hostile-preview",
        schemaVersion: "runbook.pre-capital-target-channel-request.v2-candidate.2",
        traceHeadSha256: challenge.initialTraceHeadSha256,
      };
      writeFrame("channel-request", request);
      const resultFrame = readFrame();
      if (resultFrame.type !== "channel-result" || resultFrame.sequence !== 2) fail();
      const result = resultFrame.value;
      if (
        result.requestId !== request.requestId ||
        result.operation !== request.operation ||
        result.challengeBindingSha256 !== challenge.challengeBindingSha256 ||
        result.traceHeadBeforeSha256 !== challenge.initialTraceHeadSha256 ||
        result.code !== "preview-accepted" ||
        result.payload.acceptedEffectCount !== 0
      ) {
        fail();
      }

      writeFrame("conclusion", {
        challengeBindingSha256: challenge.challengeBindingSha256,
        conclusionId: "hostile-conclusion",
        disposition: "proceed",
        lastResultSha256: sha(result),
        schemaVersion: "runbook.pre-capital-target-conclusion.v2-candidate.2",
        sessionBindingSha256: session.sessionBindingSha256,
        traceHeadSha256: result.traceHeadSha256,
      });

      if (MODE === "post-conclusion") {
        writeFrame("target-error", { errorCode: "target-failed" });
      }

      const terminate = readFrame();
      if (
        terminate.type !== "terminate" ||
        terminate.sequence !== 3 ||
        terminate.value.reason !== "runner-complete"
      ) {
        fail();
      }

      if (MODE === "trailing") {
        writeAll(TARGET_OUTPUT_FD, Buffer.from([0xff]));
      } else if (MODE === "stdout-limit") {
        writeAll(1, Buffer.alloc(70000, 0x73));
      } else if (MODE === "stderr-limit") {
        writeAll(2, Buffer.alloc(70000, 0x65));
      } else if (MODE === "signal") {
        process.kill(process.pid, "SIGTERM");
      } else if (MODE === "conclusion-nonzero") {
        process.exitCode = 9;
      } else if (MODE === "success") {
        writeAll(1, Buffer.from(`${STDOUT_SENTINEL}\n`));
        writeAll(2, Buffer.from(`${STDERR_SENTINEL}\n`));
        void ARCHIVE_SENTINEL;
      } else if (MODE !== "post-conclusion") {
        throw new Error(`hostile.unsupported-mode:${MODE}`);
      }
    }
  }
} finally {
  try {
    closeSync(RUNNER_INPUT_FD);
  } catch {}
  try {
    closeSync(TARGET_OUTPUT_FD);
  } catch {}
}
