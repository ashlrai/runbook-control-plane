# `@runbook/financial-dossier-adapter`

Process-frame-only contract for a synthetic financial target. This package is the
small target-visible leaf: it defines closed session, public task, challenge,
channel request, channel result, conclusion, and frame objects without importing
host-side execution programs, evidence derivation, or sandbox implementation.

The target receives only per-run opaque bindings and nonces, a runner-owned clock,
fixed limits, a closed public task, and synthetic channel results. Stable case
identifiers, ordering, threat classifications, expected behavior, pass/fail rules,
and host identities do not belong in this package. There is no same-realm target
callback API.

## Public task

The candidate.2 challenge binds both the exact task and its task-binding digest.
The task exposes only the minimum work context needed by a separate target:

- `review` has no idempotency key, no prior outcome, and no portable sink;
- `execute` carries a bounded opaque idempotency key and no prior outcome;
- `recover` carries a bounded opaque idempotency key and an `unknown` prior outcome;
- `summarize` has no idempotency key and permits only the `export` portable sink.

Every other combination is rejected. An execute task does not carry approval
authority. A target must request current approval through `read-approval-state`
and bind any later submission to the returned approval binding. The proposed
action is an `equity-order`; previewing remains a channel operation, not the action
kind.

## Closed operations

- `read-account-state`
- `read-market-state`
- `list-capabilities`
- `read-approval-state`
- `preview-action`
- `submit-action`
- `cancel-action`
- `read-action-status`
- `reconcile-action`
- `emit-portable-sink`

For owned non-Proxy inputs, every parser rejects unknown keys, non-plain record or
array prototypes, own accessors, malformed closed values, and invalid bounds.
Successful parsing returns a fresh recursively frozen value. The portable-sink
operation accepts canonical Base64 text within the fixed 24 KiB decoded-size
envelope so the runner can own decoding and canary scanning.

Frame direction is part of the contract. `parseTargetToRunnerFrameV2` accepts only
`ready`, `channel-request`, `conclusion`, and `target-error` frames.
`parseRunnerToTargetFrameV2` accepts only `session-open`, `challenge`,
`channel-result`, and `terminate` frames. These functions validate owned object
shapes only; the process state machine must still establish provenance, exact-byte
framing, sequence, bindings, and the legal transition for each frame.

## Limitations

- This package defines object contracts; it does not define or operate the process
  transport, byte framing, adapter loader, container, or lifecycle.
- Supplied digest fields are syntactically checked. Session, action, task, and
  challenge bindings are recomputed here, but remain unauthenticated digests. The
  runner must derive and verify every channel and trace transition.
- Opaque bindings prevent decomposed host metadata from entering the target
  contract; they do not by themselves prove freshness, secrecy, or runner identity.
- Base64 payloads are not decoded, scanned, stored, or classified by this package.
- Direct object parsing is for values already decoded into owned plain data. Own
  data accessors in records and dense arrays are rejected without invocation.
  JavaScript Proxy meta-object traps can still execute during shape inspection and
  transparent Proxy identity cannot be detected reliably; Proxies are outside this
  object API's trust boundary. The process boundary must own, bound, and strictly
  decode exact bytes before calling these parsers.
- Directional parsers establish neither frame origin nor state. The host must also
  recompute payload and trace digests and enforce sequence, binding, operation/code
  semantics, and the exact protocol transition.
- The contract has no network, broker, credential, account, order-execution,
  signing, investment-advice, scoring, certification, or production authorization
  capability.
- Passing these parsers proves only conformance to this narrow target-visible shape.

## Focused verification

```bash
pnpm --filter @runbook/financial-dossier-adapter typecheck
pnpm --filter @runbook/financial-dossier-adapter test
pnpm --filter @runbook/financial-dossier-adapter build
pnpm --filter @runbook/financial-dossier-adapter pack:check
```

Every build deletes `dist`, compiles without source maps, and rejects any emitted
file outside the twelve-file executable/declaration allowlist. The package publication
list names those twelve files individually; its type export resolves to the published
declaration rather than workspace source. The pack gate permits only those files
plus npm's publication metadata (`README.md` and `package.json`), verifies each
reported byte length against the local file, strictly decodes every executable and
declaration as UTF-8, and scans all twelve for forbidden runner-authority vocabulary.

The tests cover exact keys, all four public task programs and binding substitution,
every closed operation and directional frame, root and nested accessor rejection,
sparse/symbol/Proxy array failures, canonical Base64 pad bits, fresh immutable
outputs, the root-only export, absence of runtime dependencies, the exact
publication allowlist, and a recursive scan of executable source and built
declarations for forbidden runner-authority vocabulary.
