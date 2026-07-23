import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("production security headers", () => {
  it("applies an isolated, deny-by-default policy to every route and Worker asset", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const entries = await nextConfig.headers?.();
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.source).toBe("/:path*");

    const headers = new Map(entries?.[0]?.headers.map(({ key, value }) => [key, value]));
    const csp = headers.get("Content-Security-Policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("Permissions-Policy")).toContain("payment=()");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});
