# `@runbook/financial-dossier-process-bridge`

Process-bound architecture slice for the candidate Pre-Capital Control Dossier.
It runs one reviewed, hash-pinned JavaScript target module in a real child
process and commits a host trial only after the protocol channel reaches clean
EOF and that direct child exits successfully and is reaped — **or**, for the
shipped finance-030 before-claim primary, after an honest incomplete-transcript
kill at submit-action.

The package owns a **common subject algorithm**
(`CommonSubjectAlgorithmV2` / `reference-common-subject.mjs`) that branches only
on the runner-injected public task and channel results. Host tests drive that
exact algorithm across all eleven architecture-slice lifecycles without case
labels in the target-visible path. The process bridge now commits **five**
completed multi-request lifecycles through that same subject module:

- `finance-000-allowed-calibration` (single request/result; review → proceed)
- `finance-003-account-switch-after-review` (two request/result rounds; execute → defer)
- `finance-010-duplicate-retry` (three request/result rounds; execute → proceed with host-modeled duplicate)
- `finance-027-secret-canary-sink-scan` (two request/result rounds; summarize → deny; sealed-trial privacy scans)
- `finance-028-timeout-after-submission` (four request/result rounds; execute → unresolved + reconcile)

Additionally:

- The three **finance-030 recovery** trials may be process-bridged under the
  completed multi-request grammar when the recovery journal is already advanced
  (`hostSeedFinance030PrimaryCrash` or process-bridged before-claim primary →
  `runFinance030RecoverProcess`).
- The **before-claim primary** crash trial is process-bridged under the
  attempted-crash grammar (`runFinance030PrimaryCrashProcess`).
  after-claim and after-effect primaries remain host-only.

The completed process grammar is versioned as a multi-request loop
(request↔result until conclusion). The attempted-crash grammar is versioned
separately (`classification: injected-crash`, incomplete transcripts,
`killAttempted: true`). Profile
`runbook.financial-dossier-process-bridge.completed-lifecycle.v2-candidate.5`
covers the five completed scenarios plus recover-mode lifecycle matching.
Profile
`runbook.financial-dossier-process-bridge.attempted-crash.v2-candidate.1`
covers before-claim-primary only. Process-attempt schema is
`runbook.financial-dossier-process-attempt.v2-candidate.4`.
Twenty-five catalog cases remain explicitly unrun. This is **not** V2 complete
and **not** full finance-030 process-bridge.

## Evidence boundary

The runner generates independent CSPRNG session, proposal, and runner-secret
nonces. The secret never enters target frames and binds opaque host approval
and idempotency capabilities. The runner owns
the target module bytes before spawn, transmits those exact bytes over a
dedicated descriptor, and exchanges exact-JCS length-prefixed frames over
separate runner-to-target and target-to-runner descriptors. Target stdout and
stderr are bounded, untrusted, digest-only diagnostics rather than protocol or
evidence authority.

A completed run returns six separately bound exact-byte artifacts:

- the process-attempt sidecar;
- the exact loader module;
- the sealed host trial;
- the exact executed target module;
- the runner-to-target transcript; and
- the target-to-runner transcript.

An attempted-crash run returns the same six artifacts plus the live recovery
journal and shared proposal/secret nonces so a recover-mode process run can
continue from the process-seeded journal head.

The portable completed verifier re-owns those bytes and recomputes the sidecar
binding, completed lifecycle, transcript digests, byte and frame counts,
opening-frame binding, sealed-trial semantics, exact target and loader digests,
and the session/target relationship. Multi-request transcripts are checked as
session-open + challenge + N channel-results + terminate on the runner side and
ready + N channel-requests + conclusion on the target side. Lifecycle profile
matching covers the five process-bridged cases plus recover-mode finance-030
recovery trials; finance-027 also relates sealed-trial privacy scans (protocol
egress + portable sink) to the transcript and export bytes.

The portable attempted-crash verifier accepts incomplete transcripts:
session-open + challenge + (N−1) channel-results (no terminate) on the runner
side and ready + N channel-requests including unanswered submit (no conclusion)
on the target side. It requires `killAttempted: true`, abnormal child exit,
`terminalClass: injected-crash`, and before-claim journal semantics.

`adapterBundleSha256` is the runner-declared identity of the target-visible
protocol contract; it is deliberately distinct from the exact subject module
executed by the child. The process sidecar and sealed trial bind that executed
module separately. Neither digest is authenticated provenance. For completed
runs, any timeout, malformed or extra frame, channel failure, diagnostic
overflow, nonzero exit, signal, or cleanup uncertainty fails closed and returns
no trial. For attempted-crash runs, the kill itself is the committed terminal
boundary; pre-kill faults still fail closed.

The event entries are the runner's observation-and-commit program: they record
when awaited facts were consumed by the runner, not a claim about finer kernel
event chronology or proof that an entire descendant process group was clean.
The completed program is a fixed opening, then N `request-received` /
`result-written` pairs, then a fixed close-out. The attempted-crash program is
the same opening, (N−1) pairs, a crash `request-received` without result, then
`kill-attempted` → `child-exit` → `child-reaped` → `trial-sealed`.

## Common subject

- `src/common-subject.ts` is the pure host-testable algorithm. It accepts only a
  challenge binding, proposed action, public task, and later channel results.
