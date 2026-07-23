# Public release checklist — Runbook open-source

Operational runbook for publishing a **clean public export** of the Runbook
control-plane surface. This private monorepo stays private. The public
repository is a **separate** tree produced by `pnpm export:public`.

| | |
| --- | --- |
| **Private monorepo** | This checkout (do **not** flip public) |
| **Intended public repo** | `ashlrai/runbook-control-plane` |
| **License** | [Apache-2.0](../LICENSE) + [NOTICE](../NOTICE) |
| **Plan / gates** | [OPEN_SOURCE.md](../OPEN_SOURCE.md), [RELEASE.md](../RELEASE.md) |
| **Export tool** | `pnpm export:public` → [`scripts/public-export.mjs`](../scripts/public-export.mjs) |
| **Allowlist** | [`scripts/public-export-allowlist.json`](../scripts/public-export-allowlist.json) |
| **Public README draft** | [`README.public.md`](../README.public.md) → becomes `README.md` in export |
| **Claim evidence** | [`docs/PUBLIC_CLAIM_MATRIX.md`](./PUBLIC_CLAIM_MATRIX.md) |

**Do not** change this private repo’s visibility to public. Publish only the
export tree under Apache-2.0 with clean history.

---

## 1. Pre-flight

Complete every item in this private checkout before creating the public repo.

### 1.1 License and NOTICE

- [ ] Root [`LICENSE`](../LICENSE) is Apache License, Version 2.0 (full text).
- [ ] Root [`NOTICE`](../NOTICE) is present and includes:
  - Copyright line (Ashlr AI / year)
  - Robinhood non-affiliation disclaimer
  - Product boundary (not investment advice, not a broker, not live capital)
  - Pointer that private access ≠ redistribution license until public export
- [ ] Root `package.json` has `"license": "Apache-2.0"`.
- [ ] Workspace packages intended for public export also declare `"license": "Apache-2.0"`.
- [ ] Spot-check: no package under `packages/` / `apps/` that will be exported still says `UNLICENSED` or omits license.

```bash
# From private monorepo root
head -n 5 LICENSE
cat NOTICE
node -e "console.log(require('./package.json').license)"
rg -n '"license"' package.json packages/*/package.json apps/*/package.json
```

### 1.2 Open-source plan and public-source gate

- [ ] Read [`OPEN_SOURCE.md`](../OPEN_SOURCE.md) — open-core intent, what becomes public, what stays private.
- [ ] Read public-source gate in [`RELEASE.md`](../RELEASE.md) — still applies; scaffolding does **not** waive it.
- [ ] Confirm this private monorepo will **remain private** after public export.

### 1.3 Export dry-run

Produce a local OSS-safe tree **without** changing GitHub visibility.

```bash
# From private monorepo root
# Default dest: sibling ../runbook-public-export (must be outside this repo)
pnpm export:public

# Or explicit destination:
node scripts/public-export.mjs --dest /tmp/runbook-public-export
```

- [ ] Command exits 0.
- [ ] Destination is **outside** the source repo (script enforces this).
- [ ] `EXPORT_MANIFEST.json` exists at dest root with `fileCount`, `copiedPaths`, `exportedAt`.
- [ ] Dest root has `README.md` (renamed from `README.public.md`), not private `README.md`.
- [ ] Dest has `LICENSE`, `NOTICE`, `OPEN_SOURCE.md`, `RELEASE.md`, `SECURITY.md`, `CONTRIBUTING.md`.
- [ ] Dest has `docs/PUBLIC_CLAIM_MATRIX.md`.
- [ ] Dest does **not** contain strategy / personal / launch files (see §7).

```bash
DEST="../runbook-public-export"   # or your --dest path

# Must exist
test -f "$DEST/LICENSE" && test -f "$DEST/NOTICE" && test -f "$DEST/README.md"
test -f "$DEST/EXPORT_MANIFEST.json"
test -f "$DEST/docs/PUBLIC_CLAIM_MATRIX.md"

# Must NOT exist in export
for f in \
  commercial_strategy.md notes.md task_plan.md \
  capital_constitution_strategy.md product_moat_strategy.md \
  launch_playbook.md venture_blueprint.md \
  creator_proof_release_funnel.md mason_profile_launch_packet.md \
  social_growth_research.md proof_capsule_launch.md \
  robinhood_frontier_update_2026-07-22.md \
  robinhood_release_frontier_2026-07-21.md \
  financial_capability_registry_threat_profile.md \
  lineage_atlas_research_protocol.md
do
  if [ -e "$DEST/$f" ]; then echo "FAIL: leaked $f"; else echo "ok absent: $f"; fi
done

# No node_modules / dist / .env* / .git should be copied
find "$DEST" \( -name node_modules -o -name dist -o -name .next -o -name .git -o -name '.env*' \) 2>/dev/null | head
```

