# Runbook Proof Capsule v1 Draft Interoperability Profile

**Status:** Draft for adversarial implementation review

**Profile identifier:** `runbook.proof-capsule.v1`

**File extension:** `.runbook`

**Media type:** `application/vnd.runbook.proof+zip;version=1`

This document specifies a draft candidate for an interoperable, offline-verifiable Runbook Proof Capsule. It is intentionally narrower than the product vision: version 1 is a metadata-only, author-signed evidence package. It does not establish brokerage truth, execution, completeness, identity, time, performance, or investment skill.

The design goal is boring reproducibility under hostile input. Ten independent implementations should accept the same golden capsule, reject the same mutation corpus with the same stable error codes, and compute the same capsule ID, signer-key fingerprint, and member digests without a Runbook account or network connection.

## 1. Normative language and source standards

The terms **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

Proof Capsule v1 profiles these primary specifications:

- [PKWARE .ZIP File Format Specification, APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). APPNOTE defines local headers, central-directory headers, data descriptors, ZIP64, filename rules, and compression method `0` for stored data. This profile deliberately permits only a small, deterministic subset.
- [DSSE Protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/master/protocol.md) and its [JSON Envelope v1.0.2](https://github.com/secure-systems-lab/dsse/blob/master/envelope.md). DSSE signs exact serialized payload bytes and the authenticated payload type using pre-authentication encoding (PAE). Its `keyid` is an unauthenticated hint, not a trust decision.
- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html) for the two security-critical JSON documents.
- [RFC 8410](https://www.rfc-editor.org/rfc/rfc8410.html) for Ed25519 `SubjectPublicKeyInfo` encoding. Ed25519 algorithm parameters are absent.

The [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md), [DigestSet rules](https://github.com/in-toto/attestation/blob/main/spec/v1/digest_set.md), and [attestation parsing model](https://github.com/in-toto/attestation/blob/main/spec/v1/README.md) inform the separation of envelope, signed statement, subjects, and typed claims. [SLSA v1.2](https://slsa.dev/spec/v1.2/) informs the separation of evidence from verifier expectations and trust in an issuer. A Proof Capsule v1 is **not** an in-toto Statement, SLSA provenance, a SLSA level, or a Sigstore bundle. Those claims require their own conformance work.

## 2. Security and identity model

The signed object is the exact checkpoint statement byte string. The ZIP file is a restricted transport. Whole-capsule payload integrity is transitive:

```text
Ed25519 signature
  -> DSSE PAE(payloadType, exact checkpoint statement bytes)
  -> checkpoint.statement.experimentDigest
  -> SHA-256(exact manifest bytes)
  -> manifest member path + byte length + SHA-256
  -> exact payload member bytes
```

The required compatibility rule is:

```text
checkpoint.statement.experimentDigest =
  lowercase_hex(SHA-256(exact bytes of runbook/manifest.json))
```

This rule reuses the implemented `runbook.checkpoint.v1` primitive instead of defining a second incompatible signed `v1` statement.

The manifest MUST NOT list itself. Doing so would require a self-referential hash. It also MUST NOT list the checkpoint statement, because that statement contains the manifest hash and would create a mutual cycle. It MUST NOT list the DSSE envelope, because the envelope contains the signature over the statement and would create a signature cycle. The embedded public key is bound by the signed `authorKeyId`, not by a manifest entry. These four fixed control members are verified by profile rules; the manifest covers every payload member.

Payload members, including `payload/report.html`, MUST NOT define a semantic field for the current capsule ID, current manifest digest, current checkpoint bytes, current envelope, or current signature: each depends transitively on the payload and would require a cryptographic fixed point. A viewer that wants to show the final capsule ID MUST overlay the verified ID at display time or produce a separate, unsigned receipt. Parent capsule IDs and prior checkpoint IDs do not create this cycle and MAY be embedded. This is a producer and payload-schema rule; the core verifier does not scan opaque strings for coincidental digest text.

Consequences:

- Re-encoding an otherwise valid DSSE envelope, changing ZIP header bytes while preserving this exact profile, or renaming the outer `.runbook` file does not create a new capsule identity.
- Changing any signed statement byte changes the capsule ID and invalidates the existing signature.
- Changing any manifest byte breaks `experimentDigest`.
- Adding, deleting, renaming, truncating, or changing any payload member breaks exact manifest coverage.
- “Package integrity valid” means the fixed control semantics and every declared payload byte verify. It does not mean every transport byte was authored or that the claims are true.

## 3. Exact member layout

A conforming archive MUST contain these members in this exact local-header and central-directory order:

```text
mimetype
runbook/manifest.json
runbook/checkpoint.statement.json
runbook/checkpoint.dsse.json
runbook/author-key.spki.der
payload/charter.json
payload/claims.json
payload/disclosures.json
payload/events.ndjson
payload/report.html
payload/...                         # zero or more additional manifest members
```

Rules:

1. `mimetype` MUST be the first local entry, at byte offset zero. Its exact bytes, with no BOM or newline, MUST be:

   ```text
   application/vnd.runbook.proof+zip;version=1
   ```

2. The other four control members MUST follow in the order shown.
3. Payload members MUST then appear in ascending unsigned byte order of their ASCII path. The manifest `members` array MUST use the same order.
4. Exactly one each of `payload/charter.json`, `payload/claims.json`, `payload/disclosures.json`, `payload/events.ndjson`, and `payload/report.html` is REQUIRED.
5. No directory entries are permitted. Directories exist only as path prefixes.
6. The archive member set MUST equal the five fixed control members plus the manifest `members` paths. An unlisted, missing, or duplicated member is invalid.

Additional payload paths MUST match this ASCII grammar:

```text
payload/<component>(/<component>){0,7}
component = [a-z0-9][a-z0-9._-]{0,63}
```

Every member path MUST be at most 240 bytes. Paths MUST use lowercase ASCII and `/` only. A verifier MUST reject absolute paths; a leading or trailing `/`; empty, `.` or `..` components; backslashes; drive or device prefixes; NUL or control bytes; percent-decoded aliases; Unicode; exact duplicates; and case-folded duplicates. Verifiers MUST compare raw path bytes and MUST NOT URL-decode, Unicode-normalize, or filesystem-normalize a path.

## 4. Deterministic ZIP profile

Proof Capsule v1 is a deterministic subset of APPNOTE. Every member MUST use:

| ZIP field | Required value |
| --- | --- |
| Compression method | `0` (`STORED`) |
| General-purpose flags | `0x0800` only (UTF-8 names) |
| Version needed | `20` |
| Version made by | `0x0314` (UNIX, ZIP 2.0) |
| DOS time | `0x0000` |
| DOS date | `0x0021` (1980-01-01) |
| Extra field length | `0` in local and central headers |
| File comment length | `0` |
| Internal attributes | `0` |
| External attributes | `0x81A40000` (regular file, mode `0644`) |
| Disk number start | `0` |

Additional requirements:

- Compressed size MUST equal uncompressed size for every member.
- Local and central headers MUST agree byte-for-byte on name, flags, method, timestamp, CRC-32, and sizes.
- ZIP CRC-32 MUST match the exact member bytes, using the reflected polynomial `0xEDB88320`, initial register `0xffffffff`, and final one's complement described by APPNOTE. CRC-32 is a transport check, not the security digest.
- Local records and stored member data MUST be contiguous, without gaps or overlaps. The central directory MUST begin immediately after the final member byte.
- Central-directory records MUST be contiguous and end immediately before one End of Central Directory (EOCD) record.
- The EOCD MUST be exactly 22 bytes, end at end-of-file, use disk `0`, report equal on-disk and total entry counts, and have a zero-length archive comment.
- The first four archive bytes MUST be the local-header signature `0x04034b50` in APPNOTE byte order.
- Multi-disk archives, ZIP64 records or sentinel values, data descriptors and flag bit 3, encryption and flag bits 0 or 6, central-directory encryption, archive extra records, archive digital-signature records, file comments, archive comments, extra fields, patched data, and every compression method except `0` are forbidden.
- A conforming verifier MUST reject trailing or prepended bytes, another parseable EOCD or control record outside declared member-data ranges, central/local disagreement, impossible offsets, overlapping ranges, and integer overflow before reading member data. ZIP-looking byte sequences inside a declared payload range are opaque and MUST NOT be scanned as archive structure.

Stored-only v1 is deliberate. It removes decompression bombs, compression-ratio disagreements, and algorithm/version drift. Compression or ZIP64 would require a new major profile.

## 5. Resource limits

Limits are evaluated before allocation where possible. Exceeding any limit is an invalid or resource-rejected capsule; implementations MUST NOT silently raise limits in “lenient” mode.

| Resource | v1 limit |
| --- | ---: |
| Archive bytes | 64 MiB (`67,108,864`) |
| Total stored payload bytes | 60 MiB (`62,914,560`) |
| Total entries | 64 |
| Manifest-listed payload entries | 59 |
| Any one payload member | 16 MiB (`16,777,216`) |
| `runbook/manifest.json` | 64 KiB (`65,536`) |
| `runbook/checkpoint.statement.json` | 64 KiB |
| `runbook/checkpoint.dsse.json` | 128 KiB (`131,072`) |
| `runbook/author-key.spki.der` | exactly 44 bytes |
| Member path | 240 bytes |
| Path components / component bytes | 9 total / 64 each |
| JSON nesting depth | 32 |
| JSON nodes per control document | 5,000 |
| JSON member name or string value in the manifest or statement, or in any envelope field other than the top-level DSSE `payload` value | 32,768 UTF-16 code units |
| Top-level DSSE `payload` string | 87,384 ASCII characters maximum; decoded payload at most 65,536 bytes and whole envelope at most 131,072 bytes |
| Manifest array members | 59 |

Control JSON numbers MUST be finite safe integers in `[-9007199254740991, 9007199254740991]`; manifest sizes are non-negative integers. Negative zero and floating-point numbers are forbidden in control documents. Decimal financial values belong in payload schemas as strings and are never interpreted by the container verifier.

The DSSE `payload` row is the sole string-length exception. `87,384 = 4 * ceil(65,536 / 3)`, the longest padded Base64 representation of a statement allowed by the 64 KiB decoded-byte limit. Correctly unpadded encodings are naturally no longer than that value. The exception applies only to the parsed string value at the envelope object's top-level key named `payload`; `payloadType`, `keyid`, `sig`, and every known or unknown envelope-extension string retain the 32,768-code-unit limit (and the fixed v1 schemas impose smaller semantic lengths where specified). Before retaining decoded bytes, a verifier MUST enforce the 128 KiB envelope-file limit, valid Base64, the 64 KiB decoded-payload limit, and exact equality with the separately bounded statement member.

This is a transport budget, not an expansion of the signed schema. The fixed `runbook.checkpoint.v1` field set and literal/format constraints make any structurally valid v1 statement far smaller than 64 KiB and its Base64 far smaller than 32,768 characters. The 64 KiB statement and 87,384-character envelope-payload ceilings remain defensive parser bounds for malformed or future-looking input; unknown signed fields still fail closed and cannot consume the unused budget.

## 6. Exact byte and JSON rules

### 6.1 Security-critical JSON

`runbook/manifest.json` and `runbook/checkpoint.statement.json` MUST be RFC 8785 JCS bytes:

- UTF-8, no BOM, no trailing newline, and no bytes after the single JSON value;
- no duplicate object names at any depth;
- I-JSON-compatible strings and numbers;
- no whitespace outside strings;
- recursively JCS-sorted object properties; and
- no Unicode normalization or string alteration during parse/serialize.

A verifier MUST parse each document once with duplicate-key detection, produce its RFC 8785 serialization, and require exact byte equality. It MUST perform the digest and DSSE operations over the original bytes, never over a reserialization.

JCS provides deterministic producer bytes; DSSE still authenticates the exact original byte string. This distinction matters: canonicalization is a conformance check, not a substitute for the DSSE payload-binding check.

### 6.2 DSSE envelope JSON

Producers MUST emit the envelope as JCS using padded standard Base64. Verifiers MUST accept either standard or URL-safe Base64, padded or correctly unpadded, as required by the DSSE envelope specification. Mixed alphabets, misplaced padding, non-zero discarded bits, and invalid encodings MUST fail. Therefore producer conformance has one deterministic representation, while verifier conformance accepts DSSE-equivalent external representations and computes the same capsule ID.

For DSSE interoperability, verifiers MUST ignore unknown envelope object fields after duplicate-key and resource checks, and SHOULD emit `envelope.ignored-extension`. Unknown fields MUST NOT influence signature selection or assurance. This differs from accepting unknown fields in the signed Runbook statement, which v1 forbids.

The decoded DSSE payload MUST be byte-for-byte equal to `runbook/checkpoint.statement.json`. A verifier MUST pass those same verified bytes to the statement parser and MUST NOT parse the envelope a second time to retrieve a payload.

### 6.3 Payload bytes

Payload member SHA-256 values cover exact stored bytes. JSON payload producers SHOULD use JCS where their role schema permits it, but the container verifier MUST NOT normalize payloads before hashing. `payload/events.ndjson` SHOULD contain one JCS JSON object per line, use LF (`0x0a`) only, and end with one LF; domain-schema verification decides whether a nonconforming event stream is invalid beyond package-integrity checks.

`payload/report.html` is untrusted opaque data. The core verifier MUST NOT open, parse for active content, render, or execute it. A separate viewer MAY display it only after integrity verification in an origin-isolated sandbox that disables scripts, forms, same-origin access, top navigation, popups, downloads, and network requests. A `report` role is not a safety certification.

## 7. Manifest schema

`runbook/manifest.json` is this exact object shape; unknown fields fail closed in v1:

```json
{
  "capsuleProfile": "runbook.proof-capsule.v1",
  "experimentId": "EXP-001",
  "lineage": {
    "parents": [],
    "relation": "root"
  },
  "members": [
    {
      "bytes": 2048,
      "mediaType": "application/json",
      "path": "payload/charter.json",
      "role": "charter",
      "sha256": "<64 lowercase hex>"
    }
  ],
  "schemaVersion": "runbook.proof-manifest.v1"
}
```

Field rules:

- `schemaVersion` MUST equal `runbook.proof-manifest.v1`.
- `capsuleProfile` MUST equal `runbook.proof-capsule.v1`.
- `experimentId` MUST match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. It is an author-chosen correlation label, not a global identity.
- `members` MUST contain 5 to 59 entries, one for every and only payload member, ordered by path bytes.
- `path` follows section 3.
- `bytes` is the exact stored-byte count.
- `sha256` is exactly 64 lowercase hexadecimal characters and is SHA-256 over exact member bytes.
- `mediaType` is an author declaration of at most 127 printable lowercase ASCII characters, with no CR or LF. It does not cause automatic parsing or rendering.
- `role` is one of `charter`, `claims`, `disclosures`, `events`, `report`, `outcomes`, `reconciliation`, `evidence-projection`, `commitment`, or `policy`.
- The five required paths MUST have matching roles: `charter`, `claims`, `disclosures`, `events`, and `report` respectively.
- `events` MUST declare `application/x-ndjson`; `report` MUST declare `text/html;charset=utf-8`; every other v1 role MUST declare `application/json`.
- `lineage` follows section 10.

The manifest binds membership and bytes, not semantic correctness. Role-specific schemas and claim recomputation are separate checks and MUST appear separately in a receipt.

Because the signed checkpoint declares a metadata-only scope with no underlying records, a v1 producer MUST NOT include raw brokerage exports, confirmations, statements, account numbers, credentials, private keys, or direct personal identifiers. Optional evidence must be a Runbook-generated allowlisted `evidence-projection` JSON document or a salted `commitment` descriptor. A container verifier can enforce roles, schemas, and obvious forbidden fields, but cannot prove that arbitrary string values are private or truthful. Package validity is not a privacy certification; public release still requires human review.

## 8. Checkpoint and DSSE profile

`runbook/checkpoint.statement.json` MUST conform to the implemented `runbook.checkpoint.v1` shape:

```json
{
  "assurancePolicy": "runbook.checkpoint-assurance.v1",
  "authorKeyId": "sha256:<64 lowercase hex>",
  "checkpointSequence": 1,
  "createdAt": "2026-07-21T18:00:00Z",
  "dataClass": "synthetic",
  "eventChain": {
    "algorithm": "runbook-jsonl-chain-v1",
    "eventCount": 42,
    "headHash": "<64 lowercase hex>"
  },
  "experimentDigest": "<SHA-256 of exact manifest bytes>",
  "proofScope": {
    "brokerAttestation": "absent",
    "independentlyRecomputable": false,
    "privacy": "metadata-only",
    "sourceCoverage": "author-declared",
    "underlyingRecordsIncluded": false
  },
  "schemaVersion": "runbook.checkpoint.v1"
}
```

Checkpoint field rules:

- Unknown fields at any statement-object depth are forbidden.
- `schemaVersion`, `assurancePolicy`, `eventChain.algorithm`, and every `proofScope` field MUST equal the literals shown.
- `experimentDigest` and `eventChain.headHash` MUST each be exactly 64 lowercase hexadecimal characters.
- `authorKeyId` MUST be `sha256:` followed by exactly 64 lowercase hexadecimal characters.
- `checkpointSequence` MUST be a safe integer from 1 through 10,000,000.
- `eventChain.eventCount` MUST be a safe integer from 0 through 10,000,000.
- `createdAt` MUST be a valid proleptic-Gregorian RFC 3339 UTC timestamp for years `0001`–`9999`, formatted `YYYY-MM-DDTHH:MM:SSZ` or with exactly three fractional digits before `Z`. Offsets, lowercase `z`, leap seconds, `24:00:00`, and nonexistent calendar dates are forbidden. It is author-declared, not independently anchored.
- `dataClass` MUST be `synthetic` or `live-author-declared`.

`checkpointSequence`, `eventCount`, and `eventChain.headHash` are author-signed assertions. The capsule does not prove that no earlier checkpoint was suppressed, no event was omitted, or the chain corresponds to broker activity.

`runbook/checkpoint.dsse.json` MUST use:

```json
{
  "payload": "<Base64 exact checkpoint.statement.json bytes>",
  "payloadType": "application/vnd.runbook.checkpoint+json;version=1",
  "signatures": [
    {
      "keyid": "sha256:<64 lowercase hex>",
      "sig": "<Base64 64-byte Ed25519 signature>"
    }
  ]
}
```

There MUST be exactly one signature in v1. Its signed input is:

```text
"DSSEv1" SP LEN(type) SP type SP LEN(payload) SP payload
```

Lengths are unsigned decimal ASCII byte lengths with no leading zeros. `type` is UTF-8. `payload` is the exact decoded byte string.

## 9. Author key and signature semantics

`runbook/author-key.spki.der` MUST be exactly one canonical DER `SubjectPublicKeyInfo` for Ed25519:

- OID `1.3.101.112`;
- algorithm parameters absent;
- a 32-byte Ed25519 public key in the BIT STRING; and
- exactly 44 DER bytes in this profile.

The key identifier is:

```text
authorKeyId = "sha256:" || lowercase_hex(SHA-256(exact 44 DER bytes))
```

After validating the key and signature, a verifier MUST require the computed identifier to equal both the statement `authorKeyId` and the envelope signature `keyid`. This comparison detects substitution inside the profile, but the DSSE `keyid` remains an unauthenticated hint until the signature and signed `authorKeyId` verify.

A valid signature proves only that whoever controlled the corresponding private key signed the exact checkpoint bytes and thereby committed to the exact manifest and payload-member digests. The embedded key is self-asserted. It does **not** prove:

- the signer's civil, platform, or Robinhood identity;
- ownership or control of any brokerage account;
- Robinhood or another broker issued any record, order, fill, balance, or return;
- an order was submitted, accepted, filled, or settled;
- the capsule includes every event, account, asset class, loss, fee, cash flow, correction, or source record;
- the author signed at `createdAt` or before an outcome occurred;
- a strategy caused an outcome, is profitable, is suitable, is compliant, or reflects investment skill;
- a private key was uncompromised or exclusively controlled; or
- the ZIP transport is immutable, permanent, or externally anchored.

An external trust store MAY bind a fingerprint to a known identity or earlier observation. That result MUST be reported as a separate, local policy evaluation. A key bundled inside the capsule MUST NOT bootstrap its own identity trust.

## 10. Capsule identity and lineage

The capsule ID reuses the implemented checkpoint-ID formula:

```text
capsuleId = lowercase_hex(
  SHA-256("RUNBOOK_CHECKPOINT_ID_V1\0" || exact checkpoint statement bytes)
)
```

The NUL is one byte `0x00`. The ID is 64 lowercase hexadecimal characters. It identifies signed checkpoint content, not the outer filename or ZIP serialization.

`manifest.lineage` has exactly `relation` and `parents`:

| `relation` | Parent count | Meaning |
| --- | ---: | --- |
| `root` | 0 | No declared parent |
| `derived` | 1–8 | Author declares a derivation from all listed parents |
| `corrects` | 1 | Author declares a correction of that capsule |
| `supersedes` | 1 | Author declares a replacement, without deleting the older capsule |

Parent IDs MUST be unique, lowercase 64-hex capsule IDs, sorted ascending. A capsule MUST NOT name itself. When parent capsules are not supplied, lineage is `declared-unresolved`, not invalid. When supplied, each parent MUST independently verify, compute to the cited ID, and form an acyclic graph with the child set. A missing supplied parent, digest mismatch, or cycle is invalid for resolved-lineage verification.

Lineage is an author-signed relationship assertion. A child signature does not prove the parent's author consent, common identity, causal derivation, or correctness. `corrects` and `supersedes` never revoke or erase the earlier capsule. Revocation, key rotation, and transparency are outside v1.

## 11. Assurance ladder

Implementations MUST report assurance dimensions separately. They MUST NOT reduce them to one green shield or silently infer a higher rung.

| Rung | Name | What establishes it | v1 status |
| ---: | --- | --- | --- |
| 0 | Transport safety | Restricted ZIP profile and resource checks | Achievable |
| 1 | Payload integrity | Exact manifest binding, member set, sizes, SHA-256 | Achievable |
| 2 | Author-key signature | DSSE payload/type binding and Ed25519 against embedded key | Achievable; key is self-asserted |
| 3 | Key continuity / identity | Viewer-pinned fingerprint or accepted external identity attestation | External local policy only |
| 4 | Independent time | Accepted timestamp or transparency evidence | Absent in v1 |
| 5 | Authoritative source | Claim-specific attestation from an explicitly trusted issuer | Absent in v1 |
| 6 | Record or claim completeness | Reconciliation against a declared authoritative universe with gap rules | Not proved by v1 |

Rungs are not fungible. A valid rung 2 signature cannot substitute for rungs 3–6. A future broker attestation about one fill would not establish completeness or performance. This follows the same broad lesson as SLSA verification: evidence only becomes a useful guarantee when a verifier applies explicit expectations to a trusted issuer and subject.

The v1 human summary for a valid capsule SHOULD begin:

```text
RUNBOOK ARTIFACT VERIFIED

Transport profile       valid
Payload integrity       valid
Author signature        valid (self-asserted key)
Author continuity       unconfirmed unless locally pinned
Independent time        absent
Broker issuance         not evaluated
Broker execution        not evaluated
Record completeness     not evaluated

This verifies signed bytes and declared payload membership.
It does not verify returns, broker truth, identity, completeness, or skill.
```

## 12. Hostile ZIP parser threat model

The capsule is attacker-controlled even when its extension and icon look trusted. A conforming verifier assumes attempts to cause:

- path traversal, absolute-path writes, drive/device targeting, symlink or special-file creation;
- duplicate-name, case-collision, Unicode-collision, and central/local-header confusion;
- ZIP64, size-wrap, offset-overflow, overlap, trailing-data, polyglot, and parser-differential attacks;
- decompression bombs or CPU/memory exhaustion;
- CRC, size, or digest disagreement;
- JSON duplicate-key, Unicode, number, depth, node-count, and reparse differentials;
- DSSE type confusion, payload substitution, Base64 ambiguity, key substitution, and signature replay;
- HTML, PDF, archive, macro, image, or other active-content exploitation; and
- assurance escalation through labels such as `live`, `verified`, `broker`, or `complete`.

The v1 response is restrictive:

1. Parse raw ZIP structures with checked unsigned arithmetic before allocation.
2. Validate the EOCD and central directory under archive and count limits.
3. Validate every path and header pair before reading member contents.
4. Never call a general “extract all” API and never write member paths to the filesystem.
5. Stream stored bytes directly into bounded buffers or SHA-256/CRC-32 calculations.
6. Treat every payload as opaque for the core integrity pass. Never render or execute it.
7. Parse security-critical JSON exactly once and retain the verified byte buffer.
8. Fail closed on any parser disagreement or unsupported feature.

If a user explicitly exports payloads after verification, the viewer MUST create a new private directory, create regular files exclusively without following links, enforce the same path and size checks, and never overwrite an existing path. Extraction is not part of core conformance.

## 13. Verification algorithm

A conforming verifier performs these stages in order:

1. **Input budget:** require a regular readable file of 1 byte–64 MiB; do not follow an input symlink where the platform permits no-follow opening.
2. **EOCD:** require the exact final 22-byte EOCD and reject multi-disk, comments, ZIP64 sentinels, count/size/offset overflow, trailing bytes, and duplicate EOCD structures.
3. **Central directory:** parse at most 64 entries and validate paths, order, fields, offsets, non-overlap, exact end position, and per-entry/aggregate sizes without allocating member-sized buffers.
4. **Local headers:** walk from offset zero, cross-check every central record, enforce contiguity and exact profile fields, and locate exact stored-byte ranges.
5. **Fixed controls:** require the exact control names/order and exact `mimetype`; enforce individual limits.
6. **Control JSON:** strict UTF-8/duplicate-key/JCS parse the manifest and checkpoint statement. Strictly parse the envelope once under DSSE's unknown-field rule.
7. **Payload binding:** decode the envelope payload, require exact byte equality with the checkpoint statement member, require the exact payload type, and retain that byte buffer.
8. **Key:** parse the exact canonical Ed25519 SPKI DER, compute its fingerprint, and compare it to signed and envelope identifiers without treating `keyid` as trust.
9. **Signature:** verify the one 64-byte Ed25519 signature over DSSE PAE.
10. **Manifest binding:** SHA-256 the exact manifest bytes and require equality with signed `experimentDigest`.
11. **Member coverage:** require exact fixed-plus-manifest member set. Stream each payload's CRC-32 and SHA-256, require exact size/digest, and reject any extra or missing path.
12. **Checkpoint consistency:** validate current checkpoint schema, event-chain field shape, data class, proof scope, and assurance policy. Cross-document fields MUST NOT be silently reconciled.
13. **Domain checks:** if a separately versioned payload-schema profile was requested, validate role schemas, event chain, and claim/evidence relationships as distinct checks. The core container result stays separate: a capsule can have valid package integrity while a domain check is `unsupported`, `not-evaluated`, or `invalid`. The verifier MUST NOT infer claim truth from container validity.
14. **Lineage:** resolve only supplied parent capsules; otherwise report the signed declarations as unresolved.
15. **Receipt:** emit deterministic JSON and human output without network access, execution, locale-dependent text, wall-clock fields, absolute paths, or timing measurements.

Verifiers MAY stop after a stage whose failure makes later checks impossible. They MUST mark dependent checks `not-evaluated`, not `valid` or `invalid` by guess.

## 14. Deterministic verification receipt

JSON receipts MUST use JCS and this top-level field order when rendered for humans (JCS will sort keys for byte comparison):

```json
{
  "assurance": {},
  "authorKeyId": null,
  "capsuleId": null,
  "errors": [],
  "lineage": {},
  "limitations": [],
  "members": [],
  "schemaVersion": "runbook.proof-verification.v1",
  "valid": false,
  "verifierProfile": "runbook.proof-capsule.v1",
  "warnings": []
}
```

The core `assurance` object has these exact fields and enums:

```json
{
  "authorContinuity": "not-evaluated",
  "authorIdentity": "self-asserted-key",
  "authorSignature": "valid",
  "brokerExecution": "not-evaluated",
  "brokerIssuance": "not-evaluated",
  "eventChain": "author-signed-commitment-only",
  "independentTime": "absent",
  "investmentSkill": "not-evaluated",
  "packageIntegrity": "valid",
  "recordCompleteness": "not-evaluated",
  "sourceCoverage": "author-declared-metadata-only",
  "suitabilityOrCompliance": "not-evaluated",
  "transportProfile": "valid"
}
```

`transportProfile`, `packageIntegrity`, and `authorSignature` use `valid`, `invalid`, or `not-evaluated`. `authorIdentity` uses `self-asserted-key` or `not-evaluated`; the other literal states are as shown or `not-evaluated` when a dependency fails. Viewer key pins and future online evidence belong in separate `localPolicy` or `onlineChecks` objects and MUST NOT mutate this reproducible core assurance object.

Receipt rules:

- `valid` covers the v1 ZIP profile, control schemas, DSSE/key/signature checks, manifest binding, exact payload coverage, and manifest-lineage shape. It does not mean payload claims are true. A requested application-profile result MUST use a separate `domainChecks` extension and MUST NOT overwrite core `valid`.
- `capsuleId` is non-null only after the exact checkpoint statement passes size, UTF-8, JCS, and schema checks. It does not imply a valid signature.
- `authorKeyId` is non-null only after canonical key parsing and fingerprinting.
- `members` lists path, exact byte count, computed SHA-256, and status in the section 3 archive-member order. It MUST NOT include payload content. Member status begins as `not-evaluated`. Only after the ZIP profile, exact `mimetype`, manifest and statement schemas, envelope/payload binding, author key and signature, signed manifest digest, and exact member set all pass, the five fixed control members become `valid`. The verifier then evaluates every declared payload independently: a payload member is `valid` only when both its declared byte count and SHA-256 match, and is `invalid` when either check fails. One payload failure MUST NOT prevent status evaluation of the other declared payloads. A failure before these prerequisites leaves dependent member statuses `not-evaluated`.
- `errors` and `warnings` use stable lowercase dotted codes and optional capsule-relative paths. Sort by code, then raw path bytes. Human messages are non-normative and excluded from cross-implementation comparison.
- `limitations` is the fixed ordered list:
  `signature-does-not-prove-identity`,
  `signature-does-not-prove-independent-time`,
  `signature-does-not-prove-broker-issuance`,
  `capsule-does-not-prove-execution`,
  `capsule-does-not-prove-record-completeness`,
  `capsule-does-not-prove-investment-skill`,
  `capsule-does-not-prove-suitability-or-compliance`.
- No receipt field may depend on current time, network state, operating-system path, archive filename, locale, hash-map iteration order, or verifier brand.

Normative exit codes are `0` for fully valid, `1` for a parsed but invalid capsule, and `2` for invalid invocation, unreadable input, resource-limit rejection, or unsupported major profile. Existing detached-checkpoint CLI exit codes are not the capsule CLI contract.

## 15. Stable error namespace

At minimum, implementations MUST distinguish:

```text
input.unreadable
input.size-limit
zip.eocd-invalid
zip.multidisk-forbidden
zip.zip64-forbidden
zip.entry-count-limit
zip.field-unsupported
zip.compression-forbidden
zip.encryption-forbidden
zip.data-descriptor-forbidden
zip.extra-field-forbidden
zip.comment-forbidden
zip.path-invalid
zip.path-duplicate
zip.path-case-collision
zip.order-invalid
zip.header-mismatch
zip.range-invalid
zip.trailing-data
zip.crc-mismatch
control.member-missing
control.member-extra
control.mimetype-invalid
manifest.size-invalid
manifest.invalid-utf8
manifest.invalid-json
manifest.duplicate-key
manifest.noncanonical-json
manifest.schema-invalid
manifest.member-set-mismatch
manifest.member-size-mismatch
manifest.member-digest-mismatch
statement.size-invalid
statement.invalid-utf8
statement.invalid-json
statement.duplicate-key
statement.noncanonical-json
statement.schema-invalid
statement.manifest-digest-mismatch
envelope.size-invalid
envelope.invalid-json
envelope.duplicate-key
envelope.schema-invalid
envelope.ignored-extension
payload.type-unsupported
payload.base64-invalid
payload.byte-mismatch
key.invalid
key.algorithm-unsupported
key.encoding-noncanonical
key.fingerprint-mismatch
signature.count-unsupported
signature.invalid
lineage.parent-id-invalid
lineage.parent-missing
lineage.parent-mismatch
lineage.cycle
domain.schema-invalid
domain.event-chain-invalid
domain.claim-coverage-invalid
```

The conformance corpus, not prose alone, fixes stage precedence and the expected full ordered error set for ambiguous mutations.

## 16. Conformance corpus

The public corpus MUST contain exact `.runbook` bytes, SHA-256 checksums, expected JCS receipts, and a machine-readable `corpus-index.v1.json`. Fixtures MUST be generated once and checked into source control; tests MUST NOT regenerate golden bytes with the implementation under test.

### 16.1 Positive fixtures

- minimal synthetic root capsule;
- maximum-count, near-maximum-size synthetic capsule;
- valid live-author-declared capsule that still reports no broker/time/completeness assurance;
- valid derived, correcting, and superseding capsules with supplied parents;
- valid envelope using standard padded Base64;
- semantically identical valid envelope using URL-safe unpadded Base64, producing the same capsule ID; and
- opaque report and evidence-projection payloads that are hashed but never rendered.

### 16.2 ZIP and path mutations

- wrong first entry, wrong `mimetype`, unsorted entries, missing fixed member, and extra unmanifested member;
- exact duplicate, case collision, absolute path, leading slash, drive prefix, backslash, `.`/`..`, empty component, NUL/control, Unicode, overlong path/component, and directory entry;
- symlink, hard-link-like or device external attributes;
- DEFLATE and every nonzero method, encryption, data descriptor, extra field, file/archive comment, ZIP64, split disk, archive extra record, and archive signature record;
- central/local name, flag, method, time, CRC, size, and offset disagreement;
- overlapping, out-of-order, gapped, truncated, wrapped, and out-of-bounds ranges;
- incorrect CRC, entry count, central size, central offset, a structural duplicate EOCD outside member data, prepended polyglot bytes, and trailing bytes;
- archive, entry, path, and aggregate size limits; and
- a nested ZIP payload proving the verifier treats it as opaque and does not recursively extract it.

### 16.3 JSON, manifest, and DSSE mutations

- BOM, malformed UTF-8, duplicate names at every depth, trailing JSON, excessive depth/nodes, 32,768/32,769 ordinary-string boundaries, 87,384/87,385 top-level DSSE-payload boundaries, decoded-payload overflow, unsafe integer, negative zero, float, lone surrogate, and non-JCS whitespace/order/number/string encoding;
- missing/unknown/wrong-schema manifest and statement fields;
- manifest self-entry, control-member entry, duplicate path, unsorted members, missing payload, extra payload, wrong byte count, wrong SHA-256, and uppercase digest;
- a report or payload schema that requests an embedded current-capsule ID, proving the verifier rejects the circular field rather than substituting bytes;
- statement `experimentDigest` mismatch, wrong proof scope, unsupported data class, wrong event-chain algorithm, and credential-shaped forbidden fields under the checkpoint schema;
- envelope payload mismatch, payload-type replay, empty payload, malformed or mixed-alphabet Base64, unknown envelope extension warning, zero or multiple signatures, signature length error, wrong key, wrong algorithm, noncanonical DER, keyid substitution, and signature mutation; and
- a valid DSSE signature whose detached statement member differs by one byte.

### 16.4 Lineage and assurance mutations

- root with parents, derived without parents, duplicate/unsorted/invalid parent IDs, too many parents, self-parent, absent parent, wrong supplied parent, and cycle;
- correction and supersession with zero or multiple parents;
- author time in the future and non-monotonic author sequence, demonstrating they remain author claims rather than trusted-time proof;
- labels such as `broker-verified`, `complete`, or `live` that attempt to elevate assurance without accepted evidence; and
- a completely valid author signature whose expected receipt still says identity, time, broker issuance/execution, completeness, suitability, compliance, and skill are not proved.

Every negative fixture MUST change the smallest practical byte range from a documented positive parent and declare the expected primary and full error set.

## 17. Ten-independent-verifier reproduction protocol

“Ten verifiers” means ten independently implemented validators, not ten people invoking the same library or wrapping a reference executable.

1. Publish a frozen corpus release, its SHA-256 checksum file, this specification revision, and expected JCS receipts.
2. Recruit implementations in at least ten distinct codebases. The target set SHOULD span Rust, Go, Python, Java, C#, Swift, Kotlin, JavaScript/TypeScript, browser/WASM, and one additional ecosystem.
3. Implementations MAY use standard SHA-256, Ed25519, JSON, and raw ZIP-reading libraries, but MUST independently enforce this Runbook profile. They MUST NOT call or embed the Runbook reference verifier, share profile-validation source, or use another participant's output as an oracle during the recorded run.
4. Pin compiler/runtime and dependency versions. Record source commit, build instructions, executable digest, operating-system image digest, and corpus digest.
5. Start from a clean ephemeral VM or container as a non-administrator. Build the verifier, acquire the frozen corpus, verify acquisition hashes, then disable network access.
6. Give each process read-only corpus access, a fresh private temporary directory, 512 MiB memory, one CPU, a 10-second per-fixture timeout, and no GUI or content handlers.
7. Run every fixture twice in different filesystem enumeration orders. Verifiers MUST emit byte-identical JCS receipts on both runs.
8. Compare only normative receipt fields. For every fixture, all ten MUST agree on `valid`, capsule ID, key fingerprint, ordered member digest/status list, ordered error/warning codes, lineage status, assurance states, and fixed limitations.
9. A mismatch is a protocol bug until reduced to a minimal fixture. Do not vote by majority. Either the specification/corpus is clarified and the versioned corpus rerun, or all implementations converge on the existing expected result.
10. Publish the result matrix, implementation commits, executable digests, environment digests, and any independently discovered ambiguities. Do not call the standard interoperable until all positive fixtures and all security mutations agree.

The reference implementation MAY be one of the ten only if the other nine do not import it and no expected receipt was generated dynamically by it during the test.

## 18. Clean-machine verification protocol

For a single untrusted capsule on a fresh machine:

1. Obtain the capsule, verifier release, verifier-source commit, and verifier artifact checksum through authenticated or independently cross-checked channels. Capsule integrity does not secure a compromised verifier.
2. Verify the verifier artifact's published digest/signature outside the capsule trust chain.
3. Disconnect networking. Run as a new non-privileged user in an ephemeral environment with memory, CPU, file-size, process, and wall-time limits.
4. Open the capsule read-only without following symlinks. Do not double-click it or invoke the operating system archive previewer.
5. Run the verifier's offline JSON mode. It follows the stages in section 13 and never extracts, renders, or executes members.
6. Save the JCS receipt and independently hash both capsule and receipt for transport records. The outer capsule-file hash is a download checksum, not the capsule ID.
7. Confirm the human summary preserves all fixed limitations. If a trusted key is supplied, report continuity/identity policy separately from cryptographic validity.
8. If parent capsules are supplied, verify each independently before resolving lineage.
9. Delete the ephemeral environment. Payload export or rendering requires a separate, explicit, sandboxed action.

No step contacts Robinhood, a broker, Runbook, a timestamp service, a transparency log, a URL embedded in a payload, or a remote key server. A future online verification mode MUST place results in a separate `onlineChecks` object and MUST NOT change offline package-integrity results.

## 19. Versioning and extension policy

The v1 media type, profile string, fixed paths, ZIP subset, resource limits, manifest schema, checkpoint schema, payload type, key algorithm, digest algorithm, capsule-ID formula, and error namespace are one compatibility unit.

The following require a new major profile and distinct media/version identifiers:

- compression, ZIP64, encryption, alternate path encoding, directory entries, or larger hard limits;
- another signature or public-key algorithm, multi-signature semantics, key rotation, or embedded PKI;
- a different payload type, signed statement shape, manifest binding rule, digest algorithm, or capsule-ID formula;
- adding a REQUIRED control or payload member, changing fixed member names/order, or changing what `valid` means; and
- adding broker, identity, time, completeness, or compliance assurance semantics.

V1 control schemas reject unknown signed fields. DSSE envelope extensions are the exception because DSSE requires consumers to ignore unknown envelope fields; they produce a warning and cannot affect allow/deny. New optional payload role schemas MAY be registered without changing package-integrity v1 only if older verifiers treat them as opaque, preserve exact manifest binding, and never elevate assurance. Any extension that can turn a denial into an allow is security-critical and requires a new major profile.

An eventual in-toto mapping SHOULD encode each payload member as an in-toto subject with `sha256`, use a Runbook predicate TypeURI, and follow in-toto's monotonic extension rules. It MUST be a new signed profile unless exact byte and semantic compatibility is demonstrated. Do not label the current checkpoint object an in-toto Statement merely because its design is analogous.

## 20. Current repository implementation and remaining gaps

The repository now implements a Node draft-profile capsule reader and CLI plus a separate browser-native reader. `@runbook/capsule` validates the deterministic STORED-only ZIP profile, exact member graph, JCS controls, manifest and payload binding, DSSE/Ed25519 author signature, context-aware envelope limits, and deterministic receipts entirely offline. `@runbook/capsule-browser` implements the profile again with typed arrays and Web Crypto, and `/verify` runs it in an isolated Worker without uploading, extracting, storing, or rendering capsule members. The `runbook verify-capsule` and standalone `runbook-proof` commands open one bounded regular file without following symlinks, emit the same receipt, and distinguish valid, parsed-invalid, and invocation/resource failures by exit code. A separately assembled, checksummed synthetic golden/tampered pair exercises the complete path, the bundled Node verifier has run in a hardened clean container, and production-browser verification matches the two exact receipt oracles.

This is useful repository evidence, not independent interoperability evidence. The following gaps remain before v1 can freeze:

1. **No production signer/exporter lifecycle.** The corpus assembler creates deterministic synthetic artifacts, but the product has no protected end-user key generation, signing, rotation, recovery, revocation, export, or trusted-time workflow.
2. **Browser evidence is not independent interoperability.** The browser-native implementation parses the ZIP, validates the manifest/key/DSSE graph, and emits the normative receipt locally. It shares this repository, release process, specification interpretation, and test corpus with the Node implementation, so its agreement is differential same-project evidence and does not count toward the ten-independent-implementation freeze gate.
3. **The conformance corpus is partial.** The golden and one-byte payload mutation are only the first fixtures. Section 16's near-limit, lineage, Base64, hostile ZIP/path, JSON/DSSE, and assurance corpus remains to be produced and frozen.
4. **Independent implementations are absent.** The independent-assembler design and same-implementation clean-container run reduce self-deception but do not count toward section 17's ten-implementation gate.
5. **Data-class scope remains narrow.** The signed checkpoint permits `synthetic` and `live-author-declared`. The product's broader `paper` and `mixed` vocabulary is future application/schema work and MUST NOT be emitted as v1 checkpoint values.
6. **V1 remains metadata-only.** It commits to author-declared coverage and metadata, not included underlying broker records or independent recomputation. Broker issuance, execution, completeness, identity, time, performance, skill, suitability, and compliance remain explicitly unevaluated.
7. **Public snapshots remain non-recomputable projections.** Signing such a projection would preserve exactly what the author published but would not establish omitted global-chain context or source truth.

The engine's exact DSSE payload binding, canonical Ed25519 SPKI comparison, computed key fingerprints, signature-length checks, bounded strict JSON, and explicit non-assurance are reused by the capsule verifier. The capsule layer adds the profile-specific archive, canonical-byte, manifest, DSSE-extension, and context-aware transport rules without widening the checkpoint schema.

## 21. Freeze gate

Proof Capsule v1 is ready to freeze only when:

- one exporter produces the exact deterministic ZIP profile;
- CLI and browser/WASM verifiers agree on every conformance fixture offline;
- the current engine enforces the manifest-digest compatibility rule and JCS checks;
- documentation contains only the section 3 layout, media type, payload type, key encoding, and capsule-ID formula;
- the golden artifact is visibly synthetic and its one-byte mutation fails;
- no UI turns author-signed data into broker, identity, time, completeness, performance, compliance, or suitability assurance;
- all fixtures and expected JCS receipts are public and checksummed; and
- ten independent clean-machine implementations complete section 17 with zero unresolved disagreements.

Until then, the accurate label is **draft capsule profile built on a repository-tested detached-checkpoint primitive**, not an interoperable proof standard.
