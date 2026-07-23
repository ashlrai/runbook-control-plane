import {
  canonicalizeJcs,
  rawStringCompare,
  sha256Bytes,
  sha256Jcs,
  sha256Utf8,
} from "@runbook/financial-bench";
import {
  PublicAuthMetadataError,
  ownPlainUint8Array,
  parseStrictJsonBytes,
} from "./strict-json.js";
import {
  PUBLIC_AUTH_METADATA_BUNDLE_SCHEMA,
  PUBLIC_AUTH_METADATA_DIFF_SCHEMA,
  PUBLIC_AUTH_METADATA_LIMITATIONS,
  PUBLIC_AUTH_METADATA_OBSERVATION_SCHEMA,
  PUBLIC_AUTH_METADATA_PROFILE,
  PUBLIC_AUTH_METADATA_PROFILE_FINDINGS,
  PUBLIC_AUTH_METADATA_SOURCE_IDS,
  PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
  PUBLIC_AUTH_METADATA_WATCHED_FIELDS,
  type BuiltPublicAuthMetadataObservation,
  type PublicAuthMetadataBundleBinding,
  type PublicAuthMetadataBundleV1,
  type PublicAuthMetadataDiffChange,
  type PublicAuthMetadataDiffV1,
  type PublicAuthMetadataDocumentKind,
  type PublicAuthMetadataHttpEvidence,
  type PublicAuthMetadataObservationV1,
  type PublicAuthMetadataProfileFinding,
  type PublicAuthMetadataSemanticDigest,
  type PublicAuthMetadataSourceDefinition,
  type PublicAuthMetadataSourceId,
  type PublicAuthMetadataWatchedField,
} from "./types.js";

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const MAX_RETRIEVAL_WINDOW_MILLISECONDS = 30_000;
const HASH = /^[0-9a-f]{64}$/;

type SourceProfile = PublicAuthMetadataSourceDefinition & Readonly<{
  expected: Readonly<Record<string, string | readonly string[]>>;
  expectedKeys: readonly string[];
  fieldCodes: Readonly<Record<string, PublicAuthMetadataWatchedField>>;
  findingCodes: Readonly<Record<string, PublicAuthMetadataProfileFinding>>;
  uriKeys: readonly string[];
}>;

const sources: Readonly<Record<PublicAuthMetadataSourceId, SourceProfile>> = Object.freeze({
  "robinhood-banking-authorization-server": sourceProfile(
    "robinhood-banking-authorization-server",
    "authorization-server-metadata",
    "https://banking-agent.robinhood.com/.well-known/oauth-authorization-server/mcp/banking",
    PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
    {
      authorization_endpoint: "https://robinhood.com/oauth",
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      issuer: "https://banking-agent.robinhood.com/mcp/banking",
      registration_endpoint: "https://banking-agent.robinhood.com/oauth/banking/register",
      response_types_supported: ["code"],
      scopes_supported: ["credit-card"],
      token_endpoint: "https://api.robinhood.com/oauth2/token/",
      token_endpoint_auth_methods_supported: ["none"],
    },
  ),
  "robinhood-banking-protected-resource": sourceProfile(
    "robinhood-banking-protected-resource",
    "protected-resource-metadata",
    "https://banking-agent.robinhood.com/.well-known/oauth-protected-resource/mcp/banking",
    PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
    {
      authorization_servers: ["https://banking-agent.robinhood.com/mcp/banking"],
      bearer_methods_supported: ["header"],
      resource: "https://banking-agent.robinhood.com/mcp/banking",
      scopes_supported: ["credit-card"],
    },
  ),
  "robinhood-trading-authorization-server": sourceProfile(
    "robinhood-trading-authorization-server",
    "authorization-server-metadata",
    "https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading",
    PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
    {
      authorization_endpoint: "https://robinhood.com/oauth",
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      issuer: "https://agent.robinhood.com/mcp/trading",
      registration_endpoint: "https://agent.robinhood.com/oauth/trading/register",
      response_types_supported: ["code"],
      scopes_supported: ["internal"],
      token_endpoint: "https://api.robinhood.com/oauth2/token/",
      token_endpoint_auth_methods_supported: ["none"],
    },
  ),
  "robinhood-trading-protected-resource": sourceProfile(
    "robinhood-trading-protected-resource",
    "protected-resource-metadata",
    "https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading",
    PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
    {
      authorization_servers: ["https://agent.robinhood.com/mcp/trading"],
      bearer_methods_supported: ["header"],
      resource: "https://agent.robinhood.com/mcp/trading",
      scopes_supported: ["internal"],
    },
  ),
});

