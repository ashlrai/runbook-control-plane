# Lineage Atlas architecture and release boundary

## Purpose

Lineage Atlas is a local evidence workbench for a selected set of `.runbook` archives. It answers one narrow question: which parent declarations can this browser resolve to a loaded, core-valid capsule ID?

It is not a public graph, identity system, social network, chronology, trust score, broker record, investment-performance product, publication service, or complete-history index.

## Frozen trust boundary

1. The main thread accepts `Blob` objects, enforces count and size preflight, strips filenames with `Blob.slice()`, and transfers no filenames or paths to the Worker.
2. A dedicated `lineage-atlas.worker.js` reads archives sequentially. For every unique transport it computes the outer SHA-256 digest and the normative core-verification receipt from the same immutable byte snapshot.
3. `@runbook/capsule-lineage` copies each `Uint8Array` at API entry, calls `@runbook/capsule-browser`, hashes the exact serialized core receipt, and constructs the generic graph. Callers cannot provide trusted receipts or parsed lineage metadata.
4. Only a fully core-valid transport can create a capsule node or satisfy a declared parent ID. Invalid transports remain quarantined even if their untrusted bytes appear to name a valid capsule ID.
5. The Worker may separately run `@runbook/creator-proof` against a loaded valid frozen seed and resolved child. That application receipt remains separate from the generic lineage receipt.
6. The main thread receives metadata-only receipt objects and exact export bytes. It never reads archive bytes, creates archive object URLs, renders payloads, or injects archive text into the DOM.

## Resource profile

- At most 32 selected blobs.
- At most 64 MiB per blob.
- At most 128 MiB aggregate before deduplication; exact repeats still count during preflight.
- At most 32 unique transport hashes and 32 core-valid capsule IDs.
- At most eight declared parents per valid capsule and 256 resolved or missing edges.
- Verify sequentially with one archive buffer live. A Creator Proof check may reread only one resolved parent-child pair.
- At most 30 seconds per archive and 120 seconds for the whole batch.
- At most 1 MiB of exact serialized generic receipt bytes.
- Count, per-file, and aggregate limit failures reject the batch atomically. They never produce input-order-dependent partial evidence.

## Identity and transport semantics

Archive transports and capsule IDs are different layers.

- The exact same archive selected more than once is analyzed once. Repeat count is an ephemeral UI notice and is excluded from the deterministic export.
- Different core-valid archive hashes with the same capsule ID are alternate valid transports. They form one capsule node whose transport hashes remain individually inspectable.
- An invalid archive is always a rejected transport. Its tentative capsule ID or key ID is never exported, indexed, or used to resolve an edge.
- If two purportedly valid transports with one capsule ID disagree on author key or signed lineage metadata, the analyzer emits `lineage.identity-conflict`, withholds the node, and creates no edges for it. This is a defensive invariant failure, not a claim about a person.
- Key IDs are pseudonymous correlators. Per-edge language is exactly `same-self-asserted-key`, `different-self-asserted-key`, or `not-evaluated`. A shared key does not prove identity, control, continuity, consent, or common authorship.

## Graph semantics

- A valid `root` capsule has no declared parent and therefore no edge.
- A resolved edge exists only when a valid child declares a parent capsule ID and a loaded, non-conflicted, valid node computes to that exact ID.
- A missing edge is an open-world unresolved declaration. It does not mean the parent is false, nonexistent, or invalid outside the selected set.
- Invalid transports never poison a valid transport alias and never satisfy a parent.
- Resolved cycles produce `lineage.cycle`. The affected capsules remain core-valid, but the selected graph is not an acyclic lineage.
- Layout, edge validity, and ordering never depend on declared time, checkpoint sequence, filename, input order, locale, timezone, or current time.
- `corrects` and `supersedes` remain signed relation labels. Atlas does not infer that a correction is accepted or that a superseded record should be ignored.

## Generic receipt

The exact JCS export uses schema `runbook.proof-lineage-analysis.v1` and contains only deterministic metadata:

- unique transport artifacts: archive digest, byte length, exact core-receipt digest, core status, and core error codes; capsule and key IDs appear only for core-valid artifacts;
- valid non-conflicted nodes: capsule ID, self-asserted author-key ID, sorted transport hashes, declared relation, and sorted parent IDs;
- sorted resolved and missing edges with the declared relation and key relationship;
- sorted key groups, each containing one self-asserted key ID and its capsule IDs;
- sorted strongly connected cycle components;
- fixed counts, findings, and limitations.

The receipt has `analysisComplete: true` after successful bounded analysis. It does not have an overloaded top-level `valid` field. Core validity stays on each artifact; missing parents are warnings; cycles and identity conflicts are graph findings.

Exact duplicate occurrence counts, filenames, file paths, payload bytes, member paths, report HTML, declared timestamps, experiment IDs, free text, and invalid parsed identities are excluded. The export warning states that hashes, capsule IDs, key IDs, and lineage can still correlate artifacts.

### Finding taxonomy

Errors:

- `lineage.cycle`
- `lineage.identity-conflict`

Warnings:

- `lineage.parent-missing`
- `lineage.transport-alias`

Resource or environment failures occur outside the completed receipt:

