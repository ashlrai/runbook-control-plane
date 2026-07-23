import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProofCapsulePage } from "./proof-capsule-page";

function renderPage() {
  return renderToStaticMarkup(<ProofCapsulePage />);
}

describe("Proof Capsule public page", () => {
  it("keeps the synthetic and current-state boundaries visible", () => {
    const html = renderPage();

    expect(html).toContain("SYNTHETIC");
    expect(html).toContain("Current-state boundary");
    expect(html).toContain("browser-native");
    expect(html).toContain("frozen synthetic golden/tampered receipts");
    expect(html).toContain("same-project draft implementation");
    expect(html).toContain("Challenge design preview");
    expect(html).toContain("Signed child export, submissions, and enrollment are not open");
    expect(html).toContain("does not upload or render capsule content");
    expect(html).toContain("not independent interoperability evidence");
    expect(html).toContain("not verified returns");
    expect(html).toContain("TARGETS, NOT RESULTS");
  });

  it("describes the exact frozen corpus without turning the checkpoint ID into a transport hash", () => {
    const html = renderPage();

    expect(html).toContain("minimal-synthetic-root");
    expect(html).toContain("66b200560e20f723ece402931277043b");
    expect(html).toContain("85316687aac30f73c4da6a4d5a323578");
    expect(html).toContain("SAME IN BOTH TRANSPORT FILES");
    expect(html).toContain("{&quot;dataClass&quot;:&quot;synthetic&quot;}");
    expect(html).toContain("{&quot;dataClass&quot;:&quot;synthetix&quot;}");
    expect(html).toContain("one payload byte changed after signing");
    expect(html).toContain("There is no experiment result in either fixture");
    expect(html).toContain("4a11da34f4f8ed3dcea6167f93e729db");
    expect(html).toContain("bde7d69246e665d0b8616656eda74191");
    expect(html).toContain("eed412e23ce2a4c51c3e216a451585b8");
    expect(html).toContain("a82d9ad761e7dbfbe885f515b3a465e4");
    expect(html).not.toContain("policy.maxOrder");
  });

  it("explains Verify to Clone and the exact founding offer without implying success", () => {
    const html = renderPage();

    expect(html).toContain("Fork the rules, not the trade");
    expect(html).toContain("Proposed 30-day challenge");
    expect(html).toContain("Draft an unsigned starter");
    expect(html).toContain("An unsigned starter is not a proof capsule, does not create valid lineage");
    expect(html).toContain("Verification stays free");
    expect(html).toContain("$499");
    expect(html).toContain("Five target pilots");
    expect(html).toContain("enrollment not open");
    expect(html).toContain("No investment advice, signals, account management");
  });

  it("uses only local or fragment calls to action", () => {
    const html = renderPage();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href.startsWith("/") || href.startsWith("#"))).toBe(true);
    expect(hrefs.some((href) => /^https?:/i.test(href))).toBe(false);
    expect(hrefs).toContain("/lab/apply");
    expect(hrefs).toContain("/verify");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("target=\"_blank\"");
  });
});
