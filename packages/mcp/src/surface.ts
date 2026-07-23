/**
 * Closed MCP surface inventory for agents (single-call discovery).
 * Keep in sync with server-factory, offline-tools, resources, prompts registrations.
 */

import { PROMPT_NAMES } from "./prompts.js";
import { STATIC_RESOURCE_URIS } from "./resources.js";

export const SERVER_NAME = "runbook" as const;
export const SERVER_VERSION = "0.4.3" as const;

/** Full closed tool list in stable discovery order. */
export const TOOL_NAMES = [
  "runbook_list_surface",
  "runbook_create_experiment",
  "runbook_preflight_trade",
  "runbook_record_approval",
  "runbook_record_execution",
  "runbook_list_events",
  "runbook_verify_ledger",
  "runbook_verify_capsule",
  "runbook_verify_capability_snapshot",
  "runbook_diff_capabilities",
  "runbook_admit_capabilities",
  "runbook_inspect_public_auth_metadata",
  "runbook_pilot_doctor",
  "runbook_export_public_snapshot",
  "runbook_run_shadow_curriculum",
  "runbook_improve_charter",
  "runbook_shadow_tournament",
  "runbook_activate_refined_charter",
  "runbook_agent_eval",
  "runbook_expand_curriculum_from_ledger",
  "runbook_session_create",
  "runbook_session_use",
  "runbook_session_get",
  "runbook_session_export",
  "runbook_session_set_charter",
  "runbook_session_pin_inventory",
  "runbook_session_check_inventory",
  "runbook_session_import_tools_list",
  "runbook_session_bind_experiment",
  "runbook_session_attach_dossier",
  "runbook_session_record_shadow",
  "runbook_approval_create_signed",
  "runbook_approval_verify",
  "runbook_surface_lock_receipt",
  "runbook_process_tick",
  "runbook_session_import_pack",
  "runbook_session_seal_capsule",
  "runbook_drift_sentinel",
  "runbook_session_clone_challenge",
  "runbook_dual_check_diff",
  "runbook_session_attach_surface_lock",
  "runbook_gateway_quorum_demo",
] as const;

export type RunbookToolName = (typeof TOOL_NAMES)[number];

const OFFLINE_TOOL_NAMES = new Set<string>([
  "runbook_list_surface",
  "runbook_list_events",
  "runbook_verify_ledger",
  "runbook_verify_capsule",
  "runbook_verify_capability_snapshot",
  "runbook_diff_capabilities",
  "runbook_admit_capabilities",
  "runbook_inspect_public_auth_metadata",
  "runbook_pilot_doctor",
  "runbook_export_public_snapshot",
  "runbook_run_shadow_curriculum",
  "runbook_improve_charter",
  "runbook_shadow_tournament",
  "runbook_agent_eval",
  "runbook_expand_curriculum_from_ledger",
  // Control-plane session tools are local filesystem only (no broker / open-world).
  "runbook_session_create",
  "runbook_session_use",
  "runbook_session_get",
  "runbook_session_export",
  "runbook_session_set_charter",
  "runbook_session_pin_inventory",
  "runbook_session_check_inventory",
  "runbook_session_import_tools_list",
  "runbook_session_bind_experiment",
  "runbook_session_attach_dossier",
  "runbook_session_record_shadow",
  "runbook_approval_create_signed",
  "runbook_approval_verify",
  "runbook_surface_lock_receipt",
  "runbook_process_tick",
  "runbook_session_import_pack",
  "runbook_session_seal_capsule",
  "runbook_drift_sentinel",
  "runbook_dual_check_diff",
  "runbook_session_attach_surface_lock",
  "runbook_gateway_quorum_demo",
]);

export type SurfaceInventory = {
  schemaVersion: "runbook.surface-inventory.v1";
  serverName: typeof SERVER_NAME;
  serverVersion: typeof SERVER_VERSION;
  tools: Array<{
    name: string;
    openWorldHint: false;
    offline: boolean;
  }>;
  resourceUris: string[];
  prompts: string[];
  brokerExecutionTools: [];
  openWorldHint: false;
  notes: string[];
};

export function buildSurfaceInventory(): SurfaceInventory {
  return {
    schemaVersion: "runbook.surface-inventory.v1",
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    tools: TOOL_NAMES.map((name) => ({
      name,
      openWorldHint: false as const,
      offline: OFFLINE_TOOL_NAMES.has(name),
    })),
    resourceUris: [...STATIC_RESOURCE_URIS],
    prompts: [...PROMPT_NAMES],
    brokerExecutionTools: [],
    openWorldHint: false,
    notes: [
      "Closed inventory: no place_* or cancel_* tools.",
      "openWorldHint is false for every registered tool.",
      "brokerExecutionTools is always empty.",
      "Prefer runbook://docs/boundary before mutating tools.",
    ],
  };
}