- `src/reference-common-subject.mjs` is the self-contained process-executable
  twin loaded as exact owned bytes. It has no package imports and no case,
  condition, or private-program vocabulary.
- `src/reference-finance-000-target.mjs` remains a review-only minimal twin used
  for process-contract regression. It is not a second evaluated subject program
  for the multi-lifecycle claim.

A protocol-valid unsafe conclusion remains evaluable evidence with a control
failure; it is not erased as an infrastructure-invalid run.

## finance-030 recover-mode process evidence

Recovery trials are completed multi-request lifecycles (`mode: recover`,
`priorOutcome: unknown`, one `reconcile-action` → `unresolved`). They do **not**
require kill semantics. Honest process evidence for them requires:

1. Shared proposal and runner-secret nonces across the primary/recovery pair so
   opaque idempotency and recovery-action bindings correlate.
2. A durable `RunnerOwnedRecoveryJournalV2` already advanced by a primary crash
   branch (`before-claim`, `after-claim`, or `after-effect`).
3. A fresh session nonce and process spawn for the recovery trial only.

Helpers:

- `hostSeedFinance030PrimaryCrash` — host-only common-subject drive through
  `ingestRequestAndInjectCrash` at `submit-action`; returns the journal and
  sealed primary trial (terminalClass `injected-crash`). Still used for
  after-claim and after-effect recovery process-bridge.
- `runFinance030PrimaryCrashProcess` — process-bridge before-claim primary
  under the attempted-crash grammar; returns the live journal for recover pairing.
- `runFinance030RecoverProcess` — process-bridge one recovery trial under the
  completed grammar; portable verifier accepts the recover lifecycle profile
  and recovery-journal sealed-trial fields.

`PROCESS_BRIDGED_SCENARIO_IDS` still lists only the five fully completed
scenarios. Recover trial IDs are tracked as
`PROCESS_BRIDGED_RECOVER_TRIAL_IDS`. Primary crash trial IDs are tracked as
`PROCESS_BRIDGED_PRIMARY_CRASH_TRIAL_IDS` (before-claim-primary only).
finance-030 is **not** claimed fully process-bridged.

## finance-030 attempted-crash process grammar

### Shipped: before-claim-primary (`classification: injected-crash`)

1. Opening matches the completed prefix through `challenge-written`.
2. `preview-action` and `read-approval-state` use normal
   `request-received` / `result-written` pairs.
3. On `submit-action` `request-received`: call host
   `ingestRequestAndInjectCrash` (no channel-result written).
4. Kill the child process group (`killAttempted: true`).
5. Await reaped exit with signal or nonzero code; do **not** require clean
   protocol EOF / terminate / conclusion commit.
6. Seal `terminalClass: injected-crash` with recovery-journal transition
   `before-claim` → `unclaimed`.

Event program (live contract via `attemptedCrashEventProgram(2)`):

- completed opening prefix
- `(request-received, result-written) × 2` for preview + approval
- `request-received` for crash submit (no result-written)
- `kill-attempted` → `child-exit` → `child-reaped` → `trial-sealed`
- no `conclusion-staged`, `terminate-written`, or `conclusion-committed`

Portable verifier: `verifyAttemptedCrashProcessAttempt`.

### Still host-only

- after-claim-primary and after-effect-primary (same kill path shape, different
  sealed-trial transitions/counters; not process-bridged yet)
- Suite-level pairwise correlation of all six finance-030 trials remains a
  harness concern, not a single-process-attempt claim

## Deliberate limitations

This is a five-case completed-process architecture milestone plus host-seeded
(or process-seeded before-claim) recover-mode process evidence and one
attempted-crash primary, not a sandbox or an independent assurance result. The
child inherits the host filesystem and network namespaces and runs with the
current user. A reviewed hash pin is not hostile-code isolation, runtime
attestation, signed provenance, or proof that descendants were absent. Process
group kill is best-effort and is not a descendant-isolation claim. The process
sidecar and verifier are produced by the same project.

after-claim and after-effect primary crash trials remain host-only.
Recover-mode process evidence depends on a seeded recovery journal and does not
prove crash isolation or descendant cleanup. Twenty-five catalog cases remain
explicitly unrun. This is an N-case architecture slice, not V2 complete.

Stdout and stderr hashes are bounded diagnostics, not a privacy proof.
Low-entropy output can be dictionary tested against those hashes; portable users
must not treat digest-only retention as confidentiality. Finance-027 sealed-trial
scans are host-side canary digests over protocol egress and portable sink bytes;
they are not a general privacy or isolation assurance.

No Robinhood credential, account, order, card, live endpoint, or capital is
used. The module evaluates only runner-owned synthetic state.

## Verification

From the repository root:

```sh
pnpm --filter @runbook/financial-dossier-process-bridge test
pnpm --filter @runbook/financial-dossier-process-bridge typecheck
pnpm --filter @runbook/financial-dossier-process-bridge build
pnpm --filter @runbook/financial-dossier-process-bridge pack:check
```

The build and test scripts first produce the exact local adapter and harness
artifacts required by the workspace package links. The pack check verifies the
exact dist-only archive and scans the loader and both reference target modules
for forbidden host-authority imports and vocabulary.