function sourceProfile(
  sourceId: PublicAuthMetadataSourceId,
  documentKind: PublicAuthMetadataDocumentKind,
  requestedUrl: string,
  sourceSeriesId: typeof PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
  expected: Readonly<Record<string, string | readonly string[]>>,
): SourceProfile {
  const fieldCodes: Record<string, PublicAuthMetadataWatchedField> = {
    authorization_endpoint: "authorization-endpoint",
    authorization_servers: "authorization-servers",
    bearer_methods_supported: "bearer-methods-supported",
    code_challenge_methods_supported: "code-challenge-methods-supported",
    grant_types_supported: "grant-types-supported",
    issuer: "issuer",
    registration_endpoint: "registration-endpoint",
    resource: "resource",
    response_types_supported: "response-types-supported",
    scopes_supported: "scopes-supported",
    token_endpoint: "token-endpoint",
    token_endpoint_auth_methods_supported: "token-endpoint-auth-methods-supported",
  };
  const findingCodes: Record<string, PublicAuthMetadataProfileFinding> = {
    authorization_endpoint: "authorization-endpoint-unexpected",
    authorization_servers: "authorization-server-mismatch",
    bearer_methods_supported: "bearer-method-set-unexpected",
    code_challenge_methods_supported: "pkce-method-set-unexpected",
    grant_types_supported: "grant-type-set-unexpected",
    issuer: "issuer-mismatch",
    registration_endpoint: "registration-endpoint-unexpected",
    resource: "resource-mismatch",
    response_types_supported: "response-type-set-unexpected",
    scopes_supported: "scope-label-set-unexpected",
    token_endpoint: "token-endpoint-unexpected",
    token_endpoint_auth_methods_supported: "token-auth-method-set-unexpected",
  };
  const expectedKeys = Object.keys(expected).sort(rawStringCompare);
  const activeFieldCodes = Object.fromEntries(
    expectedKeys.map((key) => [key, fieldCodes[key]]),
  ) as Record<string, PublicAuthMetadataWatchedField>;
  const activeFindingCodes = Object.fromEntries(
    expectedKeys.map((key) => [key, findingCodes[key]]),
  ) as Record<string, PublicAuthMetadataProfileFinding>;
  return Object.freeze({
    documentKind,
    expected,
    expectedKeys,
    fieldCodes: activeFieldCodes,
    findingCodes: activeFindingCodes,
    requestedUrl,
    sourceId,
    sourceSeriesId,
    uriKeys: [
      "authorization_endpoint",
      "authorization_servers",
      "issuer",
      "registration_endpoint",
      "resource",
      "token_endpoint",
    ],
  });
}

const fail = (code: string): never => {
  throw new PublicAuthMetadataError(code);
};

function isSourceId(value: unknown): value is PublicAuthMetadataSourceId {
  return typeof value === "string" &&
    (PUBLIC_AUTH_METADATA_SOURCE_IDS as readonly string[]).includes(value);
}

export function getPublicAuthMetadataSourceDefinition(
  sourceId: PublicAuthMetadataSourceId,
): PublicAuthMetadataSourceDefinition {
  if (!isSourceId(sourceId)) return fail("source.invalid");
  const source = sources[sourceId];
  return {
    documentKind: source.documentKind,
    requestedUrl: source.requestedUrl,
    sourceId: source.sourceId,
    sourceSeriesId: source.sourceSeriesId,
  };
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code);
  }
}

function stringValue(value: unknown, code: string, max = 4_096): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\r\n]/.test(value)) {
    return fail(code);
  }
  return value;
}

function nullableString(value: unknown, code: string): string | null {
  return value === null ? null : stringValue(value, code, 1_024);
}

function hash(value: unknown, code: string): string {
  const output = stringValue(value, code, 64);
  return HASH.test(output) ? output : fail(code);
}

function booleanValue(value: unknown, code: string): boolean {
  return typeof value === "boolean" ? value : fail(code);
}

function integer(value: unknown, code: string, min: number, max: number): number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
    ? value as number
    : fail(code);
}

function strictUtc(value: unknown, code: string): string {
  const output = stringValue(value, code, 32);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(output)) return fail(code);
  const milliseconds = Date.parse(output);
  if (!Number.isFinite(milliseconds)) return fail(code);
  const iso = new Date(milliseconds).toISOString();
  const canonical = iso.endsWith(".000Z") ? iso.replace(".000Z", "Z") : iso;
  return canonical === output ? output : fail(code);
}

function displayUtc(milliseconds: number): string {
  const iso = new Date(milliseconds).toISOString();
  return iso.endsWith(".000Z") ? iso.replace(".000Z", "Z") : iso;
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalizeJcs(left) === canonicalizeJcs(right);
}

function structurallySafeUri(value: string): boolean {
  if (value.length > 2_048 || !/^[\x21-\x7e]+$/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.href === value &&
      parsed.username === "" && parsed.password === "" &&
      parsed.hash === "" && parsed.search === "";
  } catch {
    return false;
  }
}

function parseKnownArray(
  value: unknown,
  findings: Set<PublicAuthMetadataProfileFinding>,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    findings.add("metadata-field-type-invalid");
    return null;
  }
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length < 1 || entry.length > 256) {
      findings.add("metadata-field-type-invalid");
      return null;
    }
    output.push(entry);
  }
  if (new Set(output).size !== output.length) findings.add("metadata-array-duplicate");
  return output.sort(rawStringCompare);
}

function ownJson(value: unknown, code: string): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  const copy = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 2_048 || depth > 32) return fail(code);
    if (current === null || typeof current === "string" ||
      typeof current === "boolean" || typeof current === "number") return current;
    if (typeof current !== "object" || active.has(current)) return fail(code);
    active.add(current);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) return fail(code);
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) return fail(code);
        const length = current.length;
        if (keys.length !== length + 1) return fail(code);
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined) {
            return fail(code);
          }
          output.push(copy(descriptor.value, depth + 1));
        }
        return output;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return fail(code);
      const output = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined ||
          descriptor.enumerable !== true) return fail(code);
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value: copy(descriptor.value, depth + 1),
          writable: true,
        });
      }
      return output;
    } catch (error) {
      if (error instanceof PublicAuthMetadataError) throw error;
      return fail(code);
    } finally {
      active.delete(current);
    }
  };
  return copy(value, 0);
}

export type ParsedRobinhoodPublicAuthMetadata = Readonly<{
  findings: readonly PublicAuthMetadataProfileFinding[];
  profileValid: boolean;
  projectionBytes: Uint8Array;
  projectionSha256: string;
  semanticDigests: readonly PublicAuthMetadataSemanticDigest[];
}>;

