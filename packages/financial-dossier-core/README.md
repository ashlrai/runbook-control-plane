# `@runbook/financial-dossier-core`

Broker-disconnected, pure TypeScript semantic and portable-replay foundation for the candidate Runbook Pre-Capital Control Dossier V2 profile.

It freezes the ordered namespace `finance-000` through `finance-030`, one positive calibration, thirty hostile cases across ten threat families, exact condition and deviation codes, canonical JCS/SHA-256 identities, value-free portable evidence, and verifier-owned receipt derivation. A target-visible challenge contains neither the private-oracle digest, oracle body, nor accepted-response hashes. The runner-side manifest and evidence still bind the private-oracle digest. This package contains runner-only reference-oracle and trusted-fixture code for its own implementation tests; those functions are excluded from the package entry point, and the package must not be bundled or mounted into a future target sandbox. Scenario IDs and conditions still permit fixed-corpus hardcoding; that limitation is explicit in every receipt.

This pure core evaluates closed **target-declared semantic responses**. Fields about disposition, mutation attempts, accepted previews, accepted mutation effects, invalidation, conflicts, sinks, and recovery are declarations, not runner-observed facts. Preview acceptance and capital-moving effect acceptance are separate fields. A `controlStatus` of `pass` therefore means only that the declaration conforms to the candidate semantic oracle. Portable evidence contains exact digests and those closed declarations; it does not contain raw synthetic canaries. The future multi-step harness must replace declarations with runner-owned channel observations before buyer conclusions.

The untrusted replay boundary is the bounded exact UTF-8 byte input to `replayDossierEvidenceBytes`. Direct JavaScript object validators and canonicalizers are for owned plain data; callers must not pass attacker-controlled proxies, accessors, or mutable shared objects. Runtime schema vocabularies are frozen. The trusted in-process fixture generator is deliberately not a public export and is not an adversarial execution boundary: a future target execution artifact must exclude the runner-only oracle module and exchange only public challenges across a process boundary.

This package does **not** implement the V2 multi-step channel harness, canary injection or sink scanning, process isolation, Docker or microVM execution, cleanup/orphan audits, provider authorization, or a buyer-ready dossier. Its pure runner currently emits only `evaluated` and `unsupported`; the other declared coverage states are reserved for the future attempted-session harness. Passing its reference corpus is implementation assurance only, not certification, a safety grade, an audit opinion, a compliance determination, production authorization, or evidence of live behavior.

```ts
import { replayDossierEvidenceBytes } from "@runbook/financial-dossier-core";

const regenerated = replayDossierEvidenceBytes(exactEvidenceBytes);
```

`replayDossierEvidenceBytes` accepts only an owned `Uint8Array` containing the exact canonical UTF-8 evidence bytes and recomputes all scenario results. It does not accept decoded text as transport evidence. It rejects missing, duplicate, reordered, extra, or substituted cases and observation digest mismatches. It is a replay boundary within this package; a separately maintained verifier implementation and out-of-band pinned runner release remain release gates.

`parseDossierReceiptStructural` validates shape only and does not establish authenticity. Use `verifyDossierReceiptAgainstEvidence` with the exact evidence bytes to compare a receipt against the independently derived result.

Commands:

```sh
pnpm --filter @runbook/financial-dossier-core typecheck
pnpm --filter @runbook/financial-dossier-core test
pnpm --filter @runbook/financial-dossier-core build
```
