# Contributing

Runbook is currently an AshlrAI research prototype. Coordinate substantial work in an issue before opening a pull request.

## Development

Use Node.js 22 and the pnpm version pinned in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm audit --prod --audit-level moderate
(cd conformance && shasum -a 256 -c SHA256SUMS)
```

Pull requests should explain the trust boundary being changed, include hostile-path tests for security-sensitive behavior, and preserve exact deterministic bytes where a specification or frozen fixture requires them.

## Non-negotiable boundaries

- Do not add brokerage credentials, custody, order execution, copy trading, automated Robinhood Social activity, or personalized investment advice.
- Do not weaken archive, Worker, signature, policy, provenance, or privacy limits for convenience.
- Do not describe a signature as proof of identity, execution, completeness, performance, suitability, or compliance.
- Do not change `proof_capsule_spec.md`, the conformance corpus, or release assets without recording the compatibility and reproducibility impact.
- Never commit real account exports, positions, balances, credentials, tokens, private keys, or personally identifying customer data.

The repository is not currently licensed for public reuse. A license decision is a separate release gate.