export function parseRobinhoodPublicAuthMetadataBody(
  sourceId: PublicAuthMetadataSourceId,
  input: Uint8Array,
): ParsedRobinhoodPublicAuthMetadata {
  if (!isSourceId(sourceId)) return fail("source.invalid");
  const source = sources[sourceId];
  const parsed = record(parseStrictJsonBytes(input, {
    maxBytes: MAX_METADATA_BYTES,
    prefix: "metadata",
  }), "metadata.object-required");
  const findings = new Set<PublicAuthMetadataProfileFinding>();
  const actualKeys = Object.keys(parsed).sort(rawStringCompare);
  const expectedSet = new Set(source.expectedKeys);
  if (actualKeys.some((key) => !expectedSet.has(key))) findings.add("metadata-field-unknown");
  if (source.expectedKeys.some((key) => !(key in parsed))) findings.add("metadata-field-missing");

  const normalized = Object.create(null) as Record<string, unknown>;
  for (const key of actualKeys) {
    Object.defineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value: ownJson(parsed[key], "metadata.value-invalid"),
      writable: true,
    });
  }
  for (const key of source.expectedKeys) {
    if (!(key in parsed)) continue;
    const expected = source.expected[key];
    const value = parsed[key];
    if (Array.isArray(expected)) {
      const values = parseKnownArray(value, findings);
      if (values === null) continue;
      Object.defineProperty(normalized, key, {
        configurable: true,
        enumerable: true,
        value: values,
        writable: true,
      });
      if (!equalJson(values, [...expected].sort(rawStringCompare))) {
        findings.add(source.findingCodes[key] ?? "metadata-field-type-invalid");
      }
      if (source.uriKeys.includes(key) && values.some((entry) => !structurallySafeUri(entry))) {
        findings.add("uri-unallowlisted");
      }
    } else {
      if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
        findings.add("metadata-field-type-invalid");
        continue;
      }
      if (source.uriKeys.includes(key) && !structurallySafeUri(value)) {
        findings.add("uri-unallowlisted");
      }
      if (value !== expected) {
        findings.add(source.findingCodes[key] ?? "metadata-field-type-invalid");
        if (source.uriKeys.includes(key)) findings.add("uri-unallowlisted");
      }
    }
  }

  const projectionText = canonicalizeJcs(normalized);
  const projectionBytes = new TextEncoder().encode(projectionText);
  const unknown = Object.create(null) as Record<string, unknown>;
  for (const key of actualKeys.filter((key) => !expectedSet.has(key))) {
    Object.defineProperty(unknown, key, {
      configurable: true,
      enumerable: true,
      value: normalized[key],
      writable: true,
    });
  }
  const digestMap = new Map<PublicAuthMetadataWatchedField, string>();
  digestMap.set("field-set", sha256Jcs(actualKeys));
  digestMap.set("unknown-field-values", sha256Jcs(unknown));
  for (const [key, fieldCode] of Object.entries(source.fieldCodes)) {
    digestMap.set(fieldCode, sha256Jcs(key in normalized ? normalized[key] : null));
  }
  const semanticDigests = PUBLIC_AUTH_METADATA_WATCHED_FIELDS.map((fieldCode) => ({
    fieldCode,
    sha256: digestMap.get(fieldCode) ?? sha256Jcs(null),
  }));
  const outputFindings = [...findings].sort(rawStringCompare);
  return {
    findings: outputFindings,
    profileValid: outputFindings.length === 0,
    projectionBytes: new Uint8Array(projectionBytes),
    projectionSha256: sha256Utf8(projectionText),
    semanticDigests,
  };
}

function validateHttp(value: unknown, rawLength?: number): PublicAuthMetadataHttpEvidence {
  const input = record(value, "http.invalid");
  exactKeys(input, [
    "cacheControl", "contentEncoding", "contentLength", "contentType", "etag",
    "lastModified", "locationPresent", "serverDate", "setCookiePresent", "status", "vary",
  ], "http.invalid");
  const output: PublicAuthMetadataHttpEvidence = {
    cacheControl: nullableString(input.cacheControl, "http.invalid"),
    contentEncoding: input.contentEncoding === null
      ? null : fail("http.content-encoding-invalid"),
    contentLength: integer(input.contentLength, "http.content-length-invalid", 2, MAX_METADATA_BYTES),
    contentType: input.contentType === "application/json"
      ? input.contentType : fail("http.content-type-invalid"),
    etag: nullableString(input.etag, "http.invalid"),
    lastModified: nullableString(input.lastModified, "http.invalid"),
    locationPresent: input.locationPresent === false
      ? false : fail("http.redirect-refused"),
    serverDate: nullableString(input.serverDate, "http.invalid"),
    setCookiePresent: input.setCookiePresent === false
      ? false : fail("http.set-cookie-refused"),
    status: input.status === 200 ? 200 : fail("http.status-invalid"),
    vary: nullableString(input.vary, "http.invalid"),
  };
  if (rawLength !== undefined && output.contentLength !== rawLength) {
    fail("http.content-length-mismatch");
  }
  return output;
}

function rawBodyHash(bytes: Uint8Array): string {
  return sha256Bytes(bytes);
}

