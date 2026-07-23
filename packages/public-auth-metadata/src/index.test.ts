/// <reference types="node" />

import { runInNewContext } from "node:vm";

import { canonicalizeJcs, sha256Utf8 } from "@runbook/financial-bench";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_AUTH_METADATA_LIMITATIONS,
  PUBLIC_AUTH_METADATA_PROFILE_FINDINGS,
  PUBLIC_AUTH_METADATA_SOURCE_IDS,
  PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
  PUBLIC_AUTH_METADATA_WATCHED_FIELDS,
  PublicAuthMetadataError,
  buildPublicAuthMetadataBundle,
  buildPublicAuthMetadataObservation,
  diffPublicAuthMetadataObservationBytes,
  getPublicAuthMetadataSourceDefinition,
  parseExactPublicAuthMetadataBundleBytes,
  parseExactPublicAuthMetadataDiffBytes,
  parseExactPublicAuthMetadataObservationBytes,
  parseRobinhoodPublicAuthMetadataBody,
  serializePublicAuthMetadataObservation,
  validatePublicAuthMetadataBundleSuccessor,
  verifyPublicAuthMetadataObservationEvidence,
  type PublicAuthMetadataHttpEvidence,
  type PublicAuthMetadataSourceId,
  type PublicAuthMetadataWatchedField,
} from "./index.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const CURRENT: Readonly<Record<PublicAuthMetadataSourceId, Readonly<{
  body: string;
  canonicalSha256: string;
  rawSha256: string;
}>>> = {
  "robinhood-banking-authorization-server": {
    body: '{"authorization_endpoint":"https://robinhood.com/oauth","code_challenge_methods_supported":["S256"],"grant_types_supported":["authorization_code","refresh_token"],"issuer":"https://banking-agent.robinhood.com/mcp/banking","registration_endpoint":"https://banking-agent.robinhood.com/oauth/banking/register","response_types_supported":["code"],"scopes_supported":["credit-card"],"token_endpoint":"https://api.robinhood.com/oauth2/token/","token_endpoint_auth_methods_supported":["none"]}\n',
    canonicalSha256: "8f194212654177ceef93d75f96555ecd2d0f1ff33b8cbaad32b12caa9f1d4a5d",
    rawSha256: "c0c6126b998947c06d37903dde6cb196a28230f57940b2d1e685505572910e4d",
  },
  "robinhood-banking-protected-resource": {
    body: '{"authorization_servers":["https://banking-agent.robinhood.com/mcp/banking"],"bearer_methods_supported":["header"],"resource":"https://banking-agent.robinhood.com/mcp/banking","scopes_supported":["credit-card"]}\n',
    canonicalSha256: "893f33685e05774f1a9c5f7cade35412f69f6564e98db3be68fa905cb7f2e5d4",
    rawSha256: "b0b44e0340a55063571bbd24b510e0a9b4439abcef29865f23331cc53230481f",
  },
  "robinhood-trading-authorization-server": {
    body: '{"authorization_endpoint":"https://robinhood.com/oauth","code_challenge_methods_supported":["S256"],"grant_types_supported":["authorization_code","refresh_token"],"issuer":"https://agent.robinhood.com/mcp/trading","registration_endpoint":"https://agent.robinhood.com/oauth/trading/register","response_types_supported":["code"],"scopes_supported":["internal"],"token_endpoint":"https://api.robinhood.com/oauth2/token/","token_endpoint_auth_methods_supported":["none"]}\n',
    canonicalSha256: "2b74f9b600e80492dfc8376be304c03793f963f81d5ee59a0ac5a02da948f6fc",
    rawSha256: "f2ea2b1a4b4db974478d570189d909f6bbf251027fc008f348ef71197b29a287",
  },
  "robinhood-trading-protected-resource": {
    body: '{"authorization_servers":["https://agent.robinhood.com/mcp/trading"],"bearer_methods_supported":["header"],"resource":"https://agent.robinhood.com/mcp/trading","scopes_supported":["internal"]}\n',
    canonicalSha256: "e6d8e73cb425d8123a37f9b324e011fba6ef11771c8bcbaf0b5c1705cb0652e5",
    rawSha256: "59fb43b49ac2ca7a2df306874b61a44befd9ec20c696ccb8225005914fad9d96",
  },
};

