# Open source plan

Runbook uses an **open-core** distribution model.

**Public repository (export tree only):**  
[https://github.com/ashlrai/runbook-control-plane](https://github.com/ashlrai/runbook-control-plane)  
Tag: `v0.3.0` · Apache-2.0 · no private commercial/strategy history

**Private monorepo (this checkout):**  
[https://github.com/ashlrai/runbook](https://github.com/ashlrai/runbook)  
Full research workspace; not a public redistribution license by itself.

Re-export after engineering changes:

```bash
# Export only (staging tree)
pnpm export:public -- --dest /tmp/runbook-public-export

# Export + overlay into public clone + local commit (no push)
pnpm sync:public

# Export + commit + push to ashlrai/runbook-control-plane
pnpm sync:public:push
```

Details: [`docs/PUBLIC_RELEASE_CHECKLIST.md`](./docs/PUBLIC_RELEASE_CHECKLIST.md).

## Intended open-core model

| Layer | Intent |
| --- | --- |
| Open / public core | Broker-neutral policy engine, shadow curriculum, MCP companion surface, portable proof capsule, browser verifier primitives, financial capability registry schemas, and synthetic/sandbox evaluation harnesses that emit inspectable evidence without live capital |
| Commercial | Pre-Capital Control Dossier delivery, hosted developer/team products, design-partner services, Control Drift Watch, and any broker-specific adapters that require written provider permission |

The public core is technical distribution and evidence infrastructure. The
commercial lane is human-reviewed, scope-limited decision support and hosted
or service offerings. Neither layer is investment advice, brokerage, custody,
or production trading software.

## What should become public later

Expected public surface after a clean export (names may change):

- `@runbook/engine` — policy, ledger, gateway, checkpoint primitives
- `@runbook/session`, `@runbook/shadow-lab`, `@runbook/mcp` — local process
  control and recursive charter improvement (no broker execution tools)
- `@runbook/capsule` and related browser/author packages — portable `.runbook`
  evidence containers and local verification
- Financial Capability Registry and public-auth metadata foundations
- Sandbox / bench harnesses that use synthetic adapters only
- Root `LICENSE` (Apache-2.0), `NOTICE`, this document, operator guides, and
  conformance corpora that are safe for public redistribution

## What stays commercial or private

Keep out of the public tree and public history:

- Internal commercial strategy, pricing, outreach, customer, partnership, and
  launch materials (for example `commercial_strategy.md` and related playbooks)
- Account history, personal baselines, credentials, tokens, private keys, and
  customer data
- Any live-broker or Robinhood-specific commercial adapter, Social automation,
  or material that requires express written provider permission
- Hosted product code, billing, multi-tenant ops, and unpublished buyer packets

Private repository access is **not** a license to copy or redistribute those
files or the monorepo as a whole.

## Public-source gates still apply here

This checkout remains a **private** engineering and research monorepo. Adding
`LICENSE`, `NOTICE`, package `license` fields, and this document prepares the
scaffolding for a later public export. It does **not**:

- change repository visibility
- waive the public-source gate in [`RELEASE.md`](./RELEASE.md)
- authorize redistribution of the private tree

Before any public visibility change, complete the public-source gate in
[`RELEASE.md`](./RELEASE.md): split internal commercial and personal history
out of Git history, finish trademark/domain review, and publish only a clean
export under the explicit Apache-2.0 license and `NOTICE` attribution.

## Public export from this private monorepo

Produce an OSS-safe tree **without** flipping this repo public:

```bash
pnpm export:public
# or: node scripts/public-export.mjs --dest /tmp/runbook-public-export
```

Refresh the **separate** public repo (`ashlrai/runbook-control-plane`) from that export:

```bash
# Local commit only (default dest /tmp/runbook-public-export,
# clone/URL → /tmp/runbook-control-plane-clone)
pnpm sync:public

# Same, then git push (needs network + credentials)
pnpm sync:public:push

# Explicit paths
node scripts/sync-public-repo.mjs \
  --dest /tmp/runbook-public-export \
  --repo https://github.com/ashlrai/runbook-control-plane.git

node scripts/sync-public-repo.mjs \
  --repo /path/to/local/runbook-control-plane \
  --push
```

- Allowlist: [`scripts/public-export-allowlist.json`](./scripts/public-export-allowlist.json)
- Sync pipeline: [`scripts/sync-public-repo.mjs`](./scripts/sync-public-repo.mjs)
- Commercial/strategy/personal docs are **omitted** by design
- Draft public README: [`README.public.md`](./README.public.md) (copied as `README.md` in the export)
- Claim evidence map: [`docs/PUBLIC_CLAIM_MATRIX.md`](./docs/PUBLIC_CLAIM_MATRIX.md)
- The private monorepo is never used as `--dest` or `--repo` (script refuses)

## CI (elite smoke)

[`.github/workflows/elite-smoke.yml`](./.github/workflows/elite-smoke.yml) runs on `main` push/PR:

- focused tests for engine, shadow-lab, session, mcp
- `pnpm demo:elite` and `pnpm test:elite-journey`
- no Docker, no secrets, no broker access

Full monorepo CI remains in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## After a public clone: run the elite demo

When a public export is available, a clean clone should demonstrate
process-control improvement (not trading performance) with:

```bash
corepack enable
pnpm install
pnpm setup:elite    # install + build engine, shadow-lab, session, mcp
pnpm demo:elite     # weak charter → refine → hardFalseAllows = 0 → agent-eval
```

Optional checks:

```bash
pnpm smoke:elite
pnpm demo:frontier
pnpm demo:tournament
```

Requirements: Node.js 22 and the pnpm version pinned in root `package.json`.
The demo builds `@runbook/shadow-lab` and `@runbook/mcp`, then runs
`scripts/recursive-elite-demo.mjs`. It uses synthetic curriculum and local
tools only—no broker credentials, no live orders, no capital.

## Trademark and affiliation

Runbook is a product of Ashlr AI. It is **not** affiliated with, endorsed by,
or sponsored by Robinhood Markets, Inc. or affiliates. See [`NOTICE`](./NOTICE).

## Related docs

- [`LICENSE`](./LICENSE) — Apache License, Version 2.0
- [`NOTICE`](./NOTICE) — copyright, affiliation disclaimer, product boundary
- [`RELEASE.md`](./RELEASE.md) — engineering, product, origin, permission, and public-source gates
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — development expectations and non-negotiable boundaries
- [`SECURITY.md`](./SECURITY.md) — security reporting
- [`README.public.md`](./README.public.md) — draft README for a future public repository
