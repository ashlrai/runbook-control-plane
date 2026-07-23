// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistryExplorer } from "./registry-explorer";
import {
  DRIFT_ADDED_TOOLS,
  FIXTURE_SUMMARIES,
  TRADING_TOOL_COUNT,
} from "../lib/registry-explorer-data";

afterEach(() => cleanup());

describe("Capability Registry explorer", () => {
  it("states honesty boundary, assurance ladder, and full 50-tool inventory on first paint", () => {
    const { container } = render(<RegistryExplorer />);

    const boundary = screen.getByLabelText("Registry honesty boundary").textContent ?? "";
    expect(boundary).toContain("NOT LIVE INVENTORY");
    expect(boundary).toContain("NOT AUTHORIZATION");
    expect(boundary).toContain("NOT AFFILIATED WITH ROBINHOOD");

    const ladder = screen.getByLabelText("Assurance ladder").textContent ?? "";
    expect(ladder).toMatch(/Public-explicit names/i);
    expect(ladder).toMatch(/Public-derived risk labels/i);
    expect(ladder).toMatch(/NOT runtime inventory/i);

    expect(container.textContent).toContain(String(TRADING_TOOL_COUNT));
    expect(screen.getByText("place_equity_order")).toBeTruthy();
    expect(screen.getByText("get_financials")).toBeTruthy();
  });

  it("steps through the interactive 45→50 drift theater without network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<RegistryExplorer />);

    expect(screen.getByText(/Trading 45 · deterministic baseline/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next drift step" }));
    expect(screen.getByText(/Documentation delta · five names appear/i)).toBeTruthy();
    for (const name of DRIFT_ADDED_TOOLS) {
      expect(screen.getByText(`+ ${name}`)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("tab", { name: /Risk reject/i }));
    expect(screen.getByText(/Risk-correction candidate · reject/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("loads frozen fixture admit/reject language without network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<RegistryExplorer />);

    fireEvent.click(screen.getByRole("button", { name: /Trading 50 risk correction/i }));
    expect(screen.getAllByText(/Reject · unknownRiskDecision: reject/i).length).toBeGreaterThan(0);
    expect(screen.getByText(FIXTURE_SUMMARIES[2]!.sha256)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("filters tools and shows live mutation class counts", () => {
    render(<RegistryExplorer />);
    const liveCounts = screen.getByLabelText("Live mutation class counts");
    const capitalLive = Array.from(liveCounts.querySelectorAll("button")).find((btn) =>
      (btn.textContent ?? "").includes("Capital-order"),
    );
    expect(capitalLive).toBeTruthy();
    fireEvent.click(capitalLive!);
    expect(screen.getByText("place_equity_order")).toBeTruthy();
    expect(screen.queryByText("get_accounts")).toBeNull();

    const live = liveCounts.textContent ?? "";
    expect(live).toMatch(/4/);
    expect(live).toMatch(/Capital-order/i);
  });

  it("shows banking credential-release honesty callout", () => {
    render(<RegistryExplorer />);
    expect(screen.getByText(/Credential-release is not spend authority/i)).toBeTruthy();
    expect(screen.getByText(/providerToolName is null/i)).toBeTruthy();
    expect(screen.getAllByText("providerToolName: null").length).toBeGreaterThan(0);
  });
});
