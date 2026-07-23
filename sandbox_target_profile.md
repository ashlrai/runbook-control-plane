# Limited-scope Sandbox Target Run Receipt Profile

Status: implementation profile, version 1 draft
Date: 2026-07-22

This document freezes the first credential-free external-target execution boundary. It is an application profile for reviewed synthetic adapter bundles. It does not change `runbook.financial-agent-harness.v1`, the generic Proof Capsule profile, or the Synthetic Control Self-Test Card.

## Product boundary

The artifact is named **Limited-scope Sandbox Target Run Receipt**. It reports runner-observed execution of exact adapter and public-configuration bytes against one positive calibration case and four hostile scenarios. It is not an Agent Safety Card, certification, composite score, production-equivalence claim, broker attestation, investment recommendation, or guarantee of safety, performance, profitability, or future behavior.

Version 1 is suitable only for repository-owned or otherwise reviewed, self-contained JavaScript adapters. Arbitrary unreviewed customer code, Dockerfiles, images, package installation, native addons, remote model calls, broker credentials, live accounts, orders, capital, and production endpoints are rejected or outside scope.

### Documentation-only V1 clarification — July 22, 2026

The launcher and adapter share one JavaScript realm after adapter import. The pre-import bundle/configuration hash acknowledgement remains launcher-originated. Post-import `ready`, RPC, and `decision` frames are observations from the bound target process; they do not prove exclusive launcher mediation or exclusive use of the exported `run()` return path. A deliberately hostile protocol-aware adapter may wrap or suppress the process emitter and produce bound target-process frames directly. This is one reason V1 remains restricted to repository-owned or otherwise reviewed bundles. This clarification changes no frozen V1 schema, isolation identifier, receipt byte, fixture oracle, or historical CI result.

## Fixed inputs

### Adapter bundle

- One self-contained ESM file, at most 32 MiB.
- The caller supplies the expected lowercase SHA-256.
- The runner opens without following symlinks, requires a regular file, reads once into owned bytes, hashes those bytes, and never executes the original path.
- The exact owned bytes are sent over the fixed stdin protocol. There is no host bind mount.
- The trusted launcher hashes the received bytes before import and acknowledges the same digest.

### Public configuration

The exact-JCS bytes must be at most 2 KiB and match this closed schema:

```json
{"adapterContractSha256":"<fixed lowercase sha256>","adapterId":"<bounded identifier>","configurationId":"<bounded identifier>","mode":"broker-disconnected-synthetic","schemaVersion":"runbook.financial-agent-sandbox-public-configuration.v1"}
```

Unknown keys, duplicate keys, BOM, whitespace variants, trailing newline, credential-shaped keys, URLs, arbitrary prompts, environment values, and secrets fail before execution. Behavioral configuration belongs in the exact adapter bundle for version 1.

## Protocol

- Bootstrap is a fixed binary sequence: a 32-bit big-endian length plus an exact-JCS `init` header; a 32-bit length plus the raw adapter bytes, at most 32 MiB; then a 32-bit length plus the raw exact-JCS public-configuration bytes, at most 2 KiB.
- After bootstrap, the transport is a binary sequence of unsigned 32-bit big-endian lengths followed by exact-JCS UTF-8 behavioral frames. Maximum behavioral-frame length is 32 KiB; maximum nesting depth is 16; total stdout, stderr, frame count, tool calls, and approval requests are independently bounded.
- The trusted launcher hashes the two raw bootstrap sections, validates the configuration and contract, and emits `bootstrap-ack` before importing the untrusted adapter module. After import and export validation it emits a distinct `ready`; the host releases no stimulus until both arrive in order.
- Closed message types are `init`, `bootstrap-ack`, `ready`, `stimulus`, `decision`, `tool-call`, `tool-result`, `approval-request`, and `approval-result`. Version 1 does not forward a protocol cancellation frame: the host enforces aborts and deadlines by hard-killing the disposable container, while the adapter's contract-shaped local `AbortSignal` remains non-aborted.
- Every target-originated behavioral frame repeats the runner-issued execution and scenario binding.
- The host constructs observations and receipts. The adapter never receives scenario IDs, corpus type, private oracle, expected disposition, finding codes, or receipt logic.
- Invalid UTF-8, noncanonical JSON, unknown or duplicate fields, wrong binding, out-of-order frames, duplicate or nonsequential RPC identifiers, multiple decisions, excess messages, stray stdout, truncated data, and trailing bytes fail closed. After the single decision, only explicitly modeled late channel calls are accepted during the harness's existing observation window.

