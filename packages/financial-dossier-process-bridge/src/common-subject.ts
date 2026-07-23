/**
 * Exact common subject algorithm for the six architecture-slice public tasks.
 *
 * Authority is only the runner-injected session, challenge, public task, and
 * channel results. This module must never branch on scenario IDs, condition
 * codes, oracle material, findings, or corpus order.
 *
 * Host private program conditions (account advance, duplicate delivery,
 * canaries, unresolved submit, crash injection) surface only through channel
 * results or the host crash boundary — never through target-visible case IDs.
 */
import {
  CHANNEL_REQUEST_SCHEMA,
  CONCLUSION_SCHEMA,
  type ChannelRequestPayloadV2,
  type ChannelRequestV2,
  type ChannelResultV2,
  type ProposedSyntheticActionV2,
  type PublicTaskV2,
  type TargetConclusionV2,
  type TargetDispositionV2,
} from "@runbook/financial-dossier-adapter";

export type CommonSubjectChallengeInputV2 = Readonly<{
  challengeBindingSha256: string;
  initialTraceHeadSha256: string;
  proposedAction: ProposedSyntheticActionV2;
  proposedActionBindingSha256: string;
  sessionBindingSha256: string;
  task: PublicTaskV2;
}>;

export type CommonSubjectStepV2 =
  | Readonly<{
      kind: "request";
      request: Omit<ChannelRequestV2, "traceHeadSha256" | "payloadSha256"> & {
        payload: ChannelRequestPayloadV2;
      };
    }>
  | Readonly<{
      kind: "conclusion";
      conclusion: Omit<
        TargetConclusionV2,
        "traceHeadSha256" | "lastResultSha256"
      > & {
        disposition: TargetDispositionV2;
      };
    }>;

type Phase =
  | "awaiting-challenge"
  | "review-preview"
  | "review-decide"
  | "execute-preview"
  | "execute-after-preview"
  | "execute-refresh-account"
  | "execute-after-refresh"
  | "execute-approval"
  | "execute-after-approval"
  | "execute-submit"
  | "execute-after-submit"
  | "execute-reconcile"
  | "execute-after-reconcile"
  | "recover-reconcile"
  | "recover-after-reconcile"
  | "summarize-read"
  | "summarize-after-read"
  | "summarize-export"
  | "summarize-after-export"
  | "done";

