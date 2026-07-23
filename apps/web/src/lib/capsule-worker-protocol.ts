import type { ProofVerificationReceipt } from "@runbook/capsule-browser";

export const MAX_BROWSER_CAPSULE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 30_000;

export type CapsuleWorkerStage = "reading" | "verifying" | "serializing";

export type CapsuleWorkerRequest =
  | { kind: "probe"; requestId: number }
  | { kind: "verify"; requestId: number; capsule: Blob };

export type CapsuleWorkerResponse =
  | { kind: "ready"; requestId: number }
  | { kind: "progress"; requestId: number; stage: CapsuleWorkerStage }
  | {
      kind: "receipt";
      requestId: number;
      receipt: ProofVerificationReceipt;
      receiptBytes: ArrayBuffer;
      archiveSha256: string;
    }
  | {
      kind: "environment-error";
      requestId: number;
      code:
        | "crypto.unavailable"
        | "crypto.operation-failed"
        | "input.empty"
        | "input.size-limit"
        | "input.read-failed"
        | "worker.failure";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function looksLikeReceipt(value: unknown): value is ProofVerificationReceipt {
  return isRecord(value)
    && value.schemaVersion === "runbook.proof-verification.v1"
    && value.verifierProfile === "runbook.proof-capsule.v1"
    && typeof value.valid === "boolean"
    && Array.isArray(value.errors)
    && Array.isArray(value.warnings)
    && Array.isArray(value.members)
    && Array.isArray(value.limitations)
    && isRecord(value.assurance);
}

const ENVIRONMENT_CODES = new Set([
  "crypto.unavailable",
  "crypto.operation-failed",
  "input.empty",
  "input.size-limit",
  "input.read-failed",
  "worker.failure",
]);

/** Treats every Worker message as untrusted until its small outer contract passes. */
export function parseCapsuleWorkerResponse(value: unknown): CapsuleWorkerResponse | null {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.kind !== "string") return null;

  if (value.kind === "ready") return { kind: "ready", requestId: value.requestId };
  if (
    value.kind === "progress"
    && (value.stage === "reading" || value.stage === "verifying" || value.stage === "serializing")
  ) {
    return { kind: "progress", requestId: value.requestId, stage: value.stage };
  }
  if (
    value.kind === "receipt"
    && looksLikeReceipt(value.receipt)
    && value.receiptBytes instanceof ArrayBuffer
    && typeof value.archiveSha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.archiveSha256)
  ) {
    return {
      kind: "receipt",
      requestId: value.requestId,
      receipt: value.receipt,
      receiptBytes: value.receiptBytes,
      archiveSha256: value.archiveSha256,
    };
  }
  if (
    value.kind === "environment-error"
    && typeof value.code === "string"
    && ENVIRONMENT_CODES.has(value.code)
  ) {
    return value as CapsuleWorkerResponse;
  }
  return null;
}

export function validateCapsuleSelection(size: number): "input.empty" | "input.size-limit" | null {
  if (!Number.isSafeInteger(size) || size < 1) return "input.empty";
  if (size > MAX_BROWSER_CAPSULE_BYTES) return "input.size-limit";
  return null;
}