## Per-scenario lifecycle

1. Generate a fresh execution nonce and exact launch binding.
2. Create a new labeled container from the pinned runtime digest with `--pull=never`.
3. Inspect the stopped container and compare every security-relevant field to the fixed policy.
4. Start and attach; send the exact owned adapter/configuration bytes, require the pre-import hash acknowledgement, and then require post-import readiness.
5. Only after both handshakes, expose the instance as a `FinancialBenchTargetV1` to the existing harness.
6. Run one scenario using the existing harness timing and fake-tool semantics.
7. Preserve the existing late-observation window, then close or hard-kill the container.
8. Inspect exit, signal, timeout, OOM, and cleanup state.
9. Remove only the exact container ID bearing the expected run label.
10. Prove no session state is reused by creating a new container for the next scenario.

Container preparation and handshake occur outside the harness target timer. Container cleanup occurs after the harness observation window. The existing harness evidence remains byte-compatible and retains its in-process isolation wording; only the outer evidence describes container execution.

## Fixed Docker policy

The first backend creates containers with an argument array, never a shell string:

```text
--pull=never
--network=none
--read-only
--ipc=none
--cap-drop=ALL
--security-opt=no-new-privileges=true
--security-opt=seccomp=builtin
--user=65532:65532
--pids-limit=16
--memory=256m
--memory-swap=256m
--cpus=0.25
--ulimit=nofile=64:64
--hostname=runbook-sut
--log-driver=none
```

No privileged mode, device, host namespace, host path, tmpfs, secret, proxy variable, broker configuration, or Docker socket is allowed. The fixed entrypoint clears the environment and invokes the pinned Node runtime with the permission model enabled. Node permissions are defense in depth, not the isolation authority.

The normalized pre-start inspection must prove the exact OCI index reference and architecture-matched platform/config identity, command, entrypoint, non-root user, read-only root, network mode, IPC mode, exact dropped/added capability state, exact security options, seccomp selection, resource limits, log driver, absence of mounts/devices/privilege/host namespaces, and the exact run label. Any drift stops before adapter import.

## Honest isolation claim

The fixed isolation identifier is `runner-observed-oci-container-network-none-read-only-v1`.

Permitted wording:

- external network denied; loopback remains available;
- no host or persistent filesystem mounted;
- container root filesystem read-only;
- target process environment cleared to the fixed allowlist;
- exact runner-owned adapter and public-configuration bytes;
- pre-import trusted-launcher hash acknowledgement followed by post-import readiness;
- fresh Docker container and confirmed cleanup per scenario.

Forbidden wording:

- no network whatsoever;
- no filesystem exists;
- credential-free artifact or proof that bundle bytes contain no embedded secret;
- independent, remote, or hardware attestation;
- per-run VM or kernel isolation;
- safe for arbitrary malicious code;
- production-equivalent, certified safe, or ready for live capital.

The Docker daemon, runtime image, host runner, host kernel, and Docker Desktop VM remain trusted. Genuinely adversarial third-party execution requires a dedicated disposable microVM or a separately evidenced hosted backend.

## Runtime limits and cleanup

The host process owns separate bounded deadlines for creation, inspection, handshake, scenario execution, late observation, termination, inspection, and removal. CPU loops cannot block the host watchdog. Timeout, output overflow, protocol failure, signal failure, and nonzero exit trigger `docker kill`, terminal inspection, and exact-ID removal. Raw stderr, prompts, model text, and arbitrary logs never enter portable evidence; only a bounded diagnostic digest and fixed classification may appear.

## Outer evidence

The exact-JCS evidence binds:

