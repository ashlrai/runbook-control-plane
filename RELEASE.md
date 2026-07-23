# Release Policy

There is no production release today. The GitHub repository is a private engineering and research workspace until the gates below are closed.

## Engineering gate

- All tests, typechecks, lint, builds, dependency audits, frozen checksums, and release-byte reproduction pass from a clean checkout.
- Browser Worker and standalone artifacts are generated from source, not committed. Published artifacts must have checksums and source revision provenance.
- Security-sensitive changes receive hostile-path review, bounded-resource tests, and a documented assurance boundary.

## Product gate

- The Capital Constitution and Financial Agent Safety Bench demonstrate value with synthetic or broker-disconnected shadow workflows.
- No live-capital connection is enabled during the first 90-day buyer-validation period.
- Claims remain scenario-specific; Runbook does not certify safety, identity, execution, suitability, compliance, or investment performance.

## Origin and verifier gate

- A permanent signer origin has a reviewed CSP and isolation model, reproducible bytes, and live header/byte evidence.
- An independent verifier produces compatible evidence. Same-repository Node/browser agreement is not independent verification.
- Key continuity, loss, rotation, revocation, migration, and compromised-origin behavior are reviewed before promising durable author identity.

## Permission gate

- No commercial Robinhood API/MCP adapter or Robinhood Social automation, collection, promotion, or attribution is released without applicable written permission.
- No brokerage credentials, custody, order routing, personalized advice, copy trading, or performance-linked compensation is added by implication.

## Public-source gate

Before public visibility, split internal account history, pricing, outreach, customer, partnership, and launch strategy out of Git history; complete trademark/domain review; and choose an explicit source license. Private repository access is not a license to copy or redistribute the project.
