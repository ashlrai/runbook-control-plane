import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const requestedOrigin = process.argv[2];

function fail(message) {
  throw new Error(`signer-live.${message}`);
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

if (requestedOrigin === undefined) fail("usage:pnpm --filter @runbook/signer verify:live -- https://owned-signer-origin.example");
const manifest = JSON.parse(readFileSync(resolve(DIST, "release-manifest.json"), "utf8"));
if (!manifest.nonPlaceholderOriginConfigured || manifest.allowLocalForDevelopment) fail("configured-origin-required");
if (requestedOrigin !== manifest.canonicalOrigin) fail("origin-does-not-match-build");

const localHeaders = readFileSync(resolve(DIST, "_headers"), "utf8");
const csp = /^  Content-Security-Policy: (.+)$/m.exec(localHeaders)?.[1];
if (csp === undefined) fail("local-csp-missing");
const assetPaths = Object.keys(manifest.files).filter((path) => path.startsWith("assets/")).sort();
if (assetPaths.length !== 2) fail("asset-cardinality");

const sharedHeaders = new Map([
  ["content-security-policy", csp],
  ["cross-origin-opener-policy", "same-origin"],
  ["cross-origin-embedder-policy", "require-corp"],
  ["cross-origin-resource-policy", "same-origin"],
  ["origin-agent-cluster", "?1"],
  ["referrer-policy", "no-referrer"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["x-robots-tag", "noindex, nofollow, noarchive"],
  ["strict-transport-security", "max-age=63072000; includeSubDomains"],
  ["permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), clipboard-read=()"],
]);

async function fetchExact(path, localPath, cacheFragment, contentTypeFragment) {
  const url = `${requestedOrigin}${path}`;
  const response = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "manual" });
  if (response.status !== 200 || response.url !== url || response.type === "opaqueredirect") fail(`response:${path}:${response.status}`);
  if (response.headers.has("set-cookie") || response.headers.has("access-control-allow-origin")) fail(`ambient-authority:${path}`);
  for (const [name, expected] of sharedHeaders) if (response.headers.get(name) !== expected) fail(`header:${path}:${name}`);
  if (!response.headers.get("cache-control")?.includes(cacheFragment)) fail(`cache:${path}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes(contentTypeFragment)) fail(`content-type:${path}`);
  const received = new Uint8Array(await response.arrayBuffer());
  const expected = new Uint8Array(readFileSync(resolve(DIST, localPath)));
  if (!equalBytes(received, expected)) fail(`bytes:${path}`);
}

await fetchExact("/", "index.html", "no-store", "text/html");
await fetchExact("/release-manifest.json", "release-manifest.json", "no-store", "application/json");
for (const path of assetPaths) {
  await fetchExact(`/${path}`, path, "max-age=31536000", path.endsWith(".js") ? "javascript" : "text/css");
  const map = await fetch(`${requestedOrigin}/${path}.map`, { cache: "no-store", credentials: "omit", redirect: "manual" });
  if (map.status < 400) fail(`source-map-exposed:${path}`);
}

console.log(`ok: live origin ${requestedOrigin} served exact ${manifest.releaseId} bytes and required isolation headers`);
