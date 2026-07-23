import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_DEMO_CARDS,
  formatSurfaceLockSummary,
  GOLDEN_JOURNEY_STEPS,
  MCP_OPERATOR_DOCS,
  MCP_OPERATOR_GUIDE_EXISTS,
  MCP_OPERATOR_GUIDE_PATH,
  MCP_SERVER_VERSION,
  MCP_SURFACE_LOCK,
  MCP_TOOL_COUNT,
  MCP_TOOLS,
} from "./mcp-cockpit-data";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("MCP cockpit catalog data", () => {
  it("lists all 42 tools with brokerEffect-free lanes", () => {
    expect(MCP_TOOL_COUNT).toBe(42);
    expect(MCP_TOOLS).toHaveLength(42);
    expect(MCP_TOOLS.filter((t) => t.lane === "discovery")).toHaveLength(1);
    expect(MCP_TOOLS.filter((t) => t.lane === "ledger")).toHaveLength(6);
    expect(MCP_TOOLS.filter((t) => t.lane === "offline")).toHaveLength(7);
    expect(MCP_TOOLS.filter((t) => t.lane === "shadow")).toHaveLength(6);
    expect(MCP_TOOLS.filter((t) => t.lane === "session")).toHaveLength(13);
    expect(MCP_TOOLS.filter((t) => t.lane === "elite")).toHaveLength(9);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_list_surface")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_diff_capabilities")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_pilot_doctor")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_shadow_tournament")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_expand_curriculum_from_ledger")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_create")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_use")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_import_tools_list")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_bind_experiment")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_check_inventory")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_approval_verify")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_surface_lock_receipt")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_process_tick")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_seal_capsule")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_drift_sentinel")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_clone_challenge")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_dual_check_diff")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_attach_surface_lock")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_gateway_quorum_demo")).toBe(true);
  });

  it("includes golden journey and offline fixture demo cards", () => {
    expect(GOLDEN_JOURNEY_STEPS.length).toBeGreaterThanOrEqual(5);
    expect(GOLDEN_JOURNEY_STEPS.some((s) => s.id === "hard-stop")).toBe(true);
    expect(FIXTURE_DEMO_CARDS.map((c) => c.id).sort()).toEqual(
      ["capsule-twin", "diff-45-50", "reject-risk"].sort(),
    );
  });

  it("links operator docs to OPERATOR_GUIDE when present, else README sections", () => {
    const guideOnDisk = existsSync(join(REPO_ROOT, MCP_OPERATOR_GUIDE_PATH));
    expect(MCP_OPERATOR_GUIDE_EXISTS).toBe(guideOnDisk);
    if (guideOnDisk) {
      expect(MCP_OPERATOR_DOCS.path).toBe(MCP_OPERATOR_GUIDE_PATH);
    } else {
      expect(MCP_OPERATOR_DOCS.path).toBe("packages/mcp/README.md");
      expect(MCP_OPERATOR_DOCS.sections.length).toBeGreaterThanOrEqual(3);
      expect(MCP_OPERATOR_DOCS.sections.some((s) => /tool table/i.test(s.title))).toBe(true);
    }
  });

  it("exposes static surface lock for server 0.4.3 / 42 tools / attests Runbook only", () => {
    expect(MCP_SERVER_VERSION).toBe("0.4.3");
    expect(MCP_SURFACE_LOCK.serverVersion).toBe("0.4.3");
    expect(MCP_SURFACE_LOCK.toolCount).toBe(42);
    expect(MCP_SURFACE_LOCK.brokerExecutionTools).toEqual([]);
    expect(MCP_SURFACE_LOCK.openWorldHint).toBe(false);
    expect(MCP_SURFACE_LOCK.attests).toBe("Runbook only");
    expect(MCP_SURFACE_LOCK.brokerEffect).toBe(false);
    expect(MCP_SURFACE_LOCK.compositeScore).toBe(false);
    const summary = formatSurfaceLockSummary();
    expect(summary).toContain("serverVersion: 0.4.3");
    expect(summary).toContain("toolCount: 42");
    expect(summary).toContain("brokerExecutionTools: []");
    expect(summary).toContain("openWorldHint: false");
    expect(summary).toContain("attests: Runbook only");
  });
});
