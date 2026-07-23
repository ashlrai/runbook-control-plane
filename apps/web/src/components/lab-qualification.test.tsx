import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabQualification } from "./lab-qualification";

describe("Founding Creator Lab fit-check interface", () => {
  it("renders only enumerated radio choices and local buttons", () => {
    const html = renderToStaticMarkup(<LabQualification />);

    expect(html).toContain("Check the fit");
    expect(html.match(/type="radio"/g)).toHaveLength(18);
    expect(html).not.toContain("type=\"text\"");
    expect(html).not.toContain("type=\"email\"");
    expect(html).not.toContain("type=\"file\"");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("action=");
  });

  it("states every non-collection and human-review boundary before interaction", () => {
    const html = renderToStaticMarkup(<LabQualification />);

    expect(html).toContain("No name, email, profile, account, or brokerage data is requested");
    expect(html).toContain("Browser storage");
    expect(html).toContain("Answer submission");
    expect(html).toContain("Loading and navigating the site still use ordinary web requests");
    expect(html).toContain("Automated acceptance");
    expect(html).toContain("Human review remains mandatory");
    expect(html).toContain("local-answer fit check, not an application submission");
  });
});
