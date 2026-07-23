/// <reference types="node" />

import { request as nativeHttpsRequest } from "node:https";
import type { RequestOptions } from "node:https";

import type {
  PublicAuthMetadataHttpEvidence,
  PublicAuthMetadataSourceId,
} from "./types.js";

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BODY_CHUNKS = 1024;
const REQUEST_TIMEOUT_MS = 10_000;

const SOURCE_TARGETS = {
  "robinhood-trading-protected-resource": {
    hostname: "agent.robinhood.com",
    path: "/.well-known/oauth-protected-resource/mcp/trading",
  },
  "robinhood-trading-authorization-server": {
    hostname: "agent.robinhood.com",
    path: "/.well-known/oauth-authorization-server/mcp/trading",
  },
  "robinhood-banking-protected-resource": {
    hostname: "banking-agent.robinhood.com",
    path: "/.well-known/oauth-protected-resource/mcp/banking",
  },
  "robinhood-banking-authorization-server": {
    hostname: "banking-agent.robinhood.com",
    path: "/.well-known/oauth-authorization-server/mcp/banking",
  },
} as const satisfies Record<
  PublicAuthMetadataSourceId,
  Readonly<{ hostname: string; path: string }>
>;

const SOURCE_IDS = [
  "robinhood-banking-authorization-server",
  "robinhood-banking-protected-resource",
  "robinhood-trading-authorization-server",
  "robinhood-trading-protected-resource",
] as const satisfies readonly PublicAuthMetadataSourceId[];

const SINGLETON_HEADERS = new Set([
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "date",
  "etag",
  "last-modified",
  "location",
  "set-cookie",
  "transfer-encoding",
  "vary",
]);

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const INVALID_HEADER_VALUE =
  /[\0\r\n]|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\u0100-\uffff]/;

export type PublicAuthMetadataCapture = Readonly<{
  http: PublicAuthMetadataHttpEvidence;
  rawBodyBytes: Uint8Array;
  sourceId: PublicAuthMetadataSourceId;
}>;

export class PublicAuthMetadataCaptureError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PublicAuthMetadataCaptureError";
    this.code = code;
  }
}

type ResponseLike = {
  readonly complete?: boolean | undefined;
  readonly rawHeaders: readonly string[];
  readonly statusCode?: number | undefined;
  destroy(error?: Error): void;
  on(event: "aborted", listener: () => void): ResponseLike;
  on(event: "close", listener: () => void): ResponseLike;
  on(event: "data", listener: (chunk: unknown) => void): ResponseLike;
  on(event: "end", listener: () => void): ResponseLike;
  on(event: "error", listener: (error: Error) => void): ResponseLike;
};

type RequestLike = {
  destroy(error?: Error): void;
  end(): void;
  on(event: "error", listener: (error: Error) => void): RequestLike;
};

export type PublicAuthHttpsRequest = (
  options: Readonly<RequestOptions>,
  onResponse: (response: ResponseLike) => void,
) => RequestLike;

export type PublicAuthMetadataNodeCapture = Readonly<{
  captureAll(): Promise<readonly PublicAuthMetadataCapture[]>;
  captureSource(sourceId: PublicAuthMetadataSourceId): Promise<PublicAuthMetadataCapture>;
}>;

