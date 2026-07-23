import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AGENTIC_CONTRACT_MD,
  ASSURANCE_JSON,
  BOUNDARY_MD,
  DEMO_CAPABILITY_DRIFT_MD,
  DEMO_CAPSULE_GOLDEN_MD,
  DEMO_PUBLIC_AUTH_OFFLINE_MD,
  DEMO_SHADOW_PILOT_MD,
  DEMO_SHADOW_SELF_IMPROVE_MD,
  EQUITY_POLICY_JSON,
  CONTROL_PLANE_SESSION_MD,
  PLAYBOOK_RECURSIVE_ELITE_MD,
  SHADOW_MANIFEST_JSON,
  SHADOW_MANIFEST_SCHEMA,
  STATUS_DOSSIER_MD,
  TOOL_CONTRACT_JSON,
} from "./catalog/content.js";
import { buildFixtureCatalogJson } from "./fixture-catalog.js";
import type { RunbookService } from "./service.js";

function textResource(uri: string, mimeType: string, text: string) {
  return {
    contents: [
      {
        uri,
        mimeType,
        text,
      },
    ],
  };
}

/** Closed static (or catalog-built) resource URIs advertised by the server. */
export const STATIC_RESOURCE_URIS = [
  "runbook://docs/boundary",
  "runbook://docs/tool-contract",
  "runbook://docs/robinhood-agentic-contract",
  "runbook://docs/assurance",
  "runbook://schemas/shadow-pilot-manifest",
  "runbook://examples/shadow-pilot.manifest",
  "runbook://examples/equity-only-charter-policy",
  "runbook://fixtures/catalog",
  "runbook://demos/capability-drift",
  "runbook://demos/public-auth-offline",
  "runbook://demos/capsule-golden",
  "runbook://demos/shadow-pilot",
  "runbook://demos/shadow-self-improve",
  "runbook://playbooks/recursive-elite-process",
  "runbook://status/dossier",
  "runbook://docs/control-plane-session",
  "runbook://ledger/verification",
] as const;

