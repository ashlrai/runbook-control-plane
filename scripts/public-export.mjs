#!/usr/bin/env node
/**
 * Public source export — copies only OSS-safe allowlisted paths into a staging directory.
 *
 * Usage:
 *   node scripts/public-export.mjs
 *   node scripts/public-export.mjs --dest /tmp/runbook-public-export
 *   pnpm export:public
 *
 * Default destination: ../runbook-public-export (sibling of the repo root).
 * No dependencies beyond Node.js (fs, path, url).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ALLOWLIST_PATH = path.join(__dirname, "public-export-allowlist.json");
const DEFAULT_DEST = path.resolve(REPO_ROOT, "..", "runbook-public-export");

function parseArgs(argv) {
  let dest = DEFAULT_DEST;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dest" || arg === "-d") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("error: --dest requires a path argument");
        process.exit(1);
      }
      dest = path.resolve(next);
      i++;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/public-export.mjs [--dest <path>]

Copies OSS-safe allowlisted paths into a staging directory.
Default dest: ${DEFAULT_DEST}
Allowlist:    scripts/public-export-allowlist.json`);
      process.exit(0);
    }
    console.error(`error: unknown argument: ${arg}`);
    process.exit(1);
  }
  return { dest };
}

function loadAllowlist() {
  const raw = fs.readFileSync(ALLOWLIST_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.include)) {
    throw new Error("allowlist.include must be an array");
  }
  if (!Array.isArray(data.excludeNamePatterns)) {
    throw new Error("allowlist.excludeNamePatterns must be an array");
  }
  return data;
}

/**
 * Refuse exports whose destination resolves inside the source repository.
 */
function assertDestOutsideRepo(repoRoot, dest) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(dest);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target === root || target.startsWith(rootWithSep)) {
    console.error(
      `error: destination must not be inside the source repository\n` +
        `  source: ${root}\n` +
        `  dest:   ${target}`,
    );
    process.exit(1);
  }
}

/**
 * True when a path segment (basename) should be skipped during recursive copy.
 * Covers allowlist excludeNamePatterns and any .env* secret files.
 */
function shouldExcludeName(name, excludeNamePatterns) {
  if (excludeNamePatterns.includes(name)) return true;
  // Never export env files (any .env, .env.local, .env.production, etc.)
  if (name === ".env" || name.startsWith(".env.")) return true;
  return false;
}

/**
 * fs.cp filter: skip excluded basenames anywhere in the tree.
 * The filter receives absolute source paths on modern Node.
 */
function makeFilter(excludeNamePatterns) {
  return (src) => {
    const base = path.basename(src);
    return !shouldExcludeName(base, excludeNamePatterns);
  };
}

/**
 * Count files under dir (post-filter copy tree).
 */
function countFiles(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(full);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      count += 1;
    }
  }
  return count;
}

function main() {
  const { dest } = parseArgs(process.argv.slice(2));
  const allowlist = loadAllowlist();
  const { include, excludeNamePatterns } = allowlist;

  assertDestOutsideRepo(REPO_ROOT, dest);

  const filter = makeFilter(excludeNamePatterns);
  const copied = [];
  const skippedMissing = [];
  const skippedExcluded = [];

  // Fresh staging tree
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  // De-dupe includes while preserving order
  const seen = new Set();
  const uniqueIncludes = [];
  for (const rel of include) {
    const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    uniqueIncludes.push(norm);
  }

  for (const rel of uniqueIncludes) {
    const src = path.join(REPO_ROOT, rel);
    const base = path.basename(rel);

    if (shouldExcludeName(base, excludeNamePatterns)) {
      skippedExcluded.push(rel);
      continue;
    }

    if (!fs.existsSync(src)) {
      skippedMissing.push(rel);
      continue;
    }

    // If a parent directory was already copied, child paths are already present.
    // Still allow explicit re-copy of nested paths (idempotent overwrite).
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const stat = fs.lstatSync(src);
    if (stat.isDirectory()) {
      fs.cpSync(src, out, {
        recursive: true,
        filter,
        // dereference: false keeps symlinks (e.g. OPERATOR_GUIDE) as links when possible
        dereference: false,
      });
    } else {
      // Single file (or symlink to file)
      fs.cpSync(src, out, { dereference: false });
    }
    copied.push(rel);
  }

  // Public export should present README.public.md as the root README.md.
  const publicReadme = path.join(dest, "README.public.md");
  const destReadme = path.join(dest, "README.md");
  if (fs.existsSync(publicReadme)) {
    fs.renameSync(publicReadme, destReadme);
  }

  const fileCount = countFiles(dest);
  const exportedAt = new Date().toISOString();

  const manifest = {
    exportedAt,
    sourceRepo: REPO_ROOT,
    destination: dest,
    fileCount,
    includeCount: uniqueIncludes.length,
    copiedPaths: copied,
    skippedMissing,
    skippedExcluded,
    excludeNamePatterns,
  };

  const manifestPath = path.join(dest, "EXPORT_MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // Recount after writing manifest (manifest is part of the export)
  const finalFileCount = countFiles(dest);
  manifest.fileCount = finalFileCount;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log("Public source export complete");
  console.log(`  source:      ${REPO_ROOT}`);
  console.log(`  destination: ${dest}`);
  console.log(`  files:       ${finalFileCount}`);
  console.log(`  paths copied (${copied.length}):`);
  for (const p of copied) console.log(`    + ${p}`);
  if (skippedMissing.length) {
    console.log(`  skipped missing (${skippedMissing.length}):`);
    for (const p of skippedMissing) console.log(`    · ${p}`);
  }
  if (skippedExcluded.length) {
    console.log(`  skipped excluded (${skippedExcluded.length}):`);
    for (const p of skippedExcluded) console.log(`    · ${p}`);
  }
  console.log(`  manifest:    ${manifestPath}`);
  console.log(`  exportedAt:  ${exportedAt}`);
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error("error: public export failed");
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
}
