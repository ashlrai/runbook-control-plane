#!/usr/bin/env node
/**
 * Multi-charter shadow tournament CLI.
 * Prints runbook.shadow-tournament.v1 JSON to stdout.
 *
 * Usage:
 *   node packages/shadow-lab/scripts/tournament.mjs [--generations N] [--mutants N] [--seed N]
 *
 * Requires a built package: pnpm --filter @runbook/shadow-lab build
 */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function parseIntOption(raw, name, fallback, min, max) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: node packages/shadow-lab/scripts/tournament.mjs [--generations N] [--mutants N] [--seed N]",
    );
    return;
  }

  let runShadowTournament;
  try {
    const entry = require.resolve("@runbook/shadow-lab", {
      paths: [PKG_ROOT, join(PKG_ROOT, "../mcp")],
    });
    // Prefer package dist via package exports.
    const mod = await import(pathToFileURL(entry).href);
    runShadowTournament = mod.runShadowTournament;
    if (typeof runShadowTournament !== "function") {
      // Fallback: direct dist path when workspace resolution returns src.
      const dist = await import(pathToFileURL(join(PKG_ROOT, "dist/index.js")).href);
      runShadowTournament = dist.runShadowTournament;
    }
  } catch {
    const dist = await import(pathToFileURL(join(PKG_ROOT, "dist/index.js")).href);
    runShadowTournament = dist.runShadowTournament;
  }

  if (typeof runShadowTournament !== "function") {
    console.error(
      JSON.stringify({
        ok: false,
        error: "runShadowTournament not found. Run: pnpm --filter @runbook/shadow-lab build",
      }),
    );
    process.exit(1);
  }

  const maxGenerations = parseIntOption(option(args, "--generations"), "--generations", 4, 1, 20);
  const mutantCount = parseIntOption(option(args, "--mutants"), "--mutants", 6, 0, 50);
  const seedRaw = option(args, "--seed");
  const seed = seedRaw === undefined ? 1 : Number(seedRaw);
  if (!Number.isInteger(seed)) {
    throw new Error("--seed must be an integer.");
  }

  const result = runShadowTournament({ maxGenerations, mutantCount, seed });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "tournament failed");
  process.exit(1);
});
