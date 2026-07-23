#!/usr/bin/env node

import { runRegistryCli } from "../src/node.js";

const USAGE = [
  "Runbook Financial Capability Registry",
  "",
  "Usage:",
  "  runbook-capabilities verify-snapshot SNAPSHOT.jcs",
  "  runbook-capabilities diff BASELINE.jcs CANDIDATE.jcs",
  "  runbook-capabilities admit BASELINE.jcs CANDIDATE.jcs POLICY.jcs --evaluated-at UTC [--review REVIEW.jcs --review-key REVIEWER.spki.der]",
  "",
  "Offline only. Performs no source fetch, authentication, signing, registry mutation, broker connection, or execution.",
  "Exit 0: valid verification/diff, admit, or no-change. Exit 1: invalid artifact, quarantine, or reject. Exit 2: invocation, I/O, or resource failure.",
].join("\n");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  const result = await runRegistryCli(args);
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

await main().catch(() => {
  process.stderr.write('{"error":"cli.invocation-or-io-failed"}');
  process.exitCode = 2;
});
