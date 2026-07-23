// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDashboard } from "./session-dashboard";
import { BROWSER_SESSION_STORAGE_KEY } from "../lib/control-plane-session";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe("Session dashboard", () => {
  it("states honesty rails and related product links", () => {
    render(<SessionDashboard />);
    const boundary = screen.getByLabelText("Session honesty boundary").textContent ?? "";
    expect(boundary).toContain("LOCAL PROCESS EVIDENCE");
    expect(boundary).toContain("NOT HARD GATEWAY");
    expect(boundary).toContain("NO COMPOSITE SAFETY SCORE");
    expect(boundary).toContain("BROWSER LOCALSTORAGE ONLY");

    const hrefs = Array.from(document.querySelectorAll("a"))
      .map((a) => a.getAttribute("href"))
      .filter(Boolean);
    expect(hrefs).toContain("/shadow-lab");
    expect(hrefs).toContain("/control-room");
    expect(hrefs).toContain("/dossier");
    expect(hrefs).toContain("/mcp");

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/100\/100|agent certified|buyer-ready certified|safety score:/i);
  });

  it("creates a session, pins inventory, fail-closes sample check, attaches dossier, exports pack", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:session-pack");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    render(<SessionDashboard />);

    fireEvent.change(screen.getByLabelText("Session label"), {
      target: { value: "Dashboard demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create session/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Dashboard demo/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Pin public-docs inventory/i }));
    await waitFor(() => {
      expect(screen.getByText(/50 tools/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Check sample observed list/i }));
    await waitFor(() => {
      expect(screen.getByText("FAIL-CLOSED")).toBeTruthy();
      expect(screen.getByText(/unknown: place_crypto_order_unknown/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Attach dossier status snapshot/i }));
    await waitFor(() => {
      expect(screen.getByText(/architecture-evidence-not-certification/i)).toBeTruthy();
      expect(screen.getByText(/processBridgedCount=5/i)).toBeTruthy();
    });

    // Spy only for the export click path (avoid mocking createElement for React renders).
    const anchorProto = HTMLAnchorElement.prototype;
    const clickSpy = vi.spyOn(anchorProto, "click").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: /Export evidence pack/i }));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    expect(createObjectURL.mock.calls.length).toBeGreaterThan(0);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe("application/json");
    const text = await blob.text();
    const pack = JSON.parse(text) as {
      schemaVersion: string;
      notTradingPerformance: boolean;
      brokerEffect: boolean;
      compositeScore: boolean;
      session: { label: string; inventoryPin?: { tools: unknown[] } };
    };
    expect(pack.schemaVersion).toBe("runbook.session-evidence-pack.v1");
    expect(pack.notTradingPerformance).toBe(true);
    expect(pack.brokerEffect).toBe(false);
    expect(pack.compositeScore).toBe(false);
    expect(pack.session.label).toBe("Dashboard demo");
    expect(pack.session.inventoryPin?.tools).toHaveLength(50);

    expect(localStorage.getItem(BROWSER_SESSION_STORAGE_KEY)).toContain("Dashboard demo");
    clickSpy.mockRestore();
  });
});
