# `@runbook/capsule`

Strict, offline byte verifier for the draft `runbook.proof-capsule.v1` profile. It accepts an in-memory `.runbook` archive and never extracts, writes, opens, renders, executes, uploads, or resolves a member. It has no signing, private-key, network, brokerage, or trading capability.

This package implements the restricted container in the repository's authoritative `proof_capsule_spec.md`. The profile is still a **draft capsule profile built on a verified detached-checkpoint primitive** until the standard's freeze gate and independent-verifier protocol are complete.

## Exact archive profile

Members must appear in this exact local-header and central-directory order:

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
payload/...                         optional manifest members, sorted by ASCII path bytes
```

Every entry is STORED, uses flags `0x0800`, version needed `20`, version made by `0x0314`, DOS time/date `0x0000`/`0x0021`, no extra fields or comments, attributes for a regular `0644` file, and exact central/local agreement. ZIP64, encryption, data descriptors, directory entries, alternate compression, path ambiguity, gaps, overlaps, prepended/trailing bytes, and unsupported fields fail closed.

The archive is limited to 64 MiB, 64 entries, 59 payload entries, 60 MiB total payload bytes, and 16 MiB per payload. Paths are lowercase ASCII under `payload/`, never normalized or URL-decoded. The public key is exactly 44-byte canonical Ed25519 SPKI DER.

## Authenticated graph

`runbook/manifest.json` has schema `runbook.proof-manifest.v1`; it declares every and only payload path, exact length, media type, role, and SHA-256. The five required payloads and their role/media-type pairs are enforced. Both the manifest and checkpoint statement must already be exact RFC 8785 JCS bytes.

The verifier checks this transitive graph over original bytes:

```text
Ed25519 signature
  -> DSSE PAE(exact payload type, exact checkpoint statement bytes)
  -> statement.experimentDigest
  -> SHA-256(exact manifest bytes)
  -> manifest path + length + SHA-256
  -> exact opaque payload bytes
```

The capsule ID is the implemented checkpoint ID:

```text
SHA-256("RUNBOOK_CHECKPOINT_ID_V1\0" || exact checkpoint statement bytes)
```

Unknown bounded DSSE envelope fields are ignored with `envelope.ignored-extension`; unknown signed statement or manifest fields fail closed. The embedded key is fingerprinted and compared with both signed and envelope identifiers, but it remains self-asserted.

## API and deterministic receipt

```ts
import {
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "@runbook/capsule";

const receipt = verifyProofCapsule(capsuleBytes);
const canonicalReceiptBytes = serializeProofVerificationReceipt(receipt);
```

The receipt is metadata-only and contains stable sorted errors/warnings, member paths/lengths/digests/status, lineage declaration, the capsule and author-key IDs when their prerequisites pass, and separate assurance dimensions. The serializer emits deterministic RFC 8785 JCS UTF-8 bytes and adds no clock, filename, absolute path, network, locale, or verifier-brand data.

## Security boundary

A valid receipt establishes restricted transport conformance, exact payload membership/integrity, and an Ed25519 signature from the bundled self-asserted key. It does **not** establish civil or Robinhood identity, independent time, broker issuance, order execution, record completeness, truth or profitability of claims, investing skill, suitability, or compliance.

Payload bytes—including `payload/report.html`—are untrusted opaque bytes. Integrity verification is not a privacy or safety certification. Producers must keep v1 metadata-only and public release still requires human privacy review.
