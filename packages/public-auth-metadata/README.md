# Public Auth Metadata

`@runbook/public-auth-metadata` records credential-free OAuth discovery drift
for Robinhood's public Trading and Banking MCP origins. It is a separate
control-plane source series from the Financial Capability Registry.

The pure package root has no network authority. It strictly parses provider
bodies, preserves distinct raw-body and normalized projection hashes, creates
exact-JCS observations and four-source bundles, validates bundle lineage, and
emits digest-only diffs. Unknown extensions and changed HTTPS URIs become
invalid-profile evidence; they never become request targets.

`parseExactPublicAuthMetadataObservationBytes` proves structural and exact-JCS
validity. For an invalid-profile candidate, call
`verifyPublicAuthMetadataObservationEvidence` with the exact raw body before
relying on its digest claims. The local raw/projection candidate files contain
provider values and are review inputs, not publication-safe portable evidence.

The `./node` subpath is a manual capture boundary. Its public API accepts only
one of four source IDs, never a URL. It sends a bodyless GET with fixed headers
through a private one-off HTTPS agent, validates TLS explicitly, rejects every
redirect and forbidden response shape, bounds headers/body/chunks/time, and
never invokes a discovered authorization, registration, token, or MCP URI.
The injected request factory lives in a package-internal test module and is not
part of the exported `./node` API or provenance claim.

## Offline fixtures

The four source `.raw.json` files under `fixtures/robinhood/v1/` retain their
final LF and are pinned by exact SHA-256. CI and tests use them without network
access. Rebuild the complete fixture set into a new directory only after the
package has been built:

```bash
pnpm --filter @runbook/public-auth-metadata build
pnpm --filter @runbook/public-auth-metadata build:fixtures -- /tmp/runbook-auth-fixtures
```

The output contains four raw bodies, four no-newline projections, four exact
observations, one revision-1 bundle, an exact manifest, and sorted checksums.
Checked-in expected artifacts are byte-compared against a fresh build by the
test suite.

## Manual candidate capture

Live capture is never run by CI, never scheduled, and never promotes an
admitted baseline. It requires one caller-declared UTC timestamp and a new
output directory under an existing, trusted, non-symlink parent:

```bash
pnpm --filter @runbook/public-auth-metadata capture:robinhood:candidate -- \
  --retrieved-at 2026-07-22T09:04:27Z \
  --output /absolute/new/candidate-directory
```

The command accepts no URL, host, header, credential, source list, OAuth input,
or baseline destination. It creates the final directory exclusively, refuses
the fixture tree and every existing destination, removes partial output on
failure, and prints only a
stable code. A captured candidate remains review evidence; it grants no
registration, authentication, tool, account, card, trade, purchase, Social,
provider-consent, or commercial-use authority.

See [`../../public_auth_metadata_profile.md`](../../public_auth_metadata_profile.md)
for the frozen threat profile and exact limitations.
