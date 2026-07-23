/// <reference lib="webworker" />

import {
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "@runbook/capsule-browser";
import {
  MAX_BROWSER_CAPSULE_BYTES,
  type CapsuleWorkerRequest,
  type CapsuleWorkerResponse,
} from "../lib/capsule-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
// Public RFC 8410 SPKI used only to capability-probe browser Ed25519 support.
const ED25519_SPKI_PROBE_HEX = "302a300506032b65700321002b3af4a3de1350c84dc7c8bd6c57ca898009c40a7657157ac785f3577543d50a";

function bytesFromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function hexFromBytes(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function post(response: CapsuleWorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(response, transfer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRequest(value: unknown): CapsuleWorkerRequest | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.requestId) || (value.requestId as number) < 1) return null;
  if (value.kind === "probe") return { kind: "probe", requestId: value.requestId as number };
  if (value.kind === "verify" && value.capsule instanceof Blob) {
    return { kind: "verify", requestId: value.requestId as number, capsule: value.capsule };
  }
  return null;
}

async function probeCrypto() {
  if (!globalThis.crypto?.subtle) throw Object.assign(new Error("crypto.unavailable"), { code: "crypto.unavailable" });
  try {
    await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array());
    await globalThis.crypto.subtle.importKey(
      "spki",
      bytesFromHex(ED25519_SPKI_PROBE_HEX),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw Object.assign(new Error("crypto.unavailable"), { code: "crypto.unavailable" });
  }
}

function cryptoErrorCode(error: unknown): "crypto.unavailable" | "crypto.operation-failed" | null {
  if (!isRecord(error)) return null;
  return error.code === "crypto.unavailable" || error.code === "crypto.operation-failed" ? error.code : null;
}

async function handle(request: CapsuleWorkerRequest) {
  if (request.kind === "probe") {
    try {
      await probeCrypto();
      post({ kind: "ready", requestId: request.requestId });
    } catch (error) {
      post({ kind: "environment-error", requestId: request.requestId, code: cryptoErrorCode(error) ?? "crypto.unavailable" });
    }
    return;
  }

  if (request.capsule.size < 1) {
    post({ kind: "environment-error", requestId: request.requestId, code: "input.empty" });
    return;
  }
  if (request.capsule.size > MAX_BROWSER_CAPSULE_BYTES) {
    post({ kind: "environment-error", requestId: request.requestId, code: "input.size-limit" });
    return;
  }

  post({ kind: "progress", requestId: request.requestId, stage: "reading" });
  let input: ArrayBuffer;
  try {
    input = await request.capsule.arrayBuffer();
  } catch {
    post({ kind: "environment-error", requestId: request.requestId, code: "input.read-failed" });
    return;
  }
  if (input.byteLength !== request.capsule.size) {
    post({ kind: "environment-error", requestId: request.requestId, code: "input.read-failed" });
    return;
  }

  try {
    post({ kind: "progress", requestId: request.requestId, stage: "verifying" });
    const archiveSha256 = hexFromBytes(await globalThis.crypto.subtle.digest("SHA-256", input));
    const receipt = await verifyProofCapsule(new Uint8Array(input));
    post({ kind: "progress", requestId: request.requestId, stage: "serializing" });
    const exactReceipt = serializeProofVerificationReceipt(receipt).slice();
    const receiptBytes = exactReceipt.buffer as ArrayBuffer;
    post({ kind: "receipt", requestId: request.requestId, receipt, receiptBytes, archiveSha256 }, [receiptBytes]);
  } catch (error) {
    post({
      kind: "environment-error",
      requestId: request.requestId,
      code: cryptoErrorCode(error) ?? "worker.failure",
    });
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = parseRequest(event.data);
  if (!request) {
    const value = isRecord(event.data) ? event.data.requestId : null;
    if (Number.isSafeInteger(value) && (value as number) > 0) {
      post({ kind: "environment-error", requestId: value as number, code: "worker.failure" });
    }
    return;
  }
  void handle(request);
});