export function registerRunbookResources(server: McpServer, service: RunbookService): void {
  server.registerResource(
    "boundary",
    "runbook://docs/boundary",
    {
      title: "Runbook product boundary",
      description: "Hard safety boundary: no credentials, no trades, advisory only, no composite score.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", BOUNDARY_MD),
  );

  server.registerResource(
    "tool-contract",
    "runbook://docs/tool-contract",
    {
      title: "Runbook tool contract",
      description: "Machine-readable tool effects, brokerEffect flags, and discovery URIs.",
      mimeType: "application/json",
    },
    async (uri) => textResource(uri.href, "application/json", TOOL_CONTRACT_JSON),
  );

  server.registerResource(
    "agentic-contract",
    "runbook://docs/robinhood-agentic-contract",
    {
      title: "Robinhood agentic research map",
      description: "Dated public-documentation contract summary. Not live inventory. Not authorization.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", AGENTIC_CONTRACT_MD),
  );

  server.registerResource(
    "assurance",
    "runbook://docs/assurance",
    {
      title: "Assurance vocabulary",
      description: "Separate assurance axes. Composite safety scores are prohibited.",
      mimeType: "application/json",
    },
    async (uri) => textResource(uri.href, "application/json", ASSURANCE_JSON),
  );

  server.registerResource(
    "shadow-manifest-schema",
    "runbook://schemas/shadow-pilot-manifest",
    {
      title: "Shadow pilot manifest schema",
      description: "JSON Schema for runbook.shadow-pilot.v1 strict manifests.",
      mimeType: "application/json",
    },
    async (uri) => textResource(uri.href, "application/json", SHADOW_MANIFEST_SCHEMA),
  );

  server.registerResource(
    "example-shadow-manifest",
    "runbook://examples/shadow-pilot.manifest",
    {
      title: "Example shadow pilot manifest",
      description: "Disconnected, zero-capital, synthetic shadow pilot declaration.",
      mimeType: "application/json",
    },
    async (uri) => textResource(uri.href, "application/json", SHADOW_MANIFEST_JSON),
  );

  server.registerResource(
    "example-equity-charter",
    "runbook://examples/equity-only-charter-policy",
    {
      title: "Example equity-only charter policy",
      description: "Safe demo RiskPolicy: equities only, approvalRequired true, VTI/BND allowlist.",
      mimeType: "application/json",
    },
    async (uri) => textResource(uri.href, "application/json", EQUITY_POLICY_JSON),
  );

  server.registerResource(
    "fixture-catalog",
    "runbook://fixtures/catalog",
    {
      title: "Closed fixture catalog",
      description: "Pinned offline fixture IDs, SHA-256 digests, and purposes. Fail closed on drift.",
      mimeType: "application/json",
    },
    async (uri) => textResource(uri.href, "application/json", buildFixtureCatalogJson()),
  );

  server.registerResource(
    "demo-capability-drift",
    "runbook://demos/capability-drift",
    {
      title: "Demo: capability drift + risk-correction reject",
      description: "Playbook for 45→50 material diff and public-docs risk-correction reject.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", DEMO_CAPABILITY_DRIFT_MD),
  );

  server.registerResource(
    "demo-public-auth-offline",
    "runbook://demos/public-auth-offline",
    {
      title: "Demo: offline public OAuth metadata",
      description: "Playbook for fixture-only public-auth inspect. No tokens or MCP sessions.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", DEMO_PUBLIC_AUTH_OFFLINE_MD),
  );

  server.registerResource(
    "demo-capsule-golden",
    "runbook://demos/capsule-golden",
    {
      title: "Demo: valid vs tampered capsule",
      description: "Playbook for offline capsule verify on golden valid and tampered fixtures.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", DEMO_CAPSULE_GOLDEN_MD),
  );

  server.registerResource(
    "demo-shadow-pilot",
    "runbook://demos/shadow-pilot",
    {
      title: "Demo: day-1 shadow pilot SOP",
      description: "Broker-disconnected create → preflight → hard stop → verify → doctor; links tools and CLI.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", DEMO_SHADOW_PILOT_MD),
  );

  server.registerResource(
    "demo-shadow-self-improve",
    "runbook://demos/shadow-self-improve",
    {
      title: "Demo: recursive shadow self-improvement",
      description:
        "Curriculum → improve charter → re-eval → optional explicit activate. Offline process quality only; never connect broker.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", DEMO_SHADOW_SELF_IMPROVE_MD),
  );

  server.registerResource(
    "playbook-recursive-elite-process",
    "runbook://playbooks/recursive-elite-process",
    {
      title: "Playbook: elite recursive self-improvement loop",
      description:
        "Full 10-step loop: surface → curriculum → improve to fixed point → optional Pareto → experiment + preflights → agent_eval → expand → re-improve. Never broker; never returns claims.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", PLAYBOOK_RECURSIVE_ELITE_MD),
  );

  server.registerResource(
    "status-dossier",
    "runbook://status/dossier",
    {
      title: "Pre-Capital Dossier V2 status",
      description: "Honest architecture-slice status only. Not a completed buyer product or safety grade.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", STATUS_DOSSIER_MD),
  );

  server.registerResource(
    "control-plane-session",
    "runbook://docs/control-plane-session",
    {
      title: "Control plane session",
      description:
        "Local control-plane session spine: inventory pin, shadow metrics, dossier attachments, device-key approval attestation. Not a hard broker gateway.",
      mimeType: "text/markdown",
    },
    async (uri) => textResource(uri.href, "text/markdown", CONTROL_PLANE_SESSION_MD),
  );

  server.registerResource(
    "ledger-verification",
    "runbook://ledger/verification",
    {
      title: "Live ledger verification",
      description: "Dynamic local hash-chain verification. Assurance is local-tamper-evidence-only.",
      mimeType: "application/json",
    },
    async (uri) => {
      const verification = await service.verify();
      const body = {
        ...verification,
        errors: verification.valid ? [] : ["ledger-verification-failed"],
        assurance: "local-tamper-evidence-only" as const,
        brokerEffect: false,
      };
      return textResource(uri.href, "application/json", JSON.stringify(body, null, 2));
    },
  );
}