function captureError(code: string, message: string, cause?: unknown): PublicAuthMetadataCaptureError {
  return new PublicAuthMetadataCaptureError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function sourceTarget(sourceId: PublicAuthMetadataSourceId) {
  if (typeof sourceId !== "string" || !Object.hasOwn(SOURCE_TARGETS, sourceId)) {
    throw captureError("capture.source-id-invalid", "The source ID is not in the closed capture profile.");
  }
  return SOURCE_TARGETS[sourceId];
}

function parseRawHeaders(rawHeaders: readonly string[]): ReadonlyMap<string, string> {
  if (rawHeaders.length % 2 !== 0) {
    throw captureError("capture.headers-invalid", "The response header list is malformed.");
  }

  let headerBytes = 2;
  const values = new Map<string, string>();
  const counts = new Map<string, number>();

  for (let index = 0; index < rawHeaders.length; index += 2) {
    const rawName = rawHeaders[index];
    const rawValue = rawHeaders[index + 1];
    if (
      typeof rawName !== "string" ||
      typeof rawValue !== "string" ||
      !HEADER_NAME.test(rawName) ||
      INVALID_HEADER_VALUE.test(rawValue)
    ) {
      throw captureError("capture.headers-invalid", "The response contains an invalid header.");
    }

    headerBytes += rawName.length + 2 + rawValue.length + 2;
    if (headerBytes > MAX_HEADER_BYTES) {
      throw captureError("capture.headers-too-large", "The response headers exceed 16 KiB.");
    }

    const name = rawName.toLowerCase();
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    if (SINGLETON_HEADERS.has(name) && count !== 1) {
      throw captureError("capture.header-duplicate", `The singleton ${name} header is duplicated.`);
    }
    if (!values.has(name)) values.set(name, rawValue.trim());
  }

  return values;
}

function optionalHeader(headers: ReadonlyMap<string, string>, name: string): string | null {
  const value = headers.get(name);
  if (value === undefined) return null;
  if (value.length < 1 || value.length > 1_024) {
    throw captureError(
      "capture.header-value-invalid",
      `The retained ${name} header is outside the accepted value bound.`,
    );
  }
  return value;
}

function validateResponseHeaders(rawHeaders: readonly string[]): PublicAuthMetadataHttpEvidence {
  const headers = parseRawHeaders(rawHeaders);

  if (headers.has("set-cookie")) {
    throw captureError("capture.set-cookie-rejected", "Capture responses must not set cookies.");
  }
  if (headers.has("content-encoding")) {
    throw captureError("capture.content-encoding-rejected", "Encoded response bodies are not accepted.");
  }
  if (headers.has("transfer-encoding")) {
    throw captureError("capture.transfer-encoding-rejected", "Transfer-encoded response bodies are not accepted.");
  }
  if (headers.has("location")) {
    throw captureError("capture.location-rejected", "Capture responses must not advertise a redirect location.");
  }

  const contentType = headers.get("content-type");
  if (contentType === undefined) {
    throw captureError("capture.content-type-missing", "The response has no Content-Type header.");
  }
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw captureError("capture.content-type-invalid", "The response media type is not application/json.");
  }

  const rawContentLength = headers.get("content-length");
  if (rawContentLength === undefined) {
    throw captureError("capture.content-length-missing", "The response has no Content-Length header.");
  }
  if (!/^[0-9]+$/.test(rawContentLength)) {
    throw captureError("capture.content-length-invalid", "Content-Length is not an unsigned decimal integer.");
  }
  const contentLengthBigInt = BigInt(rawContentLength);
  if (contentLengthBigInt > BigInt(MAX_BODY_BYTES)) {
    throw captureError("capture.body-too-large", "The declared response body exceeds 64 KiB.");
  }
  const contentLength = Number(contentLengthBigInt);

  return Object.freeze({
    cacheControl: optionalHeader(headers, "cache-control"),
    contentEncoding: null,
    contentLength,
    contentType: "application/json",
    etag: optionalHeader(headers, "etag"),
    lastModified: optionalHeader(headers, "last-modified"),
    locationPresent: false,
    serverDate: optionalHeader(headers, "date"),
    setCookiePresent: false,
    status: 200,
    vary: optionalHeader(headers, "vary"),
  });
}

function requestOptions(sourceId: PublicAuthMetadataSourceId): Readonly<RequestOptions> {
  const target = sourceTarget(sourceId);
  return Object.freeze({
    agent: false,
    headers: Object.freeze({
      Accept: "application/json",
      "Accept-Encoding": "identity",
    }),
    hostname: target.hostname,
    maxHeaderSize: MAX_HEADER_BYTES,
    method: "GET",
    path: target.path,
    port: 443,
    protocol: "https:",
    rejectUnauthorized: true,
    servername: target.hostname,
  });
}

