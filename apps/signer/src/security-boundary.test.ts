import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const buildSource = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");

describe("signer source boundary", () => {
  it("contains no runtime network, Worker, arbitrary file, postMessage, or fixture private-key surface", () => {
    for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "new Worker", "postMessage", 'type="file"', "9d61b19deffd5a60"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("constructs inert DOM without a Trusted Types identity policy or HTML parsing sinks", () => {
    expect(source).toContain("replaceChildren");
    expect(source).toContain("textContent");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("outerHTML");
    expect(source).not.toContain("insertAdjacentHTML");
    expect(source).not.toContain("createPolicy");
    expect(source).not.toContain("DOMParser");
    expect(buildSource).toContain("require-trusted-types-for 'script'");
    expect(buildSource).toContain("trusted-types 'none'");
    expect(buildSource).not.toContain("trusted-types runbook-signer-static");
  });

  it("keeps staged activation exact and describes unavailable storage without claiming key loss", () => {
    expect(source).toContain("activateStagedDeviceAuthorKey");
    expect(source).toContain("Retry exact-key validation");
    expect(source).toContain("active.keyId !== staged.keyId");
    expect(source).toContain("no key was created or replaced");
    expect(source).toContain("cannot determine whether this is temporary storage failure");
    expect(source).toContain("Browser storage response at creation");
    expect(source).toContain("CAPSULE NOT SIGNED YET");
    expect(source).not.toContain("KEY NOT USED YET");
    expect(source).not.toContain("KEY LOST — SIGNING AUTHORITY UNAVAILABLE");
  });
});
