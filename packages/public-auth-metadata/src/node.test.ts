/// <reference types="node" />

import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPublicAuthMetadataNodeCapture,
  type PublicAuthHttpsRequest,
  type PublicAuthMetadataCaptureError,
} from "./node-internal.js";
import type { PublicAuthMetadataSourceId } from "./types.js";

type Completion = "aborted" | "close" | "end" | "incomplete-end" | "response-error";

type ResponsePlan = Readonly<{
  chunks?: readonly Uint8Array[];
  completion?: Completion;
  rawHeaders: readonly string[];
  statusCode: number;
}>;

class FakeResponse extends EventEmitter {
  complete = true;
  destroyed = false;
  destroyError: Error | undefined;
  readonly rawHeaders: readonly string[];
  readonly statusCode: number;

  constructor(plan: ResponsePlan) {
    super();
    this.rawHeaders = plan.rawHeaders;
    this.statusCode = plan.statusCode;
  }

  destroy(error?: Error) {
    this.destroyed = true;
    this.destroyError = error;
  }
}

class FakeRequest extends EventEmitter {
  destroyed = false;
  destroyError: Error | undefined;
  endCalls = 0;

  destroy(error?: Error) {
    this.destroyed = true;
    this.destroyError = error;
  }

  end() {
    this.endCalls += 1;
  }
}

function jsonHeaders(byteLength: number, extra: readonly string[] = []): readonly string[] {
  return [
    "Content-Type",
    "application/json",
    "Content-Length",
    String(byteLength),
    ...extra,
  ];
}

