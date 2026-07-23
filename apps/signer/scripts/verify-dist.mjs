import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const requireConfiguredOrigin = process.argv.includes("--configured-origin");
const PLACEHOLDER_ORIGIN = "https://signer.runbook-proof.example";

function fail(message) {
  throw new Error(`signer-dist.${message}`);
}

function sha(algorithm, bytes, encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function requireText(path) {
  if (!statSync(path).isFile()) fail(`not-file:${relative(DIST, path)}`);
  return readFileSync(path, "utf8");
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function parseHeaderScopes(source) {
  const scopes = new Map();
  let current;
  for (const [index, line] of source.split("\n").entries()) {
    if (line === "") continue;
    if (!line.startsWith("  ")) {
      if (scopes.has(line)) fail(`header-scope-duplicate:${line}`);
      current = new Map();
      scopes.set(line, current);
      continue;
    }
    if (current === undefined) fail(`header-before-scope:${index + 1}`);
    const match = /^  ([A-Za-z0-9-]+): (.+)$/.exec(line);
    if (match === null) fail(`header-syntax:${index + 1}`);
    const name = match[1].toLowerCase();
    if (current.has(name)) fail(`header-duplicate:${name}`);
    current.set(name, match[2]);
  }
  return scopes;
}

const manifestPath = resolve(DIST, "release-manifest.json");
let manifest;
try {
  manifest = JSON.parse(requireText(manifestPath));
} catch (error) {
  fail(`manifest-invalid:${error instanceof Error ? error.message : "unknown"}`);
}

if (manifest.schemaVersion !== "runbook.signer-release.v1") fail("manifest-schema");
if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(manifest.canonicalOrigin)) fail("canonical-origin");
if (!/^sha256:[a-f0-9]{64}$/.test(manifest.releaseId)) fail("release-id");
if (!Number.isSafeInteger(manifest.releaseInputCount) || manifest.releaseInputCount < 8) fail("release-input-count");
if (typeof manifest.allowLocalForDevelopment !== "boolean" || typeof manifest.nonPlaceholderOriginConfigured !== "boolean") fail("release-mode");
const hostname = new URL(manifest.canonicalOrigin).hostname;
const nonPlaceholderOriginConfigured = manifest.canonicalOrigin !== PLACEHOLDER_ORIGIN
  && hostname.includes(".")
  && isIP(hostname) === 0
  && !["example.com", "example.net", "example.org"].includes(hostname)
  && ![".example", ".example.com", ".example.net", ".example.org", ".invalid", ".localhost", ".test"].some((suffix) => hostname.endsWith(suffix));
if (manifest.nonPlaceholderOriginConfigured !== nonPlaceholderOriginConfigured) fail("configured-origin-claim");
if (requireConfiguredOrigin && (!manifest.nonPlaceholderOriginConfigured || manifest.allowLocalForDevelopment)) fail("configured-origin-required");

const fileEntries = Object.entries(manifest.files ?? {});
const scripts = fileEntries.filter(([path]) => /^assets\/signer-[A-Z0-9]+\.js$/.test(path));
const styles = fileEntries.filter(([path]) => /^assets\/signer-[A-Z0-9]+\.css$/.test(path));
if (scripts.length !== 1 || styles.length !== 1) fail("asset-cardinality");
const [scriptPath, scriptHash] = scripts[0];
const [stylePath, styleHash] = styles[0];
const expectedManifestPaths = ["_headers", "index.html", scriptPath, stylePath].sort();
if (JSON.stringify(fileEntries.map(([path]) => path).sort()) !== JSON.stringify(expectedManifestPaths)) fail("manifest-file-set");
const expectedPaths = ["_headers", "index.html", "release-manifest.json", scriptPath, stylePath].sort();
const actualPaths = filesUnder(DIST).map((path) => relative(DIST, path)).sort();
if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) fail("unexpected-files");

for (const [path, expectedHash] of fileEntries) {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) fail(`manifest-hash:${path}`);
  const actualHash = sha("sha256", readFileSync(resolve(DIST, path)));
  if (actualHash !== expectedHash) fail(`digest-mismatch:${path}`);
}

const scriptBytes = readFileSync(resolve(DIST, scriptPath));
const styleBytes = readFileSync(resolve(DIST, stylePath));
const scriptSri = `sha384-${sha("sha384", scriptBytes, "base64")}`;
const styleSri = `sha384-${sha("sha384", styleBytes, "base64")}`;
if (manifest.sri?.script !== scriptSri || manifest.sri?.style !== styleSri) fail("sri-mismatch");

