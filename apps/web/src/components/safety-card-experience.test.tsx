// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafetyCardExperience } from "./safety-card-experience";

afterEach(() => cleanup());

describe("Synthetic Control Self-Test experience", () => {
  it("puts the complete truth boundary and coverage gap on the first render", () => {
    render(<SafetyCardExperience />);

    const boundary = screen.getByLabelText("Current evidence boundary").textContent ?? "";
    expect(boundary).toContain("REFERENCE CONTROL SELF-TEST");
    expect(boundary).toContain("SYNTHETIC ONLY");
    expect(boundary).toContain("4 OF 30 SCENARIOS IMPLEMENTED");
    expect(boundary).toContain("NO AGENT OR BROKER CONNECTION");
    expect(screen.getByRole("heading", { name: "Twenty-six hostile scenarios are not implemented." })).toBeTruthy();
    expect(screen.getByText("A successful reproduction is not an Agent Safety Card.")).toBeTruthy();
  });

  it("really reruns the frozen local corpus and reveals exact scenario findings", () => {
    render(<SafetyCardExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Reproduce reference behavior" }));

    expect(screen.getByRole("status").textContent).toContain("REFERENCE BEHAVIOR REPRODUCED");
    expect(screen.getByLabelText("Wrong account finding codes").textContent).toContain("account-out-of-scope");
    expect(screen.getByLabelText("Wrong account finding codes").textContent).toContain("action-denied");
    expect(screen.getByLabelText("Undocumented mutation tool finding codes").textContent).toContain("capability-undocumented");
    expect(screen.getByLabelText("Mutation-class drift finding codes").textContent).toContain("capability-mutation-escalated");
    expect(screen.getByLabelText("Input-schema drift finding codes").textContent).toContain("capability-input-schema-changed");
    expect(screen.getAllByText("Expected finding set reproduced")).toHaveLength(4);
  });

  it("does not use storage or network during the reference run", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const localGet = vi.spyOn(Storage.prototype, "getItem");
    render(<SafetyCardExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Reproduce reference behavior" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    localSet.mockRestore();
    localGet.mockRestore();
  });

  it("keeps the commercial and cryptographic claims narrow", () => {
    const { container } = render(<SafetyCardExperience />);
    const text = container.textContent ?? "";

    expect(text).toContain("Bring us the agent—not the credentials.");
    expect(text).toContain("$5k–$15k");
    expect(text).toContain("not open for payment");
    expect(text).toContain("self-asserted signature");
    expect(text).not.toMatch(/100\/100|safety score|agent verified|agent certified|guaranteed safe|Robinhood approved/i);
    expect(container.querySelectorAll("a[href^='http']")).toHaveLength(0);
    expect(container.querySelector("form")).toBeNull();
  });
});
