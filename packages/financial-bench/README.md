# `@runbook/financial-bench`

Deterministic, broker-neutral adversarial evaluation for a small frozen set of financial-agent controls. The package turns closed synthetic scenario definitions into a canonical, digest-only receipt. It never connects to a broker, discovers credentials, places orders, or evaluates live capital.

## Frozen synthetic profile

`runbook.synthetic-financial-agent-safety.v0` currently covers four scenarios:

1. an action targets an account outside the Capital Constitution;
2. an undocumented tool attempts an unknown mutation;
3. a documented capability changes to a more dangerous mutation class; and
4. a documented capability changes its input schema.

The trusted frozen runner must produce four `pass` results. A pass means only that the modeled control emitted the frozen expected findings. It is not a performance score, safety certification, suitability assessment, compliance determination, or proof of live execution. The generic runner evaluates a caller-selected scenario set and explicitly marks that narrower coverage; `analysisComplete` never means that an external or frozen corpus was complete.

## Safety boundary

- Every run is synthetic-only. A constitution permitting `paper` or `live`, or an action declaring either environment, is rejected before evaluation.
- Unlisted tools, newly added tools, changed risk-relevant schemas, escalated mutations, and the known `unknown` mutation class fail closed.
- All public parsers use exact-key closed schemas, sorted unique collections, bounded strings and arrays, and canonical byte-size limits.
- Receipts contain scenario IDs, fixed finding codes, statuses, and SHA-256 digests. They omit account aliases, instruments, notionals, quantities, tool names, descriptions, provider labels, and other source metadata.
- Receipts are unsigned local analysis. Capability snapshots are source-reported and may be incomplete.

## Use

```ts
import {
  SYNTHETIC_V0_CORPUS_MANIFEST,
  SYNTHETIC_V0_CORPUS_MANIFEST_SHA256,
  runFrozenSyntheticV0Bench,
  serializeBenchRunReceipt,
} from "@runbook/financial-bench";

const receipt = runFrozenSyntheticV0Bench();
const canonicalJcs = serializeBenchRunReceipt(receipt);
```

`SYNTHETIC_V0_CORPUS_MANIFEST` pins the four required scenario-definition digests and an independent canonical-corpus digest. `SYNTHETIC_V0_CORPUS_MANIFEST_SHA256` identifies that manifest. `runFrozenSyntheticV0Bench()` reconstructs fresh definitions from internally owned exact JCS on every run and refuses any pin mismatch. `parseFrozenSyntheticV0BenchReceipt()` accepts only exact trusted recomputation, while `parseBenchRunReceipt()` deliberately remains a structural parser for generic receipts.

The byte oracle is [`fixtures/expected-synthetic-v0-receipt.oracle.json`](./fixtures/expected-synthetic-v0-receipt.oracle.json). Its `jcs` string is the exact no-newline canonical receipt and its separate SHA-256 removes filesystem newline ambiguity. Tests independently hash the canonical string with Node crypto and check the package SHA-256 implementation for parity.

All public parsers recursively inspect property descriptors, reject accessors and exotic prototypes, and return fresh plain-data copies. JavaScript provides no reliable universal Proxy detector: Proxy meta-object traps may execute during shape inspection. Untrusted transport should therefore enter as strict JSON bytes; successful parsing still guarantees that no caller-owned object survives.

## Resource limits

- 1–64 scenarios per run
- at most 256 tools per capability snapshot
- at most 256 policy rules
- JCS depth at most 64 and at most 100,000 visited nodes
- canonical byte caps enforced per schema (16 KiB actions, 256 KiB constitutions, 1 MiB snapshots/diffs, 64 KiB receipts)

## Verify

```sh
pnpm --filter @runbook/financial-bench test
pnpm --filter @runbook/financial-bench typecheck
pnpm --filter @runbook/financial-bench build
```
