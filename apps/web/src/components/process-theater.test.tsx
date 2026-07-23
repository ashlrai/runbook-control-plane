// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcessTheater } from "./process-theater";
import { BROWSER_SESSION_STORAGE_KEY } from "../lib/control-plane-session";
import { EXPERIMENT_ID } from "../lib/sample-ledger-events";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe("Process Theater", () => {
  it("states hosted honesty rails and agent process eval panel", () => {
    render(<ProcessTheater />);
    const boundary = screen.getByLabelText("Hosted honesty boundary").textContent ?? "";
    expect(boundary.length).toBeGreaterThan(0);

    expect(screen.getByRole("heading", { name: /Agent process eval/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Load sample ledger & evaluate/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Operator scenario probe/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/composite score/i);
    expect(document.body.textContent).not.toMatch(/100\/100|agent certified|safety score:/i);
  });

  it("loads sample ledger and renders multi-axis process eval without composite score", () => {
    render(<ProcessTheater />);
    fireEvent.click(screen.getByRole("button", { name: /Load sample ledger & evaluate/i }));

    expect(screen.getByLabelText("Process axes")).toBeTruthy();
    expect(screen.getByText("Active charter present")).toBeTruthy();
    expect(screen.getByText("Charter requires approval")).toBeTruthy();
    expect(screen.getByText("Every proposal has preflight")).toBeTruthy();

    const summary = screen.getByLabelText("Agent eval summary").textContent ?? "";
    expect(summary).toMatch(/processCorrect/);
    expect(summary).toMatch(/true/);
    expect(summary).toMatch(/compositeScore/);
    expect(summary).toMatch(/false · never/);

    const limitations = screen.getByLabelText("Agent eval limitations").textContent ?? "";
    expect(limitations).toContain("no-composite-safety-or-skill-score");
    expect(limitations).toContain("not-pnl");
    expect(limitations).toContain("notTradingPerformance=true");
    expect(limitations).toContain("compositeScore=false");

    expect(screen.getByText(new RegExp(EXPERIMENT_ID))).toBeTruthy();
    expect(localStorage.getItem(BROWSER_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("evaluates operator scenario probe with HFA/HFD only — never composite score", () => {
    render(<ProcessTheater />);

    fireEvent.change(screen.getByLabelText("Operator scenario id"), {
      target: { value: "deny-gme" },
    });
    fireEvent.change(screen.getByLabelText("Operator scenario label"), {
      target: { value: "Expect deny GME" },
    });
    fireEvent.change(screen.getByLabelText("Operator scenario symbol"), {
      target: { value: "GME" },
    });
    fireEvent.change(screen.getByLabelText("Operator scenario instrument"), {
      target: { value: "equity" },
    });
    // shouldAllow=false is the default for the probe form.

    fireEvent.click(screen.getByRole("button", { name: /Evaluate operator scenario/i }));

    const result = screen.getByLabelText("Operator scenario eval result");
    expect(result).toBeTruthy();
    expect(result.textContent).toMatch(/hardFalseAllows/);
    expect(result.textContent).toMatch(/hardFalseDenies/);
    expect(result.textContent).toMatch(/compositeScore=false/);
    expect(result.textContent).toMatch(/notTradingPerformance|elite-reference|session-charter/);
    expect(document.body.textContent).not.toMatch(/100\/100|agent certified|safety score:/i);
  });
});
