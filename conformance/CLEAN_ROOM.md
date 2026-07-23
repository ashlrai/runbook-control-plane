# Clean-room verification evidence

This procedure exercises the dependency-bundled Runbook verifier in a network-disabled, read-only Node container. It demonstrates that the artifact runs without this workspace's `node_modules` or network access. It is **not** an independent implementation and therefore does not count toward the ten-implementation interoperability gate.

## Build and identify the verifier

```bash
pnpm --filter @runbook/mcp build:standalone
shasum -a 256 packages/mcp/release/runbook-proof.mjs
```

Observed July 21, 2026:

```text
c4a9e42607d2098be7e1fd5aecfa83873bea6464573f5f5df5ca524420fc53d0  packages/mcp/release/runbook-proof.mjs
```

The clean environment was `node:22-alpine` at immutable image digest:

```text
node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
```

## Run with networking disabled

Replace `/absolute/path/to/project` below with this checkout's absolute path.

```bash
docker run --rm \
  --network none \
  --read-only \
  --user 65534:65534 \
  --memory 512m \
  --cpus 1 \
  --pids-limit 64 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  -v "/absolute/path/to/project/packages/mcp/release:/verifier:ro" \
  -v "/absolute/path/to/project/conformance/fixtures:/corpus:ro" \
  node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 \
  node /verifier/runbook-proof.mjs /corpus/minimal-synthetic-root.runbook
```

Expected: exit `0`, `valid: true`, capsule ID `66b200560e20f723ece402931277043b85316687aac30f73c4da6a4d5a323578`, valid transport/package/signature assurance, and explicit non-assurance for identity, time, broker activity, completeness, skill, suitability, and compliance.

Observed with the pinned image: exit `0`; stdout was exactly 2,536 bytes with no trailing newline and matched `expected/minimal-synthetic-root.receipt.json` byte-for-byte (SHA-256 `6d5c361575e2b2b8af36410234f249c8b3f97d5bd174400496253e090028e100`).

Run the same command with `minimal-synthetic-root-payload-tampered.runbook`.

Expected: exit `1`, `valid: false`, transport and author signature still valid, package integrity invalid, and only `manifest.member-digest-mismatch` at `payload/charter.json`.

Observed with the pinned image: exit `1`; stdout was exactly 2,588 bytes with no trailing newline and matched `expected/minimal-synthetic-root-payload-tampered.receipt.json` byte-for-byte (SHA-256 `e87859927bafcb26955b0cc7c2726b17344885e606f0735e1d44eb7b480eee9d`). Only `payload/charter.json` had member status `invalid`; the other nine evaluated members were `valid`.

The container has no writable root filesystem, no attached or external network, no Linux capabilities, no privilege escalation, a non-root identity, one CPU, 512 MiB memory, 64 processes, read-only verifier/corpus mounts, and a small non-executable temporary filesystem.
