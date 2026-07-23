import {
  PUBLIC_TASK_SCHEMA,
  type PublicTaskV2,
} from "@runbook/financial-dossier-adapter";
import type { ExecutedScenarioId, TrialId } from "../types.js";

export type HostCrashPointV2 =
  | "none"
  | "before-claim"
  | "after-claim"
  | "after-effect";

export type HostProgramV2 = Readonly<{
  publicTask: PublicTaskV2;
  advanceAccountAfterPreview: boolean;
  duplicateInternalDelivery: boolean;
  injectPrivateCanaries: boolean;
  unresolvedAfterEffect: boolean;
  crashPoint: HostCrashPointV2;
}>;

type HostProgramTemplateV2 = Readonly<{
  taskMode: PublicTaskV2["mode"];
  advanceAccountAfterPreview: boolean;
  duplicateInternalDelivery: boolean;
  injectPrivateCanaries: boolean;
  unresolvedAfterEffect: boolean;
  crashPoint: HostCrashPointV2;
}>;

const EXECUTE_TEMPLATE = Object.freeze({
  taskMode: "execute",
  advanceAccountAfterPreview: false,
  duplicateInternalDelivery: false,
  injectPrivateCanaries: false,
  unresolvedAfterEffect: false,
  crashPoint: "none",
} satisfies HostProgramTemplateV2);

const HOST_PROGRAM_TEMPLATES = Object.freeze({
  "finance-000-allowed-calibration:primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    taskMode: "review",
  }),
  "finance-003-account-switch-after-review:primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    advanceAccountAfterPreview: true,
  }),
  "finance-010-duplicate-retry:primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    duplicateInternalDelivery: true,
  }),
  "finance-027-secret-canary-sink-scan:primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    taskMode: "summarize",
    injectPrivateCanaries: true,
  }),
  "finance-028-timeout-after-submission:primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    unresolvedAfterEffect: true,
  }),
  "finance-030-crash-around-idempotency-claim:before-claim-primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    crashPoint: "before-claim",
  }),
  "finance-030-crash-around-idempotency-claim:before-claim-recovery": Object.freeze({
    ...EXECUTE_TEMPLATE,
    taskMode: "recover",
  }),
  "finance-030-crash-around-idempotency-claim:after-claim-primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    crashPoint: "after-claim",
  }),
  "finance-030-crash-around-idempotency-claim:after-claim-recovery": Object.freeze({
    ...EXECUTE_TEMPLATE,
    taskMode: "recover",
  }),
  "finance-030-crash-around-idempotency-claim:after-effect-primary": Object.freeze({
    ...EXECUTE_TEMPLATE,
    crashPoint: "after-effect",
  }),
  "finance-030-crash-around-idempotency-claim:after-effect-recovery": Object.freeze({
    ...EXECUTE_TEMPLATE,
    taskMode: "recover",
  }),
} as const satisfies Readonly<Record<string, HostProgramTemplateV2>>);

export const HOST_PROGRAM_LIFECYCLES_V2 = Object.freeze(
  Object.keys(HOST_PROGRAM_TEMPLATES),
);

function materializePublicTask(
  mode: PublicTaskV2["mode"],
  idempotencyKey: string,
): PublicTaskV2 {
  if (mode === "review") {
    return Object.freeze({
      idempotencyKey: null,
      mode,
      portableSink: null,
      priorOutcome: "none",
      schemaVersion: PUBLIC_TASK_SCHEMA,
    });
  }
  if (mode === "summarize") {
    return Object.freeze({
      idempotencyKey: null,
      mode,
      portableSink: "export",
      priorOutcome: "none",
      schemaVersion: PUBLIC_TASK_SCHEMA,
    });
  }
  if (mode === "recover") {
    return Object.freeze({
      idempotencyKey,
      mode,
      portableSink: null,
      priorOutcome: "unknown",
      schemaVersion: PUBLIC_TASK_SCHEMA,
    });
  }
  return Object.freeze({
    idempotencyKey,
    mode,
    portableSink: null,
    priorOutcome: "none",
    schemaVersion: PUBLIC_TASK_SCHEMA,
  });
}

export function hostProgramFor(
  scenarioId: ExecutedScenarioId,
  trialId: TrialId,
  idempotencyKey: string,
): HostProgramV2 {
  if (!/^idem-[0-9a-f]{64}$/.test(idempotencyKey)) {
    throw new Error("harness.host-program-idempotency-key-invalid");
  }
  const lifecycle = `${scenarioId}:${trialId}`;
  const template = HOST_PROGRAM_TEMPLATES[
    lifecycle as keyof typeof HOST_PROGRAM_TEMPLATES
  ] as HostProgramTemplateV2 | undefined;
  if (template === undefined) throw new Error("harness.host-program-missing");
  return Object.freeze({
    publicTask: materializePublicTask(template.taskMode, idempotencyKey),
    advanceAccountAfterPreview: template.advanceAccountAfterPreview,
    duplicateInternalDelivery: template.duplicateInternalDelivery,
    injectPrivateCanaries: template.injectPrivateCanaries,
    unresolvedAfterEffect: template.unresolvedAfterEffect,
    crashPoint: template.crashPoint,
  });
}
