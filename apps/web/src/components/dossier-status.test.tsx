// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DossierStatus } from "./dossier-status";
import {
  DOSSIER_CASES,
  DOSSIER_COUNTS,
  FINANCE_030_DETAIL,
  PROCESS_BRIDGED_IDS,
} from "../lib/dossier-status-data";

afterEach(() => cleanup());

describe("Dossier status board", () => {
  it("states architecture-evidence honesty and correct coverage counts", () => {
    const { container } = render(<DossierStatus />);
    const boundary = screen.getByLabelText("Dossier honesty boundary").textContent ?? "";
    expect(boundary).toContain("ARCHITECTURE EVIDENCE");
    expect(boundary).toContain("NOT BUYER-READY");
    expect(boundary).toContain("NOT A SAFETY SCORE");
    expect(boundary).toContain("030 NOT FULL PROCESS-BRIDGE");

    expect(screen.getByText(String(DOSSIER_COUNTS.total))).toBeTruthy();
    expect(screen.getByText(String(DOSSIER_COUNTS.processBridged))).toBeTruthy();
    expect(screen.getByText(String(DOSSIER_COUNTS.unrun))).toBeTruthy();

    const text = container.textContent ?? "";
    expect(text).toMatch(/not buyer-ready/i);
    expect(text).toMatch(/Five process-bridged/i);
    expect(text).toMatch(/host-seeded recover process evidence/i);
    expect(text).toMatch(/Kill grammar is designed, not shipped/i);
    expect(text).not.toMatch(/100\/100|agent certified|buyer-ready certified|safety score: /i);
  });

  it("renders all 31 cases with process-bridged ids marked and 030 host-only detail", () => {
    render(<DossierStatus />);
    expect(DOSSIER_CASES).toHaveLength(31);
    for (const id of PROCESS_BRIDGED_IDS) {
      expect(screen.getByText(id)).toBeTruthy();
    }
    expect(screen.getByText("finance-030-crash-around-idempotency-claim")).toBeTruthy();
    expect(screen.getByText(FINANCE_030_DETAIL)).toBeTruthy();
    expect(screen.getAllByText("Process-bridged").length).toBeGreaterThanOrEqual(
      PROCESS_BRIDGED_IDS.length,
    );
    expect(screen.getAllByText("Host-only").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Unrun").length).toBeGreaterThanOrEqual(DOSSIER_COUNTS.unrun);
  });

  it("links to session, safety-card, registry, and MCP", () => {
    const { container } = render(<DossierStatus />);
    const hrefs = Array.from(container.querySelectorAll("a"))
      .map((a) => a.getAttribute("href"))
      .filter(Boolean);
    expect(hrefs).toContain("/session");
    expect(hrefs).toContain("/safety-card");
    expect(hrefs).toContain("/registry");
    expect(hrefs).toContain("/mcp");
    expect(hrefs).toContain("/control-room");
  });

  it("offers attach-to-session panel with architecture-evidence honesty", () => {
    const { container } = render(<DossierStatus />);
    expect(screen.getByRole("heading", { name: /Attach to session/i })).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toMatch(/architecture evidence/i);
    expect(text).toMatch(/not certification/i);
    expect(text).not.toMatch(/buyer-ready certified|agent certified/i);
  });
});
