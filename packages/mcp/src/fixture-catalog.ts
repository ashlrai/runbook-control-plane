/**
 * Closed fixture catalog for offline MCP demos.
 * Each ID resolves relative to the monorepo root from this package location
 * and is SHA-256 pinned; load fails closed if bytes drift.
 */

import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_OWNED_FILE_BYTES,
  MAX_CAPSULE_OWNED_BYTES,
  MAX_POLICY_OWNED_BYTES,
  MAX_PUBLIC_AUTH_OWNED_BYTES,
  ownAbsoluteFile,
  type OwnedFile,
} from "./owned-file.js";

export class FixtureCatalogError extends Error {
  readonly name = "FixtureCatalogError";

  constructor(readonly code: "fixture.unknown" | "fixture.hash-mismatch") {
    super(code);
  }
}

export type FixtureKind =
  | "capability-snapshot"
  | "admission-policy"
  | "capsule"
  | "public-auth-raw";

export type PublicAuthSourceId =
  | "robinhood-banking-authorization-server"
  | "robinhood-banking-protected-resource"
  | "robinhood-trading-authorization-server"
  | "robinhood-trading-protected-resource";

export type FixtureEntry = Readonly<{
  id: string;
  kind: FixtureKind;
  /** Path relative to monorepo root. */
  relativePath: string;
  sha256: string;
  maxBytes: number;
  /** Short operator-facing purpose for discovery catalogs. */
  purpose: string;
  /** Present for public-auth raw body fixtures. */
  publicAuthSourceId?: PublicAuthSourceId;
}>;

/** packages/mcp whether resolved from src/ or dist/. */
const MCP_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Monorepo root: packages/mcp → ../.. */
export const MONOREPO_ROOT = resolve(MCP_PACKAGE_ROOT, "../..");

const FIXTURES: readonly FixtureEntry[] = [
  {
    id: "registry.trading-45",
    kind: "capability-snapshot",
    relativePath: "packages/financial-capability-registry/fixtures/robinhood/trading-45-snapshot.jcs",
    sha256: "2a414ea97e02d0732cbf03a3809486b5141977ca07311fe792787c4418b2b408",
    maxBytes: DEFAULT_MAX_OWNED_FILE_BYTES,
    purpose: "Baseline Robinhood Trading MCP capability snapshot (45 tools) for drift demos.",
  },
  {
    id: "registry.trading-50",
    kind: "capability-snapshot",
    relativePath: "packages/financial-capability-registry/fixtures/robinhood/trading-50-snapshot.jcs",
    sha256: "762eeb025972717453c863f4cb57d109c80950433796e3afe9c34684141b608e",
    maxBytes: DEFAULT_MAX_OWNED_FILE_BYTES,
    purpose: "Candidate Trading MCP capability snapshot (50 tools) after published inventory growth.",
  },
  {
    id: "registry.trading-50-risk-correction",
    kind: "capability-snapshot",
    relativePath:
      "packages/financial-capability-registry/fixtures/robinhood/trading-50-risk-correction-snapshot.jcs",
    sha256: "ae158cf5d9f26b4c005f931c291831e4ab42658d69c96b01b64ca6a4be6bc346",
    maxBytes: DEFAULT_MAX_OWNED_FILE_BYTES,
    purpose: "Risk-correction candidate expected to reject under public-docs review policy.",
  },
  {
    id: "registry.banking",
    kind: "capability-snapshot",
    relativePath: "packages/financial-capability-registry/fixtures/robinhood/banking-snapshot.jcs",
    sha256: "4ad91fdcdade8e91aba2b5a7c44afa5ec61fc786521280240c58db1ed81d4b86",
    maxBytes: DEFAULT_MAX_OWNED_FILE_BYTES,
    purpose: "Robinhood Banking MCP capability snapshot for offline claim analysis.",
  },
  {
    id: "registry.policy.public-docs-review-required",
    kind: "admission-policy",
    relativePath:
      "packages/financial-capability-registry/fixtures/robinhood/public-docs-review-required-policy.jcs",
    sha256: "b4863e7bb22b9b379b3eaa44e39e13bd3e9c458734e9efcb8c613b3a8aaa3435",
    maxBytes: MAX_POLICY_OWNED_BYTES,
    purpose: "Admission policy requiring public-docs review; used for risk-correction reject demo.",
  },
  {
    id: "capsule.minimal-root",
    kind: "capsule",
    relativePath: "conformance/fixtures/minimal-synthetic-root.runbook",
    sha256: "4a11da34f4f8ed3dcea6167f93e729dbbde7d69246e665d0b8616656eda74191",
    maxBytes: MAX_CAPSULE_OWNED_BYTES,
    purpose: "Valid minimal synthetic proof capsule (self-asserted author key integrity).",
  },
  {
    id: "capsule.minimal-tampered",
    kind: "capsule",
    relativePath: "conformance/fixtures/minimal-synthetic-root-payload-tampered.runbook",
    sha256: "eed412e23ce2a4c51c3e216a451585b8a82d9ad761e7dbfbe885f515b3a465e4",
    maxBytes: MAX_CAPSULE_OWNED_BYTES,
    purpose: "Payload-tampered capsule expected to verify as valid:false.",
  },
  {
    id: "public-auth.banking-authorization-server",
    kind: "public-auth-raw",
    relativePath:
      "packages/public-auth-metadata/fixtures/robinhood/v1/banking-authorization-server.raw.json",
    sha256: "c0c6126b998947c06d37903dde6cb196a28230f57940b2d1e685505572910e4d",
    maxBytes: MAX_PUBLIC_AUTH_OWNED_BYTES,
    purpose: "Frozen banking authorization-server OAuth discovery body for offline inspect.",
    publicAuthSourceId: "robinhood-banking-authorization-server",
  },
  {
    id: "public-auth.banking-protected-resource",
    kind: "public-auth-raw",
    relativePath:
      "packages/public-auth-metadata/fixtures/robinhood/v1/banking-protected-resource.raw.json",
    sha256: "b0b44e0340a55063571bbd24b510e0a9b4439abcef29865f23331cc53230481f",
    maxBytes: MAX_PUBLIC_AUTH_OWNED_BYTES,
    purpose: "Frozen banking protected-resource OAuth discovery body for offline inspect.",
    publicAuthSourceId: "robinhood-banking-protected-resource",
  },
  {
    id: "public-auth.trading-authorization-server",
    kind: "public-auth-raw",
    relativePath:
      "packages/public-auth-metadata/fixtures/robinhood/v1/trading-authorization-server.raw.json",
    sha256: "f2ea2b1a4b4db974478d570189d909f6bbf251027fc008f348ef71197b29a287",
    maxBytes: MAX_PUBLIC_AUTH_OWNED_BYTES,
    purpose: "Frozen trading authorization-server OAuth discovery body for offline inspect.",
    publicAuthSourceId: "robinhood-trading-authorization-server",
  },
  {
    id: "public-auth.trading-protected-resource",
    kind: "public-auth-raw",
    relativePath:
      "packages/public-auth-metadata/fixtures/robinhood/v1/trading-protected-resource.raw.json",
    sha256: "59fb43b49ac2ca7a2df306874b61a44befd9ec20c696ccb8225005914fad9d96",
    maxBytes: MAX_PUBLIC_AUTH_OWNED_BYTES,
    purpose: "Frozen trading protected-resource OAuth discovery body for offline inspect.",
    publicAuthSourceId: "robinhood-trading-protected-resource",
  },
] as const;

