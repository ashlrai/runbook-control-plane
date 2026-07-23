# Public Auth Metadata Drift Profile

## Status and purpose

This document freezes version 1 of Runbook's credential-free public auth
metadata drift lane. It records what an unauthenticated provider origin
self-publishes about OAuth discovery. It does not register a client, start an
authorization flow, request or refresh a token, initialize MCP, enumerate
tools, access an account or card, trade, purchase, or establish commercial-use
permission.

The implementation is a separate package from the Financial Capability
Registry. Capability evidence describes an agent surface; public auth metadata
describes a discovery control plane. Neither is permission evidence.

## Frozen version 1 profile

- Profile: `runbook.robinhood-mcp-public-oauth.v1`
- Observation schema: `runbook.public-auth-metadata-observation.v1`
- Bundle schema: `runbook.public-auth-metadata-bundle.v1`
- Diff schema: `runbook.public-auth-metadata-diff.v1`
- Source series: `robinhood-public-auth-metadata-v1`

Exactly four source IDs exist:

| Source ID | Document kind | Exact request URL |
|---|---|---|
| `robinhood-trading-protected-resource` | `protected-resource-metadata` | `https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading` |
| `robinhood-trading-authorization-server` | `authorization-server-metadata` | `https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading` |
| `robinhood-banking-protected-resource` | `protected-resource-metadata` | `https://banking-agent.robinhood.com/.well-known/oauth-protected-resource/mcp/banking` |
| `robinhood-banking-authorization-server` | `authorization-server-metadata` | `https://banking-agent.robinhood.com/.well-known/oauth-authorization-server/mcp/banking` |

The public API accepts a source ID, never a URL. The private table above is the
only request-target authority. A URI discovered inside a response is data and
must never become a request target.

## Current evidence

The quartet was rechecked at `2026-07-22T09:04:27Z` using four direct HTTPS
GETs, `Accept: application/json`, `Accept-Encoding: identity`, no redirect
following, and no authorization, cookie, body, registration, token, browser,
or MCP request.

| Source ID | Raw bytes | Raw response-body SHA-256 | Exact-JCS projection SHA-256 |
|---|---:|---|---|
| `robinhood-trading-protected-resource` | 193 | `59fb43b49ac2ca7a2df306874b61a44befd9ec20c696ccb8225005914fad9d96` | `e6d8e73cb425d8123a37f9b324e011fba6ef11771c8bcbaf0b5c1705cb0652e5` |
| `robinhood-trading-authorization-server` | 468 | `f2ea2b1a4b4db974478d570189d909f6bbf251027fc008f348ef71197b29a287` | `2b74f9b600e80492dfc8376be304c03793f963f81d5ee59a0ac5a02da948f6fc` |
| `robinhood-banking-protected-resource` | 212 | `b0b44e0340a55063571bbd24b510e0a9b4439abcef29865f23331cc53230481f` | `893f33685e05774f1a9c5f7cade35412f69f6564e98db3be68fa905cb7f2e5d4` |
| `robinhood-banking-authorization-server` | 487 | `c0c6126b998947c06d37903dde6cb196a28230f57940b2d1e685505572910e4d` | `8f194212654177ceef93d75f96555ecd2d0f1ff33b8cbaad32b12caa9f1d4a5d` |

Every raw response body ends in one LF byte. Raw body bytes are therefore not
exact JCS. Version 1 preserves two different facts:

1. the exact response-body byte length and SHA-256, including the LF; and
2. the canonical, no-newline JCS semantic projection and its SHA-256.

Whitespace-only or set-order changes can change raw evidence without changing
the semantic projection. They must not be collapsed into one digest.

## Structural profile

Protected Resource Metadata has exactly these fields:

- `authorization_servers`
- `bearer_methods_supported`
- `resource`
- `scopes_supported`

Authorization Server Metadata has exactly these fields:

- `authorization_endpoint`
- `code_challenge_methods_supported`
- `grant_types_supported`
- `issuer`
- `registration_endpoint`
- `response_types_supported`
- `scopes_supported`
- `token_endpoint`
- `token_endpoint_auth_methods_supported`

RFC 9728 and RFC 8414 allow extension fields. Runbook's unknown-field rejection
is a deliberately closed reviewed profile for drift control, not a claim that
an extended provider response violates OAuth.

All four current documents advertise one opaque scope label. Trading publishes
`internal`; Banking publishes `credit-card`. Both authorization-server
documents currently advertise authorization code and refresh token grants,
response type `code`, PKCE `S256`, and token endpoint authentication method
`none`. These are public self-assertions. They do not establish tool-level
privilege, entitlement, runtime availability, approval enforcement, provider
consent, commercial rights, or token authentication bypass.

## Transport boundary

The manual Node capture boundary must:

- use native `node:https`, normal TLS hostname validation, and exactly four
  compile-time HTTPS targets;
- send only `GET`, `Accept: application/json`, and
  `Accept-Encoding: identity`;
- send no authorization, cookie, body, caller header, ambient proxy, or
  caller-selected host;
- reject every redirect and non-200 status;
- reject `Set-Cookie`, `Content-Encoding`, an absent or inconsistent
  `Content-Length`, duplicate singleton headers, and non-JSON media types;
