# Browser Proof Relay Architecture

**Status:** Milestone 6 implementation contract
**Date:** July 21, 2026
**Scope:** local `.runbook` verification and the Verify → Understand → Fork distribution loop
**Explicitly out of scope:** signing, key custody, brokerage connectivity, Robinhood Social automation, uploads, hosted persistence, payments, and claims of external interoperability

## Product decision

The browser product is a dedicated `/verify` experience called **Proof Relay**:

```text
VERIFY BOTH FILES → EXPLAIN THE LIMIT → FORK ONE RULE
```

Its single job is to let a person choose an untrusted `.runbook` file, receive the normative receipt locally, understand what that receipt does and does not establish, and continue into an explicitly unsigned synthetic charter workflow. It does not render, extract, upload, publish, or sign capsule content.

The existing `/trust` route remains a separate inspector for pasted `runbook.public-snapshot.v1` metadata. Its result must never be presented as capsule verification.

## Architecture decision

Milestone 6 uses a separate browser-native implementation of the draft profile rather than polyfilling the Node package:

- `Uint8Array`, `DataView`, `TextEncoder`, and `TextDecoder` for bytes;
- native Web Crypto `SHA-256`, Ed25519 SPKI import, and signature verification;
- no `Buffer`, `node:*`, filesystem, process, network, archive extraction, DOM rendering, storage, or signing APIs in the verifier core; and
- an injected `SubtleCrypto` interface for deterministic tests and explicit capability failure.

This is deliberate implementation diversity. A second code path can expose parser and stage-precedence disagreements that a shared parser cannot. The cost is maintenance and differential risk, so exact frozen receipt oracles—not source similarity—are the release authority.

This implementation is created in the same repository by the same project. It is **not independent interoperability evidence** and does not count toward the ten-independent-implementation freeze gate.

Generic Node polyfills are rejected. The current Node verifier depends on `node:crypto`, `Buffer`, and Node public-key parsing; placing those behind a client boundary would enlarge the browser attack surface without producing a trustworthy native verifier.

## Runtime boundary

```text
unnamed Blob
    │ preflight size check in UI
    ▼
dedicated module Worker
    │ second 1–64 MiB size check
    │ Blob.arrayBuffer only after check
    ▼
browser-native draft-profile verifier
    ├─ deterministic STORED-only ZIP parsing
    ├─ CRC, ranges, paths, order, and resource limits
    ├─ strict JSON, duplicate-key, JCS, schema, and lineage checks
    ├─ exact 44-byte Ed25519 SPKI prefix check
    ├─ Web Crypto SHA-256 and Ed25519 verify
    └─ normative receipt construction
    ▼
receipt object + transferred exact JCS ArrayBuffer
    ▼
React assurance, member, error, warning, and limitation view
```

The Worker receives a sliced `Blob`, not a `File`, so a local filename never enters the verification core or receipt. The client uses generation IDs, termination, timeout, and stale-result suppression. An unavailable Web Crypto operation is an environment failure, not a capsule-invalid normative receipt.

The production Worker is an explicit esbuild output at `/proof-capsule.worker.js`, not a framework-copied TypeScript asset. Release verification must fetch that path from `next start`, require HTTP 200 plus a JavaScript content type, compare the served bytes to the generated asset, and capability-probe from a fresh origin before any cached Worker can mask a packaging failure.

Verification must not call `fetch`, XMLHttpRequest, Beacon, WebSocket, EventSource, clipboard, IndexedDB, local storage, object URLs, or DOM APIs. The UI may deliberately create and immediately revoke object URLs only for (a) the exact JCS receipt and (b) the two trusted, build-embedded frozen synthetic fixtures whose bytes and SHA-256 identities are test-bound to the public corpus. No user-selected capsule byte or capsule member may receive an object URL.

The precise public claim is:

> Capsule bytes never leave this browser. Verification performs no application network checks after the verifier code is loaded.

The page and its module Worker are themselves same-origin assets, so “the page uses no network” would be false.

## Cryptographic boundary

The verifier requires the exact canonical v1 public-key bytes:

```text
302a300506032b6570032100 || 32-byte Ed25519 public key
```

It computes the key fingerprint over those exact 44 bytes, imports them as SPKI, constructs exact DSSE v1 pre-authentication encoding, and verifies the 64-byte signature with Ed25519. A valid signature binds the exact statement to the embedded self-asserted public key; it does not establish civil identity, platform identity, Robinhood identity, independent time, broker issuance, execution, completeness, performance, skill, suitability, or compliance.