const HTTP = (length: number): PublicAuthMetadataHttpEvidence => ({
  cacheControl: null,
  contentEncoding: null,
  contentLength: length,
  contentType: "application/json",
  etag: null,
  lastModified: null,
  locationPresent: false,
  serverDate: "Wed, 22 Jul 2026 08:57:45 GMT",
  setCookiePresent: false,
  status: 200,
  vary: null,
});

function build(
  sourceId: PublicAuthMetadataSourceId,
  body: string,
  retrievedAtDeclared = "2026-07-22T09:00:00Z",
) {
  const bytes = enc.encode(body);
  return buildPublicAuthMetadataObservation({
    http: HTTP(bytes.byteLength),
    rawBodyBytes: bytes,
    retrievedAtDeclared,
    sourceId,
  });
}

function mutateBody(
  sourceId: PublicAuthMetadataSourceId,
  mutate: (value: Record<string, unknown>) => void,
): string {
  const value = JSON.parse(CURRENT[sourceId].body) as Record<string, unknown>;
  mutate(value);
  return `${JSON.stringify(value)}\n`;
}

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof PublicAuthMetadataError) return error.code;
    throw error;
  }
  throw new Error("expected PublicAuthMetadataError");
}

describe("Robinhood public auth metadata pure core", () => {
  it("freezes the four exact sources, one source series, and nine limitations", () => {
    expect(PUBLIC_AUTH_METADATA_SOURCE_IDS).toHaveLength(4);
    expect(PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID).toBe("robinhood-public-auth-metadata-v1");
    expect(PUBLIC_AUTH_METADATA_LIMITATIONS).toEqual([
      "candidate-capture-does-not-promote-a-baseline",
      "closed-profile-rejects-unreviewed-oauth-extensions",
      "does-not-authorize-account-card-trade-purchase-or-capital-access",
      "does-not-authorize-registration-authentication-token-or-mcp-use",
      "does-not-grant-provider-consent-or-commercial-use-rights",
      "does-not-prove-authenticated-tools-privileges-or-entitlements",
      "does-not-prove-runtime-availability-or-approval-enforcement",
      "public-self-asserted-discovery-metadata-only",
      "time-is-declared-not-independently-trusted",
    ]);
    for (const values of [
      PUBLIC_AUTH_METADATA_SOURCE_IDS,
      PUBLIC_AUTH_METADATA_WATCHED_FIELDS,
      PUBLIC_AUTH_METADATA_PROFILE_FINDINGS,
      PUBLIC_AUTH_METADATA_LIMITATIONS,
    ]) {
      expect(Object.isFrozen(values)).toBe(true);
      expect(() => (values as unknown as string[]).push("attacker-controlled"))
        .toThrow(TypeError);
    }
    for (const sourceId of PUBLIC_AUTH_METADATA_SOURCE_IDS) {
      const source = getPublicAuthMetadataSourceDefinition(sourceId);
      expect(source.sourceId).toBe(sourceId);
      expect(source.sourceSeriesId).toBe(PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID);
      expect(source.requestedUrl).toMatch(/^https:\/\/(?:agent|banking-agent)\.robinhood\.com\/\.well-known\/oauth-/);
    }
  });

  it("preserves exact raw LF hashes separately from normalized exact-JCS hashes", () => {
    for (const sourceId of PUBLIC_AUTH_METADATA_SOURCE_IDS) {
      const current = CURRENT[sourceId];
      const result = build(sourceId, current.body);
      expect(result.observation.profileValid, sourceId).toBe(true);
      expect(result.observation.responseBody.byteLength, sourceId).toBe(enc.encode(current.body).byteLength);
      expect(result.observation.responseBody.sha256, sourceId).toBe(current.rawSha256);
      expect(result.observation.projectionSha256, sourceId).toBe(current.canonicalSha256);
      expect(sha256Utf8(dec.decode(result.projectionBytes)), sourceId).toBe(current.canonicalSha256);
      expect(result.projectionBytes.at(-1), sourceId).not.toBe(0x0a);
      expect(result.observationBytes.at(-1), sourceId).not.toBe(0x0a);
      expect(parseExactPublicAuthMetadataObservationBytes(result.observationBytes)).toEqual(result.observation);
    }
  });

  it("owns caller bytes and structured HTTP input before returning", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const rawBodyBytes = enc.encode(CURRENT[sourceId].body);
    const http = { ...HTTP(rawBodyBytes.byteLength) };
    const result = buildPublicAuthMetadataObservation({
      http,
      rawBodyBytes,
      retrievedAtDeclared: "2026-07-22T09:00:00Z",
      sourceId,
    });
    rawBodyBytes.fill(0x78);
    Object.assign(http, { cacheControl: "attacker" });
    expect(result.observation.responseBody.sha256).toBe(CURRENT[sourceId].rawSha256);
    expect(result.observation.http.cacheControl).toBeNull();
  });

  it("translates nested hostile object traps into stable validation errors", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const rawBodyBytes = enc.encode(CURRENT[sourceId].body);
    const hostileHttp = new Proxy(HTTP(rawBodyBytes.byteLength), {
      ownKeys() {
        throw new Error("caller-controlled trap");
      },
    });
    expect(errorCode(() => buildPublicAuthMetadataObservation({
      http: hostileHttp,
      rawBodyBytes,
      retrievedAtDeclared: "2026-07-22T09:00:00Z",
      sourceId,
    }))).toBe("http.invalid");
  });

  it("rejects getters, hostile proxies, and array subclasses while owning typed-array subclasses intrinsically", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const rawBodyBytes = enc.encode(CURRENT[sourceId].body);
    let getterCalls = 0;
    const getterInput = {
      rawBodyBytes,
      retrievedAtDeclared: "2026-07-22T09:00:00Z",
      sourceId,
    } as Record<string, unknown>;
    Object.defineProperty(getterInput, "http", {
      enumerable: true,
      get() { getterCalls += 1; return HTTP(rawBodyBytes.length); },
    });
    expect(errorCode(() => buildPublicAuthMetadataObservation(
      getterInput as never,
    ))).toBe("observation.input-invalid");
    expect(getterCalls).toBe(0);

    const hostile = new Proxy({
      http: HTTP(rawBodyBytes.length), rawBodyBytes,
      retrievedAtDeclared: "2026-07-22T09:00:00Z", sourceId,
    }, { ownKeys() { throw new Error("trap"); } });
    expect(errorCode(() => buildPublicAuthMetadataObservation(hostile))).toBe("observation.input-invalid");

    class Bytes extends Uint8Array {}
    const subclassBytes = new Bytes(rawBodyBytes);
    Object.defineProperty(subclassBytes, Symbol.iterator, {
      get() {
        getterCalls += 1;
        throw new Error("iterator must remain unused");
      },
    });
    expect(buildPublicAuthMetadataObservation({
      http: HTTP(rawBodyBytes.length), rawBodyBytes: subclassBytes,
      retrievedAtDeclared: "2026-07-22T09:00:00Z", sourceId,
    }).observation.profileValid).toBe(true);
    expect(getterCalls).toBe(0);

    class Findings extends Array<string> {}
    const built = build(sourceId, CURRENT[sourceId].body);
    expect(errorCode(() => serializePublicAuthMetadataObservation({
      ...built.observation,
      findings: new Findings(),
    }))).toBe("observation.invalid");
  });

  it("rejects BOM, malformed UTF-8, duplicate keys, oversized bytes, and excessive depth", () => {
    const sourceId = "robinhood-trading-protected-resource";
    expect(errorCode(() => parseRobinhoodPublicAuthMetadataBody(
      sourceId,
      new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    ))).toBe("metadata.bytes-bom");
    expect(errorCode(() => parseRobinhoodPublicAuthMetadataBody(
      sourceId,
      new Uint8Array([0x7b, 0xff, 0x7d]),
    ))).toBe("metadata.bytes-invalid-utf8");
    expect(errorCode(() => parseRobinhoodPublicAuthMetadataBody(
      sourceId,
      enc.encode('{"resource":"a","resource":"b"}'),
    ))).toBe("metadata.bytes-duplicate-key");
    expect(errorCode(() => parseRobinhoodPublicAuthMetadataBody(
      sourceId,
      enc.encode(`{"x":"${"x".repeat(70_000)}"}`),
    ))).toBe("metadata.bytes-too-large");
    expect(errorCode(() => parseRobinhoodPublicAuthMetadataBody(
      sourceId,
      enc.encode(`${"[".repeat(20)}0${"]".repeat(20)}`),
    ))).toBe("metadata.bytes-too-complex");
  });

  it("rejects coercive or hostile byte inputs before iterator or length access", () => {
    let getterCalls = 0;
    const hostileBytes = new Proxy(enc.encode("{}"), {
      get(target, property, receiver) {
        getterCalls += 1;
        if (property === Symbol.iterator) throw new Error("caller iterator trap");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(errorCode(() => parseRobinhoodPublicAuthMetadataBody(
      "robinhood-trading-protected-resource",
      hostileBytes,
    ))).toBe("metadata.bytes-invalid");
    expect(getterCalls).toBe(0);

    const hostileLength = Object.create(null, {
      length: {
        get() {
          getterCalls += 1;
          return 0x7fff_ffff;
        },
      },
    });
    expect(errorCode(() => parseExactPublicAuthMetadataObservationBytes(
      hostileLength as Uint8Array,
    ))).toBe("observation.bytes-invalid");
    expect(getterCalls).toBe(0);
    expect(errorCode(() => parseExactPublicAuthMetadataObservationBytes(
      new Uint8Array(256 * 1_024 + 1),
    ))).toBe("observation.bytes-too-large");
    const foreignBody = runInNewContext(
      "Uint8Array.from(values)",
      { values: [...enc.encode(CURRENT["robinhood-trading-protected-resource"].body)] },
    ) as Uint8Array;
    expect(parseRobinhoodPublicAuthMetadataBody(
      "robinhood-trading-protected-resource",
      foreignBody,
    ).profileValid).toBe(true);
  });

  it("rejects bad HTTP evidence and impossible or non-canonical times", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const body = enc.encode(CURRENT[sourceId].body);
    const base = { rawBodyBytes: body, retrievedAtDeclared: "2026-07-22T09:00:00Z", sourceId };
    expect(errorCode(() => buildPublicAuthMetadataObservation({ ...base, http: { ...HTTP(body.length), contentLength: body.length + 1 } }))).toBe("http.content-length-mismatch");
    expect(errorCode(() => buildPublicAuthMetadataObservation({ ...base, http: { ...HTTP(body.length), locationPresent: true } as unknown as PublicAuthMetadataHttpEvidence }))).toBe("http.redirect-refused");
    expect(errorCode(() => buildPublicAuthMetadataObservation({ ...base, http: { ...HTTP(body.length), setCookiePresent: true } as unknown as PublicAuthMetadataHttpEvidence }))).toBe("http.set-cookie-refused");
    expect(errorCode(() => buildPublicAuthMetadataObservation({ ...base, http: HTTP(body.length), retrievedAtDeclared: "2026-02-30T09:00:00Z" }))).toBe("observation.time-invalid");
  });

  it("normalizes legal set reordering and whitespace into raw-only no-change", () => {
    const sourceId = "robinhood-trading-authorization-server";
    const baseline = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
    const value = JSON.parse(CURRENT[sourceId].body) as Record<string, unknown>;
    value.grant_types_supported = ["refresh_token", "authorization_code"];
    const reordered = `  ${JSON.stringify(value, null, 2)}\r\n`;
    const candidate = build(sourceId, reordered, "2026-07-22T09:00:01Z");
    const { diff } = diffPublicAuthMetadataObservationBytes(baseline.observationBytes, candidate.observationBytes);
    expect(candidate.observation.profileValid).toBe(true);
    expect(candidate.observation.projectionSha256).toBe(baseline.observation.projectionSha256);
    expect(diff).toMatchObject({
      changes: [],
      disposition: "no-change",
      rawBodyChanged: true,
      semanticChanged: false,
    });
  });

  it("emits digest-only invalid evidence for unknown extensions and unallowlisted HTTPS URIs", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const baseline = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
    const trap = "https://attacker.invalid/never-request-this";
    const body = mutateBody(sourceId, (value) => {
      value.resource = trap;
      value.future_extension = { endpoint: trap };
    });
    const candidate = build(sourceId, body, "2026-07-22T09:00:01Z");
    const { diff, diffBytes } = diffPublicAuthMetadataObservationBytes(baseline.observationBytes, candidate.observationBytes);
    expect(candidate.observation.profileValid).toBe(false);
    expect(candidate.observation.findings).toEqual(expect.arrayContaining([
      "metadata-field-unknown", "resource-mismatch", "uri-unallowlisted",
    ]));
    expect(diff.disposition).toBe("invalid-candidate");
    expect(diff.semanticChanged).toBe(true);
    expect(diff.changes.map((entry) => entry.fieldCode)).toEqual(expect.arrayContaining([
      "field-set", "resource", "unknown-field-values",
    ]));
    expect(dec.decode(diffBytes)).not.toContain(trap);
    expect(parseExactPublicAuthMetadataDiffBytes(diffBytes)).toEqual(diff);
  });

  it("retains __proto__ extension evidence without prototype pollution or semantic loss", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const baseline = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
    const clean = CURRENT[sourceId].body.trimEnd();
    const body = `${clean.slice(0, -1)},"__proto__":{"endpoint":"https://attacker.invalid/never"}}\n`;
    const candidate = build(sourceId, body, "2026-07-22T09:00:01Z");
    const { diff } = diffPublicAuthMetadataObservationBytes(
      baseline.observationBytes,
      candidate.observationBytes,
    );
    expect(candidate.observation.findings).toContain("metadata-field-unknown");
    expect(dec.decode(candidate.projectionBytes)).toContain('"__proto__"');
    expect(diff.changes.map((entry) => entry.fieldCode)).toEqual(expect.arrayContaining([
      "field-set", "unknown-field-values",
    ]));
    expect(({} as { endpoint?: string }).endpoint).toBeUndefined();
  });

  it("detects every watched provider field without publishing values", () => {
    const cases: readonly [PublicAuthMetadataSourceId, string, PublicAuthMetadataWatchedField, unknown][] = [
      ["robinhood-trading-authorization-server", "authorization_endpoint", "authorization-endpoint", "https://example.invalid/oauth"],
      ["robinhood-trading-protected-resource", "authorization_servers", "authorization-servers", ["https://example.invalid/mcp"]],
      ["robinhood-trading-protected-resource", "bearer_methods_supported", "bearer-methods-supported", ["body"]],
      ["robinhood-trading-authorization-server", "code_challenge_methods_supported", "code-challenge-methods-supported", ["S512"]],
      ["robinhood-trading-authorization-server", "grant_types_supported", "grant-types-supported", ["client_credentials"]],
      ["robinhood-trading-authorization-server", "issuer", "issuer", "https://example.invalid/mcp"],
      ["robinhood-trading-authorization-server", "registration_endpoint", "registration-endpoint", "https://example.invalid/register"],
      ["robinhood-trading-protected-resource", "resource", "resource", "https://example.invalid/mcp"],
      ["robinhood-trading-authorization-server", "response_types_supported", "response-types-supported", ["token"]],
      ["robinhood-trading-protected-resource", "scopes_supported", "scopes-supported", ["other"]],
      ["robinhood-trading-authorization-server", "token_endpoint", "token-endpoint", "https://example.invalid/token"],
      ["robinhood-trading-authorization-server", "token_endpoint_auth_methods_supported", "token-endpoint-auth-methods-supported", ["client_secret_post"]],
    ];
    for (const [sourceId, key, fieldCode, replacement] of cases) {
      const baseline = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
      const candidate = build(sourceId, mutateBody(sourceId, (value) => { value[key] = replacement; }), "2026-07-22T09:00:01Z");
      const { diff, diffBytes } = diffPublicAuthMetadataObservationBytes(baseline.observationBytes, candidate.observationBytes);
      expect(diff.changes.map((entry) => entry.fieldCode), fieldCode).toContain(fieldCode);
      expect(diff.disposition, fieldCode).toBe("invalid-candidate");
      expect(dec.decode(diffBytes), fieldCode).not.toContain("example.invalid");
    }
    expect(PUBLIC_AUTH_METADATA_WATCHED_FIELDS).toEqual([
      "authorization-endpoint", "authorization-servers", "bearer-methods-supported",
      "code-challenge-methods-supported", "field-set", "grant-types-supported", "issuer",
      "registration-endpoint", "resource", "response-types-supported", "scopes-supported",
      "token-endpoint", "token-endpoint-auth-methods-supported", "unknown-field-values",
    ]);
  });

  it("marks duplicate advertised set entries invalid instead of normalizing away evidence", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const body = mutateBody(sourceId, (value) => {
      value.scopes_supported = ["internal", "internal"];
    });
    const result = build(sourceId, body);
    expect(result.observation.profileValid).toBe(false);
    expect(result.observation.findings).toContain("metadata-array-duplicate");
  });

  it("requires exact-JCS observation, bundle, and diff artifact bytes", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const baseline = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
    const candidate = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:01Z");
    const { diffBytes } = diffPublicAuthMetadataObservationBytes(baseline.observationBytes, candidate.observationBytes);
    for (const [bytes, parser, prefix] of [
      [baseline.observationBytes, parseExactPublicAuthMetadataObservationBytes, "observation"],
      [diffBytes, parseExactPublicAuthMetadataDiffBytes, "diff"],
    ] as const) {
      expect(errorCode(() => parser(enc.encode(` ${dec.decode(bytes)}`)))).toBe(`${prefix}.bytes-not-exact-jcs`);
      expect(errorCode(() => parser(enc.encode(`${dec.decode(bytes)}\n`)))).toBe(`${prefix}.bytes-not-exact-jcs`);
    }
    expect(errorCode(() => parseExactPublicAuthMetadataObservationBytes(
      enc.encode('{"value":"\\ud800"}'),
    ))).toBe("observation.bytes-invalid-unicode");
  });

  it("rejects hostile exact artifacts with unbound lengths, nonapplicable digests, disposition, or raw/header flags", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const baseline = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
    const candidate = build(sourceId, ` ${CURRENT[sourceId].body}`, "2026-07-22T09:00:01Z");
    const { diffBytes } = diffPublicAuthMetadataObservationBytes(
      baseline.observationBytes,
      candidate.observationBytes,
    );
    const observation = JSON.parse(dec.decode(baseline.observationBytes)) as Record<string, unknown>;
    const badLength = structuredClone(observation) as Record<string, unknown>;
    (badLength.http as Record<string, unknown>).contentLength = 999;
    expect(errorCode(() => parseExactPublicAuthMetadataObservationBytes(
      enc.encode(canonicalizeJcs(badLength)),
    ))).toBe("observation.invalid");
    const badDigest = structuredClone(observation) as Record<string, unknown>;
    const digests = badDigest.semanticDigests as Array<Record<string, unknown>>;
    const token = digests.find((entry) => entry.fieldCode === "token-endpoint");
    if (token === undefined) throw new Error("missing token digest");
    token.sha256 = "0".repeat(64);
    expect(errorCode(() => parseExactPublicAuthMetadataObservationBytes(
      enc.encode(canonicalizeJcs(badDigest)),
    ))).toBe("observation.invalid");

    for (const mutation of [
      (value: Record<string, unknown>) => { value.disposition = "review-required"; },
      (value: Record<string, unknown>) => { value.rawBodyChanged = !value.rawBodyChanged; },
      (value: Record<string, unknown>) => { value.headerChanged = !value.headerChanged; },
    ]) {
      const diff = JSON.parse(dec.decode(diffBytes)) as Record<string, unknown>;
      mutation(diff);
      expect(errorCode(() => parseExactPublicAuthMetadataDiffBytes(
        enc.encode(canonicalizeJcs(diff)),
      ))).toBe("diff.invalid");
    }
    const wrongSourceFinding = JSON.parse(dec.decode(diffBytes)) as Record<string, unknown>;
    wrongSourceFinding.candidateFindings = ["issuer-mismatch"];
    wrongSourceFinding.disposition = "invalid-candidate";
    expect(errorCode(() => parseExactPublicAuthMetadataDiffBytes(
      enc.encode(canonicalizeJcs(wrongSourceFinding)),
    ))).toBe("diff.invalid");
  });

  it("reports normalized header drift by digest without changing semantic disposition", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const rawBodyBytes = enc.encode(CURRENT[sourceId].body);
    const baseline = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
    const candidate = buildPublicAuthMetadataObservation({
      http: { ...HTTP(rawBodyBytes.length), serverDate: "Wed, 22 Jul 2026 08:58:45 GMT" },
      rawBodyBytes,
      retrievedAtDeclared: "2026-07-22T09:00:01Z",
      sourceId,
    });
    const { diff, diffBytes } = diffPublicAuthMetadataObservationBytes(
      baseline.observationBytes,
      candidate.observationBytes,
    );
    expect(diff).toMatchObject({
      disposition: "no-change",
      headerChanged: true,
      rawBodyChanged: false,
      semanticChanged: false,
    });
    expect(dec.decode(diffBytes)).not.toContain("08:58:45");
  });

  it("builds an exact four-source bundle and enforces successor lineage", () => {
    const firstObservations = PUBLIC_AUTH_METADATA_SOURCE_IDS.map((sourceId, index) =>
      build(sourceId, CURRENT[sourceId].body, `2026-07-22T09:00:0${index}Z`).observationBytes);
    const first = buildPublicAuthMetadataBundle(firstObservations);
    expect(first.bundle).toMatchObject({
      previousAdmittedBundleSha256: null,
      profileValid: true,
      registryRevision: 1,
      sourceSeriesId: PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
    });
    expect(parseExactPublicAuthMetadataBundleBytes(first.bundleBytes)).toEqual(first.bundle);
    const previousHash = sha256Utf8(dec.decode(first.bundleBytes));
    const secondObservations = PUBLIC_AUTH_METADATA_SOURCE_IDS.map((sourceId, index) =>
      build(sourceId, CURRENT[sourceId].body, `2026-07-22T09:01:0${index}Z`).observationBytes);
    const second = buildPublicAuthMetadataBundle(secondObservations, {
      previousAdmittedBundleSha256: previousHash,
      registryRevision: 2,
    });
    expect(validatePublicAuthMetadataBundleSuccessor(first.bundleBytes, second.bundleBytes)).toEqual(second.bundle);

    const skipped = buildPublicAuthMetadataBundle(secondObservations, {
      previousAdmittedBundleSha256: previousHash,
      registryRevision: 3,
    });
    expect(errorCode(() => validatePublicAuthMetadataBundleSuccessor(first.bundleBytes, skipped.bundleBytes))).toBe("bundle.revision-not-successor");
    const wrongPrevious = buildPublicAuthMetadataBundle(secondObservations, {
      previousAdmittedBundleSha256: "0".repeat(64),
      registryRevision: 2,
    });
    expect(errorCode(() => validatePublicAuthMetadataBundleSuccessor(first.bundleBytes, wrongPrevious.bundleBytes))).toBe("bundle.previous-hash-mismatch");
  });

  it("rejects hostile bundle member and lineage traps without invoking getters", () => {
    const observations = PUBLIC_AUTH_METADATA_SOURCE_IDS.map((sourceId, index) =>
      build(sourceId, CURRENT[sourceId].body, `2026-07-22T09:00:0${index}Z`).observationBytes);
    let trapCalls = 0;
    const hostileMembers = new Proxy(observations, {
      ownKeys() {
        trapCalls += 1;
        throw new Error("caller ownKeys trap");
      },
    });
    expect(errorCode(() => buildPublicAuthMetadataBundle(hostileMembers))).toBe("bundle.members-invalid");
    expect(trapCalls).toBe(1);

    const hostileLineage = Object.create(Object.prototype, {
      previousAdmittedBundleSha256: { enumerable: true, value: null },
      registryRevision: {
        enumerable: true,
        get() {
          trapCalls += 1;
          return 1;
        },
      },
    });
    expect(errorCode(() => buildPublicAuthMetadataBundle(
      observations,
      hostileLineage,
    ))).toBe("bundle.lineage-invalid");
    expect(trapCalls).toBe(1);
  });

  it("replays observation evidence against the exact raw provider body", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const rawBodyBytes = enc.encode(CURRENT[sourceId].body);
    const built = build(sourceId, CURRENT[sourceId].body);
    expect(verifyPublicAuthMetadataObservationEvidence(
      built.observationBytes,
      rawBodyBytes,
    )).toEqual(built.observation);

    const changedRaw = enc.encode(mutateBody(sourceId, (value) => {
      value.resource = "https://example.invalid/mcp";
    }));
    expect(errorCode(() => verifyPublicAuthMetadataObservationEvidence(
      built.observationBytes,
      changedRaw,
    ))).toBe("observation.evidence-mismatch");
  });

  it("orders canonical fractional timestamps by milliseconds inside one second", () => {
    const observations = PUBLIC_AUTH_METADATA_SOURCE_IDS.map((sourceId, index) =>
      build(
        sourceId,
        CURRENT[sourceId].body,
        `2026-07-22T09:00:00.${String((index + 1) * 100).padStart(3, "0")}Z`,
      ).observationBytes);
    const bundle = buildPublicAuthMetadataBundle(observations).bundle;
    expect(bundle.retrievalWindow).toEqual({
      durationMilliseconds: 300,
      firstRetrievedAtDeclared: "2026-07-22T09:00:00.100Z",
      lastRetrievedAtDeclared: "2026-07-22T09:00:00.400Z",
    });
  });

  it("rejects partial bundles, excessive skew, revision shape errors, replay, and time regression", () => {
    const observations = PUBLIC_AUTH_METADATA_SOURCE_IDS.map((sourceId, index) =>
      build(sourceId, CURRENT[sourceId].body, `2026-07-22T09:00:0${index}Z`).observationBytes);
    expect(errorCode(() => buildPublicAuthMetadataBundle(observations.slice(1)))).toBe("bundle.members-invalid");
    const skewed = [...observations];
    skewed[3] = build(PUBLIC_AUTH_METADATA_SOURCE_IDS[3], CURRENT[PUBLIC_AUTH_METADATA_SOURCE_IDS[3]].body, "2026-07-22T09:01:00Z").observationBytes;
    expect(errorCode(() => buildPublicAuthMetadataBundle(skewed))).toBe("bundle.retrieval-window-invalid");
    expect(errorCode(() => buildPublicAuthMetadataBundle(observations, {
      previousAdmittedBundleSha256: null,
      registryRevision: 2,
    }))).toBe("bundle.lineage-invalid");

    const first = buildPublicAuthMetadataBundle(observations);
    const firstHash = sha256Utf8(dec.decode(first.bundleBytes));
    const replayed = buildPublicAuthMetadataBundle(observations, {
      previousAdmittedBundleSha256: firstHash,
      registryRevision: 2,
    });
    expect(errorCode(() => validatePublicAuthMetadataBundleSuccessor(first.bundleBytes, replayed.bundleBytes))).toBe("bundle.time-regressed");
  });

  it("rejects invalid baselines, lineage substitution, and non-monotonic observation time", () => {
    const sourceId = "robinhood-trading-protected-resource";
    const valid = build(sourceId, CURRENT[sourceId].body, "2026-07-22T09:00:00Z");
    const invalid = build(sourceId, mutateBody(sourceId, (value) => { value.scopes_supported = ["other"]; }), "2026-07-22T09:00:01Z");
    expect(errorCode(() => diffPublicAuthMetadataObservationBytes(invalid.observationBytes, valid.observationBytes))).toBe("diff.baseline-invalid");
    expect(errorCode(() => diffPublicAuthMetadataObservationBytes(valid.observationBytes, valid.observationBytes))).toBe("diff.retrieval-time-not-monotonic");
    const other = build("robinhood-banking-protected-resource", CURRENT["robinhood-banking-protected-resource"].body, "2026-07-22T09:00:01Z");
    expect(errorCode(() => diffPublicAuthMetadataObservationBytes(valid.observationBytes, other.observationBytes))).toBe("diff.lineage-mismatch");
  });

  it("produces deterministic exact bytes from repeated pure evaluation", () => {
    for (const sourceId of PUBLIC_AUTH_METADATA_SOURCE_IDS) {
      const first = build(sourceId, CURRENT[sourceId].body);
      const second = build(sourceId, CURRENT[sourceId].body);
      expect(first.observationBytes).toEqual(second.observationBytes);
      expect(first.projectionBytes).toEqual(second.projectionBytes);
      expect(canonicalizeJcs(first.observation)).toBe(dec.decode(first.observationBytes));
    }
  });
});