- `input.batch-count-limit`
- `input.batch-size-limit`
- `input.empty`
- `input.size-limit`
- `input.read-failed`
- `output.size-limit`
- `crypto.unavailable`
- `crypto.operation-failed`
- `worker.timeout`
- `worker.failure`
- `worker.cancelled`

`lineage.parent-mismatch` is reserved for a future explicit parent-slot API and is never emitted by automatic corpus ingestion.

## Worker and state-race controls

- Every request has a positive generation ID. Progress, result, error, and domain messages must match the active generation.
- Starting, clearing, cancelling, timing out, or disposing terminates the Worker and atomically invalidates previous state.
- Main-thread parsing treats Worker messages as untrusted. A successful result must bind its object to the included exact JCS bytes and bind every artifact to the digest produced from the same Worker-owned bytes.
- Results replace the previous Atlas atomically; partial progress never mutates the visible graph.
- The Worker retains only metadata and blob handles after each archive is processed.

## Experience contract

`/lineage` is a full-bleed local workbench, separate from the analytics-style application shell. Its signature view is a deterministic broken binding thread:

- an uninterrupted blue thread joins only loaded-valid resolved parent and child notches;
- a cut amber thread ends at an empty notch for a missing declared parent;
- invalid or no-verdict files have no notch and remain in an Exclusions rail;
- optional periwinkle stitching marks only `same self-asserted key` groups and never changes layout.

The semantic source of truth is a nested ordered outline. The visual thread is an `aria-hidden` enhancement. Below 760 px the outline is the default, the inspector is inline, controls are at least 44 px, full hashes wrap, and the page has no horizontal overflow. The legend always says: `Position shows declared ancestry, not time, identity, influence, or completeness.`

Core boundary copy:

> Trace only what the files can prove.
>
> NO UPLOAD · NO PAYLOAD DISPLAY · NO ANALYTICS · NO PUBLICATION
>
> Loading this page still makes ordinary requests to this site.

After analysis, the summary says `valid capsule IDs`, never `identities`. Missing-parent copy explicitly says the declaration is unresolved, not false. Key-group copy always says `same self-asserted key`.

The only authoring action applies to the exact frozen synthetic seed. It opens the isolated signer in a new tab without transferring archive bytes, receipt state, or query/referrer data. A supported child may offer `Create another child from the frozen seed`; Atlas must never claim the signer can fork an arbitrary child.

## Privacy and release gates

The metadata-only exports disclose before download:

> This export is metadata-only, but hashes, capsule IDs, self-asserted key IDs, and lineage can still correlate artifacts.

No share, post, referral, URL-ingestion, lead, payment, hosted submission, Robinhood, return, ranking, or performance control appears in Atlas.

The current main Next application now sends a reviewed baseline CSP and isolation headers, including same-origin Worker scoping, COOP/COEP/CORP, `nosniff`, no-referrer, and a restrictive Permissions Policy. Public release remains blocked until the Atlas origin reaches the stricter target (`connect-src 'none'`, no third-party scripts, analytics, or service worker), exact Worker-byte verification, and live browser/header testing.

## Must-pass adversarial gates

- Golden and tampered transports sharing a capsule ID; invalid alias cannot poison or resolve.
- Two core-valid DSSE encodings with one capsule ID; exact repeat invariance.
- Invalid-only claimed parent remains missing; conflicting mocked valid metadata is withheld.
- Two- and three-node cycles, diamond, maximum fan-out, and self-parent core rejection.
- Missing-to-resolved update, same/different/mixed keys, and hostile timestamps with no wall-clock effect.
- Script, image, meta-refresh, form, filename, and secret sentinels absent from DOM, export, storage, logs, object URLs, and network.
- Stale A after B, malformed Worker responses, object/exact-byte mismatch, read-size mismatch, cancel, per-file and whole-batch timeout.
- 32/33 files, 128 MiB plus one byte, 64 MiB plus one byte, 256-edge ceiling, and 1 MiB receipt ceiling.
- Exact export invariance across selection order, duplicates, locale, timezone, and current time.
- Keyboard, reduced-motion, forced-colors, 320 px layout, focus transfer, and live-region behavior.
- Production Worker bytes/MIME, zero post-readiness requests, and live security headers.

## Commercial validation boundary

Atlas is a free verification primitive, not the paid product. Progress remains stage-gated:

1. Ten unrelated users must correctly distinguish root, resolved, missing, invalid, repeat, alternate transport, and cycle states without inferring identity, broker activity, returns, affiliation, or complete history.
2. The existing Verify -> Fork -> Lineage loop must produce five valid downloaded children, three independently authored voluntary publications on author-controlled channels, and three unguided downstream verifications.
3. Owned or permissioned distribution must produce at least three unrelated parent-child edges and measurable recipient pull through consented observation only.
4. Fifteen qualified interviews must identify a recurring evidence-packaging, correction, or sponsor-review workflow with a budget owner before an offer is opened.
5. At most five fully paid $499 Creator Labs may be sold off-Robinhood after SOW, privacy, retention, correction, refund, and counsel gates. Paid value is repeat operations, collaboration, correction, continuity, and owned hosting—not access to verification or a claim of lineage truth.