export function buildPublicAuthMetadataObservation(input: Readonly<{
  http: PublicAuthMetadataHttpEvidence;
  rawBodyBytes: Uint8Array;
  retrievedAtDeclared: string;
  sourceId: PublicAuthMetadataSourceId;
}>): BuiltPublicAuthMetadataObservation {
  let descriptors: PropertyDescriptorMap;
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) return fail("observation.input-invalid");
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    return fail("observation.input-invalid");
  }
  exactKeys(descriptors, ["http", "rawBodyBytes", "retrievedAtDeclared", "sourceId"], "observation.input-invalid");
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined ||
      descriptor.enumerable !== true) return fail("observation.input-invalid");
  }
  const sourceId = descriptors.sourceId?.value as unknown;
  const rawInput = descriptors.rawBodyBytes?.value as unknown;
  if (!isSourceId(sourceId)) return fail("source.invalid");
  const rawBodyBytes = ownPlainUint8Array(
    rawInput,
    "metadata.bytes-invalid",
    MAX_METADATA_BYTES,
    "metadata.bytes-too-large",
  );
  const source = sources[sourceId];
  const parsed = parseRobinhoodPublicAuthMetadataBody(sourceId, rawBodyBytes);
  const retrievedAtDeclared = strictUtc(
    descriptors.retrievedAtDeclared?.value,
    "observation.time-invalid",
  );
  const http = validateHttp(
    ownJson(descriptors.http?.value, "http.invalid"),
    rawBodyBytes.byteLength,
  );
  const observation: PublicAuthMetadataObservationV1 = {
    documentKind: source.documentKind,
    findings: parsed.findings,
    http,
    limitations: PUBLIC_AUTH_METADATA_LIMITATIONS,
    profileValid: parsed.profileValid,
    profileVersion: PUBLIC_AUTH_METADATA_PROFILE,
    projectionSha256: parsed.projectionSha256,
    requestedUrl: source.requestedUrl,
    responseBody: {
      byteLength: rawBodyBytes.byteLength,
      sha256: rawBodyHash(rawBodyBytes),
    },
    retrievedAtDeclared,
    schemaVersion: PUBLIC_AUTH_METADATA_OBSERVATION_SCHEMA,
    semanticDigests: parsed.semanticDigests,
    sourceId,
    sourceSeriesId: source.sourceSeriesId,
  };
  const observationBytes = serializePublicAuthMetadataObservation(observation);
  return {
    observation: parseExactPublicAuthMetadataObservationBytes(observationBytes),
    observationBytes: new Uint8Array(observationBytes),
    projectionBytes: new Uint8Array(parsed.projectionBytes),
  };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function verifyPublicAuthMetadataObservationEvidence(
  observationBytesInput: Uint8Array,
  rawBodyBytesInput: Uint8Array,
): PublicAuthMetadataObservationV1 {
  const observationBytes = ownPlainUint8Array(
    observationBytesInput,
    "observation.bytes-invalid",
    MAX_ARTIFACT_BYTES,
    "observation.bytes-too-large",
  );
  const rawBodyBytes = ownPlainUint8Array(
    rawBodyBytesInput,
    "metadata.bytes-invalid",
    MAX_METADATA_BYTES,
    "metadata.bytes-too-large",
  );
  const observation = parseExactPublicAuthMetadataObservationBytes(observationBytes);
  let rebuilt: BuiltPublicAuthMetadataObservation;
  try {
    rebuilt = buildPublicAuthMetadataObservation({
      http: observation.http,
      rawBodyBytes,
      retrievedAtDeclared: observation.retrievedAtDeclared,
      sourceId: observation.sourceId,
    });
  } catch (error) {
    if (error instanceof PublicAuthMetadataError) {
      return fail("observation.evidence-mismatch");
    }
    throw error;
  }
  if (!bytesEqual(rebuilt.observationBytes, observationBytes)) {
    return fail("observation.evidence-mismatch");
  }
  return observation;
}

function validateLimitations(value: unknown, code: string): typeof PUBLIC_AUTH_METADATA_LIMITATIONS {
  if (!Array.isArray(value) || !equalJson(value, PUBLIC_AUTH_METADATA_LIMITATIONS)) return fail(code);
  return PUBLIC_AUTH_METADATA_LIMITATIONS;
}

function validateFindings(
  value: unknown,
  code: string,
  source?: SourceProfile,
): readonly PublicAuthMetadataProfileFinding[] {
  if (!Array.isArray(value)) return fail(code);
  const output = value.map((entry) => {
    if (typeof entry !== "string" || !(PUBLIC_AUTH_METADATA_PROFILE_FINDINGS as readonly string[]).includes(entry)) {
      return fail(code);
    }
    return entry as PublicAuthMetadataProfileFinding;
  });
  if (!equalJson(output, [...new Set(output)].sort(rawStringCompare))) return fail(code);
  if (source !== undefined) {
    const allowed = new Set<PublicAuthMetadataProfileFinding>([
      "metadata-array-duplicate",
      "metadata-field-missing",
      "metadata-field-type-invalid",
      "metadata-field-unknown",
      "uri-unallowlisted",
      ...Object.values(source.findingCodes),
    ]);
    if (output.some((finding) => !allowed.has(finding))) return fail(code);
  }
  return output;
}

function validateSemanticDigests(value: unknown, code: string): readonly PublicAuthMetadataSemanticDigest[] {
  if (!Array.isArray(value) || value.length !== PUBLIC_AUTH_METADATA_WATCHED_FIELDS.length) return fail(code);
  return value.map((entry, index) => {
    const input = record(entry, code);
    exactKeys(input, ["fieldCode", "sha256"], code);
    const fieldCode = input.fieldCode;
    if (fieldCode !== PUBLIC_AUTH_METADATA_WATCHED_FIELDS[index]) return fail(code);
    return {
      fieldCode: fieldCode as PublicAuthMetadataWatchedField,
      sha256: hash(input.sha256, code),
    };
  });
}

