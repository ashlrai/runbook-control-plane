import { canonicalizeJcs, rawStringCompare, sha256Jcs } from "./canonical.js";
import { StrictJsonError, parseStrictJson } from "./strict-json.js";
import {
  ACCOUNT_SCOPES,
  ACTION_FAMILIES,
  APPROVAL_ACTION_BINDINGS,
  APPROVAL_BYPASS_CONDITIONS,
  APPROVAL_ENFORCING_PRINCIPALS,
  APPROVAL_EXPIRY_BINDINGS,
  APPROVAL_MODES,
  APPROVAL_SCOPE_BINDINGS,
  ASSET_SCOPES,
  CAPABILITY_SNAPSHOT_SCHEMA,
  CAPITAL_OPERATIONS,
  CONTRACT_STATES,
  CREDENTIAL_RELEASE_CLASSES,
  DATA_SCOPES,
  DECISION_INFLUENCE_CLASSES,
  EVIDENCE_LEVELS,
  FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
  IDENTITY_KINDS,
  MUTATION_SCOPES,
  SOURCE_AUTHORITIES,
  SOURCE_COMPLETENESS,
  STATE_DOMAINS,
  type ApprovalSemanticsV1,
  type CapabilitySnapshotV1,
  type CapabilitySourceV1,
  type CapitalAuthorityV1,
  type ContractDigestV1,
  type EvidenceLevel,
  type FinancialCapabilityV1,
  type SourceAuthority,
} from "./types.js";

const HASH = /^[0-9a-f]{64}$/;
const IDENTITY = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const TOOL_NAME = /^[a-z][a-z0-9_.-]{0,127}$/;
const MUTATION_CLASSES = [
  "capital-moving",
  "emergency",
  "read",
  "reversible",
  "unknown",
] as const;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export class RegistryValidationError extends Error {
  readonly name = "RegistryValidationError";

  constructor(readonly code: string) {
    super(code);
  }
}

const fail = (code: string): never => {
  throw new RegistryValidationError(code);
};

/**
 * Produces a fresh plain-data copy while rejecting accessors, exotic
 * prototypes, symbols, sparse arrays, cycles, and excessive object graphs.
 * Proxy meta-object traps cannot be reliably detected by JavaScript; untrusted
 * transport should therefore enter through the exact-byte parser.
 */
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
      const prototype = Object.getPrototypeOf(object);
      const descriptors = Object.getOwnPropertyDescriptors(object);
      const ownKeys = Reflect.ownKeys(object);
      if (ownKeys.some((key) => typeof key !== "string")) fail(code);
      if (Array.isArray(object)) {
        if (prototype !== Array.prototype) fail(code);
        const lengthDescriptor = descriptors.length;
        if (
          lengthDescriptor === undefined ||
          !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0 ||
          ownKeys.length !== lengthDescriptor.value + 1
        ) {
          fail(code);
        }
        const length = (
          lengthDescriptor as PropertyDescriptor & { value: number }
        ).value;
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            descriptor === undefined ||
            !("value" in descriptor) ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined ||
            descriptor.enumerable !== true
          ) {
            fail(code);
          }
          const ownedDescriptor = descriptor as PropertyDescriptor & { value: unknown };
          output.push(copy(ownedDescriptor.value, depth + 1));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) fail(code);
      const output: Record<string, unknown> = {};
      for (const key of ownKeys as string[]) {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true
        ) {
          fail(code);
        }
        const ownedDescriptor = descriptor as PropertyDescriptor & { value: unknown };
        output[key] = copy(ownedDescriptor.value, depth + 1);
      }
      return output;
    } catch (error) {
      if (error instanceof RegistryValidationError) throw error;
      fail(code);
    } finally {
      active.delete(object);
    }
  };
  return copy(value, 0);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code);
  }
}

function string(value: unknown, code: string, max = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) fail(code);
  return value as string;
}

function hash(value: unknown, code: string): string {
  const output = string(value, code, 64);
  if (!HASH.test(output)) fail(code);
  return output;
}

function nullableHash(value: unknown, code: string): string | null {
  return value === null ? null : hash(value, code);
}

