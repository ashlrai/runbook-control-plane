# `@runbook/signer-browser`

Browser-only device-author key lifecycle for the isolated Runbook signer origin.

The package owns one IndexedDB v1 slot: `runbook-signer-keystore` / `key_slots` / `device-author-v1`. It generates a native Web Crypto Ed25519 key pair with a non-extractable signing key, derives the exact canonical 44-byte SPKI and `sha256:` key ID, proves the pair, persists it as `staged`, closes and reopens the database, repeats every identity and pair test, and only then promotes the record to `active`.

`signWithDeviceAuthorKey` signs an owned snapshot of exact caller bytes only from an active record and verifies its own 64-byte signature before returning. The package has no networking, DOM, analytics, broker, account, publishing, private-key export/import, deletion, rotation, recovery, draft, signature-history, or application-rendering authority.

Inspection proves that the persisted public and private keys still form the recorded pair without changing `staged` or `active` state. A staged record can be promoted only by the explicit activation retry after another full pair test.

A non-extractable Web Crypto key is not necessarily hardware-backed, XSS-proof, identity-bound, recoverable, or exclusively controlled. `createdAtDevice` is untrusted local-device metadata. `createdByRelease` is a caller-supplied release-hash declaration; this package does not compare it to loaded application code, and it is not a trusted timestamp or code-attestation system. Unknown, malformed, blocked, upgraded, or mismatched storage fails closed and is never auto-replaced.
