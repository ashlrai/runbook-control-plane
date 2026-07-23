# `@runbook/control-card`

The fixed `runbook.synthetic-control-self-test-card.v0` application profile.
It packages and independently rechecks Runbook's trusted four-fixture synthetic
control corpus inside a normal Proof Capsule v1.

This is a **reference control self-test**, not an Agent Safety Card. It does not
invoke or observe an agent, model, MCP client, broker, account, order, approval,
execution, or capital. A reproduced expected finding set is not a score, grade,
certification, readiness decision, or evidence that an agent is safe.

`prepareControlCard` accepts only the variable signed controls needed by the
generic capsule author: a public key, an author-declared time, and a checkpoint
sequence. All semantic payload bytes, roles, media types, experiment identity,
lineage, and event-chain fields are fixed by the application profile.

`verifyControlCard` runs the browser-safe core verifier, reruns the internally
owned trusted corpus, reconstructs the complete application manifest and all
payload bytes, and emits a separate exact-JCS application receipt. It never
changes the generic Proof Capsule assurance object. `@runbook/control-card/node`
provides the same application check over the Node core verifier for differential
testing; same-project agreement is not independent verification.

```ts
import { verifyControlCard } from "@runbook/control-card";

const receipt = await verifyControlCard(capsuleBytes);
if (!receipt.valid) throw new Error("control-card.application-profile-invalid");
```

The immutable sample is
`fixtures/synthetic-control-self-test-v0.runbook`. It uses public RFC 8032 test
vector 2, never an issuer or identity key. Its archive SHA-256 is
`4518e9957ffaefbb6f51ce8dddfe0129c9bf347a8227153508234c29b53af980`;
the complete fixed application manifest is
`f09d883e6bebfb53bcf352f4090ac4401a58c321c4efc804b6b3b840d8858404`.
The generator is a manual release tool. Tests consume the checked-in artifact
and never regenerate it as their expected oracle.