function identifier(value: unknown, code: string): string {
  const output = string(value, code, 128);
  if (!IDENTITY.test(output)) fail(code);
  return output;
}

function providerToolName(value: unknown, code: string): string {
  const output = string(value, code, 128);
  if (!TOOL_NAME.test(output)) fail(code);
  return output;
}

function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  code: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(code);
  return value as T;
}

function array(value: unknown, code: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(code);
  return value as unknown[];
}

function sortedUnique(values: readonly string[], code: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (rawStringCompare(values[index - 1] ?? "", values[index] ?? "") >= 0) fail(code);
  }
}

function enumArray<T extends string>(
  value: unknown,
  choices: readonly T[],
  code: string,
  options: Readonly<{ allowEmpty?: boolean; exclusive?: readonly T[] }> = {},
): T[] {
  const output = array(
    value,
    code,
    options.allowEmpty === true ? 0 : 1,
    choices.length,
  ).map((entry) => choice(entry, choices, code));
  sortedUnique(output, code);
  for (const exclusive of options.exclusive ?? []) {
    if (output.includes(exclusive) && output.length !== 1) fail(code);
  }
  return output;
}

function integer(value: unknown, code: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail(code);
  }
  return value as number;
}

function exact<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  code: string,
): T {
  if (value !== expected) fail(code);
  return expected;
}

function utcTimestamp(value: unknown, code: string): string {
  const output = string(value, code, 24);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(
    output,
  );
  if (match === null || match[1] === "0000") fail(code);
  const timestampMatch = match as RegExpExecArray;
  const parsed = Date.parse(output);
  if (!Number.isFinite(parsed)) fail(code);
  const normalized =
    timestampMatch[7] === undefined ? output.replace("Z", ".000Z") : output;
  if (new Date(parsed).toISOString() !== normalized) fail(code);
  return output;
}

function publicHttpsUri(value: unknown, code: string): string {
  const output = string(value, code, 2_048);
  if (!/^[\x21-\x7e]+$/.test(output)) fail(code);
  try {
    const parsed = new URL(output);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== "" ||
      parsed.href !== output
    ) {
      fail(code);
    }
  } catch (error) {
    if (error instanceof RegistryValidationError) throw error;
    fail(code);
  }
  return output;
}

function parseSource(value: unknown): CapabilitySourceV1 {
  const code = "snapshot.source-invalid";
  const input = record(value, code);
  exactKeys(
    input,
    [
      "authority",
      "completeness",
      "publicUri",
      "retrievedAtDeclared",
      "sourceId",
      "sourceProjectionSha256",
    ],
    code,
  );
  const authority = choice(input.authority, SOURCE_AUTHORITIES, code);
  let publicUri: string | null;
  if (authority === "public-documentation") {
    publicUri = publicHttpsUri(input.publicUri, code);
  } else {
    if (input.publicUri !== null) fail(code);
    publicUri = null;
  }
  return {
    authority,
    completeness: choice(input.completeness, SOURCE_COMPLETENESS, code),
    publicUri,
    retrievedAtDeclared: utcTimestamp(input.retrievedAtDeclared, code),
    sourceId: identifier(input.sourceId, code),
    sourceProjectionSha256: hash(input.sourceProjectionSha256, code),
  };
}

function parseContract(value: unknown, code: string): ContractDigestV1 {
  const input = record(value, code);
  exactKeys(input, ["sha256", "state"], code);
  const state = choice(input.state, CONTRACT_STATES, code);
  const sha256 = nullableHash(input.sha256, code);
  if ((state === "known") !== (sha256 !== null)) fail(code);
  return { sha256, state };
}

function parseCapitalAuthority(value: unknown, code: string): CapitalAuthorityV1 {
  const input = record(value, code);
  exactKeys(input, ["assetScopes", "operations"], code);
  const operations = enumArray(input.operations, CAPITAL_OPERATIONS, code, {
    allowEmpty: true,
    exclusive: ["unknown"],
  });
  const assetScopes = enumArray(input.assetScopes, ASSET_SCOPES, code, {
    allowEmpty: true,
    exclusive: ["unknown"],
  });
  if ((operations.length === 0) !== (assetScopes.length === 0)) fail(code);
  return { assetScopes, operations };
}

