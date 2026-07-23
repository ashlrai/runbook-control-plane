# `@runbook/engine`

The engine contains Runbook's local policy, ledger, content, growth, gateway, and checkpoint primitives.

## Gateway policy binding

Gateway policies are content-addressed. Construct them with `createGatewayPolicy` or derive the expected digest with `deriveGatewayPolicyDigest`; both use the same domain-separated, deterministic representation of every policy claim. Role and approver ordering do not affect the digest, while changes to quorum, roles, approval lifetime, approver identity, role assignment, or public key do.

`evaluateActionAuthorization` recomputes this digest from the supplied policy body. It denies requests when the asserted policy digest does not match that body, and approvals must bind the recomputed digest. A caller-supplied digest is never evidence that the supplied policy is approved.

## Local-ledger privacy boundary

`FileLedger` is a local, append-only, tamper-evident research ledger. It is not a secret store. Before any event is persisted, the ledger recursively checks the full event envelope and payload. It rejects:

- credential-like object keys such as `apiKey`, `authorization`, `privateKey`, `password`, account/routing identifiers, and session secrets;
- compact JWTs (including when embedded in prose), PEM private-key headers, credential-bearing connection URLs, and authorization-header values;
- common AWS, Google, GitHub, GitLab, npm, Docker, Hugging Face, OpenAI/Anthropic-style, Stripe, Slack, SendGrid, Twilio, Vercel Blob, webhook, and age-secret token shapes;
- generic opaque or hex secret material, high-entropy values assigned to credential labels, and account-, routing-, card-, or IBAN-like values.

The same guard runs when an existing ledger is read, so manually inserted unsafe records make verification fail closed. Rejection errors report only the JSON path and never echo the suspect value.

The ledger root must be owned by the current OS user and deny every group/other permission bit (normally `0700`). Existing ledger and writer-lock files must also be current-user-owned and owner-only (normally `0600`). Runbook creates new paths with those explicit modes, validates opened file descriptors before reading or writing, and fails closed instead of silently changing permissions on an existing user path. Repair or relocate an intentionally created path yourself after reviewing its ownership and contents.

The detector is intentionally conservative and shape-based; it is a last-resort persistence canary, not a data-loss-prevention guarantee. It can reject harmless values that resemble credentials, and unfamiliar or low-entropy secrets can evade it. Ordinary Runbook domain IDs (`RUN-…`, `EXP-…`, `PROPOSAL-…`, `POLICY-…`, `EVENT-…`, `CAPSULE-…`, `RECEIPT-…`, and `CHECKPOINT-…`), RFC 4122 UUIDs, exact lowercase SHA-256 digests (bare or `sha256:` tagged), `sha512:`-tagged lowercase digests, and explicitly prefixed `synthetic`, `fixture`, `mock`, `demo`, or `example` IDs remain supported. Those prefixes are declarations for controlled non-production fixtures, not a safe way to relabel real credentials: an ID containing a recognized token, key, JWT, credential URL, or credential assignment is still rejected. Never place credentials, personal account identifiers, raw broker exports, or private customer data in any ledger field; store only the minimum pseudonymous research metadata needed for the experiment.