- cap response headers at 16 KiB, body bytes at 64 KiB, and total time at ten
  seconds;
- count streaming chunks before final allocation and destroy the exact request
  on every terminal error;
- capture candidates only. It must not promote a baseline automatically.

Only these normalized response headers may enter evidence:

- content type and content length;
- content encoding;
- server date;
- ETag, Last-Modified, Cache-Control, and Vary;
- Location presence; and
- Set-Cookie presence.

CloudFront IDs, internal Envoy/VGS fields, remote addresses, request IDs,
server labels, and routing metadata are omitted.

## Parsing and normalization

All artifacts have explicit byte, string, array, depth, and node limits. The
raw provider-body parser rejects malformed UTF-8, a UTF-8 BOM, malformed JSON,
duplicate keys, unpaired Unicode surrogates, unsafe integers, negative zero,
missing required fields, duplicate semantic-set members, and structurally
unsafe URI forms. It accepts uniquely reordered semantic sets and normalizes
them. A bounded, structurally valid unknown extension or HTTPS URI produces
digest-only evidence and an invalid-profile finding; it is not silently
dropped and is never invoked. Exact observation, bundle, and diff artifact
parsers additionally require closed fields and sorted, unique semantic sets.

Raw provider bodies need not be canonical. After strict parsing, set-valued
fields are normalized in raw code-unit order and serialized as exact RFC 8785
JCS without a transport newline. Observation, bundle, and diff artifacts must
already be exact JCS when parsed from bytes.

Each source profile binds exact resource, issuer, authorization-server,
authorization, token, and registration URIs. Portable observations and diffs
preserve a new or changed URI only through a digest and stable finding code.
The local candidate directory necessarily retains the exact raw body and local
projection for human review; those files are not portable or publication-safe.
No discovered URI is ever invoked.

An exact-artifact parser establishes closed structural and canonical-byte
validity. For an invalid-profile observation, its digest claims remain
self-asserted until `verifyPublicAuthMetadataObservationEvidence` replays the
observation against the exact raw provider body. Release review, bundle use,
and semantic-diff claims must perform that evidence replay when raw bytes are
available; parsing an artifact alone is not provider attestation.

## Bundle and lineage

A valid bundle contains exactly one observation for each frozen source ID.
Observation retrieval declarations must fit within 30,000 milliseconds. The
bundle records the exact integer `durationMilliseconds` plus its first and last
declared timestamps.
Every observation binds its source ID, exact request URL, declared retrieval
time, normalized headers, raw response-body evidence, semantic projection
digest, findings, and limitations.

Version 1 lineage records an integer revision, exact source-series constant,
and the exact previous admitted bundle digest (`null` only at revision 1).
Revision repeat, skip, rollback, provider/profile/source-series substitution,
missing or duplicated source, and declared-time regression fail closed. Server
`Date` is an observation, not trusted clock authority.

## Digest-only semantic diff

Portable diffs expose artifact and field-value digests, stable field codes,
stable findings, and one disposition:

- `no-change`
- `review-required`
- `invalid-candidate`

Watched semantic fields include resource, issuer, authorization servers,
authorization/token/registration endpoints, grants, response types, PKCE
methods, token authentication methods, bearer methods, and advertised scope
labels. Raw-only body or normalized-header drift is separately visible.

Portable diffs must not contain a raw endpoint, scope label, provider response,
discovered URI, account/card value, credential, token, signature, key, or
provider-internal header.

There is no composite score. A diff is not a safety, OAuth conformance,
permission, or production-readiness verdict.

## Required limitations

Every portable observation and diff carries this complete set in exact artifact
order:

- `candidate-capture-does-not-promote-a-baseline`
- `closed-profile-rejects-unreviewed-oauth-extensions`
- `does-not-authorize-account-card-trade-purchase-or-capital-access`
- `does-not-authorize-registration-authentication-token-or-mcp-use`
- `does-not-grant-provider-consent-or-commercial-use-rights`
- `does-not-prove-authenticated-tools-privileges-or-entitlements`
- `does-not-prove-runtime-availability-or-approval-enforcement`
- `public-self-asserted-discovery-metadata-only`
- `time-is-declared-not-independently-trusted`

## Release gates

- Frozen current quartet reproduces every raw and projection digest.
- Deterministic fixture generation produces the same complete file set and
  bytes twice without live network access.
- Hostile parser and transport matrices pass.
- Every watched field has a mutation regression.
- Whitespace/LF/set-order raw-only controls pass.
- A trap response containing authorization, token, registration, and MCP URLs
  produces no follow-up request.
- Static source inspection proves the request target comes only from the
  four-entry table and no OAuth-client operation exists.
- Full workspace test, typecheck, lint, build, dependency audit, secret scan,
  reproducibility, and GitHub Actions pass.

## Explicit deferrals

Version 1 does not schedule refreshes, authenticate, register a client, invoke
OAuth endpoints, initialize MCP, capture authenticated capabilities, mutate a
durable baseline, integrate with the provider-rights release gate, or expose a
hosted UI. Those require separate reviewed milestones.
