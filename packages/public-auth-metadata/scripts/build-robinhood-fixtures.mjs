#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createArtifactSet, writeArtifactSet } from "./artifact-set.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(scriptDirectory, "../fixtures/robinhood/v1");

const arguments_ = process.argv.slice(2).filter((entry, index) => !(index === 0 && entry === "--"));
if (arguments_.length !== 1) {
  throw new Error("usage: build-robinhood-fixtures.mjs <new-output-directory>");
}
const outputDirectory = resolve(arguments_[0]);

const RETRIEVED_AT_DECLARED = "2026-07-22T09:04:27Z";
const sources = [
  {
    filename: "banking-authorization-server.raw.json",
    rawSha256: "c0c6126b998947c06d37903dde6cb196a28230f57940b2d1e685505572910e4d",
    sourceId: "robinhood-banking-authorization-server",
    vary: "Accept-Encoding",
  },
  {
    filename: "banking-protected-resource.raw.json",
    rawSha256: "b0b44e0340a55063571bbd24b510e0a9b4439abcef29865f23331cc53230481f",
    sourceId: "robinhood-banking-protected-resource",
    vary: "Accept-Encoding",
  },
  {
    filename: "trading-authorization-server.raw.json",
    rawSha256: "f2ea2b1a4b4db974478d570189d909f6bbf251027fc008f348ef71197b29a287",
    sourceId: "robinhood-trading-authorization-server",
    vary: null,
  },
  {
    filename: "trading-protected-resource.raw.json",
    rawSha256: "59fb43b49ac2ca7a2df306874b61a44befd9ec20c696ccb8225005914fad9d96",
    sourceId: "robinhood-trading-protected-resource",
    vary: null,
  },
];

const captures = sources.map((source) => {
  const rawBodyBytes = new Uint8Array(readFileSync(resolve(sourceDirectory, source.filename)));
  const actualRawSha256 = createHash("sha256").update(rawBodyBytes).digest("hex");
  if (actualRawSha256 !== source.rawSha256) {
    throw new Error(`${source.filename}: raw fixture hash mismatch`);
  }
  return {
    http: {
      cacheControl: null,
      contentEncoding: null,
      contentLength: rawBodyBytes.byteLength,
      contentType: "application/json",
      etag: null,
      lastModified: null,
      locationPresent: false,
      serverDate: null,
      setCookiePresent: false,
      status: 200,
      vary: source.vary,
    },
    rawBodyBytes,
    sourceId: source.sourceId,
  };
});

writeArtifactSet(
  outputDirectory,
  createArtifactSet(captures, RETRIEVED_AT_DECLARED),
);
