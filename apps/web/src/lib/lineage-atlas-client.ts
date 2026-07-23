import {
  DEFAULT_LINEAGE_ATLAS_TIMEOUT_MS,
  parseLineageAtlasWorkerResponse,
  validateLineageAtlasSelection,
  type LineageAtlasEnvironmentCode,
  type LineageAtlasProgress,
  type LineageAtlasWorkerResponse,
} from "./lineage-atlas-worker-protocol";

type WorkerMessageListener = (event: MessageEvent<unknown>) => void;
type WorkerErrorListener = (event: ErrorEvent) => void;

export interface LineageAtlasWorkerLike {
  addEventListener(type: "message", listener: WorkerMessageListener): void;
  addEventListener(type: "error", listener: WorkerErrorListener): void;
  removeEventListener(type: "message", listener: WorkerMessageListener): void;
  removeEventListener(type: "error", listener: WorkerErrorListener): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export type LineageAtlasWorkerFactory = () => LineageAtlasWorkerLike;
export type LineageAtlasResult = Extract<LineageAtlasWorkerResponse, { kind: "result" }>;
export type LineageAtlasEnvironmentResult = Extract<LineageAtlasWorkerResponse, { kind: "environment-error" }>;
export type LineageAtlasOutcome = LineageAtlasResult | LineageAtlasEnvironmentResult;

export class LineageAtlasClientError extends Error {
  constructor(readonly code: "worker.timeout" | "worker.failure" | "worker.disposed" | "worker.cancelled") {
    super(code);
  }
}

function defaultWorkerFactory(): LineageAtlasWorkerLike {
  return new Worker("/lineage-atlas.worker.js", {
    name: "runbook-lineage-atlas",
    type: "module",
  });
}

function rawRequestId(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const requestId = (value as { requestId?: unknown }).requestId;
  return Number.isSafeInteger(requestId) && (requestId as number) > 0 ? requestId as number : null;
}

/** One client owns one replaceable Worker and publishes only complete batches. */
export class LineageAtlasClient {
  private worker: LineageAtlasWorkerLike | null = null;
  private requestGeneration = 0;
  private analysisGeneration = 0;
  private ready = false;
  private active = false;
  private disposed = false;
  private cancelPending: (() => void) | null = null;

  constructor(
    private readonly factory: LineageAtlasWorkerFactory = defaultWorkerFactory,
    private readonly timeoutMs = DEFAULT_LINEAGE_ATLAS_TIMEOUT_MS,
  ) {}

  async initialize(): Promise<LineageAtlasEnvironmentResult | null> {
    this.assertUsable();
    if (this.ready) return null;
    if (this.active) this.resetWorker();
    this.worker ??= this.factory();
    const result = await this.request({ kind: "probe" });
    if (result.kind === "ready") {
      this.ready = true;
      return null;
    }
    if (result.kind === "environment-error") return result;
    throw new LineageAtlasClientError("worker.failure");
  }

  async analyze(
    blobs: readonly Blob[],
    onProgress?: (progress: LineageAtlasProgress) => void,
  ): Promise<LineageAtlasOutcome> {
    this.assertUsable();
    const analysisId = ++this.analysisGeneration;
    if (this.active) this.resetWorker();
    const preflight = validateLineageAtlasSelection(blobs);
    if (preflight !== null) return this.localEnvironment(preflight);
    const capabilityError = await this.initialize();
    if (analysisId !== this.analysisGeneration) throw new LineageAtlasClientError("worker.cancelled");
    if (capabilityError !== null) return capabilityError;

    // Slice strips File names and MIME declarations before structured cloning.
    const snapshots = blobs.map((blob) => blob.slice(0, blob.size, "application/octet-stream"));
    const result = await this.request({ blobs: snapshots, kind: "analyze" }, onProgress);
    if (analysisId !== this.analysisGeneration) throw new LineageAtlasClientError("worker.cancelled");
    if (result.kind === "environment-error") {
      this.resetWorker();
      return result;
    }
    if (result.kind === "result") {
      if (result.duplicateSelectionCount !== snapshots.length - result.receipt.counts.uniqueTransports) {
        this.resetWorker();
        throw new LineageAtlasClientError("worker.failure");
      }
      return result;
    }
    throw new LineageAtlasClientError("worker.failure");
  }

  cancel() {
    if (this.disposed) return;
    this.analysisGeneration += 1;
    this.resetWorker();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.analysisGeneration += 1;
    this.resetWorker();
  }

  private localEnvironment(code: LineageAtlasEnvironmentCode): LineageAtlasEnvironmentResult {
    return { code, kind: "environment-error", requestId: ++this.requestGeneration };
  }

  private assertUsable() {
    if (this.disposed) throw new LineageAtlasClientError("worker.disposed");
  }

  private resetWorker() {
    this.cancelPending?.();
    this.cancelPending = null;
    this.requestGeneration += 1;
    this.active = false;
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
  }

  private request(
    body: { kind: "probe" } | { blobs: Blob[]; kind: "analyze" },
    onProgress?: (progress: LineageAtlasProgress) => void,
  ): Promise<Exclude<LineageAtlasWorkerResponse, { kind: "progress" }>> {
    this.assertUsable();
    const worker = this.worker;
    if (worker === null) throw new LineageAtlasClientError("worker.failure");
    const requestId = ++this.requestGeneration;
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
        const message = parseLineageAtlasWorkerResponse(event.data);
        if (message === null) {
          if (rawRequestId(event.data) !== requestId || requestId !== this.requestGeneration || !finish()) return;
          this.resetWorker();
          reject(new LineageAtlasClientError("worker.failure"));
          return;
        }
        if (message.requestId !== requestId || requestId !== this.requestGeneration) return;
        if (message.kind === "progress") {
          if (body.kind !== "analyze" || message.total !== body.blobs.length) {
            if (!finish()) return;
            this.resetWorker();
            reject(new LineageAtlasClientError("worker.failure"));
            return;
          }
          onProgress?.({ completed: message.completed, stage: message.stage, total: message.total });
          return;
        }
        if (!finish()) return;
        resolve(message);
      };
      const onError: WorkerErrorListener = () => {
        if (!finish()) return;
        this.resetWorker();
        reject(new LineageAtlasClientError("worker.failure"));
      };
      const timeout = setTimeout(() => {
        if (!finish()) return;
        this.resetWorker();
        reject(new LineageAtlasClientError("worker.timeout"));
      }, this.timeoutMs);

      this.cancelPending = () => {
        if (!finish()) return;
        reject(new LineageAtlasClientError("worker.cancelled"));
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ ...body, requestId });
    });
  }
}
