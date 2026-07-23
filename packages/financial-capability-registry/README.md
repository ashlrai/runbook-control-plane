# Financial Capability Registry

`@runbook/financial-capability-registry` converts reviewed financial-agent interface claims into strict, provenance-bound snapshots, semantic diffs, and fail-closed admission receipts. It is broker-neutral. The included Robinhood fixtures are the first public-documentation corpus, not a privileged Robinhood integration.

The package is offline analysis infrastructure. It does not authenticate to Robinhood, call an MCP server, fetch a source page, place or cancel an order, retrieve a card number, make a purchase, mutate a durable registry, sign a review, or automate Robinhood Social.

## What ships

- Strict UTF-8 exact-JCS parsing with bounded depth, nodes, strings, and artifact bytes.
- Closed version 1 snapshot, diff, admission-policy, review, and receipt contracts.
- Stable capability identity, separate identity and risk evidence, source lineage, contract visibility, approval semantics, decision influence, credential release, and capital-operation fields.
- Deterministic semantic diffs. Material additions, removals, renames, schema or source changes, risk changes in either direction, approval weakening, unknown semantics, and new influence paths do not silently pass.
- Fail-closed admission outcomes: `admit`, `no-change`, `quarantine`, or `reject`.
- Ed25519 review verification against caller-supplied trusted SPKI bytes. The package has no signing command and accepts no embedded trust root.
- An offline Node CLI with symlink-resistant, bounded regular-file ownership.
- A browser-safe core export with no Node filesystem, process, or network dependency. SHA-256 is synchronous and local; review verification uses Web Crypto.
- Reproducible public-source projections and snapshot fixtures for Robinhood Trading and Banking documentation.
- An implementation-neutral, exact-byte hostile conformance corpus covering all 50 normative V1 threat cases.

The frozen profile and its threat boundaries are implemented in [`src/types.ts`](./src/types.ts), [`src/validate.ts`](./src/validate.ts), [`src/diff.ts`](./src/diff.ts), [`src/admission.ts`](./src/admission.ts), and [`src/review.ts`](./src/review.ts).

## Official-source scope

The fixtures were reviewed on 2026-07-22 against two Robinhood primary sources:

- [Trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/), Help Center reference 5762361.
- [Agentic Credit Card](https://robinhood.com/us/en/support/articles/agentic-credit-card/), Help Center reference 5527147.

The source projections contain only the members enumerated in [`fixtures/robinhood/README.md`](./fixtures/robinhood/README.md). Their hashes are hashes of those local projection bytes—not hashes of complete Robinhood webpages. Page chrome, scripts, dynamic content, and unrelated disclosures are intentionally outside the projection.

| Lane | Local source authority | Completeness | Identity treatment | Current fixture |
|---|---|---|---|---|
| Trading 45 | Public documentation plus an explicitly derived drift baseline | Complete enumeration of the constructed baseline | 45 `published-tool-name` identities | [`trading-45-snapshot.jcs`](./fixtures/robinhood/trading-45-snapshot.jcs) |
| Trading 50 admitted history | Public documentation | Complete enumeration of the published page projection | 50 `published-tool-name` identities | [`trading-50-snapshot.jcs`](./fixtures/robinhood/trading-50-snapshot.jcs) |
| Trading 50 risk-correction candidate | Same public projection; corrected Runbook-derived risk labels | Complete enumeration of the published page projection | 50 identities; five mutation classes corrected to unknown | [`trading-50-risk-correction-snapshot.jcs`](./fixtures/robinhood/trading-50-risk-correction-snapshot.jcs) |
| Banking | Public documentation | Capabilities only | Three `documented-operation` identities with `providerToolName: null` | [`banking-snapshot.jcs`](./fixtures/robinhood/banking-snapshot.jcs) |

The 45-tool fixture is a deterministic test baseline made by removing exactly:

- `get_financials`
- `get_equity_price_book`
- `get_equity_tax_lots`
- `get_option_historicals`
- `get_scanner_filter_specs`

It exercises the 45-to-50 documentation delta. It does not prove that an authenticated runtime or preserved historical Robinhood page exposed exactly 45 tools.

### Trading 50 inventory

Robinhood’s projected categories contain 50 names:

| Official category | Count |
|---|---:|
| Account, portfolio, and other tools | 5 |
| Watchlist tools | 12 |
| Market data tools | 9 |
| Equities tools | 8 |
| Options tools | 10 |
| Scanner tool calls | 6 |

Runbook’s separate, `public-derived` effect labels produce:

| Derived effect | Count | Registry treatment |
|---|---:|---|
| Observation | 33 | Read-only account, market, company, order-history, watchlist, or scan observation |
| Research-state mutation | 11 | Six operations have an explicitly paired public inverse; five creation/update writers have unknown reversibility. All are modeled as indirect decision influence and poisoning surfaces in the correction candidate. |
| Order review | 2 | Advisory preview; never treated as proof of mandatory human approval or binding to a later order |
| Capital-order mutation | 4 | Equity/option submission or cancellation in the documented dedicated-account boundary |

For the published order-submission operations, the fixture records optional customer approval and the documented `user-instruction` bypass. Unknown action, scope, and expiry bindings remain unknown. Cancellation and research-state mutation approval semantics remain unknown rather than being inferred from silence.

### Banking capabilities

The Banking page describes three operations but publishes no MCP tool names or schemas:

- View transaction history for an authorized agentic virtual card.
- View policies for an authorized agentic virtual card.
- Fetch payment-card details for an authorized agentic virtual card.

Runbook models the last operation as `payment-credential` release with mutation scope `credential-release`, even though the provider describes it as read access. It does not assign direct spend authority: Robinhood states that product selection and checkout occur in the external agent setup, which then uses the released card details. The source projection also preserves the documented distinction between optional per-purchase approval and the required monthly limit when per-purchase approval is disabled. Because the public page does not bind those controls to a specific runtime MCP call, the snapshot does not invent an approval binding.

No fixture contains an account number, card number, credential, position, order, transaction, customer policy value, or other customer record.

## Evidence levels

Evidence levels are not interchangeable:

1. `public-explicit`: a public primary source states the exact identity or behavior.
2. `public-derived`: Runbook maps an explicit public statement into the broker-neutral risk taxonomy.
3. `runtime-confirmed`: an authorized client captured an authenticated inventory and exact schemas.
4. `runtime-exercised`: a controlled synthetic invocation also observed behavior and is bound through the separate `controlled-runtime-exercise` source authority. Discovery evidence alone is rejected.

The included Robinhood fixtures use only `public-explicit` and `public-derived`. Trading provider names are explicit; risk fields are derived. Banking stable documented-operation IDs and risk fields are derived, and provider tool names remain `null`. No included fixture claims `runtime-confirmed` or `runtime-exercised` evidence.

Request and response contracts are `not-published` with `sha256: null`. Trading descriptions were deliberately not captured as description contracts. A source-projection digest proves the exact local projection used; it does not upgrade public documentation to runtime authority.

## Reproduce and verify

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @runbook/financial-capability-registry test
pnpm --filter @runbook/financial-capability-registry typecheck
pnpm --filter @runbook/financial-capability-registry build
```

Rebuild the four generated snapshots into a disposable directory and compare them with the checked-in bytes:

```sh
output_dir="$(mktemp -d)"
node packages/financial-capability-registry/scripts/build-robinhood-fixtures.mjs "$output_dir"
cmp packages/financial-capability-registry/fixtures/robinhood/trading-45-snapshot.jcs "$output_dir/trading-45-snapshot.jcs"
cmp packages/financial-capability-registry/fixtures/robinhood/trading-50-snapshot.jcs "$output_dir/trading-50-snapshot.jcs"
cmp packages/financial-capability-registry/fixtures/robinhood/trading-50-risk-correction-snapshot.jcs "$output_dir/trading-50-risk-correction-snapshot.jcs"
cmp packages/financial-capability-registry/fixtures/robinhood/banking-snapshot.jcs "$output_dir/banking-snapshot.jcs"
```

The checked-in snapshot hashes are:

```text
4ad91fdcdade8e91aba2b5a7c44afa5ec61fc786521280240c58db1ed81d4b86  banking-snapshot.jcs
2a414ea97e02d0732cbf03a3809486b5141977ca07311fe792787c4418b2b408  trading-45-snapshot.jcs
762eeb025972717453c863f4cb57d109c80950433796e3afe9c34684141b608e  trading-50-snapshot.jcs
ae158cf5d9f26b4c005f931c291831e4ab42658d69c96b01b64ca6a4be6bc346  trading-50-risk-correction-snapshot.jcs
```

`trading-50-snapshot.jcs` remains immutable revision 2 and names the exact immutable Trading 45 revision-1 digest as its previous admitted snapshot. The risk correction is append-only revision 3 and names revision 2's exact digest as its previous admitted snapshot. It introduces five material `reversible`-to-`unknown` changes. V1 therefore emits `reject` under the frozen `unknownRiskDecision: reject` policy; operators may retain the unadmitted candidate in quarantine storage for review, but must not call that handling an admission outcome or advance the active head. Banking is a separate capabilities-only source series at revision 1.

## Hostile conformance corpus

[`conformance/v1/manifest.jcs`](./conformance/v1/manifest.jcs) binds all 50 rows
of the normative threat matrix plus one append-only provider-lineage regression to exact input bytes, expected disposition,
required and forbidden stable codes, and a complete output oracle. Every path is
manifest-relative and every input and oracle carries its own SHA-256. The
TypeScript adapter executes each case twice and requires byte-identical,
no-newline output.

The generator imports neither Registry implementation nor browser verifier.
Exact output and signed-review declarations are the frozen semantic authority;
both implementations must reproduce them. A disposable regeneration test
enforces the import boundary and exact file-list/byte identity on every run.

The corpus includes malformed UTF-8/Unicode and JSON, bounds and identity
failures, lineage and source authority, time, exact Robinhood 45-to-50 drift,
schema and scope substitutions, approval partial-order changes, influence paths,
workflow prerequisites, and representative binding, time, signature, decision,
evidence, replay, denial, and success review cases.
Portable-output assertions reject provider names, URLs, description/schema,
account/card/credential, SPKI, and signature canaries. It exposes no composite
safety score.

Run the checked-in oracles without regenerating them:

```sh
pnpm --filter @runbook/financial-capability-registry test:conformance
```

See [`conformance/v1/README.md`](./conformance/v1/README.md) for the deliberate
reviewed regeneration procedure. A corpus pass is deterministic contract
conformance, not a safety certification or authorization to execute.

## CLI

Build first, then invoke the standalone Node 22 CLI:

```sh
cli="packages/financial-capability-registry/dist/runbook-capabilities.mjs"
fixtures="packages/financial-capability-registry/fixtures/robinhood"

node "$cli" verify-snapshot "$fixtures/trading-50-snapshot.jcs"
node "$cli" diff "$fixtures/trading-45-snapshot.jcs" "$fixtures/trading-50-snapshot.jcs"
```

Successful commands emit exact-JCS receipt or diff bytes to stdout without a newline. The portable diff uses hashes and finding codes rather than raw provider tool names, public URLs, descriptions, or schemas.

The repository includes a deliberately fail-closed example policy: [`public-docs-review-required-policy.jcs`](./fixtures/robinhood/public-docs-review-required-policy.jcs), SHA-256 `b4863e7bb22b9b379b3eaa44e39e13bd3e9c458734e9efcb8c613b3a8aaa3435`. It has no trusted reviewer keys or required evidence digests. It demonstrates quarantine; it is not a production policy.

```sh
node "$cli" admit \
  "$fixtures/trading-45-snapshot.jcs" \
  "$fixtures/trading-50-snapshot.jcs" \
  "$fixtures/public-docs-review-required-policy.jcs" \
  --evaluated-at 2026-07-22T07:10:00Z
```

The five additions are material, so this command emits an admission receipt with outcome `quarantine` and exits 1. A production admission requires an exact bounded review artifact, a separately supplied trusted reviewer SPKI, exact decisions for every material change ID, and any policy-required evidence digests:

```text
runbook-capabilities admit BASELINE.jcs CANDIDATE.jcs POLICY.jcs \
  --evaluated-at UTC --review REVIEW.jcs --review-key REVIEWER.spki.der
```

The CLI performs no signing and does not update a registry head. Exit codes are:

- 0: valid verification or diff, or admission outcome `admit`/`no-change`.
- 1: invalid artifact, or admission outcome `quarantine`/`reject`.
- 2: invocation, I/O, or resource failure.

## Browser-safe core

Use the default export surface for in-memory analysis. Keep Node file ownership and CLI orchestration behind the `./node` export.

```ts
import {
  buildCapabilityDiff,
  evaluateCapabilityAdmission,
  parseExactJcsCapabilitySnapshotBytes,
  verifyReviewArtifactSignature,
} from "@runbook/financial-capability-registry";

const baseline = parseExactJcsCapabilitySnapshotBytes(baselineBytes);
const candidate = parseExactJcsCapabilitySnapshotBytes(candidateBytes);
const diff = buildCapabilityDiff(baseline, candidate);
```

The browser-safe core does not fetch sources, access local files, keep a durable active head, or select trust roots. The caller owns exact input bytes and supplies trusted reviewer SPKI bytes out of band. Signature verification proves possession of the corresponding private key, not the reviewer’s legal identity, employment, independence, authority, or Robinhood approval.

## Source refresh procedure

Refreshing a public-documentation lane is a reviewed release operation, not an automatic scrape:

1. Open the primary provider source and record the declared observation date, visible reference number, and exact HTTPS URI.
2. Compare every published identity/category or documented behavior with the existing local source projection. Do not infer authenticated names or schemas from prose.
3. Update only explicit source facts and separately labeled `public-derived` risk mappings. Keep Banking provider tool names `null` until an authorized runtime capture proves them.
4. Canonicalize the complete projection as strict UTF-8 JCS with no transport newline, then review its SHA-256. The projection is not a complete webpage archive.
5. Add a new immutable registry revision and bind `previousAdmittedSnapshotSha256` to the exact prior admitted snapshot. Never rewrite admitted history to make a new source fit.
6. Extend the fixture builder’s pinned source hash, shape assertions, expected inventory, effect counts, and expected delta. Generate into a temporary directory first.
7. Run focused tests, typecheck, deterministic rebuild, secret scanning, dependency audit, full workspace verification, and CI before admitting or publishing the revision.
8. Treat additions, removals, renames, contract visibility loss, risk changes, approval changes, and influence-path changes as material. Quarantine until an exact review satisfies policy.

An authenticated runtime lane must be a different source series with `authenticated-runtime-discovery` authority. It requires explicit authorization, captured exact schemas, bounded synthetic data, and separate runtime evidence. Never silently replace a public-documentation snapshot with an authenticated capture.

## Commercial-readiness bridge

The registry is useful today as the intake and change-control layer of a financial-agent readiness engagement:

1. Inventory declared capabilities and evidence quality.
2. Detect semantic drift and isolate unreviewed changes.
3. Translate capability risk into Financial Agent Safety Bench scenarios.
4. Produce reviewable exact-JCS evidence and fail-closed admission receipts.

It does not itself establish that an agent is safe or ready for production. The roadmap bridge is:

- Expand the bench to the full 30-scenario corpus, including approval, order, data-scope, confused-deputy, persistence, output, and resource-abuse cases.
- Add synthetic cross-MCP Trading/Banking scenarios for research-state poisoning, credential release, checkout separation, and policy-confusion attacks—without real cards, accounts, or purchases.
- Add authorized `runtime-confirmed` discovery and `runtime-exercised` synthetic testing only after written access, exact scope, and evidence-retention rules exist.
- Run untrusted target adapters in the separate hardened sandbox or future disposable microVM backend; the registry parser is not a code-execution sandbox.
- Keep Robinhood Social distribution manual, original, permission-compliant, and outside this package. No posting, engagement, analytics, or follower automation is implemented.

A readiness report can truthfully say which documented interfaces were reviewed, what changed, which evidence level supports each claim, which hostile scenarios ran, and which gates remain. It cannot truthfully claim Robinhood certification, guaranteed safety, investment performance, compliance, or runtime completeness from these fixtures.

## Limitations

- Public documentation may be incomplete, stale, cohort-dependent, or different from an authenticated runtime.
- A valid snapshot proves only that bytes satisfy this profile and bind the declared projection; it does not prove the source statement is true or complete.
- Downstream diff/review/receipt parsers prove closed structure and self-consistency only. Semantic diff authority comes from replaying `buildCapabilityDiff` over the exact baseline and candidate; admission always does this internally.
- The 45-tool baseline is derived for deterministic drift testing and is not a historical-runtime claim.
- A known provider category or name does not reveal arguments, results, tool-level OAuth scope semantics, approval tokens, annotations, errors, entitlements, or behavior. Robinhood's separate public OAuth discovery metadata currently advertises coarse product scope labels; those labels do not establish per-tool privileges and are outside these capability fixtures.
- `public-derived` risk mappings are reviewable Runbook judgments, not provider claims.
- Research-state reversibility does not make poisoning benign.
- An order-review tool does not prove mandatory approval, exact-action binding, expiry, or enforcement.
- Banking card-detail access is a credential-release effect; the fixture does not prove how an authenticated runtime exposes or gates it.
- Time fields are declared and are not independently trusted.
- Analysis is unsigned unless a separately verified review signature is present.
- A verified review signature authenticates key possession only.
- No artifact grants broker/API permission or provider endorsement.
- No artifact authorizes execution, capital movement, credential release, or purchase.
- No artifact proves safety, security, compliance, suitability, performance, or future behavior.
- Admission evaluates exact bytes but does not prove a durable compare-and-swap registry-head update occurred.
- Influence paths and workflow prerequisites cover only edges declared in the snapshot. Hidden provider coupling, prompt/model behavior, and undocumented state dependencies are not discovered.
- The core parser protects its input contract; it is not a malware sandbox, transaction firewall, broker control plane, or custody system.
- This package contains no live authentication, trading, card use, purchase flow, or Robinhood Social automation.