function parseApprovalSemantics(value: unknown, code: string): ApprovalSemanticsV1 {
  const input = record(value, code);
  exactKeys(
    input,
    [
      "actionBinding",
      "bypassCondition",
      "enforcingPrincipal",
      "expiryBinding",
      "mode",
      "scopeBinding",
    ],
    code,
  );
  const output: ApprovalSemanticsV1 = {
    actionBinding: choice(input.actionBinding, APPROVAL_ACTION_BINDINGS, code),
    bypassCondition: choice(
      input.bypassCondition,
      APPROVAL_BYPASS_CONDITIONS,
      code,
    ),
    enforcingPrincipal: choice(
      input.enforcingPrincipal,
      APPROVAL_ENFORCING_PRINCIPALS,
      code,
    ),
    expiryBinding: choice(input.expiryBinding, APPROVAL_EXPIRY_BINDINGS, code),
    mode: choice(input.mode, APPROVAL_MODES, code),
    scopeBinding: choice(input.scopeBinding, APPROVAL_SCOPE_BINDINGS, code),
  };
  if (
    output.mode === "none" &&
    (output.actionBinding !== "none" ||
      output.bypassCondition !== "none" ||
      output.enforcingPrincipal !== "none" ||
      output.expiryBinding !== "none" ||
      output.scopeBinding !== "none")
  ) {
    fail(code);
  }
  if (output.mode !== "none" && output.mode !== "unknown" && output.enforcingPrincipal === "none") {
    fail(code);
  }
  return output;
}

function evidenceHasAuthority(
  level: EvidenceLevel,
  authorities: ReadonlySet<SourceAuthority>,
): boolean {
  if (level === "public-derived" || level === "public-explicit") {
    return authorities.has("public-documentation");
  }
  if (level === "runtime-confirmed") {
    return authorities.has("authenticated-runtime-discovery") ||
      authorities.has("controlled-runtime-exercise");
  }
  return authorities.has("controlled-runtime-exercise");
}

