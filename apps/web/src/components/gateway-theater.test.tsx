// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayTheater } from "./gateway-theater";
import {
  GATEWAY_THEATER_LABEL,
  GATEWAY_THEATER_LIMITATIONS,
  GATEWAY_THEATER_SCENARIOS,
} from "../lib/gateway-theater-demo";

afterEach(() => {
  cleanup();
});

describe("Gateway quorum theater", () => {
  it("states honesty rails and fixture theater labeling", () => {
    render(<GatewayTheater />);

    const boundary = screen.getByLabelText("Gateway honesty boundary").textContent ?? "";
    expect(boundary).toContain("NO LIVE CAPITAL");
    expect(boundary).toContain("NO BROKER CREDENTIALS");
    expect(boundary).toContain("NO COMPOSITE SAFETY SCORE");
    expect(boundary).toContain("NOT HARD BROKER GATEWAY");
    expect(boundary).toContain("FIXTURE THEATER");

    expect(screen.getByLabelText("Theater mode label").textContent).toContain(
      GATEWAY_THEATER_LABEL,
    );
    expect(document.body.textContent ?? "").toMatch(/authorizationConditionsSatisfied is not mayExecute/i);
    expect(document.body.textContent ?? "").toMatch(/full crypto evaluation is MCP\/CLI/i);
    expect(document.body.textContent ?? "").not.toMatch(
      /100\/100|agent certified|mayExecute=true|guaranteed safe/i,
    );

    for (const limit of GATEWAY_THEATER_LIMITATIONS) {
      expect(document.body.textContent ?? "").toContain(limit);
    }
  });

  it("renders authorize fixture checks and switches to deny / replay", () => {
    render(<GatewayTheater />);

    const authorize = GATEWAY_THEATER_SCENARIOS.find((s) => s.id === "authorize-quorum")!;
    expect(screen.getByRole("heading", { name: authorize.title })).toBeTruthy();
    expect(screen.getByLabelText("Authorization checks").textContent).toMatch(
      /approval\.roles-met/,
    );
    expect(screen.getByLabelText("Selected scenario summary").textContent).toMatch(
      /decision=authorize/,
    );

    fireEvent.click(screen.getByRole("tab", { name: /DENY/i }));
    expect(screen.getByLabelText("Selected scenario summary").textContent).toMatch(
      /decision=deny/,
    );
    expect(screen.getByLabelText("Authorization checks").textContent).toMatch(
      /approval\.roles-met/,
    );
    expect(screen.getByLabelText("Authorization checks").textContent).toMatch(/FAIL/);

    fireEvent.click(screen.getByRole("tab", { name: /REPLAY/i }));
    expect(screen.getByLabelText("Selected scenario summary").textContent).toMatch(
      /decision=replay/,
    );
    expect(screen.getByLabelText("Authorization checks").textContent).toMatch(
      /idempotency\.use-time-valid/,
    );
    expect(document.body.textContent ?? "").toMatch(/never submit again|return prior result/i);
  });

  it("runs Web Crypto 2-role signing demo when SubtleCrypto is available", async () => {
    if (typeof globalThis.crypto?.subtle === "undefined") {
      // jsdom environments without Web Crypto skip the live crypto path.
      render(<GatewayTheater />);
      expect(screen.getByRole("button", { name: /Run signing demo/i })).toBeTruthy();
      return;
    }

    render(<GatewayTheater />);
    fireEvent.click(screen.getByRole("button", { name: /Run signing demo/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Signing demo result")).toBeTruthy();
    });

    const result = screen.getByLabelText("Signing demo result").textContent ?? "";
    expect(result).toMatch(/all signatures valid/i);
    expect(result).toMatch(/owner/i);
    expect(result).toMatch(/risk/i);
    expect(result).toContain(GATEWAY_THEATER_LABEL);
  });
});