function validateObservation(value: unknown): PublicAuthMetadataObservationV1 {
  const input = record(value, "observation.invalid");
  exactKeys(input, [
    "documentKind", "findings", "http", "limitations", "profileValid", "profileVersion",
    "projectionSha256", "requestedUrl", "responseBody", "retrievedAtDeclared", "schemaVersion",
    "semanticDigests", "sourceId", "sourceSeriesId",
  ], "observation.invalid");
  if (!isSourceId(input.sourceId)) return fail("observation.invalid");
  const source = sources[input.sourceId];
  const findings = validateFindings(input.findings, "observation.invalid", source);
  const responseBody = record(input.responseBody, "observation.invalid");
  exactKeys(responseBody, ["byteLength", "sha256"], "observation.invalid");
  const profileValid = booleanValue(input.profileValid, "observation.invalid");
  if (profileValid !== (findings.length === 0)) return fail("observation.invalid");
  if (input.documentKind !== source.documentKind || input.requestedUrl !== source.requestedUrl ||
    input.sourceSeriesId !== source.sourceSeriesId || input.profileVersion !== PUBLIC_AUTH_METADATA_PROFILE ||
    input.schemaVersion !== PUBLIC_AUTH_METADATA_OBSERVATION_SCHEMA) return fail("observation.invalid");
  const http = validateHttp(input.http);
  const byteLength = integer(responseBody.byteLength, "observation.invalid", 2, MAX_METADATA_BYTES);
  if (http.contentLength !== byteLength) return fail("observation.invalid");
  const semanticDigests = validateSemanticDigests(input.semanticDigests, "observation.invalid");
  const activeFields = new Set(Object.values(source.fieldCodes));
  for (const digest of semanticDigests) {
    if (digest.fieldCode !== "field-set" && digest.fieldCode !== "unknown-field-values" &&
      !activeFields.has(digest.fieldCode) && digest.sha256 !== sha256Jcs(null)) {
      return fail("observation.invalid");
    }
  }
  const projectionSha256 = hash(input.projectionSha256, "observation.invalid");
  if (profileValid) {
    const expected = parseRobinhoodPublicAuthMetadataBody(
      input.sourceId,
      new TextEncoder().encode(canonicalizeJcs(source.expected)),
    );
    if (projectionSha256 !== expected.projectionSha256 ||
      !equalJson(semanticDigests, expected.semanticDigests)) return fail("observation.invalid");
  }
  return {
    documentKind: source.documentKind,
    findings,
    http,
    limitations: validateLimitations(input.limitations, "observation.invalid"),
    profileValid,
    profileVersion: PUBLIC_AUTH_METADATA_PROFILE,
    projectionSha256,
    requestedUrl: source.requestedUrl,
    responseBody: {
      byteLength,
      sha256: hash(responseBody.sha256, "observation.invalid"),
    },
    retrievedAtDeclared: strictUtc(input.retrievedAtDeclared, "observation.invalid"),
    schemaVersion: PUBLIC_AUTH_METADATA_OBSERVATION_SCHEMA,
    semanticDigests,
    sourceId: input.sourceId,
    sourceSeriesId: source.sourceSeriesId,
  };
}

function parseExactArtifact(bytes: Uint8Array, prefix: string): unknown {
  const owned = ownPlainUint8Array(
    bytes,
    `${prefix}.bytes-invalid`,
    MAX_ARTIFACT_BYTES,
    `${prefix}.bytes-too-large`,
  );
  const parsed = parseStrictJsonBytes(owned, { maxBytes: MAX_ARTIFACT_BYTES, prefix });
  const text = new TextDecoder().decode(owned);
  if (canonicalizeJcs(parsed) !== text) return fail(`${prefix}.bytes-not-exact-jcs`);
  return parsed;
}

export function parseExactPublicAuthMetadataObservationBytes(
  bytes: Uint8Array,
): PublicAuthMetadataObservationV1 {
  return validateObservation(parseExactArtifact(bytes, "observation"));
}

export function serializePublicAuthMetadataObservation(value: unknown): Uint8Array {
  const owned = ownJson(value, "observation.invalid");
  const bytes = new TextEncoder().encode(canonicalizeJcs(owned));
  parseExactPublicAuthMetadataObservationBytes(bytes);
  return bytes;
}

function artifactHash(bytes: Uint8Array): string {
  return sha256Bytes(bytes);
}

function ownObservationArtifactList(input: unknown): readonly Uint8Array[] {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
      return fail("bundle.members-invalid");
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(input);
    const lengthDescriptor = descriptors["length"] as PropertyDescriptor | undefined;
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== 4 || keys.length !== 5) {
      return fail("bundle.members-invalid");
    }
    const output: Uint8Array[] = [];
    for (let index = 0; index < 4; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) ||
        descriptor.get !== undefined || descriptor.set !== undefined ||
        descriptor.enumerable !== true) {
        return fail("bundle.members-invalid");
      }
      output.push(ownPlainUint8Array(
        descriptor.value,
        "bundle.members-invalid",
        MAX_ARTIFACT_BYTES,
      ));
    }
    return output;
  } catch (error) {
    if (error instanceof PublicAuthMetadataError) throw error;
    return fail("bundle.members-invalid");
  }
}

function ownBundleLineage(input: unknown): Readonly<{
  previousAdmittedBundleSha256: string | null;
  registryRevision: number;
}> {
  const owned = record(ownJson(input, "bundle.lineage-invalid"), "bundle.lineage-invalid");
  exactKeys(
    owned,
    ["previousAdmittedBundleSha256", "registryRevision"],
    "bundle.lineage-invalid",
  );
  const registryRevision = integer(
    owned.registryRevision,
    "bundle.lineage-invalid",
    1,
    0x7fff_ffff,
  );
  const previousAdmittedBundleSha256 = owned.previousAdmittedBundleSha256 === null
    ? null
    : hash(owned.previousAdmittedBundleSha256, "bundle.lineage-invalid");
  if ((registryRevision === 1) !== (previousAdmittedBundleSha256 === null)) {
    return fail("bundle.lineage-invalid");
  }
  return { previousAdmittedBundleSha256, registryRevision };
}