function parseCapability(
  value: unknown,
  sourceById: ReadonlyMap<string, CapabilitySourceV1>,
): FinancialCapabilityV1 {
  const code = "snapshot.capability-invalid";
  const input = record(value, code);
  exactKeys(
    input,
    [
      "accountScope",
      "actionFamilies",
      "approvalSemantics",
      "capitalAuthority",
      "capabilityId",
      "credentialRelease",
      "dataScopes",
      "decisionInfluence",
      "descriptionContract",
      "identityEvidence",
      "identityKind",
      "mutationClass",
      "mutationScopes",
      "providerToolName",
      "requestContract",
      "responseContract",
      "riskEvidence",
      "sourceAssertionSha256",
      "sourceIds",
      "stateReadDomains",
      "stateWriteDomains",
      "workflowPrerequisiteCapabilityIds",
    ],
    code,
  );
  const identityKind = choice(input.identityKind, IDENTITY_KINDS, code);
  const toolName =
    input.providerToolName === null ? null : providerToolName(input.providerToolName, code);
  if ((identityKind === "documented-operation") !== (toolName === null)) fail(code);
  const sourceIds = array(input.sourceIds, code, 1, 16).map((entry) =>
    identifier(entry, code),
  );
  sortedUnique(sourceIds, code);
  const sources = sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (source === undefined) fail(code);
    return source as CapabilitySourceV1;
  });
  const sourceAuthorities = new Set(sources.map((source) => source.authority));
  const identityEvidence = choice(input.identityEvidence, EVIDENCE_LEVELS, code);
  const riskEvidence = choice(input.riskEvidence, EVIDENCE_LEVELS, code);
  if (
    !evidenceHasAuthority(identityEvidence, sourceAuthorities) ||
    !evidenceHasAuthority(riskEvidence, sourceAuthorities)
  ) {
    fail(code);
  }
  if (
    identityKind === "documented-operation" &&
    identityEvidence !== "public-derived"
  ) {
    fail(code);
  }
  if (
    identityKind === "published-tool-name" &&
    identityEvidence !== "public-explicit"
  ) {
    fail(code);
  }
  if (
    identityKind === "runtime-tool-name" &&
    identityEvidence !== "runtime-confirmed" &&
    identityEvidence !== "runtime-exercised"
  ) {
    fail(code);
  }
  const actionFamilies = enumArray(input.actionFamilies, ACTION_FAMILIES, code, {
    exclusive: ["unknown"],
  });
  const dataScopes = enumArray(input.dataScopes, DATA_SCOPES, code, {
    exclusive: ["unknown"],
  });
  const mutationScopes = enumArray(input.mutationScopes, MUTATION_SCOPES, code, {
    exclusive: ["none", "unknown"],
  });
  const stateReadDomains = enumArray(input.stateReadDomains, STATE_DOMAINS, code, {
    exclusive: ["none", "unknown"],
  });
  const stateWriteDomains = enumArray(input.stateWriteDomains, STATE_DOMAINS, code, {
    exclusive: ["none", "unknown"],
  });
  const workflowPrerequisiteCapabilityIds = array(
    input.workflowPrerequisiteCapabilityIds,
    code,
    0,
    64,
  ).map((entry) => identifier(entry, code));
  sortedUnique(workflowPrerequisiteCapabilityIds, code);
  const mutationClass = choice(input.mutationClass, MUTATION_CLASSES, code);
  if (mutationClass !== "read" && mutationScopes.length === 1 && mutationScopes[0] === "none") {
    fail(code);
  }
  const credentialRelease = choice(
    input.credentialRelease,
    CREDENTIAL_RELEASE_CLASSES,
    code,
  );
  const modelsCredentialRelease = mutationScopes.includes("credential-release");
  if (
    (credentialRelease === "none" && modelsCredentialRelease) ||
    (credentialRelease !== "none" &&
      credentialRelease !== "unknown" &&
      !modelsCredentialRelease) ||
    (credentialRelease === "unknown" &&
      (mutationScopes.length !== 1 || mutationScopes[0] !== "unknown"))
  ) {
    fail(code);
  }
  if (
    credentialRelease !== "none" &&
    credentialRelease !== "unknown" &&
    credentialRelease === "payment-credential" &&
    !dataScopes.includes("payment-credentials")
  ) {
    fail(code);
  }
  const capitalAuthority = parseCapitalAuthority(input.capitalAuthority, code);
  const capitalMutations = capitalAuthority.operations.some((operation) =>
    ["cancel", "replace", "spend", "submit", "transfer"].includes(operation),
  );
  if (
    capitalMutations &&
    !mutationScopes.includes("capital-orders") &&
    !mutationScopes.includes("payments") &&
    !mutationScopes.includes("unknown")
  ) {
    fail(code);
  }
  return {
    accountScope: choice(input.accountScope, ACCOUNT_SCOPES, code),
    actionFamilies,
    approvalSemantics: parseApprovalSemantics(input.approvalSemantics, code),
    capitalAuthority,
    capabilityId: identifier(input.capabilityId, code),
    credentialRelease,
    dataScopes,
    decisionInfluence: choice(
      input.decisionInfluence,
      DECISION_INFLUENCE_CLASSES,
      code,
    ),
    descriptionContract: parseContract(input.descriptionContract, code),
    identityEvidence,
    identityKind,
    mutationClass,
    mutationScopes,
    providerToolName: toolName,
    requestContract: parseContract(input.requestContract, code),
    responseContract: parseContract(input.responseContract, code),
    riskEvidence,
    sourceAssertionSha256: hash(input.sourceAssertionSha256, code),
    sourceIds,
    stateReadDomains,
    stateWriteDomains,
    workflowPrerequisiteCapabilityIds,
  };
}

