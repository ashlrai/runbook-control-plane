# @runbook/capsule-browser

Browser-native, offline verifier for the draft `runbook.proof-capsule.v1` profile.

The implementation accepts capsule bytes, never extracts or renders members, and uses only typed byte arrays plus Web Crypto. It has no filesystem, network, signing, Node runtime, or `Buffer` dependency.

```ts
import {
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "@runbook/capsule-browser";

const receipt = await verifyProofCapsule(await file.bytes());
const exactJcsReceipt = serializeProofVerificationReceipt(receipt);
```

`verifyProofCapsule` resolves normative invalid-capsule receipts. It rejects with `ProofCapsuleCryptoError` only when the runtime cannot perform a required SHA-256 or Ed25519 operation; an environmental failure is deliberately not represented as a bad signature.