export function buildPublicAuthMetadataBundle(
  observationArtifacts: readonly Uint8Array[],
  lineage: Readonly<{
    previousAdmittedBundleSha256: string | null;
    registryRevision: number;
  }> = { previousAdmittedBundleSha256: null, registryRevision: 1 },
): Readonly<{ bundle: PublicAuthMetadataBundleV1; bundleBytes: Uint8Array }> {
  const ownedArtifacts = ownObservationArtifactList(observationArtifacts);
  const parsed = ownedArtifacts.map((owned) => {
    return { bytes: owned, observation: parseExactPublicAuthMetadataObservationBytes(owned) };
  }).sort((left, right) => rawStringCompare(left.observation.sourceId, right.observation.sourceId));
  if (!equalJson(parsed.map((entry) => entry.observation.sourceId), PUBLIC_AUTH_METADATA_SOURCE_IDS)) {
    return fail("bundle.members-invalid");
  }
  const milliseconds = parsed.map((entry) => Date.parse(entry.observation.retrievedAtDeclared));
  const first = Math.min(...milliseconds);
  const last = Math.max(...milliseconds);
  const durationMilliseconds = last - first;
  if (!Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds > MAX_RETRIEVAL_WINDOW_MILLISECONDS) {
    return fail("bundle.retrieval-window-invalid");
  }
  const { previousAdmittedBundleSha256, registryRevision } = ownBundleLineage(lineage);
  const bindings: PublicAuthMetadataBundleBinding[] = parsed.map(({ bytes, observation }) => ({
    observationSha256: artifactHash(bytes),
    profileValid: observation.profileValid,
    projectionSha256: observation.projectionSha256,
    retrievedAtDeclared: observation.retrievedAtDeclared,
    sourceId: observation.sourceId,
  }));
  const bundle: PublicAuthMetadataBundleV1 = {
    bindings,
    limitations: PUBLIC_AUTH_METADATA_LIMITATIONS,
    previousAdmittedBundleSha256,
    profileValid: parsed.every((entry) => entry.observation.profileValid),
    profileVersion: PUBLIC_AUTH_METADATA_PROFILE,
    registryRevision,
    retrievalWindow: {
      durationMilliseconds,
      firstRetrievedAtDeclared: displayUtc(first),
      lastRetrievedAtDeclared: displayUtc(last),
    },
    schemaVersion: PUBLIC_AUTH_METADATA_BUNDLE_SCHEMA,
    sourceSeriesId: PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
  };
  const bundleBytes = serializePublicAuthMetadataBundle(bundle);
  return { bundle: parseExactPublicAuthMetadataBundleBytes(bundleBytes), bundleBytes };
}

function validateBundle(value: unknown): PublicAuthMetadataBundleV1 {
  const input = record(value, "bundle.invalid");
  exactKeys(input, ["bindings", "limitations", "previousAdmittedBundleSha256", "profileValid", "profileVersion", "registryRevision", "retrievalWindow", "schemaVersion", "sourceSeriesId"], "bundle.invalid");
  if (input.profileVersion !== PUBLIC_AUTH_METADATA_PROFILE || input.schemaVersion !== PUBLIC_AUTH_METADATA_BUNDLE_SCHEMA || input.sourceSeriesId !== PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID || !Array.isArray(input.bindings) || input.bindings.length !== 4) return fail("bundle.invalid");
  const bindings = input.bindings.map((entry, index) => {
    const binding = record(entry, "bundle.invalid");
    exactKeys(binding, ["observationSha256", "profileValid", "projectionSha256", "retrievedAtDeclared", "sourceId"], "bundle.invalid");
    if (binding.sourceId !== PUBLIC_AUTH_METADATA_SOURCE_IDS[index]) return fail("bundle.invalid");
    return {
      observationSha256: hash(binding.observationSha256, "bundle.invalid"),
      profileValid: booleanValue(binding.profileValid, "bundle.invalid"),
      projectionSha256: hash(binding.projectionSha256, "bundle.invalid"),
      retrievedAtDeclared: strictUtc(binding.retrievedAtDeclared, "bundle.invalid"),
      sourceId: binding.sourceId,
    } as PublicAuthMetadataBundleBinding;
  });
  const window = record(input.retrievalWindow, "bundle.invalid");
  exactKeys(window, ["durationMilliseconds", "firstRetrievedAtDeclared", "lastRetrievedAtDeclared"], "bundle.invalid");
  const first = strictUtc(window.firstRetrievedAtDeclared, "bundle.invalid");
  const last = strictUtc(window.lastRetrievedAtDeclared, "bundle.invalid");
  const duration = integer(
    window.durationMilliseconds,
    "bundle.invalid",
    0,
    MAX_RETRIEVAL_WINDOW_MILLISECONDS,
  );
  const bindingTimes = bindings.map((entry) => Date.parse(entry.retrievedAtDeclared));
  if (Date.parse(last) - Date.parse(first) !== duration ||
    Date.parse(first) !== Math.min(...bindingTimes) ||
    Date.parse(last) !== Math.max(...bindingTimes)) return fail("bundle.invalid");
  const profileValid = booleanValue(input.profileValid, "bundle.invalid");
  if (profileValid !== bindings.every((entry) => entry.profileValid)) return fail("bundle.invalid");
  const registryRevision = integer(input.registryRevision, "bundle.invalid", 1, 0x7fff_ffff);
  const previousAdmittedBundleSha256 = input.previousAdmittedBundleSha256 === null
    ? null
    : hash(input.previousAdmittedBundleSha256, "bundle.invalid");
  if ((registryRevision === 1) !== (previousAdmittedBundleSha256 === null)) return fail("bundle.invalid");
  return {
    bindings,
    limitations: validateLimitations(input.limitations, "bundle.invalid"),
    previousAdmittedBundleSha256,
    profileValid,
    profileVersion: PUBLIC_AUTH_METADATA_PROFILE,
    registryRevision,
    retrievalWindow: {
      durationMilliseconds: duration,
      firstRetrievedAtDeclared: first,
      lastRetrievedAtDeclared: last,
    },
    schemaVersion: PUBLIC_AUTH_METADATA_BUNDLE_SCHEMA,
    sourceSeriesId: PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
  };
}