### 1.4 Elite smoke green

Match the public story CI in [`.github/workflows/elite-smoke.yml`](../.github/workflows/elite-smoke.yml).

```bash
# From private monorepo root (Node 22 + pnpm from packageManager)
corepack enable
pnpm install --frozen-lockfile

pnpm --filter @runbook/engine build
pnpm --filter @runbook/shadow-lab test
pnpm --filter @runbook/session test
pnpm --filter @runbook/mcp test
pnpm demo:elite
pnpm test:elite-journey
```

Optional stronger pre-publish smoke:

```bash
pnpm smoke:all-elite
pnpm setup:elite && pnpm demo:elite
(cd conformance && shasum -a 256 -c SHA256SUMS)
```

- [ ] Elite smoke steps above all pass in this checkout.
- [ ] Prefer also verifying **inside the export tree** after a fresh install:

```bash
DEST="../runbook-public-export"
cd "$DEST"
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @runbook/engine build
pnpm --filter @runbook/shadow-lab test
pnpm --filter @runbook/session test
pnpm --filter @runbook/mcp test
pnpm demo:elite
pnpm test:elite-journey
```

### 1.5 Claim matrix

- [ ] Review [`docs/PUBLIC_CLAIM_MATRIX.md`](./PUBLIC_CLAIM_MATRIX.md) against current code.
- [ ] Align stale counts (MCP tools / version) with `packages/mcp/src/surface.ts` before publish.
- [ ] Confirm public README claims in `README.public.md` do not exceed the matrix.
- [ ] Quick re-verify from matrix:

```bash
pnpm --filter @runbook/mcp test
pnpm demo:elite
pnpm demo:frontier
(cd conformance && shasum -a 256 -c SHA256SUMS)
```

---

## 2. Human gates still required

These are **not** fully automatable. A human owner must explicitly approve.

### 2.1 Trademark / domain — name “Runbook”

- [ ] Trademark clearance for product name **Runbook** in intended jurisdictions / classes.
- [ ] Domain / social handle availability and ownership (e.g. product site, npm scope `@runbook` if publishing packages later).
- [ ] Confirm Ashlr AI is the correct copyright / NOTICE party for public distribution.
- [ ] Confirm Robinhood non-affiliation language in `NOTICE` and public README is accurate and sufficient.
- [ ] No implied endorsement, partnership, or “official Robinhood” framing in public copy.

### 2.2 Confirm no secrets in export

- [ ] Human review of export tree for credentials, tokens, private keys, account numbers, customer data.
- [ ] No committed `.env`, `.env.*`, key material, cookies, or API tokens.
- [ ] No personal account baselines or live-broker session artifacts.
- [ ] No customer / design-partner identifying materials.

```bash
DEST="../runbook-public-export"

# Heuristic sweeps — human judgment still required
rg -n -i \
  'api[_-]?key|secret|password|private[_-]?key|BEGIN (RSA |OPENSSH |EC )?PRIVATE|sk_live|ghp_|github_pat_|aws_secret|authorization:\s*bearer' \
  "$DEST" --glob '!**/*.map' || true

find "$DEST" \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.p12' -o -name 'id_rsa*' \) 2>/dev/null
```

### 2.3 Confirm strategy / commercial / personal files absent

- [ ] Export has **no** commercial strategy, pricing, outreach, customer, partnership, or launch packets.
- [ ] Export has **no** personal notes, task plans, or internal frontier trackers (see §7 full list).
- [ ] Export Git history (when initialized) does **not** contain those files in past commits either — first commit must be export tree only (see §5).
- [ ] Public-source gate from [`RELEASE.md`](../RELEASE.md) is explicitly signed off: history split / clean export chosen; trademark/domain review done; Apache-2.0 + NOTICE accepted for distribution.

### 2.4 Other product / permission gates (if any public claim exceeds research prototype)

From [`RELEASE.md`](../RELEASE.md) — only if marketing will imply more than the current research surface:

- [ ] Engineering / product / origin-verifier / permission gates reviewed for anything you will claim on day one.
- [ ] No commercial Robinhood API/MCP adapter or Social automation without written permission.
- [ ] Claims remain scenario-specific; no safety certification, suitability, or performance guarantees.

---

## 3. Export steps (exact commands)

Run from the **private** monorepo root.

```bash
cd "/path/to/HOOD project"   # private monorepo

# 1) Pre-flight elite smoke (private tree)
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @runbook/engine build
pnpm --filter @runbook/shadow-lab test
pnpm --filter @runbook/session test
pnpm --filter @runbook/mcp test
pnpm demo:elite
pnpm test:elite-journey

# 2) Produce public export (default sibling directory)
pnpm export:public
# → writes ../runbook-public-export
# equivalent:
# node scripts/public-export.mjs
# node scripts/public-export.mjs --dest /tmp/runbook-public-export

# 3) Inspect manifest
cat ../runbook-public-export/EXPORT_MANIFEST.json | head -n 40

# 4) Human secret + strategy leak checks (see §2)
DEST="$(cd ../runbook-public-export && pwd)"
ls -la "$DEST"
test -f "$DEST/LICENSE" && test -f "$DEST/NOTICE" && test -f "$DEST/README.md"

# 5) Optional: install + elite smoke inside export only
cd "$DEST"
corepack enable
pnpm install --frozen-lockfile
pnpm demo:elite
```

Notes:

- Destination **must not** be inside the private repo (enforced by the script).
- Allowlist drives include set; `excludeNamePatterns` drops `node_modules`, `dist`, `.next`, `.git`, `coverage`.
- Any basename `.env` / `.env.*` is never copied.
- `README.public.md` is renamed to `README.md` in the export.
- `EXPORT_MANIFEST.json` is generated at dest root for audit (include or exclude from the public commit by choice; prefer **commit it** so reviewers can see export provenance, or omit if you want a pure product tree — decide once and document).

---

## 4. New public repo creation

Create a **new** public repository. Do **not** use `gh repo edit --visibility public` on the private monorepo.

```bash
# Auth check
gh auth status

# Create empty public repo under ashlrai
gh repo create ashlrai/runbook-control-plane \
  --public \
  --license apache-2.0 \
  --description "Broker-neutral process, evidence, and control layer for financial agents (research prototype). Apache-2.0." \
  --clone=false

# Confirm
gh repo view ashlrai/runbook-control-plane --json name,visibility,url,description,licenseInfo
```

Suggested description (if the flag needs a shorter line):

```text
Broker-neutral process/evidence/control layer for financial agents. Research prototype. Apache-2.0. Not affiliated with Robinhood.
```

If `--license apache-2.0` creates a GitHub-generated LICENSE commit you do not want, either:

- create with `--public` only and rely on the export’s `LICENSE` file, or
- replace history with a single export commit (§5) so the tree is export-only.

Preferred: empty repo, then push **one** export commit that already contains this monorepo’s `LICENSE` and `NOTICE`.

```bash
# Alternative: no GitHub license template (export brings LICENSE + NOTICE)
gh repo create ashlrai/runbook-control-plane \
  --public \
  --description "Broker-neutral process, evidence, and control layer for financial agents (research prototype). Apache-2.0." \
  --clone=false
```

---

## 5. First public commit content (export tree only)

Initialize Git **in the export directory**, not in the private monorepo. History must not include private files.

```bash
DEST="$(cd /path/to/runbook-public-export && pwd)"   # output of pnpm export:public
cd "$DEST"

# Clean slate
rm -rf .git
git init -b main

# Optional: drop export audit file from the public tree if you decided not to ship it
# rm -f EXPORT_MANIFEST.json

git add -A
git status   # REVIEW carefully — must look like OSS core only

git commit -m "$(cat <<'EOF'
Initial public release of Runbook control-plane core

Apache-2.0 clean export from private monorepo via pnpm export:public.
Broker-neutral process/evidence/control research prototype.
Not affiliated with Robinhood Markets, Inc.
EOF
)"

# Point at the new public remote and push
git remote add origin git@github.com:ashlrai/runbook-control-plane.git
# or: git remote add origin https://github.com/ashlrai/runbook-control-plane.git

git push -u origin main
```

Hard rules for this commit:

- [ ] **Only** files from the export tree.
- [ ] No private monorepo `.git` history rewritten or force-pushed into public.
- [ ] No `commercial_strategy.md`, `notes.md`, `task_plan.md`, frontiers, launch packets, etc.
- [ ] `LICENSE` + `NOTICE` present at root.
- [ ] Root `README.md` is the public draft (from `README.public.md`), not the private README.
- [ ] First push is to `ashlrai/runbook-control-plane` `main`.

Verify remote contents:

```bash
gh api repos/ashlrai/runbook-control-plane/contents/ | head
gh api repos/ashlrai/runbook-control-plane/contents/commercial_strategy.md 2>&1 | head  # expect 404
gh api repos/ashlrai/runbook-control-plane/contents/LICENSE --jq .name
gh api repos/ashlrai/runbook-control-plane/contents/NOTICE --jq .name
```

---

## 6. Post-publish

### 6.1 Topics and about box

```bash
gh repo edit ashlrai/runbook-control-plane \
  --description "Broker-neutral process, evidence, and control layer for financial agents (research prototype). Apache-2.0. Not affiliated with Robinhood." \
  --homepage "https://github.com/ashlrai/runbook-control-plane" \
  --add-topic runbook \
  --add-topic mcp \
  --add-topic agents \
  --add-topic apache-2.0 \
  --add-topic financial-agents \
  --add-topic evidence \
  --add-topic process-control \
  --add-topic typescript
```

- [ ] About description set; homepage set if a product URL exists later.
- [ ] Topics applied (adjust list as needed).

### 6.2 Website / clone path (when ready)

- [ ] If a marketing site exists, link to the public repo and Apache-2.0 license.
- [ ] Document clone + elite demo from [`OPEN_SOURCE.md`](../OPEN_SOURCE.md):

```bash
git clone https://github.com/ashlrai/runbook-control-plane.git
cd runbook-control-plane
corepack enable
pnpm install
pnpm setup:elite
pnpm demo:elite
```

### 6.3 SECURITY

- [ ] Public tree includes [`SECURITY.md`](../SECURITY.md) (allowlisted).
- [ ] Enable GitHub private vulnerability reporting on the public repo:

```bash
# UI: Settings → Code security → Private vulnerability reporting
# Or API (org/repo permissions required):
gh api -X PATCH repos/ashlrai/runbook-control-plane \
  -f security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}' \
  2>/dev/null || true
```

- [ ] Confirm reporting instructions in `SECURITY.md` match how the public repo is configured (advisories vs email).

### 6.4 Dependabot / CI

Export includes [`.github/dependabot.yml`](../.github/dependabot.yml) and workflows when allowlisted `.github` is copied.

- [ ] Confirm Dependabot is active (npm weekly + github-actions monthly per config).
- [ ] Confirm **Elite smoke** workflow runs on `main` push/PR (no secrets, no Docker, no broker).
- [ ] Confirm full monorepo CI behavior is acceptable on the reduced public tree (or slim workflows if full CI assumes private-only paths).
- [ ] Watch first Actions run; fix export allowlist gaps only via private monorepo → re-export → PR/commit to public.

```bash
gh workflow list -R ashlrai/runbook-control-plane
gh run list -R ashlrai/runbook-control-plane --limit 5
```

### 6.5 Stale doc / claim hygiene

- [ ] Align MCP tool counts / versions with `packages/mcp/src/surface.ts` (see claim matrix watchlist).
- [ ] Public README non-claims match matrix (no composite safety score, no live capital, no Robinhood affiliation).

---

## 7. What stays private

**Never** publish the private monorepo as-is. Keep these (and similar) out of the public tree **and** out of public Git history.

### 7.1 Commercial / strategy / launch (current private root examples)

| Path | Why private |
| --- | --- |
| `commercial_strategy.md` | Commercial strategy, pricing, GTM |
| `product_moat_strategy.md` | Moat / competitive strategy |
| `capital_constitution_strategy.md` | Internal strategy narrative |
| `venture_blueprint.md` | Venture / fundraising framing |
| `launch_playbook.md` | Launch operations |
| `proof_capsule_launch.md` | Launch packet |
| `creator_proof_release_funnel.md` | Funnel / GTM |
| `mason_profile_launch_packet.md` | Personal / founder launch packet |
| `social_growth_research.md` | Growth / outreach research |
| `notes.md` | Personal / working notes |
| `task_plan.md` | Internal task plan |
| `robinhood_frontier_update_2026-07-22.md` | Internal frontier tracker |
| `robinhood_release_frontier_2026-07-21.md` | Internal frontier tracker |
| `financial_capability_registry_threat_profile.md` | Internal threat profiling (not in allowlist) |
| `lineage_atlas_research_protocol.md` | Internal research protocol |
| `provider_extension_profile.md` | Internal profile (not in allowlist) |
| `safety_card_profile.md` | Internal profile (not in allowlist) |
| `signer_exporter_architecture.md` | Internal unless explicitly allowlisted later |
| Private root `README.md` | Private monorepo README (export uses `README.public.md`) |

