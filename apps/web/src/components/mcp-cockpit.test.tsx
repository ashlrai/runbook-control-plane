// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpCockpit } from "./mcp-cockpit";
import { MCP_SERVER_VERSION, MCP_TOOL_COUNT, MCP_TOOLS } from "../lib/mcp-cockpit-data";

afterEach(() => cleanup());

describe("MCP cockpit", () => {
  it("documents install path, full tool inventory, and discovery resources without gateway claims", () => {
    const { container } = render(<McpCockpit />);
    const text = container.textContent ?? "";

    const boundary = screen.getByLabelText("MCP honesty boundary").textContent ?? "";
    expect(boundary).toContain("NO HARD GATEWAY");
    expect(boundary).toContain("NO LIVE BROKER CONNECTION");

    expect(text).toContain('codex mcp add runbook -- node "$PWD/packages/mcp/dist/server.js"');
    for (const tool of MCP_TOOLS) {
      expect(text).toContain(tool.name);
    }
    expect(text).toContain(String(MCP_TOOL_COUNT));
    expect(MCP_TOOLS).toHaveLength(40);
    expect(text).toContain(`v${MCP_SERVER_VERSION}`);
    expect(text).toContain("runbook://docs/boundary");
    expect(text).toContain("runbook://docs/assurance");
    expect(text).toContain("pilot-doctor");
    expect(text).toMatch(/Operator docs:/i);
    expect(text).toMatch(/packages\/mcp\/(OPERATOR_GUIDE\.md|README\.md)/);
    expect(text).toMatch(/golden journey/i);
    expect(text).toMatch(/Diff 45 → 50/i);
    expect(text).toMatch(/Reject risk-correction/i);
    expect(text).toMatch(/Capsule twin/i);
    expect(text).toMatch(/NO HARD GATEWAY/i);
    expect(text).toMatch(/composite safety score/i);
    expect(text).not.toMatch(/hard gateway is active|live broker is connected|agent certified/i);
  });

  it("shows static surface lock (0.4.2 / 39 / empty brokerExecutionTools / Runbook only)", () => {
    render(<McpCockpit />);
    const lock = screen.getByLabelText("Surface lock summary").textContent ?? "";
    expect(lock).toContain("toolCount");
    expect(lock).toContain("39");
    expect(lock).toContain("brokerExecutionTools");
    expect(lock).toMatch(/\[\] empty/);
    expect(lock).toContain("openWorldHint");
    expect(lock).toContain("false");
    expect(lock).toMatch(/Runbook only/i);
    expect(screen.getByRole("button", { name: /Copy surface lock summary text/i })).toBeTruthy();
    expect(screen.getByLabelText("Surface lock limitations").textContent).toMatch(
      /runbook-surface-only-not-host-inventory/,
    );
  });

  it("toggles golden journey checklist steps", () => {
    render(<McpCockpit />);
    const first = screen.getByRole("button", { name: "1" });
    fireEvent.click(first);
    expect(screen.getByText(/1\/6|1\/\d/)).toBeTruthy();
  });

  it("validates a pasted public snapshot locally", async () => {
    const digest = new Uint8Array(32).fill(7);
    const subtle = {
      digest: vi.fn(async () => digest.buffer),
    };
    vi.stubGlobal("crypto", { subtle });

    render(<McpCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "Validate snapshot" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Schema valid/i);
    });
    expect(screen.getByRole("status").textContent).toContain("RUN-SYNTHETIC-PROOF-001");
    expect(subtle.digest).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
