import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  PUBLIC_AUTH_METADATA_PROFILE,
  PUBLIC_AUTH_METADATA_SOURCE_IDS,
  PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
  buildPublicAuthMetadataBundle,
  buildPublicAuthMetadataObservation,
} from "../dist/index.js";

export const SOURCE_FILENAMES = Object.freeze({
  "robinhood-banking-authorization-server": "banking-authorization-server",
  "robinhood-banking-protected-resource": "banking-protected-resource",
  "robinhood-trading-authorization-server": "trading-authorization-server",
  "robinhood-trading-protected-resource": "trading-protected-resource",
});

const utf8 = (value) => new TextEncoder().encode(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function exactCaptureSet(captures) {
  if (!Array.isArray(captures) || captures.length !== PUBLIC_AUTH_METADATA_SOURCE_IDS.length) {
    throw new Error("artifact-set.members-invalid");
  }
  const bySource = new Map();
  for (const capture of captures) {
    if (capture === null || typeof capture !== "object" ||
      !PUBLIC_AUTH_METADATA_SOURCE_IDS.includes(capture.sourceId) ||
      bySource.has(capture.sourceId)) {
      throw new Error("artifact-set.members-invalid");
    }
    bySource.set(capture.sourceId, capture);
  }
  return PUBLIC_AUTH_METADATA_SOURCE_IDS.map((sourceId) => {
    const capture = bySource.get(sourceId);
    if (capture === undefined) throw new Error("artifact-set.members-invalid");
    return capture;
  });
}

export function createArtifactSet(capturesInput, retrievedAtDeclared) {
  const captures = exactCaptureSet(capturesInput);
  const files = new Map();
  const observations = [];
  const sources = [];

  for (const capture of captures) {
    const stem = SOURCE_FILENAMES[capture.sourceId];
    const rawBodyBytes = new Uint8Array(capture.rawBodyBytes);
    const built = buildPublicAuthMetadataObservation({
      http: capture.http,
      rawBodyBytes,
      retrievedAtDeclared,
      sourceId: capture.sourceId,
    });
    const rawFilename = `${stem}.raw.json`;
    const projectionFilename = `${stem}.projection.jcs`;
    const observationFilename = `${stem}.observation.jcs`;
    files.set(rawFilename, rawBodyBytes);
    files.set(projectionFilename, built.projectionBytes);
    files.set(observationFilename, built.observationBytes);
    observations.push(built.observationBytes);
    sources.push({
      observation: {
        byteLength: built.observationBytes.byteLength,
        filename: observationFilename,
        sha256: sha256(built.observationBytes),
      },
      projection: {
        byteLength: built.projectionBytes.byteLength,
        filename: projectionFilename,
        sha256: sha256(built.projectionBytes),
      },
      rawBody: {
        byteLength: rawBodyBytes.byteLength,
        filename: rawFilename,
        sha256: sha256(rawBodyBytes),
      },
      sourceId: capture.sourceId,
    });
  }

  const builtBundle = buildPublicAuthMetadataBundle(observations);
  files.set("bundle.jcs", builtBundle.bundleBytes);
  const manifest = {
    bundle: {
      byteLength: builtBundle.bundleBytes.byteLength,
      filename: "bundle.jcs",
      sha256: sha256(builtBundle.bundleBytes),
    },
    profileVersion: PUBLIC_AUTH_METADATA_PROFILE,
    retrievedAtDeclared,
    schemaVersion: "runbook.public-auth-metadata-fixture-manifest.v1",
    sourceSeriesId: PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID,
    sources,
  };
  const canonicalManifestBytes = utf8(canonicalize(manifest));
  files.set("manifest.jcs", canonicalManifestBytes);

  const sums = [...files.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([filename, bytes]) => `${sha256(bytes)}  ${filename}\n`)
    .join("");
  files.set("SHA256SUMS", utf8(sums));
  return Object.freeze({ bundle: builtBundle.bundle, files });
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("artifact-set.manifest-invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new Error("artifact-set.manifest-invalid");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function writeArtifactSet(outputDirectory, artifactSet) {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [filename, bytes] of artifactSet.files) {
    writeFileSync(join(outputDirectory, filename), bytes, { flag: "wx" });
  }
}

export function artifactSetSha256(artifactSet) {
  return sha256(artifactSet.files.get("manifest.jcs"));
}
