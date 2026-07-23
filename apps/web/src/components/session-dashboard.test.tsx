// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDashboard } from "./session-dashboard";
import {
  BROWSER_SESSION_STORAGE_KEY,
  browserSessionStore,
} from "../lib/control-plane-session";

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
    expect(hrefs).toContain("/gateway");

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/100\/100|agent certified|buyer-ready certified|safety score:/i);
  });

  it("runs refine into session, shows HFA/HFD trend, and deep-links Shadow Lab", async () => {
    render(<SessionDashboard />);

    fireEvent.change(screen.getByLabelText("Charter seed policy"), {
      target: { value: "weak" },
    });
    fireEvent.change(screen.getByLabelText("Session label"), {
      target: { value: "Refine bind demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create session/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Refine bind demo/i })).toBeTruthy();
    });

    const sessionId = browserSessionStore.list()[0]!.sessionId;
    expect(
      screen.getByRole("link", { name: /Open in Shadow Lab/i }).getAttribute("href"),
    ).toBe(`/shadow-lab?sessionId=${sessionId}`);

    fireEvent.click(screen.getByRole("button", { name: /Run refine into session/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Shadow HFA HFD trend")).toBeTruthy();
      expect(screen.getByText(/charter updated · not investment skill/i)).toBeTruthy();
    });

    const session = browserSessionStore.read(sessionId);
    expect(session.shadowGenerations.length).toBeGreaterThan(0);
    expect(session.lastShadowHardFalseAllows).toBe(0);
    expect(session.charter).toBeDefined();
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
      // Status note after pin — button label always contains "50 tools", so do not match that alone.
      expect(screen.getByText(/Pinned public-docs inventory/i)).toBeTruthy();
      expect(screen.getByLabelText("Inventory pin digest")).toBeTruthy();
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

  it("clones an elite session via Deny GME challenge and selects the child", async () => {
    render(<SessionDashboard />);

    fireEvent.change(screen.getByLabelText("Charter seed policy"), {
      target: { value: "elite" },
    });
    fireEvent.change(screen.getByLabelText("Session label"), {
      target: { value: "Elite parent challenge" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create session/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Elite parent challenge/i })).toBeTruthy();
    });

    const parentId = browserSessionStore.list()[0]!.sessionId;
    expect(screen.getByLabelText("Clone and challenge")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Deny GME/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Challenge: Deny GME/i })).toBeTruthy();
      // Status note carries receipt JSON summary (distinct from section honesty copy).
      expect(screen.getByText(/Clone & challenge · Deny GME/i)).toBeTruthy();
    });

    const sessions = browserSessionStore.list();
    expect(sessions.length).toBe(2);
    const child = sessions.find((s) => s.sessionId !== parentId);
    expect(child).toBeDefined();
    expect(child!.label).toMatch(/Challenge: Deny GME/);
    expect(child!.label).toContain(parentId);
    expect(child!.charter?.deniedSymbols.map((s) => s.toUpperCase())).toContain("GME");
    expect(child!.notes.some((n) => n.includes("clone-challenge") && n.includes(parentId))).toBe(
      true,
    );
    expect(child!.charterBindingEnforcement).toBe(
      browserSessionStore.read(parentId).charterBindingEnforcement,
    );

    // Child is selected after challenge.
    const childOption = screen.getByRole("option", { name: /Challenge: Deny GME/i });
    expect(childOption.getAttribute("aria-selected")).toBe("true");

    const note = screen.getByText(/Clone & challenge · Deny GME/i).textContent ?? "";
    expect(note).toMatch(/not safer strategy/i);
    expect(note).toMatch(/not returns/i);
    expect(note).toMatch(/runbook\.clone-challenge\.v1/);
  });

  it("cycles charter binding and process-denies option under fail-closed dual-eval", async () => {
    render(<SessionDashboard />);

    fireEvent.change(screen.getByLabelText("Charter seed policy"), {
      target: { value: "elite" },
    });
    fireEvent.change(screen.getByLabelText("Session label"), {
      target: { value: "Dual-eval demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create session/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Dual-eval demo/i })).toBeTruthy();
    });

    expect(screen.getByLabelText("Charter binding enforcement").textContent).toMatch(/warn/i);

    fireEvent.click(screen.getByRole("button", { name: /Cycle charter binding/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Charter binding enforcement").textContent).toMatch(
        /fail-closed/i,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Dual-eval option probe/i }));
    await waitFor(() => {
      const panel = screen.getByLabelText("Charter dual-eval result");
      expect(panel).toBeTruthy();
      expect(panel.textContent).toMatch(/PROCESS DENY \(session\)/);
      expect(panel.textContent).toMatch(/mismatch-session-denies/);
      expect(panel.textContent).toMatch(/processDeniedBySession=true/);
      expect(panel.textContent).toMatch(/brokerEffect=false/);
      expect(panel.textContent).toMatch(/ledgerAllowed=true/);
      expect(panel.textContent).toMatch(/processAllowed=false/);
    });

    const sessionId = browserSessionStore.list()[0]!.sessionId;
    expect(browserSessionStore.read(sessionId).charterBindingEnforcement).toBe("fail-closed");
  });

  it("imports tools/list sample JSON and fail-closes on place_crypto_order_unknown", async () => {
    render(<SessionDashboard />);

    fireEvent.change(screen.getByLabelText("Session label"), {
      target: { value: "Tools list import" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create session/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Tools list import/i })).toBeTruthy();
    });

    // Import UI only when pin exists.
    expect(screen.queryByLabelText("tools/list inventory import")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Pin public-docs inventory/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("tools/list inventory import")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Load sample tools\/list/i }));
    const textarea = screen.getByLabelText("tools/list JSON paste area") as HTMLTextAreaElement;
    expect(textarea.value).toContain("place_crypto_order_unknown");

    fireEvent.click(screen.getByRole("button", { name: /Import & check against pin/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("tools/list import result")).toBeTruthy();
      expect(screen.getByText("IMPORT FAIL-CLOSED")).toBeTruthy();
      expect(screen.getByText(/unknownTools: place_crypto_order_unknown/i)).toBeTruthy();
      expect(screen.getByText(/ok=false/i)).toBeTruthy();
    });
  });

  it("imports a session evidence pack JSON and offers browser seal button", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:claims");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    // Seed a pack from a real browser session export shape.
    const seed = await browserSessionStore.create({
      label: "Pack seed",
      charterSeed: "elite",
    });
    const pack = await browserSessionStore.exportPack(seed.sessionId);
    browserSessionStore.delete(seed.sessionId);

    render(<SessionDashboard />);

    fireEvent.change(screen.getByLabelText("Session evidence pack JSON paste area"), {
      target: { value: JSON.stringify(pack) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import pack into local store/i }));

    await waitFor(() => {
      expect(screen.getByText(/Imported evidence pack/i)).toBeTruthy();
      expect(screen.getByRole("option", { name: /Pack seed/i })).toBeTruthy();
    });

    expect(
      screen.getByRole("button", { name: /Seal process capsule \(\.runbook\)/i }),
    ).toBeTruthy();

    const seal = screen.getByLabelText("Seal capsule note").textContent ?? "";
    expect(seal).toMatch(/self-asserted|ephemeral/i);
    expect(seal).toMatch(/not identity|not broker-issued/i);
    expect(seal).toMatch(/not returns|not certification/i);
    expect(seal).toMatch(/runbook_session_seal_capsule/i);

    fireEvent.click(screen.getByRole("button", { name: /Export process claims JSON/i }));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    const text = await blob.text();
    const claims = JSON.parse(text) as {
      schemaVersion: string;
      capitalAtRisk: number;
      brokerEffect: boolean;
      compositeScore: boolean;
    };
    expect(claims.schemaVersion).toBe("runbook.control-plane-claims.v1");
    expect(claims.capitalAtRisk).toBe(0);
    expect(claims.brokerEffect).toBe(false);
    expect(claims.compositeScore).toBe(false);

    clickSpy.mockRestore();
  });

  it("exposes Seal process capsule button on a live session", async () => {
    render(<SessionDashboard />);

    fireEvent.change(screen.getByLabelText("Session label"), {
      target: { value: "Seal button surface" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create session/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Seal button surface/i })).toBeTruthy();
    });

    const sealBtn = screen.getByRole("button", { name: /Seal process capsule \(\.runbook\)/i });
    expect(sealBtn).toBeTruthy();
    expect((sealBtn as HTMLButtonElement).disabled).toBe(false);

    const note = screen.getByLabelText("Seal capsule note").textContent ?? "";
    expect(note).toMatch(/synthetic|self-asserted/i);
    expect(note).toMatch(/not identity/i);
    expect(note).toMatch(/not broker-issued/i);
  });
});