export function parseExactPublicAuthMetadataBundleBytes(bytes: Uint8Array): PublicAuthMetadataBundleV1 {
  return validateBundle(parseExactArtifact(bytes, "bundle"));
}

export function serializePublicAuthMetadataBundle(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(canonicalizeJcs(ownJson(value, "bundle.invalid")));
  parseExactPublicAuthMetadataBundleBytes(bytes);
  return bytes;
}

export function validatePublicAuthMetadataBundleSuccessor(
  baselineBytesInput: Uint8Array,
  candidateBytesInput: Uint8Array,
): PublicAuthMetadataBundleV1 {
  const baselineBytes = ownPlainUint8Array(
    baselineBytesInput,
    "bundle.bytes-invalid",
    MAX_ARTIFACT_BYTES,
    "bundle.bytes-too-large",
  );
  const candidateBytes = ownPlainUint8Array(
    candidateBytesInput,
    "bundle.bytes-invalid",
    MAX_ARTIFACT_BYTES,
    "bundle.bytes-too-large",
  );
  const baseline = parseExactPublicAuthMetadataBundleBytes(baselineBytes);
  const candidate = parseExactPublicAuthMetadataBundleBytes(candidateBytes);
  if (candidate.registryRevision !== baseline.registryRevision + 1) {
    return fail("bundle.revision-not-successor");
  }
  if (candidate.previousAdmittedBundleSha256 !== artifactHash(baselineBytes)) {
    return fail("bundle.previous-hash-mismatch");
  }
  if (Date.parse(candidate.retrievalWindow.firstRetrievedAtDeclared) <=
    Date.parse(baseline.retrievalWindow.lastRetrievedAtDeclared)) {
    return fail("bundle.time-regressed");
  }
  for (let index = 0; index < baseline.bindings.length; index += 1) {
    if (candidate.bindings[index]?.sourceId !== baseline.bindings[index]?.sourceId) {
      return fail("bundle.source-substitution");
    }
    if (candidate.bindings[index]?.observationSha256 === baseline.bindings[index]?.observationSha256) {
      return fail("bundle.observation-replayed");
    }
  }
  return candidate;
}

export function diffPublicAuthMetadataObservationBytes(
  baselineBytesInput: Uint8Array,
  candidateBytesInput: Uint8Array,
): Readonly<{ diff: PublicAuthMetadataDiffV1; diffBytes: Uint8Array }> {
  const baselineBytes = ownPlainUint8Array(
    baselineBytesInput,
    "diff.bytes-invalid",
    MAX_ARTIFACT_BYTES,
    "diff.bytes-too-large",
  );
  const candidateBytes = ownPlainUint8Array(
    candidateBytesInput,
    "diff.bytes-invalid",
    MAX_ARTIFACT_BYTES,
    "diff.bytes-too-large",
  );
  const baseline = parseExactPublicAuthMetadataObservationBytes(baselineBytes);
  const candidate = parseExactPublicAuthMetadataObservationBytes(candidateBytes);
  if (!baseline.profileValid) return fail("diff.baseline-invalid");
  if (baseline.sourceId !== candidate.sourceId || baseline.documentKind !== candidate.documentKind ||
    baseline.sourceSeriesId !== candidate.sourceSeriesId || baseline.requestedUrl !== candidate.requestedUrl) {
    return fail("diff.lineage-mismatch");
  }
  if (Date.parse(candidate.retrievedAtDeclared) <= Date.parse(baseline.retrievedAtDeclared)) {
    return fail("diff.retrieval-time-not-monotonic");
  }
  const changes: PublicAuthMetadataDiffChange[] = [];
  for (let index = 0; index < PUBLIC_AUTH_METADATA_WATCHED_FIELDS.length; index += 1) {
    const before = baseline.semanticDigests[index];
    const after = candidate.semanticDigests[index];
    if (before === undefined || after === undefined || before.fieldCode !== after.fieldCode) return fail("diff.invalid");
    if (before.sha256 !== after.sha256) changes.push({
      afterSha256: after.sha256,
      beforeSha256: before.sha256,
      fieldCode: before.fieldCode,
      findingCodes: ["metadata-field-changed"],
    });
  }
  const rawBodyChanged = baseline.responseBody.sha256 !== candidate.responseBody.sha256;
  const semanticChanged = baseline.projectionSha256 !== candidate.projectionSha256 || changes.length > 0;
  const baselineHttpSha256 = sha256Jcs(baseline.http);
  const candidateHttpSha256 = sha256Jcs(candidate.http);
  const diff: PublicAuthMetadataDiffV1 = {
    baselineHttpSha256,
    baselineObservationSha256: artifactHash(baselineBytes),
    baselineProjectionSha256: baseline.projectionSha256,
    baselineResponseBodySha256: baseline.responseBody.sha256,
    candidateFindings: candidate.findings,
    candidateHttpSha256,
    candidateObservationSha256: artifactHash(candidateBytes),
    candidateProjectionSha256: candidate.projectionSha256,
    candidateResponseBodySha256: candidate.responseBody.sha256,
    changes,
    disposition: !candidate.profileValid
      ? "invalid-candidate"
      : semanticChanged ? "review-required" : "no-change",
    headerChanged: baselineHttpSha256 !== candidateHttpSha256,
    limitations: PUBLIC_AUTH_METADATA_LIMITATIONS,
    profileVersion: PUBLIC_AUTH_METADATA_PROFILE,
    rawBodyChanged,
    schemaVersion: PUBLIC_AUTH_METADATA_DIFF_SCHEMA,
    semanticChanged,
    sourceId: baseline.sourceId,
  };
  const diffBytes = serializePublicAuthMetadataDiff(diff);
  return { diff: parseExactPublicAuthMetadataDiffBytes(diffBytes), diffBytes };
}

