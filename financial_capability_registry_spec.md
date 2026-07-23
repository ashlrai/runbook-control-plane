# Financial Capability Registry version 1

Status: implementation contract

## Purpose

The Financial Capability Registry converts source-owned financial-agent interface claims into strict, provenance-bound snapshots, semantic drift evidence, and fail-closed admission decisions. It is broker-neutral. Robinhood Trading and Banking documentation are the first public fixtures, not a privileged product dependency.

The registry never authenticates to a broker, fetches a remote source during analysis, stores account data or credentials, authorizes an operational action, or claims that public documentation equals an authenticated runtime contract.

## Frozen identifiers

- Profile: `runbook.financial-capability-registry.v1`
- Snapshot: `runbook.financial-capability-snapshot.v1`
- Snapshot verification: `runbook.financial-capability-snapshot-verification.v1`
- Diff: `runbook.financial-capability-diff.v1`
- Admission policy: `runbook.financial-capability-admission-policy.v1`
- Review claims: `runbook.financial-capability-review-claims.v1`
- Review artifact: `runbook.financial-capability-review-artifact.v1`
- Admission receipt: `runbook.financial-capability-admission-receipt.v1`

All portable bytes are strict UTF-8 exact JCS with no transport newline. SHA-256 values are lowercase hexadecimal. Identity strings are lowercase ASCII identifiers and are never Unicode-normalized or case-folded.

## Trust and source model

The four evidence levels are:

1. `public-explicit`: a public primary source states the exact identity or behavior.
2. `public-derived`: Runbook classifies an explicit public statement into the broker-neutral risk taxonomy.
3. `runtime-confirmed`: an authorized client captured the authenticated inventory and exact schemas.
4. `runtime-exercised`: a controlled synthetic invocation also observed the behavior and is bound through a distinct `controlled-runtime-exercise` source authority. Authenticated discovery alone cannot assert this level.

One level never silently upgrades another. A public fixture cannot claim runtime authority. A derived security classification is not represented as an explicit provider claim.

Each source record binds:

- a stable `sourceId`;
- authority: `public-documentation`, `authenticated-runtime-discovery`, or `user-supplied-export`;
- completeness: `complete-enumeration`, `partial-enumeration`, `capabilities-only`, or `unknown`;
- declared retrieval time;
- a SHA-256 of the exact local source projection used to construct the snapshot;
- an HTTPS public URI only for public documentation, otherwise `null`.

The source-projection digest is not represented as a hash of Robinhood's complete web response. Dynamic page scaffolding and unrelated content are outside the projection. The fixture README must state the projection members exactly.

## Snapshot model

A snapshot binds provider, product, profile, source-series, revision, prior admitted snapshot digest, declared observation time, a closed source set, and a sorted capability set.

Each capability contains:

- stable `capabilityId`;
- `identityKind`: `published-tool-name`, `runtime-tool-name`, or `documented-operation`;
- `providerToolName`, nullable only for a documented operation whose public tool name is not enumerated;
- description contract state and optional digest;
- request and response contract state plus optional artifact digest;
- action families;
- data scopes and account scope;
- mutation class and mutation scopes;
- state-read and state-write domains;
- decision influence;
- declared workflow-prerequisite capability IDs;
- credential-release class;
- structured capital operations and asset scope;
- structured approval semantics;
- source assertion digest and source IDs;
- separate identity and risk evidence levels.

Contract states distinguish `known`, `not-published`, `not-authorized`, and `not-captured`. A known contract requires a digest. Every other state requires `sha256: null`. A known-empty JSON schema is therefore distinct from an unavailable schema.

Banking documentation currently names behaviors but not MCP tools. Its fixture must use `documented-operation` with `providerToolName: null`. Names such as `get_card_details` are forbidden unless an authorized runtime capture later supplies them.

## Risk taxonomy

Action families are a closed set spanning account/market/research observation, research-state management, order review/submission/management, credential release, purchase observation/execution, policy observation/management, reconciliation, emergency control, and unknown behavior.

Data scopes distinguish account identifiers, balances, positions, transactions, order history, watchlists, scans, market/company/order data, card transactions, card policies, payment credentials, and unknown data.

Mutation scopes distinguish none, research state, control plane, capital orders, payments, credential release, emergency state, and unknown effects. Credential release is modeled as a security effect even when a provider describes it as read access.

Capital operations are a set drawn from preview, submit, cancel, replace, transfer, spend, and unknown. No scalar risk ranking may make an apparent downgrade automatically safe.

Approval semantics separately bind mode, enforcing principal, action binding, scope binding, expiry binding, and bypass condition. The existence of a review tool never establishes mandatory human approval.

Watchlist and scanner writers are decision-influencing research-state mutations when their state can feed later selection or capital decisions. A writer is classified as reversible only when the captured public surface documents its explicit inverse. The paired follow/unfollow and add/remove watchlist operations meet that threshold; watchlist creation/update and scan creation/update fail closed as unknown until an exact inverse contract is published or captured. Reversibility does not make poisoning benign.

## Diff rules

The analyzer owns and parses the exact baseline and candidate snapshot bytes, then recomputes the diff. A caller-supplied diff is never authoritative.

An ordinary diff requires exact provider, product, profile, and source-series continuity. The candidate must name the exact baseline digest as its previous snapshot and increment the registry revision by one. Documentation and authenticated-runtime lanes remain separate source series.

