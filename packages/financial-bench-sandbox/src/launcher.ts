import { createHash } from "node:crypto";
import { SANDBOX_LAUNCHER_SHA256 } from "./profile.js";

// This string is the exact trusted program passed to `node -e` in the container.
// It intentionally has no package or filesystem dependency.
export const SANDBOX_LAUNCHER_SOURCE = String.raw`
"use strict";
(async () => {
  const crypto = await import("node:crypto");
  const stdin = process.stdin;
  const MAX_FRAME = 32768;
  const MAX_ADAPTER = 33554432;
  const MAX_CONFIG = 2048;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = Buffer.alloc(0);
  const iterator = stdin[Symbol.asyncIterator]();
  async function exact(length) {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("length-invalid");
    while (buffered.length < length) {
      const next = await iterator.next();
      if (next.done) throw new Error("truncated-input");
      buffered = Buffer.concat([buffered, Buffer.from(next.value)]);
    }
    const value = buffered.subarray(0, length);
    buffered = buffered.subarray(length);
    return value;
  }
  async function section(maximum) {
    const prefix = await exact(4);
    const length = prefix.readUInt32BE(0);
    if (length > maximum) throw new Error("section-too-large");
    return exact(length);
  }
  function compare(a, b) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      const difference = a.charCodeAt(i) - b.charCodeAt(i);
      if (difference !== 0) return difference;
    }
    return a.length - b.length;
  }
  function canonical(value, depth = 0, state = { nodes: 0 }) {
    state.nodes += 1;
    if (depth > 16 || state.nodes > 10000) throw new Error("value-too-complex");
    if (value === null) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("invalid-number");
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return "[" + value.map((item) => canonical(item, depth + 1, state)).join(",") + "]";
    if (typeof value !== "object") throw new Error("invalid-value");
    return "{" + Object.keys(value).sort(compare).map((key) => JSON.stringify(key) + ":" + canonical(value[key], depth + 1, state)).join(",") + "}";
  }
  function parseCanonical(bytes) {
    const text = decoder.decode(bytes);
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value) || canonical(value) !== text) throw new Error("noncanonical-frame");
    return value;
  }
  function exactKeys(value, keys) {
    const actual = Object.keys(value).sort(compare);
    const expected = [...keys].sort(compare);
    if (canonical(actual) !== canonical(expected)) throw new Error("unknown-frame-field");
  }
  async function frame() { return parseCanonical(await section(MAX_FRAME)); }
  function write(value) {
    const bytes = Buffer.from(canonical(value), "utf8");
    if (bytes.length > MAX_FRAME) throw new Error("frame-too-large");
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(bytes.length, 0);
    process.stdout.write(prefix); process.stdout.write(bytes);
  }
  const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  const init = await frame();
  exactKeys(init, ["adapterByteCount","adapterContractSha256","adapterSha256","configurationByteCount","configurationSha256","executionNonce","launchBindingSha256","schemaVersion","type"]);
  if (init.type !== "init" || init.schemaVersion !== "runbook.financial-agent-sandbox-protocol-init.v1") throw new Error("init-invalid");
  const adapterBytes = await section(MAX_ADAPTER);
  const configurationBytes = await section(MAX_CONFIG);
  if (adapterBytes.length !== init.adapterByteCount || configurationBytes.length !== init.configurationByteCount) throw new Error("bootstrap-length-mismatch");
  if (hash(adapterBytes) !== init.adapterSha256 || hash(configurationBytes) !== init.configurationSha256) throw new Error("bootstrap-digest-mismatch");
  const configuration = parseCanonical(configurationBytes);
  if (configuration.adapterContractSha256 !== init.adapterContractSha256) throw new Error("contract-binding-mismatch");
  if (Object.keys(process.env).length !== 0) throw new Error("environment-not-empty");
  write({
    adapterContractSha256: init.adapterContractSha256,
    bundleSha256: init.adapterSha256,
    configurationSha256: init.configurationSha256,
    executionNonce: init.executionNonce,
    launchBindingSha256: init.launchBindingSha256,
    schemaVersion: "runbook.financial-agent-sandbox-protocol-bootstrap-ack.v1",
    type: "bootstrap-ack"
  });
  const moduleUrl = "data:text/javascript;base64," + Buffer.from(adapterBytes).toString("base64");
  const imported = await import(moduleUrl);
  const adapter = imported.default;
  if (adapter === null || typeof adapter !== "object" || typeof adapter.run !== "function") throw new Error("adapter-export-invalid");
  write({
    executionNonce: init.executionNonce,
    launchBindingSha256: init.launchBindingSha256,
    schemaVersion: "runbook.financial-agent-sandbox-protocol-ready.v1",
    type: "ready"
  });
  const stimulusFrame = await frame();
  exactKeys(stimulusFrame, ["executionNonce","launchBindingSha256","schemaVersion","stimulus","type"]);
  if (stimulusFrame.type !== "stimulus" || stimulusFrame.executionNonce !== init.executionNonce || stimulusFrame.launchBindingSha256 !== init.launchBindingSha256) throw new Error("stimulus-binding-invalid");
  let rpcSequence = 0;
  let rpcLock = Promise.resolve();
  async function rpc(type, input) {
    const execute = async () => {
      const requestId = "rpc-" + String(rpcSequence++).padStart(4, "0");
      write({ executionNonce: init.executionNonce, input, launchBindingSha256: init.launchBindingSha256, requestId, schemaVersion: "runbook.financial-agent-sandbox-protocol-rpc.v1", type });
      const response = await frame();
      exactKeys(response, ["executionNonce","launchBindingSha256","requestId","result","schemaVersion","type"]);
      const wanted = type === "tool-call" ? "tool-result" : "approval-result";
      if (response.type !== wanted || response.requestId !== requestId || response.executionNonce !== init.executionNonce || response.launchBindingSha256 !== init.launchBindingSha256) throw new Error("rpc-response-invalid");
      return response.result;
    };
    const result = rpcLock.then(execute, execute);
    rpcLock = result.then(() => undefined, () => undefined);
    return result;
  }
  const controller = new AbortController();
  const channels = Object.freeze({
    approvalRequestsSupported: true,
    toolNames: Object.freeze(["preview_order"]),
    call: (input) => rpc("tool-call", input),
    requestApproval: (input) => rpc("approval-request", input)
  });
  try {
    const decision = await adapter.run(stimulusFrame.stimulus, channels, controller.signal);
    write({ decision, executionNonce: init.executionNonce, launchBindingSha256: init.launchBindingSha256, ok: true, schemaVersion: "runbook.financial-agent-sandbox-protocol-decision.v1", type: "decision" });
  } catch {
    write({ decision: null, executionNonce: init.executionNonce, launchBindingSha256: init.launchBindingSha256, ok: false, schemaVersion: "runbook.financial-agent-sandbox-protocol-decision.v1", type: "decision" });
  }
  await new Promise((resolve) => setTimeout(resolve, 75));
})().catch((error) => {
  const diagnostic = String(error && error.message || "launcher-failed").slice(0, 160);
  process.stderr.write(diagnostic);
  process.exitCode = 70;
});
`;

const measuredLauncherSha256 = createHash("sha256")
  .update(SANDBOX_LAUNCHER_SOURCE)
  .digest("hex");
if (measuredLauncherSha256 !== SANDBOX_LAUNCHER_SHA256) {
  throw new Error("sandbox.launcher-source-integrity-failed");
}
export { SANDBOX_LAUNCHER_SHA256 };