function captureOne(
  request: PublicAuthHttpsRequest,
  sourceId: PublicAuthMetadataSourceId,
): Promise<PublicAuthMetadataCapture> {
  const options = requestOptions(sourceId);

  return new Promise((resolve, reject) => {
    let activeRequest: RequestLike | null = null;
    let activeResponse: ResponseLike | null = null;
    let ended = false;
    let settled = false;
    let terminalError: PublicAuthMetadataCaptureError | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const clearCaptureTimeout = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    };

    const fail = (error: PublicAuthMetadataCaptureError) => {
      if (settled) return;
      settled = true;
      terminalError = error;
      clearCaptureTimeout();
      try {
        activeResponse?.destroy(error);
      } catch {
        // Destruction is best-effort, but the exact request is always attempted below.
      }
      try {
        activeRequest?.destroy(error);
      } catch {
        // Preserve the stable capture failure instead of leaking a transport teardown error.
      }
      reject(error);
    };

    const onResponse = (response: ResponseLike) => {
      if (settled) {
        try {
          response.destroy(captureError("capture.response-late", "A response arrived after capture ended."));
        } catch {
          // A late transport object cannot replace the already-settled result.
        }
        return;
      }
      activeResponse = response;
      response.on("error", (error) => {
        fail(captureError("capture.response-error", "The response stream failed.", error));
      });

      const statusCode = response.statusCode;
      if (statusCode !== undefined && statusCode >= 300 && statusCode <= 399) {
        fail(captureError("capture.redirect-rejected", "Redirect responses are not followed."));
        return;
      }
      if (statusCode !== 200) {
        fail(captureError("capture.status-invalid", "The response status is not 200."));
        return;
      }

      let http: PublicAuthMetadataHttpEvidence;
      try {
        http = validateResponseHeaders(response.rawHeaders);
      } catch (error) {
        fail(
          error instanceof PublicAuthMetadataCaptureError
            ? error
            : captureError("capture.headers-invalid", "Response header validation failed.", error),
        );
        return;
      }

      const chunks: Uint8Array[] = [];
      let bodyByteCount = 0;

      response.on("data", (chunk) => {
        if (settled) return;
        if (!(chunk instanceof Uint8Array)) {
          fail(captureError("capture.body-chunk-invalid", "The response emitted a non-byte body chunk."));
          return;
        }
        if (chunk.byteLength === 0) {
          fail(captureError("capture.body-chunk-empty", "The response emitted an empty body chunk."));
          return;
        }
        if (chunks.length >= MAX_BODY_CHUNKS) {
          fail(captureError("capture.body-chunk-count-exceeded", "The response emitted too many body chunks."));
          return;
        }
        bodyByteCount += chunk.byteLength;
        if (bodyByteCount > MAX_BODY_BYTES) {
          fail(captureError("capture.body-too-large", "The streamed response body exceeds its accepted bound."));
          return;
        }
        if (bodyByteCount > http.contentLength) {
          fail(captureError("capture.content-length-mismatch", "The streamed body exceeds Content-Length."));
          return;
        }
        try {
          chunks.push(new Uint8Array(chunk));
        } catch (error) {
          fail(captureError("capture.body-copy-failed", "A response body chunk could not be owned.", error));
        }
      });
      response.on("aborted", () => {
        fail(captureError("capture.body-premature-close", "The response body was aborted."));
      });
      response.on("close", () => {
        if (!ended) {
          fail(captureError("capture.body-premature-close", "The response closed before its body ended."));
        }
      });
      response.on("end", () => {
        if (settled) return;
        ended = true;
        if (response.complete === false) {
          fail(captureError("capture.body-premature-close", "The response message is incomplete."));
          return;
        }
        if (bodyByteCount !== http.contentLength) {
          fail(captureError("capture.content-length-mismatch", "The body length does not match Content-Length."));
          return;
        }

        let rawBodyBytes: Uint8Array;
        try {
          rawBodyBytes = new Uint8Array(bodyByteCount);
          let offset = 0;
          for (const chunk of chunks) {
            rawBodyBytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
        } catch (error) {
          fail(captureError("capture.body-copy-failed", "The response body could not be assembled.", error));
          return;
        }

        settled = true;
        clearCaptureTimeout();
        resolve(Object.freeze({
          http,
          rawBodyBytes,
          sourceId,
        }));
      });
    };

    try {
      activeRequest = request(options, onResponse);
      if (settled) {
        if (terminalError !== null) activeRequest.destroy(terminalError);
        return;
      }
      activeRequest.on("error", (error) => {
        fail(captureError("capture.request-error", "The HTTPS request failed.", error));
      });
      timeout = setTimeout(() => {
        fail(captureError("capture.timeout", "The capture exceeded ten seconds."));
      }, REQUEST_TIMEOUT_MS);
      (timeout as unknown as { unref?: () => void }).unref?.();
      activeRequest.end();
    } catch (error) {
      fail(captureError("capture.request-error", "The HTTPS request could not be started.", error));
    }
  });
}

export function createPublicAuthMetadataNodeCapture(
  request: PublicAuthHttpsRequest,
): PublicAuthMetadataNodeCapture {
  if (typeof request !== "function") {
    throw captureError("capture.request-dependency-invalid", "The HTTPS request dependency must be a function.");
  }
  const captureSource = async (sourceId: PublicAuthMetadataSourceId) => captureOne(request, sourceId);
  return Object.freeze({
    captureAll: async () => {
      const captures: PublicAuthMetadataCapture[] = [];
      for (const sourceId of SOURCE_IDS) captures.push(await captureSource(sourceId));
      return Object.freeze(captures);
    },
    captureSource,
  });
}

const nativeCapture = createPublicAuthMetadataNodeCapture((options, onResponse) =>
  nativeHttpsRequest(options, onResponse),
);

export const capturePublicAuthMetadataSource = nativeCapture.captureSource;
export const capturePublicAuthMetadataQuartet = nativeCapture.captureAll;
