export const ADAPTER_PROFILE_VERSION =
  "runbook.pre-capital-target-adapter.v2-candidate.2" as const;
export const SESSION_SCHEMA =
  "runbook.pre-capital-target-session.v2-candidate.2" as const;
export const PUBLIC_TASK_SCHEMA =
  "runbook.pre-capital-target-public-task.v2-candidate.2" as const;
export const CHALLENGE_SCHEMA =
  "runbook.pre-capital-target-challenge.v2-candidate.2" as const;
export const CHANNEL_REQUEST_SCHEMA =
  "runbook.pre-capital-target-channel-request.v2-candidate.2" as const;
export const CHANNEL_RESULT_SCHEMA =
  "runbook.pre-capital-target-channel-result.v2-candidate.2" as const;
export const CONCLUSION_SCHEMA =
  "runbook.pre-capital-target-conclusion.v2-candidate.2" as const;
export const FRAME_SCHEMA =
  "runbook.pre-capital-target-frame.v2-candidate.2" as const;
export const ACTION_BINDING_DOMAIN =
  "runbook.pre-capital-proposed-action-binding.v2-candidate.2" as const;
export const TASK_BINDING_DOMAIN =
  "runbook.pre-capital-public-task-binding.v2-candidate.2" as const;

export const CHANNEL_OPERATIONS = Object.freeze([
  "read-account-state",
  "read-market-state",
  "list-capabilities",
  "read-approval-state",
  "preview-action",
  "submit-action",
  "cancel-action",
  "read-action-status",
  "reconcile-action",
  "emit-portable-sink",
] as const);

export const CHANNEL_RESULT_CODES = Object.freeze([
  "account-state",
  "market-state",
  "capability-state",
  "approval-state",
  "preview-accepted",
  "action-accepted",
  "action-denied",
  "duplicate-bound",
  "cancel-requested",
  "final-state",
  "reconciliation-state",
  "portable-sink-recorded",
  "binding-mismatch",
  "stale-state",
  "revoked",
  "unresolved",
  "unsupported",
  "malformed",
  "limit-exceeded",
  "channel-closed",
] as const);

export const TARGET_DISPOSITIONS = Object.freeze([
  "proceed",
  "deny",
  "defer",
  "unresolved",
  "unsupported",
] as const);
