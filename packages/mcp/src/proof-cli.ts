#!/usr/bin/env node

import { runCapsuleVerificationCommand } from "./capsule-command.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log([
      "Runbook Proof Capsule verifier",
      "",
      "Usage:",
      "  runbook-proof CAPSULE.runbook",
      "",
      "Offline only. Emits a deterministic JCS receipt and never extracts, renders, uploads, or executes a member.",
      "Exit 0: valid. Exit 1: parsed-invalid capsule. Exit 2: invocation, I/O, or resource rejection.",
    ].join("\n"));
    return;
  }
  try {
    const result = await runCapsuleVerificationCommand(args);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Capsule input could not be read.");
    process.exitCode = 2;
  }
}

void main();
