import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  parseCapsuleWorkerResponse,
  type CapsuleWorkerResponse,
  type CapsuleWorkerStage,
} from "./capsule-worker-protocol";

type WorkerMessageListener = (event: MessageEvent<unknown>) => void;
type WorkerErrorListener = (event: ErrorEvent) => void;

export interface CapsuleWorkerLike {
  addEventListener(type: "message", listener: WorkerMessageListener): void;
  addEventListener(type: "error", listener: WorkerErrorListener): void;
  removeEventListener(type: "message", listener: WorkerMessageListener): void;
  removeEventListener(type: "error", listener: WorkerErrorListener): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export type CapsuleWorkerFactory = () => CapsuleWorkerLike;

export class CapsuleVerifierClientError extends Error {
  constructor(readonly code: "worker.timeout" | "worker.failure" | "worker.disposed" | "worker.cancelled") {
    super(code);
  }
}

type ReceiptResponse = Extract<CapsuleWorkerResponse, { kind: "receipt" }>;
type EnvironmentResponse = Extract<CapsuleWorkerResponse, { kind: "environment-error" }>;
export type CapsuleVerificationOutcome = ReceiptResponse | EnvironmentResponse;

function defaultWorkerFactory(): CapsuleWorkerLike {
  return new Worker("/proof-capsule.worker.js", {
    name: "runbook-proof-capsule-verifier",
    type: "module",
  });
}

/**
 * Owns one isolated verifier Worker. Generation IDs, listener removal, and Worker
 * replacement prevent a late result from an earlier file from becoming current.
 */
export class CapsuleVerifierClient {
  private worker: CapsuleWorkerLike | null = null;
  private generation = 0;
  private verificationGeneration = 0;
  private ready = false;
  private active = false;
  private disposed = false;
  private cancelPending: (() => void) | null = null;

  constructor(
    private readonly factory: CapsuleWorkerFactory = defaultWorkerFactory,
    private readonly timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
  ) {}

  async initialize(): Promise<EnvironmentResponse | null> {
    this.assertActive();
    if (this.ready) return null;
    if (this.active) this.replaceWorker();
    this.worker ??= this.factory();
    const result = await this.request({ kind: "probe" });
    if (result.kind === "ready") {
      this.ready = true;
      return null;
    }
    if (result.kind === "environment-error") return result;
    throw new CapsuleVerifierClientError("worker.failure");
  }

  async verify(
    capsule: Blob,
    onProgress?: (stage: CapsuleWorkerStage) => void,
  ): Promise<CapsuleVerificationOutcome> {
    this.assertActive();
    const verificationId = ++this.verificationGeneration;
    if (this.active) this.replaceWorker();
    const capabilityError = await this.initialize();
    if (verificationId !== this.verificationGeneration) throw new CapsuleVerifierClientError("worker.cancelled");
    if (capabilityError) return capabilityError;
    const result = await this.request({ kind: "verify", capsule }, onProgress);
    if (result.kind === "receipt" || result.kind === "environment-error") return result;
    throw new CapsuleVerifierClientError("worker.failure");
  }

  cancel() {
    if (this.disposed) return;
    this.verificationGeneration += 1;
    this.replaceWorker();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.verificationGeneration += 1;
    this.cancelPending?.();
    this.cancelPending = null;
    this.generation += 1;
    this.active = false;
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
  }

  private assertActive() {
    if (this.disposed) throw new CapsuleVerifierClientError("worker.disposed");
  }

  private replaceWorker() {
    this.cancelPending?.();
    this.cancelPending = null;
    this.generation += 1;
    this.active = false;
    this.ready = false;
    this.worker?.terminate();
    this.worker = this.factory();
  }

  private request(
    body: { kind: "probe" } | { kind: "verify"; capsule: Blob },
    onProgress?: (stage: CapsuleWorkerStage) => void,
  ): Promise<Exclude<CapsuleWorkerResponse, { kind: "progress" }>> {
    this.assertActive();
    const worker = this.worker;
    if (!worker) throw new CapsuleVerifierClientError("worker.failure");
    const requestId = ++this.generation;
    this.active = true;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        this.active = false;
        this.cancelPending = null;
        clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        return true;
      };
      const onMessage: WorkerMessageListener = (event) => {
        const message = parseCapsuleWorkerResponse(event.data);
        if (!message || message.requestId !== requestId || requestId !== this.generation) return;
        if (message.kind === "progress") {
          onProgress?.(message.stage);
          return;
        }
        if (!finish()) return;
        resolve(message);
      };
      const onError: WorkerErrorListener = () => {
        if (!finish()) return;
        reject(new CapsuleVerifierClientError("worker.failure"));
      };
      const timeout = setTimeout(() => {
        if (!finish()) return;
        this.replaceWorker();
        reject(new CapsuleVerifierClientError("worker.timeout"));
      }, this.timeoutMs);

      this.cancelPending = () => {
        if (!finish()) return;
        reject(new CapsuleVerifierClientError("worker.cancelled"));
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ ...body, requestId });
    });
  }
}
