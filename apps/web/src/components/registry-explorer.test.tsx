// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistryExplorer } from "./registry-explorer";
import {
  BROWSER_SESSION_STORAGE_KEY,
  browserSessionStore,
} from "../lib/control-plane-session";
import {
  DRIFT_ADDED_TOOLS,
  FIXTURE_SUMMARIES,
  TRADING_TOOL_COUNT,
} from "../lib/registry-explorer-data";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

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

  it("pins trading tools and observation-only preset into a browser session", async () => {
    render(<RegistryExplorer />);

    fireEvent.click(
      screen.getByRole("button", { name: /Pin trading tools as session inventory/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/tools pinned/i);
    });
    expect(screen.getByRole("status").textContent).toMatch(/tool count: 50/);
    expect(screen.getByRole("status").textContent).toMatch(/not broker authorization/i);

    const fullLink = screen.getByRole("link", { name: /Open session/i });
    const sessionHref = fullLink.getAttribute("href") ?? "";
    expect(sessionHref).toMatch(/^\/session\?sessionId=/);

    const sessionId = decodeURIComponent(sessionHref.split("sessionId=")[1]!);
    const session = browserSessionStore.read(sessionId);
    expect(session.label).toBe("Registry pin handoff");
    expect(session.inventoryPin?.tools).toHaveLength(50);
    expect(session.brokerEffect).toBe(false);
    expect(localStorage.getItem(BROWSER_SESSION_STORAGE_KEY)).toContain(sessionId);

    fireEvent.click(screen.getByRole("button", { name: /Pin observation-only preset/i }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/observation-only/);
    });
    const obs = browserSessionStore.read(sessionId);
    expect(obs.inventoryPin?.tools.every((t) => t.effectClass === "observation")).toBe(true);
    expect((obs.inventoryPin?.tools.length ?? 0) > 0).toBe(true);
    expect(obs.inventoryPin?.tools.some((t) => t.effectClass === "capital-order-mutation")).toBe(
      false,
    );
    expect(screen.getByRole("status").textContent).toMatch(
      new RegExp(`tool count: ${obs.inventoryPin!.tools.length}`),
    );
  });
});
