import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CapsuleVerifierClient,
  CapsuleVerifierClientError,
  type CapsuleWorkerLike,
} from "./capsule-verifier-client";

class FakeWorker implements CapsuleWorkerLike {
  readonly messages: unknown[] = [];
  terminated = false;
  private messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private errorListeners = new Set<(event: ErrorEvent) => void>();

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
}

function requestId(worker: FakeWorker, index = worker.messages.length - 1) {
  return (worker.messages[index] as { requestId: number }).requestId;
}

afterEach(() => vi.useRealTimers());

describe("CapsuleVerifierClient", () => {
  it("probes capability, forwards progress, and returns environment failures separately", async () => {
    const worker = new FakeWorker();
    const client = new CapsuleVerifierClient(() => worker, 1_000);
    const initialization = client.initialize();
    expect(worker.messages[0]).toMatchObject({ kind: "probe" });
    worker.emit({ kind: "ready", requestId: requestId(worker) });
    await expect(initialization).resolves.toBeNull();

    const stages: string[] = [];
    const verification = client.verify(new Blob(["bytes"]), (stage) => stages.push(stage));
    await Promise.resolve();
    const id = requestId(worker);
    worker.emit({ kind: "progress", requestId: id, stage: "verifying" });
    worker.emit({ kind: "environment-error", requestId: id, code: "crypto.operation-failed" });

    await expect(verification).resolves.toEqual({ kind: "environment-error", requestId: id, code: "crypto.operation-failed" });
    expect(stages).toEqual(["verifying"]);
    client.dispose();
  });

  it("terminates the old Worker and rejects its request when a newer generation starts", async () => {
    const workers: FakeWorker[] = [];
    const client = new CapsuleVerifierClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, 1_000);

    const initialization = client.initialize();
    workers[0]!.emit({ kind: "ready", requestId: requestId(workers[0]!) });
    await initialization;
    const first = client.verify(new Blob(["first"]));
    const second = client.verify(new Blob(["second"]));
    const firstExpectation = expect(first).rejects.toMatchObject({ code: "worker.cancelled" });
    await Promise.resolve();

    await firstExpectation;
    const activeWorker = workers.at(-1)!;
    const id = requestId(activeWorker);
    activeWorker.emit({ kind: "environment-error", requestId: id, code: "input.read-failed" });
    await expect(second).resolves.toMatchObject({ kind: "environment-error", code: "input.read-failed" });
    client.dispose();
  });

  it("stops and replaces a Worker after the bounded timeout", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const client = new CapsuleVerifierClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, 25);

    const initialization = client.initialize();
    const expectation = expect(initialization).rejects.toEqual(new CapsuleVerifierClientError("worker.timeout"));
    await vi.advanceTimersByTimeAsync(26);
    await expectation;
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    client.dispose();
  });
});
