// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShadowLab } from "./shadow-lab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Shadow Process Lab", () => {
  it("states process-control boundary and curriculum metrics without composite scores", () => {
    const { container } = render(<ShadowLab />);
    const boundary = screen.getByLabelText("Shadow Lab honesty boundary").textContent ?? "";
    expect(boundary).toContain("PROCESS CONTROL LAB");
    expect(boundary).toContain("NO CAPITAL / NO BROKER");
    expect(boundary).toContain("NO COMPOSITE SCORE");

    const text = container.textContent ?? "";
    expect(text).toMatch(/process control quality/i);
    expect(text).toMatch(/not investment skill/i);
    expect(text).toMatch(/hardFalseAllows/i);
    expect(text).toMatch(/hardFalseDenies/i);
    expect(text).toMatch(/scenarioCount/i);
    expect(text).not.toMatch(/ROI|guaranteed safe|agent certified|processScore/i);
    expect(text).toMatch(/never a composite score/i);
  });

  it("renders curriculum scenario tickets with shouldAllow and engine results", () => {
    render(<ShadowLab />);
    expect(screen.getByText(/Clean allowlisted VTI buy/i)).toBeTruthy();
    expect(screen.getByText(/Denied meme equity GME/i)).toBeTruthy();
    expect(screen.getAllByText(/shouldAllow:/i).length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByText(/FALSE ALLOW|PROCESS CORRECT|FALSE DENY/).length).toBeGreaterThan(
      5,
    );
    expect(screen.getByLabelText("Hard false allows").textContent).toMatch(/[1-9]/);
  });

  it("runs one refinement generation and reduces false allows", () => {
    render(<ShadowLab />);
    const before = screen.getByLabelText("Hard false allows").textContent ?? "";
    const beforeCount = Number(before.replace(/\D/g, ""));
    expect(beforeCount).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Run refinement generation/i }));

    const after = screen.getByLabelText("Hard false allows").textContent ?? "";
    const afterCount = Number(after.replace(/\D/g, ""));
    expect(afterCount).toBeLessThan(beforeCount);
    expect(screen.getByRole("heading", { name: /Before → after this generation/i })).toBeTruthy();
    expect(screen.getByText("G1")).toBeTruthy();
  });

  it("runs until fixed point and reaches curriculum clean", () => {
    render(<ShadowLab />);
    fireEvent.click(screen.getByRole("button", { name: /Run until fixed point/i }));

    expect(screen.getByLabelText("Hard false allows").textContent).toMatch(/0/);
    expect(screen.getByLabelText("Hard false denies").textContent).toMatch(/0/);
    expect(screen.getByRole("heading", { name: /All scenarios process-correct/i })).toBeTruthy();
  });

  it("exports report download and copies policy JSON", async () => {
    const createObjectURL = vi.fn(() => "blob:shadow-lab");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });

    const click = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", { value: click });
      }
      return el;
    });

    render(<ShadowLab />);
    fireEvent.click(screen.getByRole("button", { name: /Run until fixed point/i }));
    fireEvent.click(screen.getByRole("button", { name: /Download JSON report/i }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Copy refined policy JSON for MCP/i }));
    expect(writeText).toHaveBeenCalled();
    const copied = String(writeText.mock.calls.at(0)?.at(0) ?? "");
    expect(copied).toContain("capitalBudget");
    expect(copied).toContain("allowedInstruments");
  });

  it("loads elite reference as curriculum-clean", () => {
    render(<ShadowLab />);
    fireEvent.click(screen.getByRole("button", { name: /Load elite reference/i }));
    expect(screen.getByLabelText("Hard false allows").textContent).toMatch(/0/);
    const metrics = screen.getByLabelText("Curriculum metrics strip");
    expect(within(metrics).getByLabelText("Process correct scenarios").textContent).toMatch(
      /1[0-9]/,
    );
  });

  it("runs a tournament and surfaces Pareto candidates with truth rail", () => {
    render(<ShadowLab />);
    fireEvent.click(screen.getByRole("tab", { name: /Tournament/i }));

    const truth = screen.getByLabelText("Tournament truth rail").textContent ?? "";
    expect(truth).toMatch(/NOT TRADING PERFORMANCE/i);
    expect(truth).toMatch(/CAPITAL 0/i);
    expect(truth).toMatch(/COMPOSITESCORE FALSE/i);

    fireEvent.click(screen.getByRole("button", { name: /Run tournament/i }));

    expect(screen.getByLabelText("Candidate count").textContent).toMatch(/[1-9]/);
    expect(screen.getByLabelText("Pareto count").textContent).toMatch(/[1-9]/);
    expect(screen.getByLabelText("Capital always zero").textContent).toMatch(/0/);
    expect(screen.getByText("reference-elite")).toBeTruthy();
    expect(screen.getAllByText("PARETO").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("region", { name: /Tournament candidates table/i })).toBeTruthy();

    // Adopt Pareto should switch back to refine with adopted policy.
    fireEvent.click(screen.getByRole("button", { name: /Adopt Pareto policy/i }));
    expect(screen.getByRole("tab", { name: /Refine loop/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByLabelText("Hard false allows")).toBeTruthy();
  });

  it("extracts meta-curriculum from sample fixture", () => {
    render(<ShadowLab />);
    fireEvent.click(screen.getByRole("tab", { name: /Meta-curriculum/i }));

    fireEvent.click(screen.getByRole("button", { name: /Load sample fixture/i }));
    const textarea = screen.getByLabelText(/Ledger-like JSON events/i) as HTMLTextAreaElement;
    expect(textarea.value.length).toBeGreaterThan(50);

    fireEvent.click(screen.getByRole("button", { name: /Extract \+ merge/i }));

    expect(screen.getByLabelText("Candidate count").textContent).toMatch(/[1-9]/);
    expect(screen.getByLabelText("Merged count").textContent).toMatch(/1[0-9]|[2-9]/);
    expect(screen.getByLabelText("Ledger mutated flag").textContent).toMatch(/false/);
    expect(screen.getByLabelText("Meta curriculum tags")).toBeTruthy();
    expect(screen.getByLabelText("Sample merged scenarios").children.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Re-evaluate working policy/i }));
    expect(screen.getByLabelText("Merged curriculum evaluation")).toBeTruthy();
    expect(screen.getByLabelText("Meta hard false allows")).toBeTruthy();
  });
});
