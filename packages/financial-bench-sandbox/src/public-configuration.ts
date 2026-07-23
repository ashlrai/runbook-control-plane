import { canonicalizeJcs, jcsBytes, rawStringCompare } from "./canonical.js";
import { MAX_PUBLIC_CONFIGURATION_BYTES, SANDBOX_ADAPTER_CONTRACT_SHA256 } from "./profile.js";
import {
  SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
  type SandboxPublicConfigurationV1,
} from "./types.js";

export class SandboxValidationError extends Error {
  readonly name = "SandboxValidationError";
  constructor(readonly code: string) {
    super(code);
  }
}

const fail = (code: string): never => {
  throw new SandboxValidationError(code);
};

const ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

function ownRecord(value: unknown, code: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value as object);
  const ownKeys = Reflect.ownKeys(value as object);
  if (ownKeys.some((key) => typeof key !== "string")) fail(code);
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
    output[key] = ownedDescriptor.value;
  }
  return output;
}

function exactKeys(input: Record<string, unknown>, expected: readonly string[], code: string) {
  const actual = Object.keys(input).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code);
  }
}

function exact(value: unknown, expected: string, code: string): string {
  if (value !== expected) fail(code);
  return expected;
}

function identifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !ID.test(value)) fail(code);
  return value as string;
}

export function parseSandboxPublicConfiguration(value: unknown): SandboxPublicConfigurationV1 {
  const code = "public-configuration.invalid";
  const input = ownRecord(value, code);
  exactKeys(
    input,
    ["adapterContractSha256", "adapterId", "configurationId", "mode", "schemaVersion"],
    code,
  );
  return {
    adapterContractSha256: exact(
      input.adapterContractSha256,
      SANDBOX_ADAPTER_CONTRACT_SHA256,
      code,
    ),
    adapterId: identifier(input.adapterId, code),
    configurationId: identifier(input.configurationId, code),
    mode: exact(input.mode, "broker-disconnected-synthetic", code) as "broker-disconnected-synthetic",
    schemaVersion: exact(input.schemaVersion, SANDBOX_PUBLIC_CONFIGURATION_SCHEMA, code) as typeof SANDBOX_PUBLIC_CONFIGURATION_SCHEMA,
  };
}

export function serializeSandboxPublicConfiguration(value: unknown): Uint8Array {
  const parsed = parseSandboxPublicConfiguration(value);
  const bytes = jcsBytes(parsed);
  if (bytes.byteLength > MAX_PUBLIC_CONFIGURATION_BYTES) {
    fail("public-configuration.bytes-invalid");
  }
  return bytes;
}

export function parseExactJcsPublicConfigurationBytes(
  bytes: Uint8Array,
): SandboxPublicConfigurationV1 {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > MAX_PUBLIC_CONFIGURATION_BYTES ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) {
    fail("public-configuration.bytes-invalid");
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    fail("public-configuration.bytes-invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail("public-configuration.bytes-invalid");
  }
  const parsed = parseSandboxPublicConfiguration(value);
  if (canonicalizeJcs(parsed) !== text) fail("public-configuration.bytes-noncanonical");
  return parsed;
}
