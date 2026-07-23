import { canonicalizeJcs, rawStringCompare } from "./canonical.js";
import { SANDBOX_INSPECTION_POLICY } from "./profile.js";
import {
  SANDBOX_EVIDENCE_SCHEMA,
  SANDBOX_ISOLATION,
  SANDBOX_LIMITATIONS,
  SANDBOX_PROFILE,
  type SandboxEvidenceV1,
  type SandboxInspectionSnapshotV1,
  type SandboxSessionEvidenceV1,
} from "./types.js";
import {
  SandboxValidationError,
  parseSandboxPublicConfiguration,
} from "./public-configuration.js";

const HASH = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const SCENARIO_IDS = [
  "scenario-00-allowed-baseline",
  "scenario-01-wrong-account",
  "scenario-04-undocumented-tool",
  "scenario-05-mutation-capability-drift",
  "scenario-06-incompatible-schema-drift",
] as const;
const LIFECYCLE = [
  "created",
  "policy-inspected",
  "ready",
  "scenario-closed",
  "removed",
] as const;

const fail = (code: string): never => {
  throw new SandboxValidationError(code);
};

/** Copies only plain own data without invoking accessors. */
function ownPlainData(value: unknown, code: string): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  const copy = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) fail(code);
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean" ||
      typeof current === "number"
    ) {
      return current;
    }
    if (typeof current !== "object" || active.has(current)) fail(code);
    const object = current as object;
    active.add(object);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(object);
      const ownKeys = Reflect.ownKeys(object);
      if (ownKeys.some((key) => typeof key !== "string")) fail(code);
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) fail(code);
        const output: unknown[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined) fail(code);
          const ownedDescriptor = descriptor as PropertyDescriptor;
          if (
            !("value" in ownedDescriptor) ||
            ownedDescriptor.get !== undefined ||
            ownedDescriptor.set !== undefined ||
            ownedDescriptor.enumerable !== true
          ) {
            fail(code);
          }
          output.push(copy(ownedDescriptor.value, depth + 1));
        }
        if (ownKeys.length !== current.length + 1) fail(code);
        return output;
      }
      if (Object.getPrototypeOf(current) !== Object.prototype) fail(code);
      const output: Record<string, unknown> = {};
      for (const key of ownKeys as string[]) {
        const descriptor = descriptors[key];
        if (descriptor === undefined) fail(code);
        const ownedDescriptor = descriptor as PropertyDescriptor;
        if (
          !("value" in ownedDescriptor) ||
          ownedDescriptor.get !== undefined ||
          ownedDescriptor.set !== undefined ||
          ownedDescriptor.enumerable !== true
        ) {
          fail(code);
        }
        output[key] = copy(ownedDescriptor.value, depth + 1);
      }
      return output;
    } finally {
      active.delete(object);
    }
  };
  return copy(value, 0);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function keys(input: Record<string, unknown>, expected: readonly string[], code: string) {
  const actual = Object.keys(input).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code);
  }
}

function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  code: string,
): T {
  if (value !== expected) fail(code);
  return expected;
}

function string(value: unknown, code: string, max = 512): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) fail(code);
  return value as string;
}

function hash(value: unknown, code: string): string {
  const parsed = string(value, code, 64);
  if (!HASH.test(parsed)) fail(code);
  return parsed;
}

function integer(value: unknown, code: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail(code);
  }
  return value as number;
}

function array(value: unknown, code: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value as unknown[];
}

function parseInspection(value: unknown, code: string): SandboxInspectionSnapshotV1 {
  const input = record(value, code);
  keys(input, Object.keys(SANDBOX_INSPECTION_POLICY), code);
  if (canonicalizeJcs(input) !== canonicalizeJcs(SANDBOX_INSPECTION_POLICY)) fail(code);
  return SANDBOX_INSPECTION_POLICY;
}

function parseSession(value: unknown, ordinal: number): SandboxSessionEvidenceV1 {
  const code = "evidence.session-invalid";
  const input = record(value, code);
  keys(
    input,
    [
      "cleanupComplete",
      "diagnosticSha256",
      "environmentAcknowledgement",
      "executionNonce",
      "launchBindingSha256",
      "lifecycle",
      "ordinal",
      "orphanAuditPassed",
      "processOutcome",
      "scenarioEvidenceSha256",
      "scenarioId",
    ],
    code,
  );
  const acknowledgement = record(input.environmentAcknowledgement, code);
  keys(
    acknowledgement,
    [
      "adapterContractSha256",
      "bundleSha256",
      "executionNonce",
      "launchBindingSha256",
      "publicConfigurationSha256",
    ],
    code,
  );
  const executionNonce = string(input.executionNonce, code, 64);
  if (!NONCE.test(executionNonce)) fail(code);
  const lifecycle = array(input.lifecycle, code, LIFECYCLE.length);
  if (
    lifecycle.length !== LIFECYCLE.length ||
    lifecycle.some((entry, index) => entry !== LIFECYCLE[index])
  ) {
    fail(code);
  }
  const processOutcome = string(input.processOutcome, code, 32);
  if (!["exited-zero", "force-killed"].includes(processOutcome)) {
    fail(code);
  }
  return {
    cleanupComplete: literal(input.cleanupComplete, true, code),
    diagnosticSha256: hash(input.diagnosticSha256, code),
    environmentAcknowledgement: {
      adapterContractSha256: hash(acknowledgement.adapterContractSha256, code),
      bundleSha256: hash(acknowledgement.bundleSha256, code),
      publicConfigurationSha256: hash(
        acknowledgement.publicConfigurationSha256,
        code,
      ),
      executionNonce: string(acknowledgement.executionNonce, code, 64),
      launchBindingSha256: hash(acknowledgement.launchBindingSha256, code),
    },
    executionNonce,
    launchBindingSha256: hash(input.launchBindingSha256, code),
    lifecycle: LIFECYCLE,
    ordinal: literal(input.ordinal, ordinal, code),
    orphanAuditPassed: literal(input.orphanAuditPassed, true, code),
    processOutcome: processOutcome as SandboxSessionEvidenceV1["processOutcome"],
    scenarioEvidenceSha256: hash(input.scenarioEvidenceSha256, code),
    scenarioId: literal(input.scenarioId, SCENARIO_IDS[ordinal]!, code),
  };
}

