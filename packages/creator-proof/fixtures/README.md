# Rich synthetic Creator Proof seed

`rich-synthetic-seed.runbook` is generated deterministically by `pnpm --filter @runbook/creator-proof generate:seed` from the public RFC 8032 test-vector seed in `scripts/generate-seed.mjs`.

The fixture key is deliberately public. It proves only deterministic package construction and is never an identity, continuity, production-signing, or truth key. The device-local signer must generate a different private key and must never include the fixture private seed in its bundle.

The frozen minimal conformance fixture remains the package-profile oracle. This rich fixture is a separate application-profile seed for the Creator Proof Sprint and does not expand the current conformance corpus or count as independent interoperability evidence.
