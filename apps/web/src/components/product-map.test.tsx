// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductMap } from "./product-map";

afterEach(() => cleanup());

describe("Product map landing", () => {
  it("renders five primary doors with hosted showcase first and honest product language", () => {
    render(<ProductMap />);

    const boundary = screen.getByLabelText("Product boundary").textContent ?? "";
    expect(boundary).toContain("NO LIVE CAPITAL");
    expect(boundary).toContain("NO BROKER CREDENTIALS");
    expect(boundary).toContain("NO COMPOSITE SAFETY SCORE");
    expect(boundary).toContain("HOSTED LAB · BROWSER-LOCAL STATE");

    expect(screen.getByRole("heading", { name: /Five doors/i })).toBeTruthy();
    expect(document.body.textContent ?? "").toMatch(/Session is the spine/i);
    expect(screen.getByRole("link", { name: /Hosted control-plane story/i }).getAttribute("href")).toBe(
      "/showcase",
    );
    const sessionDoors = screen.getAllByRole("link", { name: /Control Plane Session/i });
    expect(sessionDoors[0]?.getAttribute("href")).toBe("/session");
    expect(screen.getByRole("link", { name: /Break the agent safely/i }).getAttribute("href")).toBe(
      "/safety-card",
    );
    expect(screen.getByRole("link", { name: /Verify portable evidence/i }).getAttribute("href")).toBe(
      "/verify",
    );
    expect(
      screen.getByRole("link", { name: /Record a human-owned experiment/i }).getAttribute("href"),
    ).toBe("/experiments/new");
  });

  it("surfaces showcase, session, registry, control room, dossier, and MCP as first-class product links", () => {
    const { container } = render(<ProductMap />);
    const text = container.textContent ?? "";
    const hrefs = Array.from(container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href"))
      .filter(Boolean);

    expect(hrefs).toContain("/showcase");
    expect(hrefs).toContain("/theater");
    expect(hrefs).toContain("/session");
    expect(hrefs).toContain("/registry");
    expect(hrefs).toContain("/control-room");
    expect(hrefs).toContain("/shadow-lab");
    expect(hrefs).toContain("/dossier");
    expect(hrefs).toContain("/mcp");
    expect(hrefs).toContain("/lineage");
    expect(text).toContain("Research history");
    expect(text).toContain("$499 lab fit check");
    expect(text).toContain("Historical commercial hypothesis");
    expect(text).toMatch(/Control Plane Session/i);
    expect(text).toMatch(/Process Theater/i);
    expect(text).toMatch(/Control Room/i);
    expect(text).toMatch(/Shadow Process Lab/i);
    expect(text).toMatch(/Dossier status/i);
    expect(text).toMatch(/NO COMPOSITE SAFETY SCORE/i);
    expect(text).not.toMatch(/100\/100|agent certified|guaranteed safe|agent verified/i);
  });
});

