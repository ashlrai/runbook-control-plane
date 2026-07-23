import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BROWSER_FIXTURES, decodeBrowserFixture } from "./browser-fixtures";

describe("embedded synthetic browser fixtures", () => {
  for (const kind of ["golden", "tampered"] as const) {
    it(`${kind} bytes exactly match the frozen conformance fixture`, async () => {
      const fixture = BROWSER_FIXTURES[kind];
      const source = fileURLToPath(new URL(`../../../../conformance/fixtures/${fixture.filename}`, import.meta.url));
      const expected = await readFile(source);
      const decoded = decodeBrowserFixture(kind);

      expect(Buffer.from(decoded)).toEqual(expected);
      expect(decoded).toHaveLength(4_522);
      expect(createHash("sha256").update(decoded).digest("hex")).toBe(fixture.sha256);
    });
  }

  it("keeps the valid and tampered archive transport identities distinct", () => {
    expect(BROWSER_FIXTURES.golden.sha256).not.toBe(BROWSER_FIXTURES.tampered.sha256);
    expect(decodeBrowserFixture("golden")).not.toEqual(decodeBrowserFixture("tampered"));
  });
});
