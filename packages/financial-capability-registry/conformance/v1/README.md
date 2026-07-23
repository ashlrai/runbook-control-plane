# Financial Capability Registry V1 conformance corpus

This directory contains the executable, implementation-neutral form of all 50
normative cases in `financial_capability_registry_threat_profile.md` plus
append-only provider-lineage regression 051. Case 051 proves that the immutable
Robinhood revisions 1 and 2 remain unchanged while revision 3 carries five
material risk-class corrections and receives the exact V1 outcome `reject`.
That rejected candidate may be retained in quarantine storage for inspection;
storage handling does not change the verifier outcome or advance the active head.

`manifest.jcs` is exact JCS without a trailing newline. Every case binds each
input and its complete output oracle by SHA-256. Validation failures use the
bounded envelope `{"errorCode":"...","kind":"validation-error"}`; semantic
cases freeze the complete admission receipt. The hand-declared `requiredCodes`,
`forbiddenCodes`, and exact code counts are normative expectations independent
of the generated receipt bytes.

The checked-in bytes are the release oracle. The generator imports only Node
standard-library modules. It constructs ordinary inputs through a local minimal
JCS/hash path and takes signed-review inputs and complete expected outputs from
the exact `review-declarations.jcs` and `oracle-declarations.jcs` records. It
imports neither implementation under test. The TypeScript Registry and the
independent browser verifier are separate consumers of the resulting bytes.

Tests regenerate the full corpus into a disposable directory and require exact
file-list and byte equality with this directory. They also enforce the
generator's import boundary as a provenance guard.
The TypeScript adapter/runner is invoked with:

```sh
pnpm --filter @runbook/financial-capability-registry test:conformance
```

Maintainers may deliberately rebuild them after a reviewed contract change:

```sh
node packages/financial-capability-registry/scripts/build-conformance-fixtures.mjs
```

The review declaration contains fixed test-only signatures and public SPKI
bytes. No private signing key is shipped. These artifacts grant no runtime,
broker, registry, or capital authority.

No conformance result is a safety score or certification. A passing adapter
proves only that it reproduced these exact deterministic cases.

The declarations are reviewed in the same repository; they are not a
third-party audit or formal proof. Review cases cover representative binding,
time, signature, decision, evidence, denial, and replay variants. Influence
cases prove only paths declared in their snapshots, including the scanner
writer to research-state to capital-preview consumer path; they do not discover
hidden dependencies or establish arbitrary multi-domain runtime behavior.
