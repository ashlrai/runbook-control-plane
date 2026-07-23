import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_BROWSER_CAPSULE_BYTES,
  parseCapsuleWorkerResponse,
  validateCapsuleSelection,
} from "./capsule-worker-protocol";

async function frozenReceipt() {
  const path = fileURLToPath(new URL("../../../../conformance/expected/minimal-synthetic-root.receipt.json", import.meta.url));
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("capsule Worker protocol", () => {
  it("accepts a strictly shaped receipt response with outer archive identity", async () => {
    const receipt = await frozenReceipt();
    const response = parseCapsuleWorkerResponse({
      kind: "receipt",
      requestId: 4,
      receipt,
      receiptBytes: new ArrayBuffer(12),
      archiveSha256: "4a11da34f4f8ed3dcea6167f93e729dbbde7d69246e665d0b8616656eda74191",
    });

    expect(response).toMatchObject({ kind: "receipt", requestId: 4 });
  });

  it("rejects malformed, unknown, and archive-hash-free messages", async () => {
    const receipt = await frozenReceipt();
    expect(parseCapsuleWorkerResponse(null)).toBeNull();
    expect(parseCapsuleWorkerResponse({ kind: "ready", requestId: 0 })).toBeNull();
    expect(parseCapsuleWorkerResponse({ kind: "progress", requestId: 1, stage: "uploading" })).toBeNull();
    expect(parseCapsuleWorkerResponse({ kind: "receipt", requestId: 1, receipt, receiptBytes: new ArrayBuffer(2) })).toBeNull();
    expect(parseCapsuleWorkerResponse({ kind: "environment-error", requestId: 1, code: "signature.invalid" })).toBeNull();
  });

  it("enforces the browser allocation boundary before Worker dispatch", () => {
    expect(validateCapsuleSelection(0)).toBe("input.empty");
    expect(validateCapsuleSelection(1)).toBeNull();
    expect(validateCapsuleSelection(MAX_BROWSER_CAPSULE_BYTES)).toBeNull();
    expect(validateCapsuleSelection(MAX_BROWSER_CAPSULE_BYTES + 1)).toBe("input.size-limit");
    expect(validateCapsuleSelection(Number.NaN)).toBe("input.empty");
  });
});
