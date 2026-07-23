import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  analyzeProofLineageArchives,
  serializeLineageAnalysisReceipt,
  serializeLineageResearchPacket,
} from "@runbook/capsule-lineage";
import {
  LineageAtlasClient,
  LineageAtlasClientError,
  type LineageAtlasWorkerLike,
} from "./lineage-atlas-client";

class FakeWorker implements LineageAtlasWorkerLike {
  readonly messages: unknown[] = [];
  terminated = false;
  private readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messageListeners.add(listener as (event: MessageEvent<unknown>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }

  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messageListeners.delete(listener as (event: MessageEvent<unknown>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }

  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { for (const listener of this.messageListeners) listener({ data } as MessageEvent<unknown>); }
  fail() { for (const listener of this.errorListeners) listener({} as ErrorEvent); }
}

function requestId(worker: FakeWorker) {
  return (worker.messages.at(-1) as { requestId: number }).requestId;
}

async function waitForKind(worker: FakeWorker, kind: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const message = worker.messages.findLast((candidate) => (candidate as { kind?: unknown }).kind === kind);
    if (message !== undefined) return message as { requestId: number };
    await Promise.resolve();
  }
  throw new Error(`Worker never received ${kind}.`);
}

afterEach(() => vi.useRealTimers());

describe("LineageAtlasClient", () => {
  it("preflights atomically without creating a Worker", async () => {
    let workers = 0;
    const client = new LineageAtlasClient(() => { workers += 1; return new FakeWorker(); });
    await expect(client.analyze([])).resolves.toMatchObject({ kind: "environment-error", code: "input.empty" });
    expect(workers).toBe(0);
    client.dispose();
  });

  it("probes, strips Blob metadata, forwards bounded progress, and returns environment failures", async () => {
    const worker = new FakeWorker();
    const client = new LineageAtlasClient(() => worker, 1_000);
    const initialization = client.initialize();
    worker.emit({ kind: "ready", requestId: requestId(worker) });
    await expect(initialization).resolves.toBeNull();

    const source = new Blob(["capsule"], { type: "sensitive/local-name" }) as Blob & { name?: string };
    source.name = "private-account.runbook";
    const progress: string[] = [];
    const analysis = client.analyze([source], (event) => progress.push(`${event.stage}:${event.completed}/${event.total}`));
    await Promise.resolve();
    const request = worker.messages.at(-1) as { blobs: Blob[]; requestId: number };
    expect(request.blobs[0]).not.toBe(source);
    expect(request.blobs[0]?.type).toBe("application/octet-stream");
    expect("name" in (request.blobs[0] as object)).toBe(false);
    worker.emit({ completed: 0, kind: "progress", requestId: request.requestId, stage: "reading", total: 1 });
    worker.emit({ code: "input.read-failed", kind: "environment-error", requestId: request.requestId });
    await expect(analysis).resolves.toMatchObject({ kind: "environment-error", code: "input.read-failed" });
    expect(progress).toEqual(["reading:0/1"]);
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it("terminates a timed-out analyzer before a later batch can reuse its Worker", async () => {
    const workers: FakeWorker[] = [];
    const client = new LineageAtlasClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, 1_000);
    const initialization = client.initialize();
    workers[0]!.emit({ kind: "ready", requestId: requestId(workers[0]!) });
    await initialization;
    const first = client.analyze([new Blob(["first"])]);
    const firstRequest = await waitForKind(workers[0]!, "analyze");
    workers[0]!.emit({ code: "worker.timeout", kind: "environment-error", requestId: firstRequest.requestId });
    await expect(first).resolves.toMatchObject({ code: "worker.timeout" });
    expect(workers[0]!.terminated).toBe(true);

    const second = client.analyze([new Blob(["second"])]);
    const nextWorker = workers[1]!;
    const probe = await waitForKind(nextWorker, "probe");
    nextWorker.emit({ kind: "ready", requestId: probe.requestId });
    const secondRequest = await waitForKind(nextWorker, "analyze");
    nextWorker.emit({ code: "worker.failure", kind: "environment-error", requestId: secondRequest.requestId });
    await expect(second).resolves.toMatchObject({ code: "worker.failure" });
    expect(nextWorker.terminated).toBe(true);
    client.dispose();
  });

  it("rejects a duplicate count that is not bound to selection minus unique transports", async () => {
    const archive = new Uint8Array(await readFile(fileURLToPath(new URL("../../../../conformance/fixtures/minimal-synthetic-root.runbook", import.meta.url))));
    const receipt = await analyzeProofLineageArchives([archive], { subtle: webcrypto.subtle as unknown as SubtleCrypto });
    const worker = new FakeWorker();
    const client = new LineageAtlasClient(() => worker, 1_000);
    const initialization = client.initialize();
    worker.emit({ kind: "ready", requestId: requestId(worker) });
    await initialization;
    const analysis = client.analyze([new Blob([archive])]);
    const request = await waitForKind(worker, "analyze");
    worker.emit({
      creatorDomainResults: [],
      duplicateSelectionCount: 1,
      kind: "result",
      receipt,
      receiptBytes: serializeLineageAnalysisReceipt(receipt).slice().buffer,
      requestId: request.requestId,
      researchPacketBytes: serializeLineageResearchPacket(receipt).slice().buffer,
    });
    await expect(analysis).rejects.toEqual(new LineageAtlasClientError("worker.failure"));
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it("terminates stale work when a newer analysis starts", async () => {
    const workers: FakeWorker[] = [];
    const client = new LineageAtlasClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, 1_000);
    const initialization = client.initialize();
    workers[0]!.emit({ kind: "ready", requestId: requestId(workers[0]!) });
    await initialization;

    const first = client.analyze([new Blob(["first"])]);
    await waitForKind(workers[0]!, "analyze");
    const second = client.analyze([new Blob(["second"])]);
    const firstExpectation = expect(first).rejects.toEqual(new LineageAtlasClientError("worker.cancelled"));
    await Promise.resolve();
    await firstExpectation;
    expect(workers[0]!.terminated).toBe(true);

    const active = workers.at(-1)!;
    const probe = await waitForKind(active, "probe");
    active.emit({ kind: "ready", requestId: probe.requestId });
    const analyze = await waitForKind(active, "analyze");
    const id = analyze.requestId;
    active.emit({ code: "worker.failure", kind: "environment-error", requestId: id });
    await expect(second).resolves.toMatchObject({ code: "worker.failure" });
    client.dispose();
  });

  it("fails immediately on a malformed matching response and ignores stale IDs", async () => {
    const worker = new FakeWorker();
    const client = new LineageAtlasClient(() => worker, 1_000);
    const initialization = client.initialize();
    const id = requestId(worker);
    worker.emit({ kind: "ready", requestId: id + 1 });
    expect(worker.terminated).toBe(false);
    worker.emit({ kind: "ready", requestId: id, unexpected: true });
    await expect(initialization).rejects.toEqual(new LineageAtlasClientError("worker.failure"));
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it("rejects progress whose total is not bound to the active selection", async () => {
    const worker = new FakeWorker();
    const client = new LineageAtlasClient(() => worker, 1_000);
    const initialization = client.initialize();
    worker.emit({ kind: "ready", requestId: requestId(worker) });
    await initialization;
    const analysis = client.analyze([new Blob(["one"])]);
    const request = await waitForKind(worker, "analyze");
    worker.emit({ completed: 0, kind: "progress", requestId: request.requestId, stage: "reading", total: 2 });
    await expect(analysis).rejects.toEqual(new LineageAtlasClientError("worker.failure"));
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it("terminates the Worker at the whole-batch timeout", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new LineageAtlasClient(() => worker, 25);
    const initialization = client.initialize();
    const expectation = expect(initialization).rejects.toEqual(new LineageAtlasClientError("worker.timeout"));
    await vi.advanceTimersByTimeAsync(26);
    await expectation;
    expect(worker.terminated).toBe(true);
    client.dispose();
  });
});
