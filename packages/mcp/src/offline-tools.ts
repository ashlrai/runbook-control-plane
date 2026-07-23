/**
 * Offline read-only MCP tools wrapping pure package APIs.
 * No network capture, no dossier/sandbox runners, brokerEffect always false.
 */

import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildCapabilityDiff,
  capabilitySnapshotSha256,
  evaluateCapabilityAdmission,
  parseExactJcsCapabilitySnapshotBytes,
  RegistryValidationError,
  sha256Jcs,
} from "@runbook/financial-capability-registry";
import {
  parseRobinhoodPublicAuthMetadataBody,
  type PublicAuthMetadataSourceId,
} from "@runbook/public-auth-metadata";
import * as z from "zod/v4";
import { verifyCapsuleFile } from "./capsule-command.js";
import {
  FixtureCatalogError,
  loadFixture,
  MONOREPO_ROOT,
  type FixtureKind,
} from "./fixture-catalog.js";
import {
  MAX_CAPSULE_OWNED_BYTES,
  MAX_POLICY_OWNED_BYTES,
  MAX_PUBLIC_AUTH_OWNED_BYTES,
  DEFAULT_MAX_OWNED_FILE_BYTES,
  OwnedFileError,
  ownAbsoluteFile,
} from "./owned-file.js";
import { diagnoseShadowPilot, shadowPilotManifestSchema } from "./pilot-doctor.js";
import { buildPublicSnapshot } from "./public-snapshot.js";
import type { RunbookService } from "./service.js";

const DEFAULT_SHADOW_MANIFEST_PATH = fileURLToPath(
  new URL("../examples/shadow-pilot.manifest.json", import.meta.url),
);

const PUBLIC_AUTH_SOURCE_IDS = [
  "robinhood-banking-authorization-server",
  "robinhood-banking-protected-resource",
  "robinhood-trading-authorization-server",
  "robinhood-trading-protected-resource",
] as const satisfies readonly PublicAuthMetadataSourceId[];

const offlineAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export type OfflineToolsOptions = Readonly<{
  /** Default workspace root for pilot-doctor when not supplied per call. */
  workspaceRoot?: string;
  /** Default absolute data directory when RUNBOOK_DATA_DIR is unset. */
  dataDir?: string;
}>;

function pathOrFixtureSchema() {
  return {
    path: z.string().trim().min(1).max(4_096).optional(),
    fixtureId: z.string().trim().min(1).max(160).optional(),
  };
}

type ResolvedInput = Readonly<{
  bytes: Uint8Array;
  sha256: string;
  source: "path" | "fixture";
  fixtureId?: string;
  absolutePath?: string;
  publicAuthSourceId?: string;
}>;

async function resolveBytes(
  input: { path?: string | undefined; fixtureId?: string | undefined },
  expectedKinds: readonly FixtureKind[],
  maxBytes: number,
): Promise<ResolvedInput> {
  const hasPath = input.path !== undefined && input.path.length > 0;
  const hasFixture = input.fixtureId !== undefined && input.fixtureId.length > 0;
  if (hasPath === hasFixture) {
    throw new OwnedFileError("path.invalid");
  }
  if (hasFixture) {
    const loaded = await loadFixture(input.fixtureId as string);
    if (!expectedKinds.includes(loaded.entry.kind)) {
      throw new FixtureCatalogError("fixture.unknown");
    }
    return {
      bytes: loaded.bytes,
      sha256: loaded.sha256,
      source: "fixture",
      fixtureId: loaded.entry.id,
      absolutePath: loaded.absolutePath,
      ...(loaded.entry.publicAuthSourceId !== undefined
        ? { publicAuthSourceId: loaded.entry.publicAuthSourceId }
        : {}),
    };
  }
  const absolutePath = input.path as string;
  const owned = await ownAbsoluteFile(absolutePath, { maxBytes, minBytes: 1 });
  return {
    bytes: owned.bytes,
    sha256: owned.sha256,
    source: "path",
    absolutePath,
  };
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolvePilotDataDir(
  service: RunbookService,
  options: OfflineToolsOptions | undefined,
  arg: string | undefined,
): string {
  if (arg !== undefined && arg.length > 0) {
    if (!isAbsolute(arg)) throw new OwnedFileError("path.invalid");
    return resolve(arg);
  }
  if (options?.dataDir !== undefined && options.dataDir.length > 0) {
    if (!isAbsolute(options.dataDir)) throw new OwnedFileError("path.invalid");
    return resolve(options.dataDir);
  }
  const fromEnv = process.env.RUNBOOK_DATA_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    if (!isAbsolute(fromEnv)) throw new OwnedFileError("path.invalid");
    return resolve(fromEnv);
  }
  return service.ledger.rootDir;
}

