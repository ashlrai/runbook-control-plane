import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GrowthBaselineCapture } from "./growth-baseline-capture";

vi.mock("next/navigation", () => ({ usePathname: () => "/growth/baseline" }));

describe("Social baseline capture interface", () => {
  it("renders finite aggregate fields without identity or content collection", () => {
    const html = renderToStaticMarkup(<GrowthBaselineCapture />);

    expect(html).toContain("Social baseline capture");
    expect(html).toContain("Aggregate counts only");
    expect(html).toContain("Current bio variant");
    expect(html).not.toContain("type=\"text\"");
    expect(html).not.toContain("type=\"email\"");
    expect(html).not.toContain("type=\"file\"");
    expect(html).not.toMatch(/name="(username|postText|commentText|profileLink|tradeSymbol|screenshot)"/);
  });

  it("states the manual, local, and observational limits before save", () => {
    const html = renderToStaticMarkup(<GrowthBaselineCapture />);

    expect(html).toContain("No Robinhood access");
    expect(html).toContain("Local IndexedDB only");
    expect(html).toContain("Observational—not causal");
    expect(html).toContain("No historical reconstruction");
    expect(html).toContain("No ranking inference");
  });
});
