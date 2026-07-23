# `@runbook/capsule-author`

Browser-safe, deterministic byte construction for Proof Capsule v1. It emits the exact `.runbook` ZIP, manifest, checkpoint, DSSE, and payload bytes required by `proof_capsule_spec.md`.

The package has no key storage, network, brokerage, publishing, account, DOM, or rendering authority. `prepareProofCapsule` returns exact review and DSSE PAE bytes without touching a key. After explicit review, the caller signs those bytes. `finalizeProofCapsule` verifies the supplied raw Ed25519 signature before emitting any ZIP bytes.

The package does not interpret application payloads or verify that supplied parents are valid. `@runbook/creator-proof` owns the fixed synthetic application profile. The isolated signer must verify the supported parent locally, apply domain checks, then self-verify the emitted archive before download.
