import type {
  ADAPTER_PROFILE_VERSION,
  CHALLENGE_SCHEMA,
  CHANNEL_OPERATIONS,
  CHANNEL_REQUEST_SCHEMA,
  CHANNEL_RESULT_CODES,
  CHANNEL_RESULT_SCHEMA,
  CONCLUSION_SCHEMA,
  FRAME_SCHEMA,
  PUBLIC_TASK_SCHEMA,
  SESSION_SCHEMA,
  TARGET_DISPOSITIONS,
} from "./constants.js";

export type ChannelOperationV2 = (typeof CHANNEL_OPERATIONS)[number];
export type ChannelResultCodeV2 = (typeof CHANNEL_RESULT_CODES)[number];
export type TargetDispositionV2 = (typeof TARGET_DISPOSITIONS)[number];

export type TargetSessionV2 = Readonly<{
  limits: Readonly<{
    maxRequests: 64;
    maxSinkBytes: 24576;
    timeoutMilliseconds: 1000;
  }>;
  runNonce: string;
  schemaVersion: typeof SESSION_SCHEMA;
  sessionBindingSha256: string;
  sessionNonce: string;
  syntheticOnly: true;
}>;

export type ProposedSyntheticActionV2 = Readonly<{
  actionKind: "equity-order";
  accountAlias: string;
  accountVersion: string;
  exactNotionalDecimal: string;
  instrumentAlias: string;
  orderType: "market";
  side: "buy";
  timeInForce: "day";
}>;

export type PublicTaskV2 =
  | Readonly<{
      idempotencyKey: null;
      mode: "review";
      portableSink: null;
      priorOutcome: "none";
      schemaVersion: typeof PUBLIC_TASK_SCHEMA;
    }>
  | Readonly<{
      idempotencyKey: string;
      mode: "execute";
      portableSink: null;
      priorOutcome: "none";
      schemaVersion: typeof PUBLIC_TASK_SCHEMA;
    }>
  | Readonly<{
      idempotencyKey: string;
      mode: "recover";
      portableSink: null;
      priorOutcome: "unknown";
      schemaVersion: typeof PUBLIC_TASK_SCHEMA;
    }>
  | Readonly<{
      idempotencyKey: null;
      mode: "summarize";
      portableSink: "export";
      priorOutcome: "none";
      schemaVersion: typeof PUBLIC_TASK_SCHEMA;
    }>;

export type TargetChallengeV2 = Readonly<{
  challengeBindingSha256: string;
  clock: Readonly<{
    iso8601: string;
    unixMilliseconds: number;
  }>;
  instructionCode: "evaluate-runner-owned-synthetic-financial-state";
  initialTraceHeadSha256: string;
  profileVersion: typeof ADAPTER_PROFILE_VERSION;
  proposalNonce: string;
  proposedAction: ProposedSyntheticActionV2;
  proposedActionBindingSha256: string;
  schemaVersion: typeof CHALLENGE_SCHEMA;
  sessionBindingSha256: string;
  task: PublicTaskV2;
  taskBindingSha256: string;
}>;

export type ReadAccountStatePayloadV2 = Readonly<{ accountAlias: string }>;
export type ReadMarketStatePayloadV2 = Readonly<{
  instrumentAlias: string;
  sourceAlias: string;
}>;
export type ListCapabilitiesPayloadV2 = Readonly<{
  scope: "financial-actions";
}>;
export type ReadApprovalStatePayloadV2 = Readonly<{
  actionBindingSha256: string;
}>;
export type PreviewActionPayloadV2 = Readonly<{
  actionBindingSha256: string;
}>;
export type SubmitActionPayloadV2 = Readonly<{
  actionBindingSha256: string;
  approvalBindingSha256: string | null;
  idempotencyKey: string;
}>;
export type CancelActionPayloadV2 = Readonly<{
  actionBindingSha256: string;
  venueReference: string;
}>;
export type ReadActionStatusPayloadV2 = Readonly<{ venueReference: string }>;
export type ReconcileActionPayloadV2 = Readonly<{
  actionBindingSha256: string;
  idempotencyKey: string;
}>;
export type EmitPortableSinkPayloadV2 = Readonly<{
  bytesBase64: string;
  sink: "diagnostic" | "export" | "protocol" | "ui";
}>;

export type ChannelRequestPayloadV2 =
  | ReadAccountStatePayloadV2
  | ReadMarketStatePayloadV2
  | ListCapabilitiesPayloadV2
  | ReadApprovalStatePayloadV2
  | PreviewActionPayloadV2
  | SubmitActionPayloadV2
  | CancelActionPayloadV2
  | ReadActionStatusPayloadV2
  | ReconcileActionPayloadV2
  | EmitPortableSinkPayloadV2;

export type ChannelRequestV2 = Readonly<{
  challengeBindingSha256: string;
  operation: ChannelOperationV2;
  payload: ChannelRequestPayloadV2;
  payloadSha256: string;
  requestId: string;
  schemaVersion: typeof CHANNEL_REQUEST_SCHEMA;
  traceHeadSha256: string;
}>;

export type SyntheticDatumV2 = Readonly<{
  dataClass: "synthetic-private" | "synthetic-public";
  name: string;
  value: string;
}>;

export type ChannelResultPayloadV2 = Readonly<{
  acceptedEffectCount: number;
  artifactSha256: string | null;
  bindingSha256: string | null;
  observedAt: string | null;
  sourceSha256: string | null;
  stateVersion: string | null;
  values: readonly SyntheticDatumV2[];
}>;

export type ChannelResultV2 = Readonly<{
  challengeBindingSha256: string;
  code: ChannelResultCodeV2;
  operation: ChannelOperationV2;
  payload: ChannelResultPayloadV2;
  requestId: string;
  resultClass:
    | "accepted"
    | "denied"
    | "observed"
    | "rejected"
    | "unresolved"
    | "unsupported";
  schemaVersion: typeof CHANNEL_RESULT_SCHEMA;
  traceHeadBeforeSha256: string;
  traceHeadSha256: string;
}>;

export type TargetConclusionV2 = Readonly<{
  challengeBindingSha256: string;
  conclusionId: string;
  disposition: TargetDispositionV2;
  lastResultSha256: string | null;
  schemaVersion: typeof CONCLUSION_SCHEMA;
  sessionBindingSha256: string;
  traceHeadSha256: string;
}>;

export type RunnerToTargetFrameV2 =
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "session-open";
      value: TargetSessionV2;
    }>
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "challenge";
      value: TargetChallengeV2;
    }>
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "channel-result";
      value: ChannelResultV2;
    }>
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "terminate";
      value: Readonly<{
        reason: "runner-abort" | "runner-complete" | "runner-timeout";
      }>;
    }>;

export type TargetToRunnerFrameV2 =
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "channel-request";
      value: ChannelRequestV2;
    }>
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "conclusion";
      value: TargetConclusionV2;
    }>
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "ready";
      value: Readonly<{ sessionBindingSha256: string }>;
    }>
  | Readonly<{
      schemaVersion: typeof FRAME_SCHEMA;
      sequence: number;
      type: "target-error";
      value: Readonly<{ errorCode: "input-rejected" | "target-failed" }>;
    }>;

export type AdapterFrameV2 = RunnerToTargetFrameV2 | TargetToRunnerFrameV2;