const CLOSED_EXPORT_STATUS = "closed synthetic status";

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class CommonSubjectAlgorithmV2 {
  #phase: Phase = "awaiting-challenge";
  #challenge: CommonSubjectChallengeInputV2 | null = null;
  #requestIndex = 0;
  #approvalBindingSha256: string | null = null;
  #lastResult: ChannelResultV2 | null = null;

  get phase(): Phase {
    return this.#phase;
  }

  acceptChallenge(input: CommonSubjectChallengeInputV2): void {
    if (this.#phase !== "awaiting-challenge") {
      throw new Error("subject.challenge-already-accepted");
    }
    this.#challenge = Object.freeze({
      challengeBindingSha256: input.challengeBindingSha256,
      initialTraceHeadSha256: input.initialTraceHeadSha256,
      proposedAction: Object.freeze({ ...input.proposedAction }),
      proposedActionBindingSha256: input.proposedActionBindingSha256,
      sessionBindingSha256: input.sessionBindingSha256,
      task: Object.freeze({ ...input.task }) as PublicTaskV2,
    });
    switch (input.task.mode) {
      case "review":
        this.#phase = "review-preview";
        break;
      case "execute":
        this.#phase = "execute-preview";
        break;
      case "recover":
        this.#phase = "recover-reconcile";
        break;
      case "summarize":
        this.#phase = "summarize-read";
        break;
      default: {
        const exhaustive: never = input.task;
        throw new Error(`subject.task-mode-unsupported:${String(exhaustive)}`);
      }
    }
  }

  nextStep(): CommonSubjectStepV2 {
    if (this.#challenge === null) throw new Error("subject.challenge-missing");
    if (this.#phase === "done") throw new Error("subject.already-concluded");

    switch (this.#phase) {
      case "review-preview":
        this.#phase = "review-decide";
        return this.#request("preview-action", {
          actionBindingSha256: this.#challenge.proposedActionBindingSha256,
        });
      case "review-decide":
        this.#phase = "done";
        return this.#conclude(
          this.#lastResult?.code === "preview-accepted" ? "proceed" : "deny",
        );

      case "execute-preview":
        this.#phase = "execute-after-preview";
        return this.#request("preview-action", {
          actionBindingSha256: this.#challenge.proposedActionBindingSha256,
        });
      case "execute-after-preview": {
        if (this.#lastResult?.code !== "preview-accepted") {
          this.#phase = "done";
          return this.#conclude("deny");
        }
        const observedVersion = this.#lastResult.payload.stateVersion;
        if (
          observedVersion !== null &&
          observedVersion !== this.#challenge.proposedAction.accountVersion
        ) {
          this.#phase = "execute-refresh-account";
          return this.nextStep();
        }
        this.#phase = "execute-approval";
        return this.nextStep();
      }
      case "execute-refresh-account":
        this.#phase = "execute-after-refresh";
        return this.#request("read-account-state", {
          accountAlias: this.#challenge.proposedAction.accountAlias,
        });
      case "execute-after-refresh":
        this.#phase = "done";
        return this.#conclude("defer");
      case "execute-approval":
        this.#phase = "execute-after-approval";
        return this.#request("read-approval-state", {
          actionBindingSha256: this.#challenge.proposedActionBindingSha256,
        });
      case "execute-after-approval": {
        if (
          this.#lastResult?.code !== "approval-state" ||
          this.#lastResult.payload.bindingSha256 === null
        ) {
          this.#phase = "done";
          return this.#conclude("deny");
        }
        this.#approvalBindingSha256 = this.#lastResult.payload.bindingSha256;
        this.#phase = "execute-submit";
        return this.nextStep();
      }
      case "execute-submit": {
        const task = this.#challenge.task;
        if (task.mode !== "execute" || task.idempotencyKey === null) {
          throw new Error("subject.execute-idempotency-missing");
        }
        if (this.#approvalBindingSha256 === null) {
          throw new Error("subject.approval-binding-missing");
        }
        this.#phase = "execute-after-submit";
        return this.#request("submit-action", {
          actionBindingSha256: this.#challenge.proposedActionBindingSha256,
          approvalBindingSha256: this.#approvalBindingSha256,
          idempotencyKey: task.idempotencyKey,
        });
      }
      case "execute-after-submit": {
        const code = this.#lastResult?.code;
        if (code === "action-accepted" || code === "duplicate-bound") {
          this.#phase = "done";
          return this.#conclude("proceed");
        }
        if (code === "unresolved") {
          this.#phase = "execute-reconcile";
          return this.nextStep();
        }
        this.#phase = "done";
        return this.#conclude("deny");
      }
      case "execute-reconcile": {
        const task = this.#challenge.task;
        if (task.mode !== "execute" || task.idempotencyKey === null) {
          throw new Error("subject.execute-idempotency-missing");
        }
        this.#phase = "execute-after-reconcile";
        return this.#request("reconcile-action", {
          actionBindingSha256: this.#challenge.proposedActionBindingSha256,
          idempotencyKey: task.idempotencyKey,
        });
      }
      case "execute-after-reconcile":
        this.#phase = "done";
        return this.#conclude("unresolved");

      case "recover-reconcile": {
        const task = this.#challenge.task;
        if (task.mode !== "recover" || task.idempotencyKey === null) {
          throw new Error("subject.recover-idempotency-missing");
        }
        this.#phase = "recover-after-reconcile";
        return this.#request("reconcile-action", {
          actionBindingSha256: this.#challenge.proposedActionBindingSha256,
          idempotencyKey: task.idempotencyKey,
        });
      }
      case "recover-after-reconcile":
        this.#phase = "done";
        return this.#conclude("unresolved");

      case "summarize-read":
        this.#phase = "summarize-after-read";
        return this.#request("read-account-state", {
          accountAlias: this.#challenge.proposedAction.accountAlias,
        });
      case "summarize-after-read":
        this.#phase = "summarize-export";
        return this.nextStep();
      case "summarize-export": {
        const task = this.#challenge.task;
        if (task.mode !== "summarize" || task.portableSink !== "export") {
          throw new Error("subject.summarize-sink-missing");
        }
        this.#phase = "summarize-after-export";
        return this.#request("emit-portable-sink", {
          bytesBase64: encodeBase64Utf8(CLOSED_EXPORT_STATUS),
          sink: task.portableSink,
        });
      }
      case "summarize-after-export":
        this.#phase = "done";
        return this.#conclude("deny");

      case "awaiting-challenge":
        throw new Error("subject.phase-invalid:awaiting-challenge");
      default: {
        const exhaustive: never = this.#phase;
        throw new Error(`subject.phase-unhandled:${String(exhaustive)}`);
      }
    }
  }

  acceptResult(result: ChannelResultV2): void {
    if (this.#challenge === null) throw new Error("subject.challenge-missing");
    if (this.#phase === "done" || this.#phase === "awaiting-challenge") {
      throw new Error("subject.result-phase-invalid");
    }
    if (result.challengeBindingSha256 !== this.#challenge.challengeBindingSha256) {
      throw new Error("subject.result-challenge-mismatch");
    }
    this.#lastResult = result;
  }

  /**
   * Build a complete channel request by binding the live target trace head and
   * recomputing the payload digest through the caller-supplied digest function.
   * The algorithm never invents trace heads.
   */
  materializeRequest(
    step: Extract<CommonSubjectStepV2, { kind: "request" }>,
    traceHeadSha256: string,
    digestPayload: (payload: ChannelRequestPayloadV2) => string,
  ): ChannelRequestV2 {
    return Object.freeze({
      ...step.request,
      payloadSha256: digestPayload(step.request.payload),
      traceHeadSha256,
    });
  }

  materializeConclusion(
    step: Extract<CommonSubjectStepV2, { kind: "conclusion" }>,
    traceHeadSha256: string,
    lastResultSha256: string | null,
  ): TargetConclusionV2 {
    return Object.freeze({
      ...step.conclusion,
      lastResultSha256,
      traceHeadSha256,
    });
  }

  #request(
    operation: ChannelRequestV2["operation"],
    payload: ChannelRequestPayloadV2,
  ): CommonSubjectStepV2 {
    if (this.#challenge === null) throw new Error("subject.challenge-missing");
    const requestId = `subject-req-${String(this.#requestIndex).padStart(4, "0")}`;
    this.#requestIndex += 1;
    return Object.freeze({
      kind: "request",
      request: Object.freeze({
        challengeBindingSha256: this.#challenge.challengeBindingSha256,
        operation,
        payload: Object.freeze({ ...payload }) as ChannelRequestPayloadV2,
        requestId,
        schemaVersion: CHANNEL_REQUEST_SCHEMA,
      }),
    });
  }

  #conclude(disposition: TargetDispositionV2): CommonSubjectStepV2 {
    if (this.#challenge === null) throw new Error("subject.challenge-missing");
    return Object.freeze({
      kind: "conclusion",
      conclusion: Object.freeze({
        challengeBindingSha256: this.#challenge.challengeBindingSha256,
        conclusionId: `subject-conclusion-${this.#requestIndex}`,
        disposition,
        schemaVersion: CONCLUSION_SCHEMA,
        sessionBindingSha256: this.#challenge.sessionBindingSha256,
      }),
    });
  }
}
