import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_DEMO_CARDS,
  GOLDEN_JOURNEY_STEPS,
  MCP_OPERATOR_DOCS,
  MCP_OPERATOR_GUIDE_EXISTS,
  MCP_OPERATOR_GUIDE_PATH,
  MCP_TOOL_COUNT,
  MCP_TOOLS,
} from "./mcp-cockpit-data";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("MCP cockpit catalog data", () => {
  it("lists all 30 tools with brokerEffect-free lanes", () => {
    expect(MCP_TOOL_COUNT).toBe(30);
    expect(MCP_TOOLS).toHaveLength(30);
    expect(MCP_TOOLS.filter((t) => t.lane === "discovery")).toHaveLength(1);
    expect(MCP_TOOLS.filter((t) => t.lane === "ledger")).toHaveLength(6);
    expect(MCP_TOOLS.filter((t) => t.lane === "offline")).toHaveLength(7);
    expect(MCP_TOOLS.filter((t) => t.lane === "shadow")).toHaveLength(6);
    expect(MCP_TOOLS.filter((t) => t.lane === "session")).toHaveLength(10);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_list_surface")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_diff_capabilities")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_pilot_doctor")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_shadow_tournament")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_expand_curriculum_from_ledger")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_create")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_session_check_inventory")).toBe(true);
    expect(MCP_TOOLS.some((t) => t.name === "runbook_approval_verify")).toBe(true);
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
});