- schema/profile versions and limitations;
- adapter contract, actual owned bundle bytes digest and byte count;
- exact public-configuration bytes digest and parsed identity;
- fixed trusted-launcher and exact self-measured standalone host-runner artifact digests;
- pinned OCI index reference, architecture-matched actual image ID, OS, and architecture;
- exact sandbox-policy digest and normalized inspection snapshot;
- execution nonce and launch binding;
- environment/hash acknowledgement before adapter import and distinct readiness after import;
- five fresh session lifecycle summaries;
- host-derived observation streams and process outcomes;
- exact inner harness evidence and receipt bytes/digests;
- cleanup completion and orphan-audit result.

Runtime evidence is intentionally nondeterministic where the nonce, image platform, process outcome, or timestamps differ. Verification is deterministic over captured evidence; repeated execution is not claimed to produce identical bytes.

## Independent verification

The browser-safe verifier owns and strictly parses the exact outer bytes, rebuilds every fixed profile value and digest, checks all cross-document bindings and lifecycle state machines, and invokes `verifyHarnessEvidenceBytes` for the exact inner evidence. It emits a deterministic receipt without executing the adapter.

`valid` means the portable evidence is structurally valid, completely bound, and independently replayed. It does not mean every scenario passed. Scenario results remain independent pass/fail/unsupported outcomes.

## Fixed coverage statement

- Positive calibration evaluated: 1
- Hostile scenarios evaluated: 4
- Hostile scenarios in catalog: 30
- Hostile scenarios unevaluated: 26

`analysisComplete` means all five cases in this limited profile were evaluated. It never means all thirty hostile scenarios were evaluated.

## Mandatory limitations

1. Synthetic one-calibration plus four-of-thirty-hostile-cases only.
2. Exact runner-observed bundle and public configuration, not source or production provenance.
3. Bundle bytes omitted from the public receipt; absence of embedded secrets is not proven.
4. Runner-observed Docker isolation, not independent or hardware attestation.
5. Host-runner digest is unsigned self-measurement unless the verifier receives an independently trusted expected digest.
6. Docker container isolation is not a dedicated per-run VM and shares a kernel boundary.
7. External network is denied while loopback remains available.
8. No broker, account, order, execution, credential, or capital is used.
9. Fixed-corpus behavior does not prove generalization or resistance to hardcoding.
10. No production build, deployment, model, provider, or behavioral equivalence is proven.
11. Scenario outcomes are not a composite score, grade, certification, or readiness guarantee.
12. The receipt does not prove safety, compliance, suitability, performance, profitability, or future behavior.
13. Same-project verifier agreement is not independent interoperability.

## Hostile acceptance gates

- Reject malformed, noncanonical, oversized, symlinked, nonregular, changed, or digest-mismatched inputs.
- Prove that replacing the original adapter after ownership does not change executed bytes.
- Reject malformed, oversized, truncated, invalid-UTF-8, noncanonical, out-of-order, replayed, and binding-swapped protocol frames.
- Prove IPv4, IPv6, TCP, UDP, DNS, metadata, host-service, and Docker-socket escape attempts cannot reach an external interface or mounted host control surface.
- Prove parent secret canaries and common host credential paths are unavailable.
- Prove read-only root, empty/allowlisted environment, non-root identity, zero capabilities, no-new-privileges, seccomp, and exact resource limits.
- Prove child process, worker, native addon, WASI, inspector, CPU, memory, PID, FD, and output controls fail closed.
- Prove hard timeout, forced termination, cleanup, no orphan, and no cross-scenario persistence on every terminal path.
- Prove the reference adapter passes all five cases and a deny-all adapter fails the positive calibration.
- Prove one-byte changes to adapter, configuration, policy, runtime, launcher, lifecycle, inner evidence, or receipt invalidate verification.
- Prove normal CI executes repository-owned fixtures only and carries no repository credential into the target.

## Graduation gates

Before accepting arbitrary customer-provided bundles, add a dedicated disposable microVM or separately reviewed Cloudflare Sandbox backend, explicit destroy-on-timeout behavior, DNS-channel handling, immutable runtime/bundle identity, and backend-specific hostile evidence.

Before using the unqualified Agent Safety Card name, complete the thirty hostile scenarios plus calibration, freeze the profile, establish externally distributed runner-key trust and rotation/revocation, complete independent verification, and satisfy the broader commercial and security review gates.
