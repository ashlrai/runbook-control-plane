// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlRoom } from "./control-room";

afterEach(() => cleanup());

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
});