const BY_ID = new Map(FIXTURES.map((entry) => [entry.id, entry]));

export function listFixtureIds(): readonly string[] {
  return FIXTURES.map((entry) => entry.id);
}

/** Closed catalog projection for MCP discovery (no absolute paths). */
export function listFixtureCatalogEntries(): ReadonlyArray<{
  id: string;
  kind: FixtureKind;
  sha256: string;
  purpose: string;
  relativePath: string;
  publicAuthSourceId?: PublicAuthSourceId;
}> {
  return FIXTURES.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    sha256: entry.sha256,
    purpose: entry.purpose,
    relativePath: entry.relativePath,
    ...(entry.publicAuthSourceId !== undefined
      ? { publicAuthSourceId: entry.publicAuthSourceId }
      : {}),
  }));
}

export function buildFixtureCatalogJson(): string {
  return JSON.stringify(
    {
      schemaVersion: "runbook.fixture-catalog.v1",
      fixtureCount: FIXTURES.length,
      fixtures: listFixtureCatalogEntries(),
      notes: [
        "IDs are closed; unknown fixtureId fails closed.",
        "SHA-256 pins refuse drifted bytes.",
        "Relative paths are monorepo-layout hints only; MCP tools load via fixtureId or absolute path.",
        "No network capture. No broker execution. Not live inventory.",
      ],
    },
    null,
    2,
  );
}

export function getFixtureEntry(fixtureId: string): FixtureEntry {
  const entry = BY_ID.get(fixtureId);
  if (!entry) throw new FixtureCatalogError("fixture.unknown");
  return entry;
}

export function resolveFixtureAbsolutePath(fixtureId: string): string {
  const entry = getFixtureEntry(fixtureId);
  return join(MONOREPO_ROOT, entry.relativePath);
}

export type LoadedFixture = OwnedFile & Readonly<{
  entry: FixtureEntry;
  absolutePath: string;
}>;

/** Load a closed fixture, verify pinned SHA-256, and return owned bytes. */
export async function loadFixture(fixtureId: string): Promise<LoadedFixture> {
  const entry = getFixtureEntry(fixtureId);
  const absolutePath = join(MONOREPO_ROOT, entry.relativePath);
  const owned = await ownAbsoluteFile(absolutePath, {
    maxBytes: entry.maxBytes,
    minBytes: 1,
  });
  if (owned.sha256 !== entry.sha256) {
    throw new FixtureCatalogError("fixture.hash-mismatch");
  }
  // Re-hash for defense in depth (owned.sha256 already matches pin).
  const recomputed = createHash("sha256").update(owned.bytes).digest("hex");
  if (recomputed !== entry.sha256) {
    throw new FixtureCatalogError("fixture.hash-mismatch");
  }
  return { ...owned, entry, absolutePath };
}

export function isKnownFixtureId(fixtureId: string): boolean {
  return BY_ID.has(fixtureId);
}
