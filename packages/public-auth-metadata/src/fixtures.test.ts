/// <reference types="node" />

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeJcs } from "@runbook/financial-bench";
import { describe, expect, it } from "vitest";

import {
  parseExactPublicAuthMetadataBundleBytes,
  parseExactPublicAuthMetadataObservationBytes,
} from "./index.js";
import * as publicNodeApi from "./node.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/robinhood/v1/", import.meta.url));
const expectedDirectory = join(fixtureRoot, "expected");
const builder = fileURLToPath(new URL("../scripts/build-robinhood-fixtures.mjs", import.meta.url));
const captureCli = fileURLToPath(new URL("../scripts/capture-robinhood-candidate.mjs", import.meta.url));
const nodeSource = fileURLToPath(new URL("./node-internal.ts", import.meta.url));

const rawHashes = {
  "banking-authorization-server.raw.json": "c0c6126b998947c06d37903dde6cb196a28230f57940b2d1e685505572910e4d",
  "banking-protected-resource.raw.json": "b0b44e0340a55063571bbd24b510e0a9b4439abcef29865f23331cc53230481f",
  "trading-authorization-server.raw.json": "f2ea2b1a4b4db974478d570189d909f6bbf251027fc008f348ef71197b29a287",
  "trading-protected-resource.raw.json": "59fb43b49ac2ca7a2df306874b61a44befd9ec20c696ccb8225005914fad9d96",
} as const;

const projectionHashes = {
  "banking-authorization-server.projection.jcs": "8f194212654177ceef93d75f96555ecd2d0f1ff33b8cbaad32b12caa9f1d4a5d",
  "banking-protected-resource.projection.jcs": "893f33685e05774f1a9c5f7cade35412f69f6564e98db3be68fa905cb7f2e5d4",
  "trading-authorization-server.projection.jcs": "2b74f9b600e80492dfc8376be304c03793f963f81d5ee59a0ac5a02da948f6fc",
  "trading-protected-resource.projection.jcs": "e6d8e73cb425d8123a37f9b324e011fba6ef11771c8bcbaf0b5c1705cb0652e5",
} as const;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("public auth metadata fixture and manual-capture integration", () => {
  it("rebuilds the complete frozen artifact set twice with exact checked-in bytes", () => {
    const first = mkdtempSync(join(tmpdir(), "runbook-public-auth-first-"));
    const second = mkdtempSync(join(tmpdir(), "runbook-public-auth-second-"));
    rmSync(first, { recursive: true });
    rmSync(second, { recursive: true });
    try {
      execFileSync(process.execPath, [builder, first], { stdio: "pipe" });
      execFileSync(process.execPath, [builder, second], { stdio: "pipe" });
      const filenames = readdirSync(expectedDirectory).sort();
      expect(filenames).toHaveLength(15);
      expect(readdirSync(first).sort()).toEqual(filenames);
      expect(readdirSync(second).sort()).toEqual(filenames);
      for (const filename of filenames) {
        const expected = readFileSync(join(expectedDirectory, filename));
        expect(readFileSync(join(first, filename)), filename).toEqual(expected);
        expect(readFileSync(join(second, filename)), filename).toEqual(expected);
      }
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  it("retains raw LF bytes while projections and portable artifacts are exact no-newline JCS", () => {
    for (const [filename, expectedHash] of Object.entries(rawHashes)) {
      const source = readFileSync(join(fixtureRoot, filename));
      const generated = readFileSync(join(expectedDirectory, filename));
      expect(source.at(-1), filename).toBe(0x0a);
      expect(generated, filename).toEqual(source);
      expect(sha256(source), filename).toBe(expectedHash);
    }
    for (const [filename, expectedHash] of Object.entries(projectionHashes)) {
      const bytes = readFileSync(join(expectedDirectory, filename));
      expect(bytes.at(-1), filename).not.toBe(0x0a);
      expect(sha256(bytes), filename).toBe(expectedHash);
      const text = bytes.toString("utf8");
      expect(canonicalizeJcs(JSON.parse(text)), filename).toBe(text);
    }
    for (const filename of readdirSync(expectedDirectory).filter((name) => name.endsWith(".observation.jcs"))) {
      const bytes = new Uint8Array(readFileSync(join(expectedDirectory, filename)));
      expect(bytes.at(-1), filename).not.toBe(0x0a);
      expect(parseExactPublicAuthMetadataObservationBytes(bytes)).toBeDefined();
    }
    expect(parseExactPublicAuthMetadataBundleBytes(
      new Uint8Array(readFileSync(join(expectedDirectory, "bundle.jcs"))),
    )).toBeDefined();
    const manifestText = readFileSync(join(expectedDirectory, "manifest.jcs"), "utf8");
    expect(canonicalizeJcs(JSON.parse(manifestText))).toBe(manifestText);
  });

  it("pins sorted checksums for every generated member except the checksum file", () => {
    const lines = readFileSync(join(expectedDirectory, "SHA256SUMS"), "utf8")
      .trimEnd().split("\n");
    const filenames = lines.map((line) => line.slice(66));
    expect(filenames).toEqual([...filenames].sort());
    expect(filenames).toEqual(
      readdirSync(expectedDirectory).filter((name) => name !== "SHA256SUMS").sort(),
    );
    for (const line of lines) {
      const digest = line.slice(0, 64);
      const filename = line.slice(66);
      expect(line[64]).toBe(" ");
      expect(line[65]).toBe(" ");
      expect(sha256(readFileSync(join(expectedDirectory, filename))), filename).toBe(digest);
    }
  });

  it("refuses invalid or existing candidate destinations before any network operation", () => {
    const invalid = spawnSync(process.execPath, [captureCli], { encoding: "utf8" });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toBe("candidate.arguments-invalid\n");

    const existing = mkdtempSync(join(tmpdir(), "runbook-public-auth-existing-"));
    try {
      const refused = spawnSync(process.execPath, [
        captureCli,
        "--retrieved-at", "2026-07-22T09:04:27Z",
        "--output", existing,
      ], { encoding: "utf8" });
      expect(refused.status).toBe(1);
      expect(refused.stdout).toBe("");
      expect(refused.stderr).toBe("candidate.output-refused\n");
      expect(readdirSync(existing)).toEqual([]);

      const fixtureRefusal = spawnSync(process.execPath, [
        captureCli,
        "--retrieved-at", "2026-07-22T09:04:27Z",
        "--output", join(fixtureRoot, "candidate-must-not-exist"),
      ], { encoding: "utf8" });
      expect(fixtureRefusal.status).toBe(1);
      expect(fixtureRefusal.stderr).toBe("candidate.output-refused\n");
    } finally {
      rmSync(existing, { recursive: true, force: true });
    }
  });

  it("keeps all request authority in the four-entry source table", () => {
    expect(Object.keys(publicNodeApi).sort()).toEqual([
      "PublicAuthMetadataCaptureError",
      "capturePublicAuthMetadataQuartet",
      "capturePublicAuthMetadataSource",
    ]);
    const source = readFileSync(nodeSource, "utf8");
    expect((source.match(/hostname: "(?:agent|banking-agent)\.robinhood\.com"/g) ?? [])).toHaveLength(4);
    expect(source).not.toMatch(/authorization_endpoint|registration_endpoint|token_endpoint/);
    expect(source).not.toMatch(/process\.env|HTTP_PROXY|HTTPS_PROXY|fetch\s*\(/);
    expect(source).toContain("const SOURCE_TARGETS");
    expect(source).toContain("agent: false");
    expect(source).toContain("rejectUnauthorized: true");
  });
});
