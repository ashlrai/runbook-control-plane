# Runbook web application

This Next.js application is the local-first Runbook product and research surface. It includes the synthetic control room, charter builder, owned-data content and growth workspaces, Trust Center, Proof Capsule verifier, Creator Proof funnel, and multi-capsule Lineage Atlas.

The browser verifier and Lineage Atlas run in dedicated same-origin Workers generated from TypeScript source before development, tests, and production builds. They accept bounded local bytes, perform no application network calls during analysis, never render capsule payloads, and return narrow assurance receipts. Generated Worker bundles are intentionally not committed.

## Development

```bash
pnpm install --frozen-lockfile
pnpm --filter @runbook/web dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
pnpm --filter @runbook/web test
pnpm --filter @runbook/web typecheck
pnpm --filter @runbook/web lint
pnpm --filter @runbook/web build
```

Production build is necessary but not sufficient for release. The main application still needs an explicit production header/origin review, while browser signing remains isolated in `apps/signer` and has separate live-byte, CSP, key-lifecycle, and independent-verifier gates.

## Boundaries

- No brokerage connection, credentials, custody, or execution.
- No Robinhood Social scraping, automated posting, analytics collection, or commercial funnel.
- No copy trading, signals, personalized advice, or performance claims.
- Browser-local verification does not prove identity, independent time, broker issuance, execution, completeness, suitability, compliance, or investment skill.