const html = requireText(resolve(DIST, "index.html"));
const headers = requireText(resolve(DIST, "_headers"));
const script = scriptBytes.toString("utf8");
if (!html.includes(`src="/${scriptPath}" integrity="${scriptSri}" crossorigin="anonymous" defer`)) fail("html-script-binding");
if (!html.includes(`href="/${stylePath}" integrity="${styleSri}" crossorigin="anonymous"`)) fail("html-style-binding");
if (/<style\b/i.test(html) || /<script\b(?![^>]*\bsrc=)/i.test(html) || /\son[a-z]+\s*=/i.test(html)) fail("html-inline-execution");
if (html.includes("__SCRIPT_") || html.includes("__STYLE_")) fail("html-placeholder");

const parsedScopes = parseHeaderScopes(headers);
if (JSON.stringify([...parsedScopes.keys()]) !== JSON.stringify(["/*", "/assets/*"])) fail("header-scopes");
const globalHeaders = parsedScopes.get("/*");
const assetHeaders = parsedScopes.get("/assets/*");
if (globalHeaders === undefined || assetHeaders === undefined) fail("header-scopes");
const expectedGlobalHeaders = new Map([
  ["content-security-policy", [`default-src 'none'`, `script-src 'none'`, `script-src-elem ${manifest.canonicalOrigin}/${scriptPath} '${scriptSri}'`, `script-src-attr 'none'`, `style-src 'none'`, `style-src-elem ${manifest.canonicalOrigin}/${stylePath} '${styleSri}'`, `style-src-attr 'none'`, `connect-src 'none'`, `img-src 'none'`, `font-src 'none'`, `media-src 'none'`, `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`, `child-src 'none'`, `manifest-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `require-trusted-types-for 'script'`, `trusted-types 'none'`].join("; ")],
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
  ["cache-control", "no-store"],
]);
if (globalHeaders.size !== expectedGlobalHeaders.size) fail("header-global-cardinality");
for (const [name, expected] of expectedGlobalHeaders) if (globalHeaders.get(name) !== expected) fail(`header-global:${name}`);
if (assetHeaders.size !== 1 || assetHeaders.get("cache-control") !== "public, max-age=31536000, immutable") fail("header-assets");

for (const forbidden of [
  "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "new Worker", "SharedWorker",
  "serviceWorker.register", "postMessage", "new Function", "eval(", "sourceMappingURL", "BEGIN PRIVATE KEY",
  "innerHTML", "outerHTML", "insertAdjacentHTML", "createPolicy", "DOMParser",
  "9d61b19deffd5a60", "http://", "localhost", "127.0.0.1",
]) if (script.includes(forbidden)) fail(`bundle-forbidden:${forbidden}`);
if (!script.includes(manifest.releaseId) || !script.includes(manifest.canonicalOrigin)) fail("bundle-release-binding");
if (!script.includes(manifest.seedArchiveSha256)) fail("bundle-seed-binding");

const reproDist = mkdtempSync(resolve(tmpdir(), "runbook-signer-repro-"));
try {
  const environment = { ...process.env, SIGNER_CANONICAL_ORIGIN: manifest.canonicalOrigin, SIGNER_REPRO_DIST: reproDist };
  if (manifest.allowLocalForDevelopment) environment.SIGNER_ALLOW_LOCAL = "true";
  else delete environment.SIGNER_ALLOW_LOCAL;
  execFileSync(process.execPath, [resolve(ROOT, "scripts/build.mjs")], { cwd: ROOT, env: environment, stdio: "pipe" });
  const reproducedPaths = filesUnder(reproDist).map((path) => relative(reproDist, path)).sort();
  if (JSON.stringify(reproducedPaths) !== JSON.stringify(actualPaths)) fail("repro-file-set");
  for (const path of actualPaths) {
    if (!equalBytes(readFileSync(resolve(DIST, path)), readFileSync(resolve(reproDist, path)))) fail(`repro-bytes:${path}`);
  }
} finally {
  rmSync(reproDist, { recursive: true, force: true });
}

console.log(`ok: signer dist ${manifest.releaseId}, ${manifest.releaseInputCount} release inputs, exact reproducible source build/assets/SRI/header scopes, forbidden runtime-network tokens absent`);
