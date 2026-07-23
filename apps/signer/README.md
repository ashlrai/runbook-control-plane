# Runbook device-local signer preview

This is the isolated static application for one fixed Creator Proof workflow. It verifies the embedded rich synthetic seed, uses one non-extractable device-local Ed25519 key, prepares one of four restrictive policy forks, requires exact human review, signs locally, performs same-project core and domain self-verification, and enables three manual downloads only after both checks pass.

It has no brokerage, Robinhood, account, network-after-readiness, analytics, arbitrary-file, payload-rendering, publication, identity, backup, recovery, rotation, revocation, payment, or enrollment authority. A non-extractable browser key is not hardware-backed or XSS-proof. This preview is not deployed and is not an independent verifier or production identity system.

## Local verification

From the workspace root:

```sh
pnpm --filter @runbook/signer typecheck
pnpm --filter @runbook/signer test
pnpm --filter @runbook/signer build
pnpm --filter @runbook/signer verify:dist
```

`build` first builds the four workspace dependencies, then emits `dist/` with one content-addressed script, one content-addressed stylesheet, exact SRI, strict scoped headers, and `release-manifest.json`. The default canonical origin is an explicit `.example` placeholder and cannot pass the configured-origin or live-release gates.

`verify:dist` checks the exact file set, hashes, SRI, CSP and headers, embedded release/origin/seed bindings, listed forbidden runtime-network and HTML-sink tokens, and a second clean byte-identical build in a dedicated temporary directory. The token scan is defense in depth rather than a proof against deliberately obfuscated property access; the deny-all CSP is the runtime network boundary. This verifies local release construction only, not that a host serves those bytes or headers.

## Configured-origin release candidate

Build only for an HTTPS origin owned and reserved exclusively for the signer:

```sh
SIGNER_CANONICAL_ORIGIN=https://signer.company-owned-domain.com \
  pnpm --filter @runbook/signer build
pnpm --filter @runbook/signer verify:configured-origin
```

Do not set `SIGNER_ALLOW_LOCAL=true` for a release candidate. `verify:configured-origin` rejects the placeholder origin, reserved/test hostnames, IP addresses, single-label hosts, and local-development mode.

After deploying the exact `dist/` without rewriting its HTML, assets, manifest, or headers:

```sh
pnpm --filter @runbook/signer verify:live -- https://signer.company-owned-domain.com
```

The live command automatically reruns both the local reproducible-build gate and the configured-origin gate before it makes a request. It then requires exact origin equality, no redirect, no cookie or CORS authority, exact local bytes, every required isolation header including Permissions Policy, correct cache/content types, and no exposed source maps. Passing the live check is required after deployment. No owned origin has passed this gate yet.

## Release boundary

- Never deploy the signer as a path on the main Next application origin.
- Never reuse an origin that has a service worker, unrelated application, tenant content, analytics, redirects, or third-party scripts.
- Never publish `dist/` built with the placeholder origin or local-development mode.
- Never describe the embedded release ID as independent attestation, trusted time, identity, or protection from malicious future same-origin code.
- Never open publication, enrollment, or payment from this application without a separate reviewed product and privacy boundary.