export function parseCapabilitySnapshot(value: unknown): CapabilitySnapshotV1 {
  const code = "snapshot.invalid";
  const input = record(ownPlainData(value, code), code);
  exactKeys(
    input,
    [
      "capabilities",
      "observedAtDeclared",
      "previousAdmittedSnapshotSha256",
      "productId",
      "profileVersion",
      "providerId",
      "registryRevision",
      "schemaVersion",
      "sourceSeriesId",
      "sources",
    ],
    code,
  );
  exact(input.schemaVersion, CAPABILITY_SNAPSHOT_SCHEMA, code);
  exact(input.profileVersion, FINANCIAL_CAPABILITY_REGISTRY_PROFILE, code);
  const registryRevision = integer(input.registryRevision, code, 1, 10_000_000);
  const previousAdmittedSnapshotSha256 = nullableHash(
    input.previousAdmittedSnapshotSha256,
    code,
  );
  if ((registryRevision === 1) !== (previousAdmittedSnapshotSha256 === null)) fail(code);
  const sources = array(input.sources, code, 1, 64).map(parseSource);
  const sourceIds = sources.map((source) => source.sourceId);
  sortedUnique(sourceIds, code);
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const capabilities = array(input.capabilities, code, 1, 512).map((capability) =>
    parseCapability(capability, sourceById),
  );
  sortedUnique(
    capabilities.map((capability) => capability.capabilityId),
    code,
  );
  const capabilityIds = new Set(
    capabilities.map((capability) => capability.capabilityId),
  );
  if (capabilities.some((capability) =>
    capability.workflowPrerequisiteCapabilityIds.includes(capability.capabilityId) ||
    capability.workflowPrerequisiteCapabilityIds.some((required) =>
      !capabilityIds.has(required)))) {
    fail(code);
  }
  const toolNames = capabilities.flatMap((capability) =>
    capability.providerToolName === null ? [] : [capability.providerToolName],
  );
  if (new Set(toolNames).size !== toolNames.length) fail(code);
  const observedAtDeclared = utcTimestamp(input.observedAtDeclared, code);
  const observedMilliseconds = Date.parse(observedAtDeclared);
  if (
    sources.some(
      (source) => Date.parse(source.retrievedAtDeclared) > observedMilliseconds,
    )
  ) {
    fail(code);
  }
  const output: CapabilitySnapshotV1 = {
    capabilities,
    observedAtDeclared,
    previousAdmittedSnapshotSha256,
    productId: identifier(input.productId, code),
    profileVersion: FINANCIAL_CAPABILITY_REGISTRY_PROFILE,
    providerId: identifier(input.providerId, code),
    registryRevision,
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA,
    sourceSeriesId: identifier(input.sourceSeriesId, code),
    sources,
  };
  try {
    if (new TextEncoder().encode(canonicalizeJcs(output)).byteLength > MAX_SNAPSHOT_BYTES) {
      fail(code);
    }
  } catch (error) {
    if (error instanceof RegistryValidationError) throw error;
    fail(code);
  }
  return output;
}

export function serializeCapabilitySnapshot(value: unknown): string {
  return canonicalizeJcs(parseCapabilitySnapshot(value));
}

export function capabilitySnapshotSha256(value: unknown): string {
  return sha256Jcs(parseCapabilitySnapshot(value));
}

export function parseExactJcsCapabilitySnapshotBytes(
  bytes: Uint8Array,
): CapabilitySnapshotV1 {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > MAX_SNAPSHOT_BYTES ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) {
    fail("snapshot.bytes-invalid");
  }
  let value: unknown;
  try {
    value = parseStrictJson(bytes, {
      maxDepth: 64,
      maxNodes: 100_000,
      maxStringLength: 4_096,
    });
  } catch (error) {
    if (error instanceof StrictJsonError) {
      if (error.code === "invalid-utf8") fail("snapshot.bytes-invalid-utf8");
      if (error.code === "invalid-unicode") fail("snapshot.bytes-invalid-unicode");
      if (error.code === "duplicate-key") fail("snapshot.bytes-duplicate-key");
    }
    fail("snapshot.bytes-invalid-json");
  }
  const snapshot = parseCapabilitySnapshot(value);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  if (canonicalizeJcs(snapshot) !== source) fail("snapshot.bytes-noncanonical");
  return snapshot;
}
