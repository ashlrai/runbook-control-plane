# `@runbook/financial-bench-sandbox`

Credential-free, broker-disconnected execution of one reviewed, self-contained financial-agent adapter bundle in a fresh hardened Docker container per scenario.

The package emits and deterministically replays a **Limited-scope Sandbox Target Run Receipt**. It binds the actual runner-owned adapter/configuration bytes, fixed launcher and runtime policy, five isolated lifecycles, existing Financial Bench evidence, and cleanup result. It does not prove production equivalence, arbitrary-code safety, credential absence inside bundle bytes, investment suitability, profitability, or future behavior.

The browser-safe root export contains strict evidence parsing and verification. `./node` contains owned-file ingestion and the Docker executor. `./adapter` contains only the fixed target adapter contract. Arbitrary execution is intentionally not exposed as an MCP tool.

## Standalone runner

Build the deterministic self-measuring host runner:

```bash
pnpm --filter @runbook/financial-bench-sandbox build
```

Run one reviewed self-contained ESM adapter. The public configuration must be exact JCS matching the fixed closed schema, and the caller must independently supply the adapter's expected SHA-256:

```bash
node packages/financial-bench-sandbox/dist/host-runner.mjs \
  --adapter ABSOLUTE_ADAPTER.mjs \
  --adapter-sha256 LOWERCASE_SHA256 \
  --configuration ABSOLUTE_PUBLIC_CONFIG.jcs \
  --evidence-out ABSOLUTE_EVIDENCE.jcs
```

Verify the portable evidence without executing the adapter:

```bash
node packages/financial-bench-sandbox/dist/host-runner.mjs verify \
  --evidence ABSOLUTE_EVIDENCE.jcs \
  --expected-host-runner-sha256 INDEPENDENTLY_OBTAINED_SHA256
```

Valid verification writes exact receipt JCS to stdout without a transport newline. The expected runner digest is optional for structural replay but required to turn the runner self-measurement into a caller-pinned release identity.

Docker integration tests run only repository-owned fixtures:

```bash
pnpm --filter @runbook/financial-bench-sandbox test:docker
```

The local V1 suite covers reference and deny-all behavior, environment/filesystem/child-process/IPv4 egress probes, CPU-loop hard termination, exact terminal-state inspection, nonzero-exit rejection after a valid decision, attach reaping, orphan audit, and pre-import frame spoofing. Version 1 enforces host aborts by terminating the disposable container rather than forwarding a cooperative cancellation frame. The full hostile matrix in the profile remains a release gate; this package must not be described as safe for arbitrary malicious customer code.

After adapter import, the fixed launcher and adapter share one JavaScript realm and stdout. The bootstrap acknowledgement remains a launcher-originated pre-import hash check, while post-import readiness, RPC, and decision frames are bounded target-process observations—not proof of exclusive launcher mediation or exclusive use of the exported `run()` return path. A protocol-aware hostile adapter can emit bound post-import frames directly. That adversary is outside V1's reviewed-bundle scope and must be addressed by the separate V2 process architecture.

See [`../../sandbox_target_profile.md`](../../sandbox_target_profile.md) for the frozen version 1 boundary and acceptance gates.