function validateDiff(value: unknown): PublicAuthMetadataDiffV1 {
  const input = record(value, "diff.invalid");
  exactKeys(input, ["baselineHttpSha256", "baselineObservationSha256", "baselineProjectionSha256", "baselineResponseBodySha256", "candidateFindings", "candidateHttpSha256", "candidateObservationSha256", "candidateProjectionSha256", "candidateResponseBodySha256", "changes", "disposition", "headerChanged", "limitations", "profileVersion", "rawBodyChanged", "schemaVersion", "semanticChanged", "sourceId"], "diff.invalid");
  if (input.schemaVersion !== PUBLIC_AUTH_METADATA_DIFF_SCHEMA || input.profileVersion !== PUBLIC_AUTH_METADATA_PROFILE || !isSourceId(input.sourceId) || !Array.isArray(input.changes)) return fail("diff.invalid");
  const changes = input.changes.map((entry) => {
    const change = record(entry, "diff.invalid");
    exactKeys(change, ["afterSha256", "beforeSha256", "fieldCode", "findingCodes"], "diff.invalid");
    if (!(PUBLIC_AUTH_METADATA_WATCHED_FIELDS as readonly unknown[]).includes(change.fieldCode) || !equalJson(change.findingCodes, ["metadata-field-changed"])) return fail("diff.invalid");
    return {
      afterSha256: hash(change.afterSha256, "diff.invalid"),
      beforeSha256: hash(change.beforeSha256, "diff.invalid"),
      fieldCode: change.fieldCode as PublicAuthMetadataWatchedField,
      findingCodes: ["metadata-field-changed"] as const,
    };
  });
  if (!equalJson(changes.map((entry) => entry.fieldCode), [...new Set(changes.map((entry) => entry.fieldCode))].sort(rawStringCompare))) return fail("diff.invalid");
  const source = sources[input.sourceId];
  const allowedFields = new Set<PublicAuthMetadataWatchedField>([
    "field-set",
    "unknown-field-values",
    ...Object.values(source.fieldCodes),
  ]);
  if (changes.some((entry) => !allowedFields.has(entry.fieldCode))) return fail("diff.invalid");
  const disposition = input.disposition;
  if (disposition !== "invalid-candidate" && disposition !== "no-change" && disposition !== "review-required") return fail("diff.invalid");
  const candidateFindings = validateFindings(input.candidateFindings, "diff.invalid", source);
  const semanticChanged = booleanValue(input.semanticChanged, "diff.invalid");
  const projectionChanged = input.baselineProjectionSha256 !== input.candidateProjectionSha256;
  if (projectionChanged !== (changes.length > 0) || semanticChanged !== projectionChanged) {
    return fail("diff.invalid");
  }
  const expectedDisposition = candidateFindings.length > 0
    ? "invalid-candidate"
    : semanticChanged ? "review-required" : "no-change";
  if (disposition !== expectedDisposition) return fail("diff.invalid");
  const baselineHttpSha256 = hash(input.baselineHttpSha256, "diff.invalid");
  const candidateHttpSha256 = hash(input.candidateHttpSha256, "diff.invalid");
  const headerChanged = booleanValue(input.headerChanged, "diff.invalid");
  if (headerChanged !== (baselineHttpSha256 !== candidateHttpSha256)) return fail("diff.invalid");
  const baselineResponseBodySha256 = hash(input.baselineResponseBodySha256, "diff.invalid");
  const candidateResponseBodySha256 = hash(input.candidateResponseBodySha256, "diff.invalid");
  const rawBodyChanged = booleanValue(input.rawBodyChanged, "diff.invalid");
  if (rawBodyChanged !== (baselineResponseBodySha256 !== candidateResponseBodySha256)) {
    return fail("diff.invalid");
  }
  return {
    baselineHttpSha256,
    baselineObservationSha256: hash(input.baselineObservationSha256, "diff.invalid"),
    baselineProjectionSha256: hash(input.baselineProjectionSha256, "diff.invalid"),
    baselineResponseBodySha256,
    candidateFindings,
    candidateHttpSha256,
    candidateObservationSha256: hash(input.candidateObservationSha256, "diff.invalid"),
    candidateProjectionSha256: hash(input.candidateProjectionSha256, "diff.invalid"),
    candidateResponseBodySha256,
    changes,
    disposition,
    headerChanged,
    limitations: validateLimitations(input.limitations, "diff.invalid"),
    profileVersion: PUBLIC_AUTH_METADATA_PROFILE,
    rawBodyChanged,
    schemaVersion: PUBLIC_AUTH_METADATA_DIFF_SCHEMA,
    semanticChanged,
    sourceId: input.sourceId,
  };
}

export function parseExactPublicAuthMetadataDiffBytes(bytes: Uint8Array): PublicAuthMetadataDiffV1 {
  return validateDiff(parseExactArtifact(bytes, "diff"));
}

export function serializePublicAuthMetadataDiff(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(canonicalizeJcs(ownJson(value, "diff.invalid")));
  parseExactPublicAuthMetadataDiffBytes(bytes);
  return bytes;
}
