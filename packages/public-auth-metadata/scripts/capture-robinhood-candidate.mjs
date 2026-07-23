#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { PublicAuthMetadataError } from "../dist/index.js";
import {
  PublicAuthMetadataCaptureError,
  capturePublicAuthMetadataQuartet,
} from "../dist/node.js";
import {
  artifactSetSha256,
  createArtifactSet,
  writeArtifactSet,
} from "./artifact-set.mjs";

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--retrieved-at" || argv[2] !== "--output") {
    throw new PublicAuthMetadataError("candidate.arguments-invalid");
  }
  const retrievedAtDeclared = argv[1];
  const milliseconds = Date.parse(retrievedAtDeclared);
  const normalized = typeof retrievedAtDeclared === "string" && retrievedAtDeclared.includes(".")
    ? retrievedAtDeclared
    : String(retrievedAtDeclared).replace("Z", ".000Z");
  if (typeof retrievedAtDeclared !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(retrievedAtDeclared) ||
    !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new PublicAuthMetadataError("candidate.retrieved-at-invalid");
  }
  const requestedOutputDirectory = resolve(argv[3]);
  const requestedParent = dirname(requestedOutputDirectory);
  if (!existsSync(requestedParent) || lstatSync(requestedParent).isSymbolicLink()) {
    throw new PublicAuthMetadataError("candidate.output-refused");
  }
  const outputDirectory = join(
    realpathSync(requestedParent),
    basename(requestedOutputDirectory),
  );
  const fixtureRoot = realpathSync(resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../fixtures/robinhood/v1",
  ));
  if (outputDirectory === fixtureRoot || outputDirectory.startsWith(`${fixtureRoot}${sep}`) ||
    existsSync(outputDirectory)) {
    throw new PublicAuthMetadataError("candidate.output-refused");
  }
  return { outputDirectory, retrievedAtDeclared };
}

async function main() {
  const arguments_ = process.argv.slice(2).filter((entry, index) => !(index === 0 && entry === "--"));
  const { outputDirectory, retrievedAtDeclared } = parseArguments(arguments_);
  let outputCreated = false;
  try {
    const captures = await capturePublicAuthMetadataQuartet();
    const artifactSet = createArtifactSet(captures, retrievedAtDeclared);
    mkdirSync(outputDirectory, { recursive: false });
    outputCreated = true;
    writeArtifactSet(outputDirectory, artifactSet);
    process.stdout.write(`candidate.manifest-sha256=${artifactSetSha256(artifactSet)}\n`);
  } catch (error) {
    if (outputCreated) rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  const code = error instanceof PublicAuthMetadataCaptureError ||
    error instanceof PublicAuthMetadataError
    ? error.code
    : "candidate.failed";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