function fakeTransport(
  planFor: (options: Readonly<RequestOptions>, call: number) => ResponsePlan | "hang" | "request-error",
) {
  const calls: RequestOptions[] = [];
  const requests: FakeRequest[] = [];
  const responses: FakeResponse[] = [];

  const request: PublicAuthHttpsRequest = (options, onResponse) => {
    const call = calls.length;
    calls.push(options);
    const fakeRequest = new FakeRequest();
    requests.push(fakeRequest);
    const originalEnd = fakeRequest.end.bind(fakeRequest);
    fakeRequest.end = () => {
      originalEnd();
      queueMicrotask(() => {
        const plan = planFor(options, call);
        if (plan === "hang") return;
        if (plan === "request-error") {
          fakeRequest.emit("error", new Error("synthetic request failure"));
          return;
        }

        const response = new FakeResponse(plan);
        responses.push(response);
        onResponse(response);
        if (response.destroyed) return;
        for (const chunk of plan.chunks ?? []) {
          response.emit("data", chunk);
          if (response.destroyed) return;
        }

        switch (plan.completion ?? "end") {
          case "aborted":
            response.emit("aborted");
            break;
          case "close":
            response.emit("close");
            break;
          case "incomplete-end":
            response.complete = false;
            response.emit("end");
            break;
          case "response-error":
            response.emit("error", new Error("synthetic response failure"));
            break;
          case "end":
            response.emit("end");
            response.emit("close");
            break;
        }
      });
    };
    return fakeRequest;
  };

  return { calls, request, requests, responses };
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function expectCaptureCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject<Partial<PublicAuthMetadataCaptureError>>({ code });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("public auth metadata Node capture boundary", () => {
  it("issues one exact bodyless GET and returns owned bytes plus allowlisted provenance", async () => {
    const bodyChunk = bytes('{"issuer":"trap"}\n');
    const transport = fakeTransport(() => ({
      chunks: [bodyChunk],
      rawHeaders: jsonHeaders(bodyChunk.byteLength, [
        "Date",
        "Wed, 22 Jul 2026 13:04:27 GMT",
        "ETag",
        "\"candidate-1\"",
        "Last-Modified",
        "Wed, 22 Jul 2026 12:00:00 GMT",
        "Cache-Control",
        "public, max-age=60",
        "Vary",
        "Accept-Encoding",
        "Server",
        "must-not-enter-evidence",
        "X-Amz-Cf-Id",
        "must-not-enter-evidence",
      ]),
      statusCode: 200,
    }));
    const capture = createPublicAuthMetadataNodeCapture(transport.request);

    const result = await capture.captureSource("robinhood-trading-authorization-server");
    bodyChunk.fill(0);

    expect(new TextDecoder().decode(result.rawBodyBytes)).toBe('{"issuer":"trap"}\n');
    expect(result).toEqual({
      http: {
        cacheControl: "public, max-age=60",
        contentEncoding: null,
        contentLength: 18,
        contentType: "application/json",
        etag: '"candidate-1"',
        lastModified: "Wed, 22 Jul 2026 12:00:00 GMT",
        locationPresent: false,
        serverDate: "Wed, 22 Jul 2026 13:04:27 GMT",
        setCookiePresent: false,
        status: 200,
        vary: "Accept-Encoding",
      },
      rawBodyBytes: result.rawBodyBytes,
      sourceId: "robinhood-trading-authorization-server",
    });
    expect(Object.keys(result.http).sort()).toEqual([
      "cacheControl",
      "contentEncoding",
      "contentLength",
      "contentType",
      "etag",
      "lastModified",
      "locationPresent",
      "serverDate",
      "setCookiePresent",
      "status",
      "vary",
    ]);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      agent: false,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
      },
      hostname: "agent.robinhood.com",
      maxHeaderSize: 16 * 1024,
      method: "GET",
      path: "/.well-known/oauth-authorization-server/mcp/trading",
      port: 443,
      protocol: "https:",
      rejectUnauthorized: true,
      servername: "agent.robinhood.com",
    });
    expect(transport.requests[0]?.endCalls).toBe(1);
    expect(transport.requests[0]?.destroyed).toBe(false);
  });

  it("owns each streamed chunk before a transport can mutate it", async () => {
    const emittedChunk = bytes("{}");
    const request: PublicAuthHttpsRequest = (_options, onResponse) => {
      const fakeRequest = new FakeRequest();
      const originalEnd = fakeRequest.end.bind(fakeRequest);
      fakeRequest.end = () => {
        originalEnd();
        queueMicrotask(() => {
          const response = new FakeResponse({
            rawHeaders: jsonHeaders(2),
            statusCode: 200,
          });
          onResponse(response);
          response.emit("data", emittedChunk);
          emittedChunk.fill(0);
          response.emit("end");
        });
      };
      return fakeRequest;
    };

    const result = await createPublicAuthMetadataNodeCapture(request)
      .captureSource("robinhood-trading-protected-resource");

    expect(new TextDecoder().decode(result.rawBodyBytes)).toBe("{}");
  });

  it("requests exactly the closed quartet and never chains to discovered trap endpoints", async () => {
    const trapBody = bytes(JSON.stringify({
      authorization_endpoint: "https://trap.invalid/authorize",
      authorization_servers: ["https://trap.invalid/authorization-server"],
      issuer: "https://trap.invalid",
      mcp: "https://trap.invalid/mcp",
      registration_endpoint: "https://trap.invalid/register",
      resource: "https://trap.invalid/resource",
      token_endpoint: "https://trap.invalid/token",
    }));
    const transport = fakeTransport(() => ({
      chunks: [trapBody],
      rawHeaders: jsonHeaders(trapBody.byteLength),
      statusCode: 200,
    }));
    const capture = createPublicAuthMetadataNodeCapture(transport.request);

    const results = await capture.captureAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(results.map((result) => result.sourceId)).toEqual([
      "robinhood-banking-authorization-server",
      "robinhood-banking-protected-resource",
      "robinhood-trading-authorization-server",
      "robinhood-trading-protected-resource",
    ]);
    expect(transport.calls).toHaveLength(4);
    expect(transport.calls.map(({ hostname, path }) => `${hostname}${path}`)).toEqual([
      "banking-agent.robinhood.com/.well-known/oauth-authorization-server/mcp/banking",
      "banking-agent.robinhood.com/.well-known/oauth-protected-resource/mcp/banking",
      "agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading",
      "agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading",
    ]);
    expect(transport.calls.every((call) => !JSON.stringify(call).includes("trap.invalid"))).toBe(true);
  });

  it("stops the sequential quartet after the first failure and leaves no sibling requests", async () => {
    const transport = fakeTransport(() => ({
      rawHeaders: jsonHeaders(0),
      statusCode: 500,
    }));
    const capture = createPublicAuthMetadataNodeCapture(transport.request);

    await expectCaptureCode(capture.captureAll(), "capture.status-invalid");
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.calls).toHaveLength(1);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.destroyed).toBe(true);
    expect(transport.responses[0]?.destroyed).toBe(true);
  });

  it("rejects a runtime source outside the private table without requesting it", async () => {
    const transport = fakeTransport(() => "hang");
    const capture = createPublicAuthMetadataNodeCapture(transport.request);

    await expectCaptureCode(
      capture.captureSource("https://attacker.invalid" as PublicAuthMetadataSourceId),
      "capture.source-id-invalid",
    );
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    [301, "capture.redirect-rejected"],
    [302, "capture.redirect-rejected"],
    [307, "capture.redirect-rejected"],
    [308, "capture.redirect-rejected"],
    [199, "capture.status-invalid"],
    [201, "capture.status-invalid"],
    [404, "capture.status-invalid"],
    [500, "capture.status-invalid"],
  ])("rejects status %i without following it", async (statusCode, code) => {
    const transport = fakeTransport(() => ({
      rawHeaders: jsonHeaders(0, ["Location", "https://trap.invalid/next"]),
      statusCode,
    }));
    const capture = createPublicAuthMetadataNodeCapture(transport.request);

    await expectCaptureCode(
      capture.captureSource("robinhood-trading-protected-resource"),
      code,
    );
    expect(transport.calls).toHaveLength(1);
    expect(transport.requests[0]?.destroyed).toBe(true);
    expect(transport.responses[0]?.destroyed).toBe(true);
  });

  it.each([
    [jsonHeaders(0, ["Set-Cookie", "session=forbidden"]), "capture.set-cookie-rejected"],
    [jsonHeaders(0, ["Content-Encoding", "identity"]), "capture.content-encoding-rejected"],
    [jsonHeaders(0, ["Content-Encoding", "gzip"]), "capture.content-encoding-rejected"],
    [jsonHeaders(0, ["Transfer-Encoding", "chunked"]), "capture.transfer-encoding-rejected"],
    [jsonHeaders(0, ["Location", "https://trap.invalid/next"]), "capture.location-rejected"],
    [["Content-Length", "0"], "capture.content-type-missing"],
    [["Content-Type", "application/json"], "capture.content-length-missing"],
    [["Content-Type", "text/plain", "Content-Length", "0"], "capture.content-type-invalid"],
    [["Content-Type", "application/json", "Content-Length", "-1"], "capture.content-length-invalid"],
    [["Content-Type", "application/json", "Content-Length", "65537"], "capture.body-too-large"],
    [["Content-Type", "application/json", "content-type", "application/json", "Content-Length", "0"], "capture.header-duplicate"],
    [["Content-Type", "application/json", "Content-Length", "0", "content-length", "0"], "capture.header-duplicate"],
    [jsonHeaders(0, ["Cache-Control", ""]), "capture.header-value-invalid"],
    [jsonHeaders(0, ["ETag", "x".repeat(1_025)]), "capture.header-value-invalid"],
    [["Bad Header", "x", "Content-Type", "application/json", "Content-Length", "0"], "capture.headers-invalid"],
    [["X-Test", "bad\nvalue", "Content-Type", "application/json", "Content-Length", "0"], "capture.headers-invalid"],
    [["Content-Type", "application/json", "Content-Length"], "capture.headers-invalid"],
  ])("rejects hostile response headers %#", async (rawHeaders, code) => {
    const transport = fakeTransport(() => ({ rawHeaders, statusCode: 200 }));
    const capture = createPublicAuthMetadataNodeCapture(transport.request);

    await expectCaptureCode(
      capture.captureSource("robinhood-banking-protected-resource"),
      code,
    );
    expect(transport.requests[0]?.destroyed).toBe(true);
  });

  it.each([
    "Cache-Control",
    "Content-Encoding",
    "Content-Length",
    "Content-Type",
    "Date",
    "ETag",
    "Last-Modified",
    "Location",
    "Set-Cookie",
    "Transfer-Encoding",
    "Vary",
  ])("rejects duplicate %s singleton headers before interpreting them", async (headerName) => {
    const base = headerName.toLowerCase() === "content-type"
      ? ["Content-Length", "0"]
      : headerName.toLowerCase() === "content-length"
        ? ["Content-Type", "application/json"]
        : [...jsonHeaders(0)];
    const value = headerName.toLowerCase() === "content-length"
      ? "0"
      : headerName.toLowerCase() === "content-type"
        ? "application/json"
        : "synthetic";
    const transport = fakeTransport(() => ({
      rawHeaders: [...base, headerName, value, headerName.toLowerCase(), value],
      statusCode: 200,
    }));

    await expectCaptureCode(
      createPublicAuthMetadataNodeCapture(transport.request)
        .captureSource("robinhood-banking-protected-resource"),
      "capture.header-duplicate",
    );
  });

  it("accepts a JSON charset parameter but normalizes only the JSON media type", async () => {
    const body = bytes("{}");
    const transport = fakeTransport(() => ({
      chunks: [body],
      rawHeaders: ["Content-Type", "Application/JSON; charset=utf-8", "Content-Length", "2"],
      statusCode: 200,
    }));
    const result = await createPublicAuthMetadataNodeCapture(transport.request)
      .captureSource("robinhood-banking-authorization-server");

    expect(result.http.contentType).toBe("application/json");
  });

  it("rejects a response header section over 16 KiB", async () => {
    const transport = fakeTransport(() => ({
      rawHeaders: jsonHeaders(0, ["X-Padding", "x".repeat(16 * 1024)]),
      statusCode: 200,
    }));

    await expectCaptureCode(
      createPublicAuthMetadataNodeCapture(transport.request)
        .captureSource("robinhood-banking-protected-resource"),
      "capture.headers-too-large",
    );
  });

  it.each([
    [jsonHeaders(2), [bytes("{}x")], "end", "capture.content-length-mismatch"],
    [jsonHeaders(3), [bytes("{}")], "end", "capture.content-length-mismatch"],
    [jsonHeaders(65_536), [new Uint8Array(65_537)], "end", "capture.body-too-large"],
    [jsonHeaders(0), [new Uint8Array(0)], "end", "capture.body-chunk-empty"],
    [jsonHeaders(2), [bytes("{")], "close", "capture.body-premature-close"],
    [jsonHeaders(2), [bytes("{")], "aborted", "capture.body-premature-close"],
    [jsonHeaders(2), [bytes("{}")], "incomplete-end", "capture.body-premature-close"],
    [jsonHeaders(2), [bytes("{")], "response-error", "capture.response-error"],
  ] as const)("rejects hostile framing case %#", async (rawHeaders, chunks, completion, code) => {
    const transport = fakeTransport(() => ({
      chunks,
      completion,
      rawHeaders,
      statusCode: 200,
    }));

    await expectCaptureCode(
      createPublicAuthMetadataNodeCapture(transport.request)
        .captureSource("robinhood-trading-protected-resource"),
      code,
    );
    expect(transport.requests[0]?.destroyed).toBe(true);
    expect(transport.responses[0]?.destroyed).toBe(true);
  });

  it("rejects more than 1024 non-empty chunks even when their total is below 64 KiB", async () => {
    const chunks = Array.from({ length: 1025 }, () => new Uint8Array([0x20]));
    const transport = fakeTransport(() => ({
      chunks,
      rawHeaders: jsonHeaders(chunks.length),
      statusCode: 200,
    }));

    await expectCaptureCode(
      createPublicAuthMetadataNodeCapture(transport.request)
        .captureSource("robinhood-trading-protected-resource"),
      "capture.body-chunk-count-exceeded",
    );
    expect(transport.requests[0]?.destroyed).toBe(true);
    expect(transport.responses[0]?.destroyed).toBe(true);
  });

  it("contains a throwing late response without changing the completed capture", async () => {
    const request: PublicAuthHttpsRequest = (_options, onResponse) => {
      const fakeRequest = new FakeRequest();
      const originalEnd = fakeRequest.end.bind(fakeRequest);
      fakeRequest.end = () => {
        originalEnd();
        queueMicrotask(() => {
          const accepted = new FakeResponse({
            rawHeaders: jsonHeaders(2),
            statusCode: 200,
          });
          onResponse(accepted);
          accepted.emit("data", bytes("{}"));
          accepted.emit("end");

          const late = new FakeResponse({
            rawHeaders: jsonHeaders(0),
            statusCode: 200,
          });
          late.destroy = () => {
            throw new Error("synthetic late destroy failure");
          };
          onResponse(late);
        });
      };
      return fakeRequest;
    };

    const result = await createPublicAuthMetadataNodeCapture(request)
      .captureSource("robinhood-trading-protected-resource");
    await Promise.resolve();

    expect(new TextDecoder().decode(result.rawBodyBytes)).toBe("{}");
  });

  it("rejects request-stream errors and destroys the exact request", async () => {
    const transport = fakeTransport(() => "request-error");

    await expectCaptureCode(
      createPublicAuthMetadataNodeCapture(transport.request)
        .captureSource("robinhood-trading-protected-resource"),
      "capture.request-error",
    );
    expect(transport.requests[0]?.destroyed).toBe(true);
  });

  it("rejects a synchronous request-construction failure", async () => {
    const request: PublicAuthHttpsRequest = () => {
      throw new Error("synthetic construction failure");
    };

    await expectCaptureCode(
      createPublicAuthMetadataNodeCapture(request)
        .captureSource("robinhood-trading-protected-resource"),
      "capture.request-error",
    );
  });

  it("enforces a ten-second total timeout and destroys the exact request", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport(() => "hang");
    const result = createPublicAuthMetadataNodeCapture(transport.request)
      .captureSource("robinhood-trading-protected-resource");
    const rejection = expectCaptureCode(result, "capture.timeout");

    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    expect(transport.requests[0]?.destroyed).toBe(true);
  });
});
