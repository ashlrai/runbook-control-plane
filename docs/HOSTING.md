# Hosting Runbook at runbook.ashlr.ai

## Recommendation

**Yes — host the local-first web lab at `https://runbook.ashlr.ai`.**

| Host | Role |
| --- | --- |
| `runbook.ashlr.ai` | Public process lab: session spine, shadow lab, registry, verifier, control room, MCP docs |
| GitHub `ashlrai/runbook-control-plane` | Apache-2.0 source + CLI demos |
| Local MCP (`npx` / clone) | Real ledger + control-plane tools on the operator machine |
| `apps/signer` | **Never** same origin as the main app (isolated device-local signer) |

### Why this domain

- DNS already points at Vercel (`cname.vercel-dns-016.com`); previously returned `DEPLOYMENT_NOT_FOUND`.
- Matches Ashlr product subdomain pattern (`drake.ashlr.ai`, etc.).
- Web surface is browser-local (localStorage / Workers) — no brokerage credentials, no live capital API.
- Public hosting multiplies OSS discovery without changing the Capital Constitution boundary.

### What hosting is *not*

- Not a brokerage integration or order gateway
- Not live capital, credentials, or composite safety certification
- Not the MCP disk store (`~/.runbook`) — browser sessions stay in `localStorage`
- Not the Creator Proof signer origin

## Vercel project settings

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework | Next.js |
| Install / Build | See `apps/web/vercel.json` |
| Include files outside root | **Required** (workspace packages) |
| Production domain | `runbook.ashlr.ai` |
| Node | 22.x |

```bash
# From monorepo root (after vercel login + project link)
# Git author email must match a Vercel team member (else BLOCKED).
vercel --prod --yes

# Custom domain (requires ashlr.ai ownership on the same Vercel team)
vercel domains add runbook.ashlr.ai
vercel alias set <deployment-url> runbook.ashlr.ai
```

**Current production alias:** `https://runbook-pi.vercel.app`  
**Intended custom domain:** `https://runbook.ashlr.ai` (DNS CNAME already points at Vercel; attach domain from the team that owns `ashlr.ai`)

Or one-shot scripts:

```bash
pnpm deploy:web          # production
pnpm deploy:web:preview  # preview
```

## Honesty rails on the hosted surface

Every public page should keep visible:

- NO LIVE CAPITAL
- NO BROKER CREDENTIALS  
- NO COMPOSITE SAFETY SCORE
- HOSTED LAB · BROWSER-LOCAL STATE (when not localhost)

Canonical metadata uses `https://runbook.ashlr.ai`.
