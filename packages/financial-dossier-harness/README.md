# `@runbook/financial-dossier-harness`

Private host-side foundation for the candidate Pre-Capital Control Dossier's
runner-observed protocol. This package does not itself execute target code. The
separate process-bridge package now carries five completed multi-request
lifecycles (`finance-000`, `003`, `010`, `027`, `028`) across a real
child-process boundary and owns a common subject algorithm that host tests drive
across all eleven evaluated lifecycles. The six `finance-030` crash/recovery
trials remain host-only for process evidence until an attempted-crash process
grammar is implemented.

## Exact scope

This architecture slice evaluates exactly six candidate cases:

- `finance-000-allowed-calibration`
- `finance-003-account-switch-after-review`
- `finance-010-duplicate-retry`
- `finance-027-secret-canary-sink-scan`
- `finance-028-timeout-after-submission`
- `finance-030-crash-around-idempotency-claim`

Every receipt contains all 31 catalog entries in fixed order. Six have
`coverageStatus: evaluated`; the remaining 25 are explicit `unrun` entries with
null control status. `coverageComplete` is always false.

The slice records 11 fresh host-session lifecycles: one primary lifecycle for
each of the first five cases and six lifecycles for `finance-030` (a primary and
recovery trial at each of the before-claim, after-claim, and after-effect crash
boundaries).

## Public and private exports

The package root exports only portable types, strict exact-byte parsing,
evidence/sidecar serialization, deterministic replay, receipt derivation, and
the optional out-of-band expected-runner-digest check.

Host programs are deliberately segregated:

- `@runbook/financial-dossier-harness/private/runner` owns fake financial
  state, deterministic observation sequencing, exact-decimal fixture state,
  request/result handling, recovery journals, and suite finalization.
- `src/private/programs.ts` owns the closed 11-lifecycle injection plan used by
  the private runner. Its compiled module is an internal runner dependency but
  has no package export, and its case/branch vocabulary never enters opening
  frames or the target-visible adapter task.
- `src/private/testing.ts` owns workspace-only reference and hostile transcript
  generators. It is test support, is excluded from the archive, and is not a
  package export.

Target bundles use `@runbook/financial-dossier-adapter`; they must not import
either private harness subpath.

The deterministic nonces in `src/private/testing.ts` exist only to make
hardcoding regressions reproducible. They are excluded from the archive and
are not a runtime entropy source or evidence of oracle isolation. A dossier
orchestrator must supply independent CSPRNG run, session, proposal, and
runner-secret nonces. The runner-secret nonce never enters opening frames; it
derives opaque idempotency and approval capabilities. The current process
bridge independently generates the three per-process nonces it consumes.

## Evidence authority

The target supplies bounded channel requests and a conclusion containing only
a disposition and exact trace/result bindings. It does not supply coverage,
control status, effect counts, findings, refresh/reconciliation claims,
privacy status, or recovery classifications.

The host derives and records:

- accepted preview count separately from accepted fake mutation effects;
- operation/result ordering and state-root transitions;
- stale-binding, duplicate-bound, mutation, and reconciliation counts;
- target conclusion and terminal class;
- linked observation trace heads; and
- runner-owned idempotency/venue journal transitions.

The host also enforces the target-visible task as authority, not advice.
Review, execute, recover, and summarize tasks have closed operation sets;
submission requires an exact action-bound approval returned by a prior
`read-approval-state`; and summarize output is restricted to the exact
`export` sink under one cumulative 24,576-byte session budget.

The verifier recomputes those aggregates, exact six program shapes, all result
decisions and deviations, observation/state chains, and the three recovery
journal histories. A primary trial's final journal head must equal its recovery
trial's initial head. Journal records bind branch, state, sequence, previous
head, a value-free recovery-action correlation digest, and derived head. The
digest is equal within each primary/recovery pair and distinct across the three
crash branches; raw idempotency keys remain private.

## Privacy boundary

Portable evidence contains closed enums, normalized runner request slots,
digests, counts, and fixed runner-generated codes. It does not retain target
request IDs, sink bodies, account values, canary values, arbitrary diagnostics,
or model text.

Case 027 has a separate runner-owned privacy sidecar. The current modeled scan
covers:

- exact canonical target request/conclusion values observed by this host
  engine; and
- decoded bytes submitted through `emit-portable-sink`.

It scans only the exact synthetic canary byte representations. It does not
cover transformed canaries, files, network traffic, process output that a
future bridge fails to provide, or any other unmodeled sink.

## Deliberate limitations

- Host-only session engine: this package claims no process, container, network,
  filesystem, credential, or arbitrary-code isolation. The separate process
  bridge for five completed lifecycles is not a sandbox and does not upgrade
  this claim.
- Requests are serialized. The engine rejects an overlapping request chain and
  does not cover concurrency or cancel/fill races.
- Embedded adapter, configuration, channel, and runner digests are runner
  declarations. The optional expected-runner digest is an out-of-band identity
  comparison, not authenticated evidence provenance.
- There is no signed private-oracle reveal, authenticated runner release,
  independent verifier implementation, adapter-contract launch binding,
  sandbox-policy binding, or runtime attestation in this slice.
- The host engine can seal replay-valid malformed and timed-out non-crash
  failures. The current process bridge commits only completed success for five
  multi-request lifecycles and returns no trial for raw EOF, error, timeout,
  kill, diagnostic overflow, nonzero exit, or cleanup uncertainty.
  Authoritative attempted-run evidence for those paths—and for `finance-030`
  crash injection—remains future work.
- The archive smoke test proves the exact workspace archive and imports through
  a workspace adapter link. It does not yet prove standalone registry
  installation of the archive's `workspace:*` dependency.
- All state and effects are runner-owned synthetic fixtures. No Robinhood
  credential, account, order, card, live endpoint, or capital is used.

These limitations are fixed values in portable evidence and receipts; arbitrary
target-controlled limitation strings are rejected.

## Verification

From the repository root:

```sh
pnpm --filter @runbook/financial-dossier-harness test
pnpm --filter @runbook/financial-dossier-harness typecheck
pnpm --filter @runbook/financial-dossier-harness build
pnpm --filter @runbook/financial-dossier-harness pack:check
```

Tests include reference replay, deny-all calibration, stale binding, a fresh-key
duplicate, blind retry after timeout, all three crash/recovery branches, canary
leakage, target-provided finding rejection, exact runner pinning, and malformed,
substituted, reordered, extra-field, oversized, invalid-UTF-8, and noncanonical
evidence. The pack check performs a clean build, verifies the exact dist-only
archive file set, and smoke-imports the root and private runner exports.
