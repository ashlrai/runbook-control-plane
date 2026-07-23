import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("production capsule Worker bundle", () => {
  it("is executable browser JavaScript rather than a copied TypeScript module", async () => {
    const path = fileURLToPath(new URL("../../public/proof-capsule.worker.js", import.meta.url));
    const source = await readFile(path, "utf8");

    expect(source).toContain('addEventListener("message"');
    expect(source).not.toMatch(/@runbook\/capsule-browser|import\s+type|DedicatedWorkerGlobalScope/);
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|indexedDB|localStorage|sessionStorage)\b/);
  });
});
