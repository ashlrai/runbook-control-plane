// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostedShowcase } from "./hosted-showcase";
import { BROWSER_SESSION_STORAGE_KEY } from "../lib/control-plane-session";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe("Hosted showcase", () => {
  it(
    "states hosted honesty rails and runs the control-plane story",
    async () => {
      render(<HostedShowcase />);

      const boundary = screen.getByLabelText("Hosted honesty boundary").textContent ?? "";
      expect(boundary).toContain("NO LIVE CAPITAL");
      expect(boundary).toContain("HOSTED LAB · BROWSER-LOCAL STATE");
      expect(boundary).toContain("NO COMPOSITE SAFETY SCORE");

      fireEvent.click(screen.getByRole("button", { name: /Run live control-plane story/i }));

      await waitFor(
        () => {
          const receipt = screen.getByLabelText("Showcase receipt JSON").textContent ?? "";
          expect(receipt).toContain("runbook.hosted-showcase.v1");
          expect(receipt).toContain('"success": true');
          expect(receipt).toContain('"brokerEffect": false');
          expect(receipt).toContain('"processDeniedBySession": true');
          expect(receipt).toContain("mismatch-session-denies");
        },
        { timeout: 30_000 },
      );

      expect(localStorage.getItem(BROWSER_SESSION_STORAGE_KEY)).toContain("Hosted showcase");
      const dualStep = document.querySelector('[data-step="dual-eval"]');
      expect(dualStep?.getAttribute("data-status")).toBe("ok");

      const continueLinks = screen.getByLabelText("Continue after showcase");
      const hrefs = Array.from(continueLinks.querySelectorAll("a")).map((a) =>
        a.getAttribute("href"),
      );
      expect(hrefs.some((h) => h?.startsWith("/session?sessionId="))).toBe(true);
      expect(hrefs).toContain("/verify");
      expect(hrefs).toContain("/theater");
      expect(hrefs.some((h) => h?.startsWith("/control-room?sessionId="))).toBe(true);
      expect(screen.getByRole("link", { name: /Download process claims/i })).toBeTruthy();
      const surfaceNote = screen.getByLabelText("Surface version after success").textContent ?? "";
      expect(surfaceNote).toMatch(/v0\.4\.4/);
      expect(surfaceNote).toMatch(/44 tools/);
    },
    35_000,
  );
});
