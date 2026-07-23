# `@runbook/capsule-lineage`

Browser-safe, selected-set lineage analysis for untrusted Proof Capsule bytes.

The package accepts raw `Uint8Array` archives only. It copies each archive before its first asynchronous operation, runs `@runbook/capsule-browser` itself, hashes the exact core receipt, and indexes only core-valid capsule IDs. Callers cannot supply receipts, parsed manifests, parent metadata, filenames, timestamps, experiment IDs, member paths, or payloads as graph authority.

```ts
import {
  analyzeProofLineageArchives,
  serializeLineageAnalysisReceipt,
} from "@runbook/capsule-lineage";

const receipt = await analyzeProofLineageArchives([parentBytes, childBytes]);
const exactJcs = serializeLineageAnalysisReceipt(receipt);
```

Workers that read `Blob` objects sequentially should use `createProofLineageAnalyzer()`, call `addArchive()` with one Worker-owned byte snapshot at a time, then call `finish()`. The analyzer retains deterministic metadata, not archive bytes. A failed collector is permanently poisoned and cannot emit a partial receipt.

Limits are 32 selected archives, 64 MiB each, 128 MiB aggregate before deduplication, and 1 MiB per serialized receipt or research packet. Exact repeat selections count toward input limits but are analyzed once and have no occurrence count in deterministic output.

`analysisComplete: true` means bounded analysis finished. There is deliberately no top-level `valid`: core validity remains per artifact, missing parents remain open-world warnings, and cycles or defensive identity conflicts remain graph findings. Core-valid artifacts retain their verified relation and parent IDs so an untrusted receipt can be checked without trusting caller-shaped conflict claims; core-invalid artifacts retain neither. Shared key IDs are labeled only as self-asserted correlators; they do not prove identity, control, continuity, consent, or common authorship.