function resolvePilotWorkspaceRoot(
  options: OfflineToolsOptions | undefined,
  arg: string | undefined,
): string {
  if (arg !== undefined && arg.length > 0) {
    if (!isAbsolute(arg)) throw new OwnedFileError("path.invalid");
    return resolve(arg);
  }
  if (options?.workspaceRoot !== undefined && options.workspaceRoot.length > 0) {
    if (!isAbsolute(options.workspaceRoot)) throw new OwnedFileError("path.invalid");
    return resolve(options.workspaceRoot);
  }
  return MONOREPO_ROOT;
}

export function registerOfflineTools(
  server: McpServer,
  service: RunbookService,
  options?: OfflineToolsOptions,
): void {
  server.registerTool(
    "runbook_verify_capsule",
    {
      title: "Verify Proof Capsule (Offline)",
      description:
        "Verify a local .runbook proof capsule from an absolute path or a pinned fixtureId. Invalid capsules return valid:false without isError. Does not contact a broker or establish author identity.",
      inputSchema: pathOrFixtureSchema(),
      outputSchema: {
        valid: z.boolean(),
        verification: z.record(z.string(), z.unknown()),
        brokerEffect: z.literal(false),
        assurance: z.literal("self-asserted-author-key-integrity"),
        inputSha256: z.string(),
        source: z.enum(["path", "fixture"]),
        fixtureId: z.string().optional(),
      },
      annotations: offlineAnnotations,
    },
    async (input) => {
      try {
        const resolved = await resolveBytes(input, ["capsule"], MAX_CAPSULE_OWNED_BYTES);
        if (resolved.absolutePath === undefined) {
          throw new OwnedFileError("path.invalid");
        }
        // verifyCapsuleFile re-opens with O_NOFOLLOW after fixture pin verification.
        const verification = await verifyCapsuleFile(resolved.absolutePath);
        const output = {
          valid: verification.valid,
          verification: jsonSafe(verification),
          brokerEffect: false as const,
          assurance: "self-asserted-author-key-integrity" as const,
          inputSha256: resolved.sha256,
          source: resolved.source,
          ...(resolved.fixtureId !== undefined ? { fixtureId: resolved.fixtureId } : {}),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapOfflineError(error);
      }
    },
  );

  server.registerTool(
    "runbook_diff_capabilities",
    {
      title: "Diff Capability Snapshots (Offline)",
      description:
        "Build a deterministic capability diff between baseline and candidate snapshots (path or pinned fixtureId). Offline claim analysis only; not runtime inventory or trade authorization.",
      inputSchema: {
        baselinePath: z.string().trim().min(1).max(4_096).optional(),
        baselineFixtureId: z.string().trim().min(1).max(160).optional(),
        candidatePath: z.string().trim().min(1).max(4_096).optional(),
        candidateFixtureId: z.string().trim().min(1).max(160).optional(),
      },
      outputSchema: {
        diff: z.record(z.string(), z.unknown()),
        materialChangeCount: z.number().int().nonnegative(),
        brokerEffect: z.literal(false),
        assurance: z.literal("offline-reviewed-claim-analysis"),
      },
      annotations: offlineAnnotations,
    },
    async (input) => {
      try {
        const baseline = await resolveBytes(
          { path: input.baselinePath, fixtureId: input.baselineFixtureId },
          ["capability-snapshot"],
          DEFAULT_MAX_OWNED_FILE_BYTES,
        );
        const candidate = await resolveBytes(
          { path: input.candidatePath, fixtureId: input.candidateFixtureId },
          ["capability-snapshot"],
          DEFAULT_MAX_OWNED_FILE_BYTES,
        );
        const baselineSnapshot = parseExactJcsCapabilitySnapshotBytes(baseline.bytes);
        const candidateSnapshot = parseExactJcsCapabilitySnapshotBytes(candidate.bytes);
        const diff = buildCapabilityDiff(baselineSnapshot, candidateSnapshot);
        const output = {
          diff: jsonSafe(diff),
          materialChangeCount: diff.materialChangeIds.length,
          brokerEffect: false as const,
          assurance: "offline-reviewed-claim-analysis" as const,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapOfflineError(error);
      }
    },
  );

  server.registerTool(
    "runbook_admit_capabilities",
    {
      title: "Evaluate Capability Admission (Offline)",
      description:
        "Evaluate candidate capability snapshot admission against a baseline and policy. Restated: does NOT grant broker permission, mutate a durable registry head, or authorize trades. Offline claim analysis only.",
      inputSchema: {
        baselinePath: z.string().trim().min(1).max(4_096).optional(),
        baselineFixtureId: z.string().trim().min(1).max(160).optional(),
        candidatePath: z.string().trim().min(1).max(4_096).optional(),
        candidateFixtureId: z.string().trim().min(1).max(160).optional(),
        policyPath: z.string().trim().min(1).max(4_096).optional(),
        policyFixtureId: z.string().trim().min(1).max(160).optional(),
        evaluatedAtDeclared: z.string().trim().min(1).max(40),
      },
      outputSchema: {
        receipt: z.record(z.string(), z.unknown()),
        outcome: z.enum(["admit", "no-change", "quarantine", "reject"]),
        brokerEffect: z.literal(false),
        doesNotGrantBrokerPermission: z.literal(true),
        assurance: z.literal("offline-reviewed-claim-analysis"),
      },
      annotations: offlineAnnotations,
    },
    async (input) => {
      try {
        const baseline = await resolveBytes(
          { path: input.baselinePath, fixtureId: input.baselineFixtureId },
          ["capability-snapshot"],
          DEFAULT_MAX_OWNED_FILE_BYTES,
        );
        const candidate = await resolveBytes(
          { path: input.candidatePath, fixtureId: input.candidateFixtureId },
          ["capability-snapshot"],
          DEFAULT_MAX_OWNED_FILE_BYTES,
        );
        const policy = await resolveBytes(
          { path: input.policyPath, fixtureId: input.policyFixtureId },
          ["admission-policy"],
          MAX_POLICY_OWNED_BYTES,
        );
        const receipt = await evaluateCapabilityAdmission({
          baselineSnapshotBytes: baseline.bytes,
          candidateSnapshotBytes: candidate.bytes,
          policyBytes: policy.bytes,
          evaluatedAtDeclared: input.evaluatedAtDeclared,
        });
        const output = {
          receipt: jsonSafe(receipt),
          outcome: receipt.outcome,
          brokerEffect: false as const,
          doesNotGrantBrokerPermission: true as const,
          assurance: "offline-reviewed-claim-analysis" as const,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapOfflineError(error);
      }
    },
  );

  server.registerTool(
    "runbook_verify_capability_snapshot",
    {
      title: "Verify Capability Snapshot (Offline)",
      description:
        "Parse and verify one exact-JCS capability snapshot (path or pinned fixtureId). Invalid snapshot structure returns valid:false without isError when parse fails with a registry validation error.",
      inputSchema: pathOrFixtureSchema(),
      outputSchema: {
        valid: z.boolean(),
        inputSha256: z.string(),
        snapshotSha256: z.string().nullable(),
        errorCode: z.string().nullable(),
        brokerEffect: z.literal(false),
        assurance: z.literal("offline-reviewed-claim-analysis"),
      },
      annotations: offlineAnnotations,
    },
    async (input) => {
      try {
        const resolved = await resolveBytes(
          input,
          ["capability-snapshot"],
          DEFAULT_MAX_OWNED_FILE_BYTES,
        );
        try {
          const snapshot = parseExactJcsCapabilitySnapshotBytes(resolved.bytes);
          const snapshotSha256 = sha256Jcs(snapshot);
          const recomputed = capabilitySnapshotSha256(snapshot);
          const valid = snapshotSha256 === resolved.sha256 && recomputed === resolved.sha256;
          const output = {
            valid,
            inputSha256: resolved.sha256,
            snapshotSha256,
            errorCode: valid ? null : "snapshot.hash-mismatch",
            brokerEffect: false as const,
            assurance: "offline-reviewed-claim-analysis" as const,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          if (error instanceof RegistryValidationError) {
            const output = {
              valid: false,
              inputSha256: resolved.sha256,
              snapshotSha256: null,
              errorCode: error.code,
              brokerEffect: false as const,
              assurance: "offline-reviewed-claim-analysis" as const,
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
              structuredContent: output,
            };
          }
          throw error;
        }
      } catch (error) {
        return mapOfflineError(error);
      }
    },
  );

  server.registerTool(
    "runbook_inspect_public_auth_metadata",
    {
      title: "Inspect Public Auth Metadata (Offline)",
      description:
        "Pure offline parse of a Robinhood public OAuth discovery body from a pinned fixture or absolute path. Never performs network capture. Does not authorize registration, tokens, MCP sessions, or capital access.",
      inputSchema: {
        path: z.string().trim().min(1).max(4_096).optional(),
        fixtureId: z.string().trim().min(1).max(160).optional(),
        sourceId: z.enum(PUBLIC_AUTH_SOURCE_IDS).optional(),
      },
      outputSchema: {
        sourceId: z.string(),
        profileValid: z.boolean(),
        findings: z.array(z.string()),
        projectionSha256: z.string(),
        semanticDigests: z.array(z.object({
          fieldCode: z.string(),
          sha256: z.string(),
        })),
        brokerEffect: z.literal(false),
        assurance: z.literal("offline-fixture-or-operator-capture-analysis"),
        limitations: z.array(z.string()),
      },
      annotations: offlineAnnotations,
    },
    async (input) => {
      try {
        const resolved = await resolveBytes(
          { path: input.path, fixtureId: input.fixtureId },
          ["public-auth-raw"],
          MAX_PUBLIC_AUTH_OWNED_BYTES,
        );
        const sourceId = input.sourceId ?? resolved.publicAuthSourceId;
        if (sourceId === undefined) {
          throw new OwnedFileError("path.invalid");
        }
        const parsed = parseRobinhoodPublicAuthMetadataBody(
          sourceId as PublicAuthMetadataSourceId,
          resolved.bytes,
        );
        const output = {
          sourceId,
          profileValid: parsed.profileValid,
          findings: [...parsed.findings],
          projectionSha256: parsed.projectionSha256,
          semanticDigests: parsed.semanticDigests.map((d) => ({
            fieldCode: d.fieldCode,
            sha256: d.sha256,
          })),
          brokerEffect: false as const,
          assurance: "offline-fixture-or-operator-capture-analysis" as const,
          limitations: [
            "does-not-authorize-registration-authentication-token-or-mcp-use",
            "does-not-grant-provider-consent-or-commercial-use-rights",
            "public-self-asserted-discovery-metadata-only",
            "no-network-capture",
          ],
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapOfflineError(error);
      }
    },
  );

  server.registerTool(
    "runbook_pilot_doctor",
    {
      title: "Shadow Pilot Doctor (Offline)",
      description:
        "Diagnose local shadow-pilot readiness from a manifest and ledger. Advisory local attestation only; does not disconnect brokers or authenticate humans.",
      inputSchema: {
        manifestPath: z.string().trim().min(1).max(4_096).optional(),
        dataDir: z.string().trim().min(1).max(4_096).optional(),
        workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
      },
      outputSchema: {
        report: z.record(z.string(), z.unknown()),
        ready: z.boolean(),
        brokerEffect: z.literal(false),
        assurance: z.literal("local-attestation-and-ledger-only"),
      },
      annotations: offlineAnnotations,
    },
    async (input) => {
      try {
        const manifestPath = input.manifestPath ?? DEFAULT_SHADOW_MANIFEST_PATH;
        const owned = await ownAbsoluteFile(manifestPath, {
          maxBytes: 64 * 1024,
          minBytes: 2,
        });
        const text = new TextDecoder().decode(owned.bytes);
        const raw = JSON.parse(text) as unknown;
        const manifest = shadowPilotManifestSchema.parse(raw);
        const dataDir = resolvePilotDataDir(service, options, input.dataDir);
        const workspaceRoot = resolvePilotWorkspaceRoot(options, input.workspaceRoot);
        const report = await diagnoseShadowPilot({
          manifest,
          service,
          dataDir,
          workspaceRoot,
          environment: process.env,
        });
        const output = {
          report: jsonSafe(report),
          ready: report.ready,
          brokerEffect: false as const,
          assurance: "local-attestation-and-ledger-only" as const,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapOfflineError(error);
      }
    },
  );

  server.registerTool(
    "runbook_export_public_snapshot",
    {
      title: "Export Public Snapshot (Local Ledger)",
      description:
        "Build a metadata-only public snapshot for one experiment from the local ledger. Filtered projection; independentlyVerifiable is always false. Does not contact a broker.",
      inputSchema: {
        experimentId: z.string().trim().min(1).max(120),
        generatedAt: z.iso.datetime().optional(),
      },
      outputSchema: {
        snapshot: z.record(z.string(), z.unknown()),
        brokerEffect: z.literal(false),
        assurance: z.literal("local-tamper-evidence-only"),
      },
      annotations: offlineAnnotations,
    },
    async (input) => {
      try {
        const snapshot = await buildPublicSnapshot(
          service,
          input.experimentId,
          input.generatedAt,
        );
        const output = {
          snapshot: jsonSafe(snapshot),
          brokerEffect: false as const,
          assurance: "local-tamper-evidence-only" as const,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return mapOfflineError(error);
      }
    },
  );
}

function mapOfflineError(error: unknown): {
  content: [{ type: "text"; text: string }];
  structuredContent: {
    schemaVersion: "runbook.mcp-error.v1";
    code: "fixture.unknown" | "path.invalid" | "path.size-limit" | "input.invalid" | "tool.failed-safely";
    message: string;
    retryable: false;
    brokerEffect: false;
    assurance: string;
    limitations: string[];
  };
  isError: true;
} {
  if (error instanceof FixtureCatalogError) {
    if (error.code === "fixture.unknown") {
      return {
        content: [{ type: "text", text: "Unknown or mismatched fixture identifier." }],
        structuredContent: {
          schemaVersion: "runbook.mcp-error.v1",
          code: "fixture.unknown",
          message: "Unknown or mismatched fixture identifier.",
          retryable: false,
          brokerEffect: false,
          assurance: "local-tool-failure-only",
          limitations: ["advisory-only", "no-broker-execution", "no-credential-handling", "local-process-only"],
        },
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: "Pinned fixture hash mismatch; refuse to load drifted bytes." }],
      structuredContent: {
        schemaVersion: "runbook.mcp-error.v1",
        code: "fixture.unknown",
        message: "Pinned fixture hash mismatch; refuse to load drifted bytes.",
        retryable: false,
        brokerEffect: false,
        assurance: "local-tool-failure-only",
        limitations: ["advisory-only", "no-broker-execution", "no-credential-handling", "local-process-only"],
      },
      isError: true,
    };
  }
  if (error instanceof OwnedFileError) {
    return {
      content: [{
        type: "text",
        text: error.code === "path.size-limit"
          ? "Local file exceeds the allowed size limit."
          : "Local path is invalid, disallowed, or unreadable.",
      }],
      structuredContent: {
        schemaVersion: "runbook.mcp-error.v1",
        code: error.code,
        message: error.code === "path.size-limit"
          ? "Local file exceeds the allowed size limit."
          : "Local path is invalid, disallowed, or unreadable.",
        retryable: false,
        brokerEffect: false,
        assurance: "local-tool-failure-only",
        limitations: ["advisory-only", "no-broker-execution", "no-credential-handling", "local-process-only"],
      },
      isError: true,
    };
  }
  if (error instanceof RegistryValidationError) {
    return {
      content: [{ type: "text", text: "Capability registry input failed exact validation." }],
      structuredContent: {
        schemaVersion: "runbook.mcp-error.v1",
        code: "input.invalid",
        message: "Capability registry input failed exact validation.",
        retryable: false,
        brokerEffect: false,
        assurance: "offline-reviewed-claim-analysis",
        limitations: ["advisory-only", "no-broker-execution", "no-credential-handling", "local-process-only"],
      },
      isError: true,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      content: [{ type: "text", text: "Input failed schema validation." }],
      structuredContent: {
        schemaVersion: "runbook.mcp-error.v1",
        code: "input.invalid",
        message: "Input failed schema validation.",
        retryable: false,
        brokerEffect: false,
        assurance: "local-tool-failure-only",
        limitations: ["advisory-only", "no-broker-execution", "no-credential-handling", "local-process-only"],
      },
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: "Runbook offline tool failed safely. Review local server logs." }],
    structuredContent: {
      schemaVersion: "runbook.mcp-error.v1",
      code: "tool.failed-safely",
      message: "Runbook offline tool failed safely. Review local server logs.",
      retryable: false,
      brokerEffect: false,
      assurance: "local-tool-failure-only",
      limitations: ["advisory-only", "no-broker-execution", "no-credential-handling", "local-process-only"],
    },
    isError: true,
  };
}