Web Crypto Level 2 specifies Ed25519, but implementations are not required to support every algorithm and the specification remains a working draft. The Worker therefore performs the actual import/verify capability path and reports verification-only incompatibility honestly. No JavaScript or WASM cryptographic fallback is silently loaded. See [Web Cryptography Level 2](https://www.w3.org/TR/webcrypto-2/), [RFC 8410](https://www.rfc-editor.org/rfc/rfc8410.html), [Firefox 130 release notes](https://www.firefox.com/en-US/firefox/130.0/releasenotes/), and the [Chromium Ed25519 implementation intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/T2kriFdjXsg/m/ZeD_PoLXBwAJ).

## Receipt and identity semantics

The receipt is the shareable result, not a green “verified” badge.

Every valid share context must pair:

- signed checkpoint/capsule ID;
- outer archive SHA-256;
- exact receipt SHA-256;
- verifier profile;
- package integrity;
- author signature;
- self-asserted identity state; and
- explicit non-assurance fields.

The frozen valid and tampered transports intentionally share capsule ID `66b200560e20f723ece402931277043b85316687aac30f73c4da6a4d5a323578`; their outer archive digests differ. Capsule ID alone therefore does not identify the received transport bytes.

Receipt downloads must be exact RFC 8785 JCS bytes with no BOM, CR, LF, filename-derived field, local time, locale, or browser brand. The valid browser result must byte-equal the 2,536-byte frozen oracle; the tampered result must byte-equal the 2,588-byte frozen oracle.

## Proof Relay interaction

The page uses an ordered, text-accessible three-station relay:

1. **Integrity** — explicitly verify the intact and tampered synthetic fixtures, or choose another local capsule.
2. **Understanding** — answer what passed, what failed, and what remains unevaluated.
3. **Fork** — continue to an unsigned synthetic starter only after the assurance boundary is understood.

The frozen mutation must be represented exactly:

```text
payload/charter.json byte offset 22
"synthetic" → "synthetix"
ASCII 0x63 → 0x78
ZIP CRC recomputed; signed manifest digest left unchanged
```

The guided fork is educational, not a paywall. Specification, fixtures, CLI, and raw receipts remain directly accessible. Until a separately reviewed signer/exporter exists, the next artifact is labeled `unsigned-template-not-proof`; it is not a capsule, valid lineage child, or challenge submission.

## Local observation boundary

Proof Relay may maintain a separate, device-local observation store to help Mason test the funnel. It may record only fixed schema values such as `verify_started`, `golden_validated`, `tamper_rejected`, `assurance_comprehended`, or `clone_starter_created`, plus public frozen hashes and fixed source buckets.

It must exclude filenames, paths, payload content, free text, IP addresses, referrers, user agents, emails, account data, Robinhood usernames/posts/comments, symbols, and cross-site identifiers. Local counts are “local sessions,” never people. Any later aggregate contribution is a separate explicit opt-in action.

## Accessibility and visual contract

Subject: adversarial evidence verification for technical finance creators.
Audience: creators, educators, agent builders, and security-minded investors.
Page job: move one person from file selection to an honest receipt and comprehension checkpoint.

The visual system extends Runbook’s flight-recorder/evidence language:

- **Ink** `#0b1220` — verification chamber and transport rails;
- **Paper** `#f4f7fb` — readable evidence surface;
- **Signal blue** `#3157d5` — intentional actions;
- **Integrity green** `#14845e` — only paired with explicit `valid` text;
- **Mutation orange** `#f0642b` — tamper/error evidence;
- **Rule gray** `#d8e0eb` — member and assurance structure.

Typography remains Bricolage Grotesque for thesis, Instrument Sans for explanation, and IBM Plex Mono for bytes, paths, IDs, and states. The signature element is an **evidence relay rail**: two file tickets pass visibly through Integrity, Understanding, and Fork stations. Motion is limited to one station-transition sequence and is disabled under `prefers-reduced-motion`.

Requirements:

- ordinary file input is primary; drag/drop is additive;
- every control is at least 44 CSS pixels;
- keyboard selection and visible focus work end to end;
- `aria-live="polite"` announces progress and outcomes;
- result heading receives programmatic focus after verification;
- state is never communicated by color alone;
- exact failed member/error is textual;
- long hashes wrap without horizontal viewport overflow at 320 CSS pixels; and
- bundled `payload/report.html` is never inserted into the DOM, iframe, or application origin.

## Signing is a separate milestone

Browser verification does not create a signing key. A production signer on the current application origin would trust every same-origin page and script because Web Crypto and IndexedDB are origin-scoped, not path-scoped.

A future Local Authoring Preview requires:

- a dedicated minimal origin;
- native Web Crypto Ed25519 feature and persistence ceremony;
- a non-extractable private `CryptoKey` stored in IndexedDB;
- exact public SPKI validation and fingerprinting;
- no third-party scripts, analytics, shared service worker, uploads, cookies, or application APIs;
- strict CSP and isolation headers;
- explicit human review of manifest, member digests, data class, scope, and lineage;
- local self-verification of the finished capsule before download; and
- copy that says non-extractable through Web Crypto, never hardware-backed, unstealable, origin-locked, identity-verified, recoverable, or revoked.

Private-key backup, cross-device recovery, key continuity/rotation/revocation, WebAuthn/hardware signing, trusted time, transparency, identity, and broker attestation remain deferred.

## Release gates

Browser verification is current capability only after all of these pass:

- exact-byte equality with both frozen receipt oracles, twice per fixture;
- parity on capsule ID, archive hash, key ID, assurances, members, errors, warnings, lineage, and limitations;
- malformed ZIP/path/JSON/JCS/Base64/key/signature cases produce expected stable results;
- empty and over-64-MiB inputs fail before allocation;
- Worker timeout, crash, malformed response, cancellation, double-selection, and stale result are safe;
- production browser verification performs no application network request after readiness;
- valid/tampered receipt downloads contain exact bytes and no trailing newline;
- no payload/report content reaches the DOM;
- keyboard, screen-reader text, reduced motion, mobile, and long-hash layouts pass;
- Next production build and browser bundle contain no `node:`, `Buffer`, filesystem, process, network, storage, or signing calls in the verifier core; and
- public copy continues to label the profile draft and the browser implementation same-project.

Only after these gates pass may Proof Capsule CTAs move from the metadata demo to `/verify`. The full section 16 corpus and ten external implementations remain separate freeze requirements.
