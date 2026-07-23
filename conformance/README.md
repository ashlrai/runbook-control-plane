# Proof Capsule v1 frozen byte corpus

This directory is the first byte-level corpus for the draft profile in [`../proof_capsule_spec.md`](../proof_capsule_spec.md). It is deliberately independent of `@runbook/capsule`: the committed expected outcomes were derived from the normative specification, and `assemble.mjs` uses only Node.js built-ins.

This corpus is intentionally partial. It freezes the minimal positive root and its smallest payload-integrity mutation; it does not yet contain the full limit, lineage, alternate-Base64, hostile-ZIP, JSON, DSSE, and assurance matrix required by section 16 of the draft specification. It is not evidence that the v1 profile has passed the freeze gate or independent-implementation protocol.

Everything in both fixtures is synthetic. There is no real account, identity, trade, order, fill, position, return, brokerage export, or broker attestation in this corpus.

## Trust boundary

The embedded Ed25519 public key is **self-asserted**. Its fingerprint is:

```text
sha256:b4d90a08583c87e8b69423aa17746e8d0359b8f3765ead1567531d232c28ce55
```

The signing key pair was generated once with Node.js. The private key existed only inside that ephemeral generation process and was never exported, printed, written to disk, or committed. There is intentionally no private key, seed, signer endpoint, recovery secret, or production signer API in this directory. The public key and valid signature prove only a commitment by that otherwise-unidentified ephemeral key.

Both archives have the same signed checkpoint and therefore the same content identity:

```text
66b200560e20f723ece402931277043b85316687aac30f73c4da6a4d5a323578
```

## Fixtures and normative outcomes

| Fixture | Expected core result | Required stable error | Exact JCS receipt oracle |
| --- | --- | --- | --- |
| `fixtures/minimal-synthetic-root.runbook` | `valid: true`; transport, payload integrity, and self-asserted author signature valid | none | `expected/minimal-synthetic-root.receipt.json` |
| `fixtures/minimal-synthetic-root-payload-tampered.runbook` | `valid: false`; transport and author signature remain valid, package integrity invalid | `manifest.member-digest-mismatch` for `payload/charter.json` | `expected/minimal-synthetic-root-payload-tampered.receipt.json` |

The negative fixture is a corpus child derived from the valid archive, not a valid signed-lineage child. Its signed manifest still declares `root` because changing that control would require a new signature. It changes exactly one byte at zero-based offset 22 of `payload/charter.json`: ASCII `c` (`0x63`) in `synthetic` becomes ASCII `x` (`0x78`). Its ZIP CRC-32 is correctly recomputed, so a verifier must reach the manifest SHA-256 check rather than reject transport corruption. Every control byte, all other payload bytes, member names, order, and archive-profile fields remain identical in meaning and construction.

The negative receipt freezes the five controls and four matching payload members as `valid`, and `payload/charter.json` as `invalid`. After all control and member-set prerequisites pass, each payload's declared size and SHA-256 are evaluated independently; one mismatch does not erase the valid status of unrelated members.

The two files under `expected/` are complete receipt byte oracles derived independently from the normative specification and committed corpus bytes. They are exact RFC 8785 JCS with no BOM, newline, or other trailing byte. They freeze every normative receipt field, including ordered member statuses, errors, warnings, lineage, assurance states, and fixed limitations. They were not emitted by `@runbook/capsule` or the Runbook CLI and tests must never rewrite them from verifier output.

`corpus-index.v1.json` is exact JCS with no trailing newline. It records archive and receipt byte counts, SHA-256 values, paths, capsule identity, self-asserted key identity, expected assurance dimensions, and the precise mutation. `SHA256SUMS` covers every other regular file in this directory exactly once.

## Exact source bytes

Each archive has a complete source tree under `sources/<fixture-name>/`. Files are read as opaque bytes; no control or payload is regenerated during assembly. The two source trees differ by exactly the one charter byte described above. The zero-byte `payload/events.ndjson` is intentional: it is the minimal empty ledger, paired with signed `eventCount: 0` and the 64-zero genesis head hash.

The assembler emits local entries and central-directory records in this exact order:

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
```

Every entry is `STORED`, uses flags `0x0800`, version-needed `20`, version-made-by `0x0314`, DOS time/date `0x0000`/`0x0021`, zero extras/comments/internal attributes/disk start, and external attributes `0x81a40000`. The assembler independently checks those headers, CRC-32 values, contiguous ranges, central offsets, and the exact 22-byte EOCD at EOF.

## Reproduce and check

Run from the repository root with Node.js 22 or later:

```sh
node conformance/assemble.mjs --check
```

This reconstructs both archives in memory from committed source bytes, verifies the DSSE/key/manifest graph independently, checks the one-byte mutation and raw ZIP profile, compares the reconstructed bytes with the committed fixtures, validates the complete expected JCS receipts and corpus index, and verifies complete checksum coverage.

To rewrite only the two generated `.runbook` archives from their committed sources and then run the same checks:

```sh
node conformance/assemble.mjs --write
```

For a conventional checksum-only check:

```sh
cd conformance
shasum -a 256 -c SHA256SUMS
```

Neither command signs anything or needs private-key access. A future verifier implementation must consume the fixtures as external truth; it must not generate or silently update the expected outcomes from its own behavior.