export function parseSandboxEvidence(value: unknown): SandboxEvidenceV1 {
  const code = "evidence.invalid";
  const input = record(ownPlainData(value, code), code);
  keys(
    input,
    [
      "adapter",
      "innerHarness",
      "isolation",
      "limitations",
      "policy",
      "profileVersion",
      "publicConfiguration",
      "runner",
      "runtime",
      "schemaVersion",
      "sessions",
    ],
    code,
  );
  const adapter = record(input.adapter, code);
  keys(adapter, ["adapterContractSha256", "adapterId", "bundleByteCount", "bundleSha256"], code);
  const publicConfiguration = record(input.publicConfiguration, code);
  keys(publicConfiguration, ["bytesSha256", "value"], code);
  const configurationValue = parseSandboxPublicConfiguration(publicConfiguration.value);
  const runner = record(input.runner, code);
  keys(runner, ["hostRunnerSha256", "launcherSha256"], code);
  const runtime = record(input.runtime, code);
  keys(runtime, ["architecture", "imageId", "imageReference", "operatingSystem"], code);
  const policy = record(input.policy, code);
  keys(policy, ["inspection", "inspectionSha256", "policySha256"], code);
  const inner = record(input.innerHarness, code);
  keys(inner, ["evidenceJson", "evidenceSha256", "receiptJson", "receiptSha256"], code);
  const limitations = array(input.limitations, code, SANDBOX_LIMITATIONS.length);
  if (
    limitations.length !== SANDBOX_LIMITATIONS.length ||
    limitations.some((entry, index) => entry !== SANDBOX_LIMITATIONS[index])
  ) {
    fail(code);
  }
  const sessions = array(input.sessions, code, SCENARIO_IDS.length);
  if (sessions.length !== SCENARIO_IDS.length) fail(code);
  const architecture = string(runtime.architecture, code, 64);
  if (architecture !== "amd64" && architecture !== "arm64") fail(code);
  const imageId = string(runtime.imageId, code, 71);
  if (!IMAGE_ID.test(imageId)) fail(code);
  const evidenceJson = string(inner.evidenceJson, code, 1_048_576);
  const receiptJson = string(inner.receiptJson, code, 262_144);
  return {
    adapter: {
      adapterContractSha256: hash(adapter.adapterContractSha256, code),
      adapterId: string(adapter.adapterId, code, 64),
      bundleByteCount: integer(adapter.bundleByteCount, code, 1, 32 * 1024 * 1024),
      bundleSha256: hash(adapter.bundleSha256, code),
    },
    innerHarness: {
      evidenceJson,
      evidenceSha256: hash(inner.evidenceSha256, code),
      receiptJson,
      receiptSha256: hash(inner.receiptSha256, code),
    },
    isolation: literal(input.isolation, SANDBOX_ISOLATION, code),
    limitations: SANDBOX_LIMITATIONS,
    policy: {
      inspection: parseInspection(policy.inspection, code),
      inspectionSha256: hash(policy.inspectionSha256, code),
      policySha256: hash(policy.policySha256, code),
    },
    profileVersion: literal(input.profileVersion, SANDBOX_PROFILE, code),
    publicConfiguration: {
      bytesSha256: hash(publicConfiguration.bytesSha256, code),
      value: configurationValue,
    },
    runner: {
      hostRunnerSha256: hash(runner.hostRunnerSha256, code),
      launcherSha256: hash(runner.launcherSha256, code),
    },
    runtime: {
      architecture,
      imageId,
      imageReference: string(runtime.imageReference, code, 512),
      operatingSystem: literal(runtime.operatingSystem, "linux", code),
    },
    schemaVersion: literal(input.schemaVersion, SANDBOX_EVIDENCE_SCHEMA, code),
    sessions: sessions.map((session, ordinal) => parseSession(session, ordinal)),
  };
}

export function parseExactJcsSandboxEvidenceBytes(bytes: Uint8Array): SandboxEvidenceV1 {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > 2_097_152 ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) {
    fail("evidence.bytes-invalid");
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    fail("evidence.bytes-invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail("evidence.bytes-invalid");
  }
  const evidence = parseSandboxEvidence(value);
  if (canonicalizeJcs(evidence) !== text) fail("evidence.bytes-noncanonical");
  return evidence;
}
