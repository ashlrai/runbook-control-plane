// @vitest-environment jsdom

import type { ProofVerificationReceipt } from "@runbook/capsule-browser";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_FIXTURES } from "../lib/browser-fixtures";
import { CapsuleVerifier } from "./capsule-verifier";

const workerMock = vi.hoisted(() => ({
  outcome: null as null | Record<string, unknown>,
  capsuleSizes: [] as number[],
}));

vi.mock("../lib/capsule-verifier-client", () => {
  class CapsuleVerifierClientError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return {
    CapsuleVerifierClientError,
    CapsuleVerifierClient: class {
      initialize() { return Promise.resolve(null); }
      dispose() {}
      verify(capsule: Blob, onProgress?: (stage: "verifying") => void) {
        workerMock.capsuleSizes.push(capsule.size);
        onProgress?.("verifying");
        return Promise.resolve(workerMock.outcome);
      }
    },
  };
});

function validReceipt() {
  const path = resolve(process.cwd(), "../../conformance/expected/minimal-synthetic-root.receipt.json");
  const text = readFileSync(path, "utf8");
  return {
    receipt: JSON.parse(text) as ProofVerificationReceipt,
    bytes: new TextEncoder().encode(text),
    text,
  };
}

afterEach(() => {
  cleanup();
  workerMock.outcome = null;
  workerMock.capsuleSizes = [];
});

describe("Evidence Relay capsule verifier", () => {
  it("renders the local boundary and embedded guided downloads without claiming broker truth", async () => {
    render(<CapsuleVerifier />);
    await screen.findByText("Verifier ready");

    expect(screen.getByText("No server upload path")).toBeTruthy();
    expect(screen.getByText("No payload rendering or storage")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Download exact fixture/ })).toHaveLength(2);
    expect(screen.getByText(/does not prove identity/i)).toBeTruthy();
  });

  it("runs the exact embedded golden fixture without a file chooser", async () => {
    const frozen = validReceipt();
    workerMock.outcome = {
      kind: "receipt",
      requestId: 2,
      receipt: frozen.receipt,
      receiptBytes: frozen.bytes.buffer,
      archiveSha256: BROWSER_FIXTURES.golden.sha256,
    };
    render(<CapsuleVerifier />);
    await screen.findByText("Verifier ready");

    fireEvent.click(screen.getAllByRole("button", { name: "Run embedded fixture" })[0]);

    await screen.findByText("CAPSULE VALID");
    expect(workerMock.capsuleSizes).toEqual([4522]);
    expect(screen.getByText("Result matches the selected synthetic guide.")).toBeTruthy();
  });

  it("focuses the result heading and never renders opaque report payload text", async () => {
    const frozen = validReceipt();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:exact-receipt");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    workerMock.outcome = {
      kind: "receipt",
      requestId: 2,
      receipt: frozen.receipt,
      receiptBytes: frozen.bytes.buffer,
      archiveSha256: BROWSER_FIXTURES.golden.sha256,
    };
    render(<CapsuleVerifier />);
    await screen.findByText("Verifier ready");

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["local fixture placeholder"], "private-name.runbook")] },
    });

    await screen.findByText("CAPSULE VALID");
    const heading = screen.getByRole("heading", { name: "Verification receipt" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.body.textContent).not.toContain("SYNTHETIC CONFORMANCE FIXTURE");
    expect(document.body.textContent).not.toContain("Synthetic fixture");
    expect(document.body.textContent).not.toContain("private-name.runbook");
    expect(screen.getByText(BROWSER_FIXTURES.golden.sha256)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy exact JCS" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(frozen.text));

    fireEvent.click(screen.getByRole("button", { name: "Download receipt" }));
    const receiptBlob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(receiptBlob.size).toBe(frozen.bytes.byteLength);
    expect(receiptBlob.type).toBe("application/json");
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:exact-receipt");
  });

  it("focuses the result heading for capability failures without producing an invalid verdict", async () => {
    workerMock.outcome = {
      kind: "environment-error",
      requestId: 2,
      code: "crypto.operation-failed",
    };
    render(<CapsuleVerifier />);
    await screen.findByText("Verifier ready");
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["bytes"], "capsule.runbook")] } });

    await screen.findByText("ENVIRONMENT — NO VERDICT");
    const heading = screen.getByRole("heading", { name: "Verification receipt" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByText("CAPSULE INVALID")).toBeNull();
  });
});
