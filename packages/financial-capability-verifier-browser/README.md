# `@runbook/financial-capability-verifier-browser`

A separately implemented, browser-compatible verifier for the
`runbook.financial-capability-registry.v1` evidence profile.

The runtime package imports no registry implementation, Node API, filesystem,
network, storage, broker, credential, signing, or mutation capability. It owns
exact input bytes and independently performs:

- strict UTF-8 and JSON parsing with duplicate-key and Unicode rejection;
- exact RFC 8785 JCS and SHA-256 replay;
- closed snapshot, source, capability, policy, and review validation;
- source-set, capability/source change, influence-path, workflow-prerequisite,
  blocked-set, diff, policy, review, and admission recomputation;
- out-of-band Ed25519 review verification through browser Web Crypto; and
- exact comparison of any caller-supplied diff or admission receipt against the
  recomputed bytes.

```ts
import {
  serializeIndependentVerificationReceipt,
  verifyCapabilityRegistryBundle,
} from "@runbook/financial-capability-verifier-browser";

const receipt = await verifyCapabilityRegistryBundle({
  baselineSnapshotBytes: new Uint8Array(await baselineFile.arrayBuffer()),
  candidateSnapshotBytes: new Uint8Array(await candidateFile.arrayBuffer()),
  policyBytes: new Uint8Array(await policyFile.arrayBuffer()),
  evaluatedAtDeclared: "2026-07-22T09:00:00Z",
});

const exactJcsBytes = serializeIndependentVerificationReceipt(receipt);
```

`verifySnapshotBytes` provides the smaller exact-byte snapshot interface used
by the executable conformance corpus. `evaluateAdmissionBytes` returns the
registry-compatible independently recomputed admission receipt. Both reject
malformed artifacts with a stable `IndependentVerifierError.code`.

The bundle receipt's `recomputationComplete` field means only that exact local
recomputation completed and any supplied claims matched it. It can be `true`
when the independently recomputed admission outcome is `reject` or
`quarantine`; it is never an execution authorization or safety verdict.

## Assurance boundary

The implementation is separate from the registry core and does not import it at
runtime. Its tests deliberately import the core only as a differential oracle;
that code is excluded from the package build.

This is same-repository independent-implementation evidence, not third-party
certification. It is currently TypeScript, not the issue's recommended future
Rust/WASM diversity boundary. Browser and Web Crypto behavior remain part of
the trusted computing base. Verification neither proves remote source truth nor
authorizes or executes a trade, payment, credential release, purchase, capital
movement, or durable registry-head mutation.
