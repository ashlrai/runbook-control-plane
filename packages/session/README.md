# `@runbook/session`

**Control Plane Session** — shared spine for Runbook MCP, web, shadow-lab, and dossier evidence.

## What this is

- Local session records binding charter digests, inventory pins, shadow-generation summaries, and dossier attachments
- Fail-closed inventory checks against an admitted tool pin
- Signed approval *intent* helpers (device-key local attestation)
- Evidence pack export for one session

## What this is not

- Not a hard broker gateway
- Not trading performance or capital allocation
- Not composite safety certification
- Device-key signatures do **not** establish broker authorization or authenticated legal human identity

## Quick use

```ts
import {
  SessionStore,
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
} from "@runbook/session";

const store = new SessionStore({ rootDir: "/tmp/runbook-sessions" });
const session = await store.create({ label: "My control plane", charter: policy });
await store.setInventoryPin(session.sessionId, buildPublicDocsInventoryPin());
const check = checkObservedToolsAgainstPin(session.inventoryPin, observedNames, "fail-closed");
```

## Storage

Sessions are JSON files under a private root (`~/.runbook/sessions` by default when used from MCP). Modes prefer `0700` / `0600`.