Capabilities are matched only by stable `capabilityId`. A provider tool-name change on the same stable capability is a rename. Similarity never converts an addition plus removal into a rename.

Every change entry contains only:

- a domain-separated capability-reference digest;
- previous and current capability digests;
- sorted changed-field and finding codes;
- materiality;
- a domain-separated change ID.

Portable diff evidence contains no raw tool name, URL, description, schema, account data, credential, or card data. It separately carries digest-only source-record changes, and derived influence-path findings when declared state writers gain a path to a declared decision or capital consumer.

Additions, removals, renames, risk-axis changes in either direction, description changes, schema changes or visibility loss, source-assertion changes, newly reachable state-influence paths, and removed workflow prerequisites are material and quarantined until an exact bounded review is valid. Newly introduced unknown risk semantics are material but the frozen V1 policy rejects them; an operator may retain the unadmitted candidate in quarantine storage, but this is not a `quarantine` admission outcome and review cannot override the rejection. A partial source can establish a capability it contains but cannot establish that an omitted baseline capability was removed.

The 45-to-50 Robinhood documentation delta must produce exactly five additions: `get_financials`, `get_equity_price_book`, `get_equity_tax_lots`, `get_option_historicals`, and `get_scanner_filter_specs`. This is documentation drift, not runtime availability evidence.

Admitted snapshots are immutable. The Robinhood revision-1 and revision-2 fixture bytes remain frozen even when a later review corrects a Runbook-derived label. That correction is represented by revision 3, names the exact revision-2 digest as its previous admitted snapshot, and carries five material mutation-class changes. It is an unadmitted, operationally quarantined candidate with exact V1 admission outcome `reject` because it introduces unknown risk semantics.

## Review artifact

Review claims bind:

- exact baseline, candidate, diff, policy, source-set, and blocked-change-set digests;
- one explicit decision for each material change ID;
- required evidence digests;
- reviewer key ID;
- review ID and nonce digest;
- issued, not-before, and expiry times;
- purpose `registry-admission-only`.

The review artifact carries an Ed25519 signature over a domain-separated exact-JCS review-claims message. Verification receives trusted reviewer SPKI bytes out of band, recomputes their key IDs, and accepts no embedded or self-declared trust root. The core verifier uses browser Web Crypto. The CLI accepts local bounded SPKI files and contains no signing command.

A review may cover at most 64 material changes and 16 evidence digests, lasts at most seven days, is bound to one baseline and candidate, and cannot be partially applied. Missing decisions deny. One explicit denial vetoes admission. A review cannot override malformed input, source-lineage mismatch, stale head, source incompleteness, unknown risk semantics, or a missing required evidence digest.

The signature authenticates possession of a trusted key, not a legal identity, job title, independent audit, or Robinhood approval.

## Admission outcomes

- `admit`: the exact candidate is eligible for an atomic active-head update.
- `quarantine`: retain for inspection but do not advance the active head.
- `reject`: structurally coherent inputs reveal a stale head, source mismatch, replay, forbidden transition, or invalid review binding.
- `no-change`: the exact candidate is already the baseline.

The version 1 core emits a decision but does not itself prove a durable compare-and-swap update occurred. A future state service must atomically compare the active head with the receipt baseline before applying an `admit` result.

## Portable limitations

Every verification, diff, and admission receipt states that it:

- is unsigned local analysis unless the separately verified review signature is present;
- does not prove authenticated runtime completeness or current availability;
- does not grant broker/API permission or establish provider endorsement;
- does not authorize execution, capital movement, credential release, or purchase;
- does not prove safety, security, compliance, suitability, performance, or future behavior;
- contains declared rather than independently trusted time;
- does not prove a durable registry-head update.

## CLI

The deterministic Node CLI supports:

```text
runbook-capabilities verify-snapshot SNAPSHOT.jcs
runbook-capabilities diff BASELINE.jcs CANDIDATE.jcs
runbook-capabilities admit BASELINE.jcs CANDIDATE.jcs POLICY.jcs --evaluated-at UTC [--review REVIEW.jcs --review-key REVIEWER.spki.der]
```

It follows symbolic-link-resistant bounded regular-file ownership, performs no network access, emits exact receipt JCS to stdout without a newline, and sends bounded stable errors to stderr.

- Exit 0: valid verification/diff, or admission outcome `admit`/`no-change`.
- Exit 1: invalid artifact, or admission outcome `quarantine`/`reject`.
- Exit 2: invocation, I/O, or resource failure.

There is no authentication, source fetch, signing, review-creation, registry mutation, broker connection, or MCP mutation command.

## Required release gates

- Preserve every existing Financial Bench V0 byte oracle unchanged.
- Strict bytes reject duplicate JSON keys, invalid UTF-8, unpaired surrogates, unknown fields, excess depth/count/bytes, duplicate IDs/names, and non-ASCII identity.
- Freeze complete-byte regressions for 45-to-50 drift, watchlist/scanner poisoning, approval weakening, same-name schema substitution, source mismatch, partial-source omission, stale/mismatched/expired/untrusted/partial review, rename handling, and evidence omission.
- Prove portable receipts exclude tool names, public URLs, descriptions, schemas, account/card canaries, and raw key/signature material beyond the bounded review artifact.
- Reproduce standalone CLI bytes from two builds.
- Run focused tests, typecheck, static analysis, secret scan, production dependency audit, full workspace tests/typecheck/lint/build, and real CI before calling the release complete.
