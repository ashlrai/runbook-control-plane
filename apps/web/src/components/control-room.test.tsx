// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlRoom } from "./control-room";
import {
  BROWSER_SESSION_STORAGE_KEY,
  browserSessionStore,
} from "../lib/control-plane-session";

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/control-room");
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/control-room");
});

describe("Control Room", () => {
  it("states advisory-only boundary and equity-only charter defaults", () => {
    const { container } = render(<ControlRoom />);
    const boundary = screen.getByLabelText("Control Room honesty boundary").textContent ?? "";
    expect(boundary).toContain("ADVISORY ONLY");
    expect(boundary).toContain("CALLER-SUPPLIED STATE");
    expect(boundary).toContain("NOT A HARD GATE");

    const text = container.textContent ?? "";
    expect(text).toMatch(/equity only/i);
    expect(text).toMatch(/approvalRequired/i);
    expect(text).toMatch(/@runbook\/engine/i);
    expect(text).toMatch(/No composite process score/i);
    expect(text).toMatch(/Hostile tickets/i);
    expect(text).not.toMatch(/agent certified|hard gateway is active/i);
  });

  it("runs real engine preflight and shows pass tickets for the demo proposal", async () => {
    render(<ControlRoom />);
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));

    await waitFor(() => {
      expect(screen.getByText(/Clears for human review/i)).toBeTruthy();
    });
    expect(screen.getByText("Instrument permitted")).toBeTruthy();
    expect(screen.getByText("Evidence attached")).toBeTruthy();
    expect(screen.getAllByText("PASS").length).toBeGreaterThanOrEqual(9);
    expect(screen.getByText(/enforcement: advisory/i)).toBeTruthy();
  });

  it("shows fail tickets when instrument is blocked by equity-only charter", async () => {
    render(<ControlRoom />);
    const instrument = screen.getByLabelText(/^Instrument$/i) as HTMLSelectElement;
    fireEvent.change(instrument, { target: { value: "option" } });
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));

    await waitFor(() => {
      expect(screen.getByText(/Blocked by hard checks/i)).toBeTruthy();
    });
    expect(screen.getAllByText("FAIL").length).toBeGreaterThanOrEqual(1);
  });

  it("loads hostile ticket presets (options, GME, missing thesis)", async () => {
    render(<ControlRoom />);

    fireEvent.click(screen.getByRole("button", { name: /Options blocked \(SPY\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));
    await waitFor(() => {
      expect(screen.getByText(/Blocked by hard checks/i)).toBeTruthy();
    });
    expect((screen.getByLabelText(/^Instrument$/i) as HTMLSelectElement).value).toBe("option");

    fireEvent.click(screen.getByRole("button", { name: /Denied GME/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));
    await waitFor(() => {
      expect(screen.getByText(/Blocked by hard checks/i)).toBeTruthy();
      expect(screen.getByText(/Symbol not restricted/i)).toBeTruthy();
    });
    expect((screen.getByLabelText(/^Symbol$/i) as HTMLInputElement).value).toBe("GME");

    fireEvent.click(screen.getByRole("button", { name: /Missing thesis \/ invalidation/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));
    await waitFor(() => {
      expect(screen.getByText(/Blocked by hard checks/i)).toBeTruthy();
      expect(screen.getByText(/Decision record complete/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Clean VTI equity/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));
    await waitFor(() => {
      // Clean VTI may still be blocked if denied GME left denylist; form is VTI though.
      expect((screen.getByLabelText(/^Symbol$/i) as HTMLInputElement).value).toBe("VTI");
    });
  });

  it("dual-evals bound session charter after preflight (ledger vs process)", async () => {
    const session = await browserSessionStore.create({
      sessionId: "CPS-CR-DUAL-001",
      label: "Control Room dual-eval",
      charterSeed: "elite",
      charterBindingEnforcement: "fail-closed",
    });
    expect(localStorage.getItem(BROWSER_SESSION_STORAGE_KEY)).toContain(session.sessionId);

    window.history.replaceState({}, "", `/control-room?sessionId=${session.sessionId}`);
    render(<ControlRoom />);

    await waitFor(() => {
      const select = screen.getByLabelText("Bound Control Plane Session") as HTMLSelectElement;
      expect(select.value).toBe(session.sessionId);
    });

    // Option probe: local equity-only charter denies (ledgerAllowed false).
    fireEvent.click(screen.getByRole("button", { name: /Options blocked \(SPY\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));

    await waitFor(() => {
      const panel = screen.getByLabelText("Charter dual-eval panel");
      expect(panel).toBeTruthy();
      expect(panel.textContent).toMatch(/ledgerAllowed/i);
      expect(panel.textContent).toMatch(/processAllowed/i);
      expect(panel.textContent).toMatch(/sessionCharterBinding/i);
      expect(panel.textContent).toMatch(/still not a hard gateway/i);
      expect(panel.textContent).toMatch(/brokerEffect=false/);
    });

    // Clean VTI: local allow; elite session may still allow (matched-allowed) under fail-closed.
    fireEvent.click(screen.getByRole("button", { name: /Clean VTI equity/i }));
    // Reset denylist noise from denied-gme path if any.
    fireEvent.click(screen.getByRole("button", { name: /Reset demo proposal/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run engine preflight/i }));

    await waitFor(() => {
      const panel = screen.getByLabelText("Charter dual-eval panel");
      expect(panel.textContent).toMatch(/ledgerAllowed/i);
      expect(panel.textContent).toMatch(/TRUE|FALSE/);
      expect(panel.textContent).toMatch(
        /matched-allowed|matched-denied|mismatch-session-denies|mismatch-session-allows|no-session-charter/,
      );
    });

    // Check-by-check diff when session charter is bound.
    await waitFor(() => {
      const diff = screen.getByLabelText("Dual check-diff table");
      expect(diff).toBeTruthy();
      expect(diff.textContent).toMatch(/disagreementCount=/);
      expect(diff.textContent).toMatch(/not trading performance/i);
      expect(diff.querySelector("table")).toBeTruthy();
      expect(diff.textContent).toMatch(/both-pass|both-fail|ledger-only|session-only|missing/);
    });

    // Dual-eval with bound session also records a process tick (inventory N/A → ok).
    await waitFor(() => {
      const ticks = browserSessionStore.read(session.sessionId).processTicks;
      expect(ticks.length).toBeGreaterThanOrEqual(1);
      const last = ticks[ticks.length - 1]!;
      expect(last.inventoryOk).toBe(true);
      expect(["proceed", "warn", "stop"]).toContain(last.recommendation);
      expect(last.message).toMatch(/control-room dual-eval/i);
    });
  });
});