### 7.2 Categories that must remain private even if renamed

- Internal commercial strategy, pricing, outreach, customer, partnership, and launch materials
- Account history, personal baselines, credentials, tokens, private keys, customer data
- Live-broker or Robinhood-specific **commercial** adapters, Social automation, or materials needing written provider permission
- Hosted product code, billing, multi-tenant ops, unpublished buyer packets
- Anything not on [`scripts/public-export-allowlist.json`](../scripts/public-export-allowlist.json)

### 7.3 Source of truth for the public include set

Only paths listed under `include` in the allowlist are copied. When adding public surface later:

1. Update allowlist in the private monorepo.
2. Re-run `pnpm export:public`.
3. Diff export vs last public commit.
4. Push to **public** repo only after §1–§2 gates.

---

## 8. Rollback if wrong

If the public repo is wrong, incomplete, or leaked private material:

### 8.1 Immediately make the repository private

```bash
gh repo edit ashlrai/runbook-control-plane --visibility private
# Confirm
gh repo view ashlrai/runbook-control-plane --json visibility
```

- [ ] Repo is private.
- [ ] If secrets leaked: rotate all exposed credentials **first**, then clean history.
- [ ] Notify anyone who may have cloned during the public window.

### 8.2 Delete if empty / unused / unrecoverably contaminated

Only if there are no irreplaceable public issues, stars you care about, or third-party forks you must coordinate with:

```bash
# Destructive — requires confirmation; only if the public repo should not exist
gh repo delete ashlrai/runbook-control-plane --yes
```

If history contained private files:

- [ ] Do **not** rely on “delete file in a new commit” alone for secrets or strategy docs — treat history as compromised.
- [ ] Prefer: private visibility → delete repo → create a **new** empty public repo → re-export → single clean commit (§3–§5).
- [ ] If deletion is blocked (org policy), force-replace history only after legal/security review:

```bash
# Last resort on a repo you own: rebuild orphan main from a clean export
cd /path/to/fresh-clean-export
rm -rf .git && git init -b main
git add -A && git commit -m "Initial public release (history reset)"
git remote add origin git@github.com:ashlrai/runbook-control-plane.git
git push --force origin main   # coordinate; rewrites public history
```

### 8.3 Private monorepo

- [ ] Leave the private monorepo private.
- [ ] Do **not** “fix” a bad public release by flipping the private monorepo public.

---

## Quick reference

| Step | Command / doc |
| --- | --- |
| Plan | [`OPEN_SOURCE.md`](../OPEN_SOURCE.md) |
| Gates | [`RELEASE.md`](../RELEASE.md) |
| Claims | [`docs/PUBLIC_CLAIM_MATRIX.md`](./PUBLIC_CLAIM_MATRIX.md) |
| Export | `pnpm export:public` |
| Allowlist | [`scripts/public-export-allowlist.json`](../scripts/public-export-allowlist.json) |
| Elite smoke | `pnpm demo:elite` + `pnpm test:elite-journey` (+ package tests in workflow) |
| Public README source | [`README.public.md`](../README.public.md) |
| License / NOTICE | [`LICENSE`](../LICENSE), [`NOTICE`](../NOTICE) |
| Security policy | [`SECURITY.md`](../SECURITY.md) |
| Create public repo | `gh repo create ashlrai/runbook-control-plane --public ...` |
| Rollback | `gh repo edit ... --visibility private` then fix or `gh repo delete` |

---

## Sign-off (human)

| Gate | Owner | Date | OK |
| --- | --- | --- | --- |
| Pre-flight (§1) | | | ☐ |
| Trademark/domain (§2.1) | | | ☐ |
| No secrets in export (§2.2) | | | ☐ |
| Strategy files absent (§2.3) | | | ☐ |
| Export + first commit (§3–§5) | | | ☐ |
| Post-publish (§6) | | | ☐ |
| Private inventory still private (§7) | | | ☐ |
