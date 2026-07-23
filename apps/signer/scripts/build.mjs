import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version as esbuildVersion } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedReproDist = process.env.SIGNER_REPRO_DIST;
const DIST = requestedReproDist === undefined ? resolve(ROOT, "dist") : resolve(requestedReproDist);
if (requestedReproDist !== undefined && (!DIST.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(DIST).startsWith("runbook-signer-repro-"))) {
  throw new Error("SIGNER_REPRO_DIST must be a dedicated runbook-signer-repro-* directory under the system temporary directory.");
}
const PLACEHOLDER_ORIGIN = "https://signer.runbook-proof.example";
const canonicalOrigin = process.env.SIGNER_CANONICAL_ORIGIN ?? PLACEHOLDER_ORIGIN;
const allowLocal = process.env.SIGNER_ALLOW_LOCAL === "true";
if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(canonicalOrigin)) throw new Error("SIGNER_CANONICAL_ORIGIN must be one HTTPS origin with no path.");

function sha(algorithm, bytes) { return createHash(algorithm).update(bytes).digest("hex"); }

const buildOptions = {
  absWorkingDir: ROOT,
  bundle: true,
  entryNames: "assets/signer-[hash]",
  entryPoints: ["src/main.ts"],
  format: "iife",
  legalComments: "none",
  loader: { ".runbook": "binary" },
  metafile: true,
  minify: true,
  outdir: DIST,
  platform: "browser",
  sourcemap: false,
  splitting: false,
  target: "es2022",
};

function releaseDefines(releaseId) {
  return {
    __SIGNER_ALLOW_LOCAL__: allowLocal ? "true" : "false",
    __SIGNER_CANONICAL_ORIGIN__: JSON.stringify(canonicalOrigin),
    __SIGNER_RELEASE_ID__: JSON.stringify(releaseId),
  };
}

// Discover the exact files esbuild consumes before deriving the release identity.
// The provisional ID cannot affect this input graph and is not itself hashed.
const probe = await build({
  ...buildOptions,
  define: releaseDefines(`sha256:${"0".repeat(64)}`),
  write: false,
});
const bundledInputs = Object.keys(probe.metafile.inputs).map((path) => resolve(ROOT, path));
const releaseScaffolding = [
  resolve(ROOT, "index.template.html"),
  resolve(ROOT, "package.json"),
  resolve(ROOT, "scripts/build.mjs"),
  resolve(ROOT, "scripts/verify-dist.mjs"),
  resolve(ROOT, "scripts/verify-live.mjs"),
  resolve(ROOT, "security/headers.template"),
  resolve(ROOT, "tsconfig.json"),
  resolve(ROOT, "../..", "package.json"),
  resolve(ROOT, "../..", "pnpm-lock.yaml"),
  resolve(ROOT, "../..", "pnpm-workspace.yaml"),
];
const releaseInputs = [...new Set([...bundledInputs, ...releaseScaffolding])].sort();
const releaseContext = Buffer.from(JSON.stringify({
  allowLocal,
  canonicalOrigin,
  esbuildVersion,
  nodeVersion: process.version,
  schemaVersion: "runbook.signer-release-inputs.v1",
}));
const releaseHash = sha("sha256", Buffer.concat([
  Buffer.from("RUNBOOK_SIGNER_RELEASE_V1\0"),
  releaseContext,
  Buffer.from([0]),
  ...releaseInputs.map((path) => Buffer.concat([Buffer.from(relative(ROOT, path)), Buffer.from([0]), readFileSync(path), Buffer.from([0])])),
]));
const releaseId = `sha256:${releaseHash}`;
const releaseHostname = new URL(canonicalOrigin).hostname;
const nonPlaceholderOriginConfigured = canonicalOrigin !== PLACEHOLDER_ORIGIN
  && releaseHostname.includes(".")
  && isIP(releaseHostname) === 0
  && !["example.com", "example.net", "example.org"].includes(releaseHostname)
  && ![".example", ".example.com", ".example.net", ".example.org", ".invalid", ".localhost", ".test"].some((suffix) => releaseHostname.endsWith(suffix));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(resolve(DIST, "assets"), { recursive: true });
const result = await build({
  ...buildOptions,
  define: releaseDefines(releaseId),
  write: true,
});
const outputs = Object.keys(result.metafile.outputs).map((path) => resolve(ROOT, path));
const script = outputs.find((path) => path.endsWith(".js"));
const style = outputs.find((path) => path.endsWith(".css"));
if (!script || !style) throw new Error("Expected exactly one JavaScript and one CSS output.");
const scriptPath = `/${relative(DIST, script)}`;
const stylePath = `/${relative(DIST, style)}`;
const sri = (path) => `sha384-${createHash("sha384").update(readFileSync(path)).digest("base64")}`;
const scriptSri = sri(script);
const styleSri = sri(style);
const html = readFileSync(resolve(ROOT, "index.template.html"), "utf8")
  .replace("__SCRIPT_PATH__", scriptPath).replace("__SCRIPT_SRI__", scriptSri)
  .replace("__STYLE_PATH__", stylePath).replace("__STYLE_SRI__", styleSri);
const csp = [`default-src 'none'`, `script-src 'none'`, `script-src-elem ${canonicalOrigin}${scriptPath} '${scriptSri}'`, `script-src-attr 'none'`, `style-src 'none'`, `style-src-elem ${canonicalOrigin}${stylePath} '${styleSri}'`, `style-src-attr 'none'`, `connect-src 'none'`, `img-src 'none'`, `font-src 'none'`, `media-src 'none'`, `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`, `child-src 'none'`, `manifest-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `require-trusted-types-for 'script'`, `trusted-types 'none'`].join("; ");
const headers = readFileSync(resolve(ROOT, "security/headers.template"), "utf8").replace("__CSP__", csp);
const manifest = {
  allowLocalForDevelopment: allowLocal,
  canonicalOrigin,
  files: Object.fromEntries([resolve(DIST, "index.html"), resolve(DIST, "_headers"), script, style].map((path) => [relative(DIST, path), path.endsWith("index.html") || path.endsWith("_headers") ? null : sha("sha256", readFileSync(path))])),
  nonPlaceholderOriginConfigured,
  releaseId,
  releaseInputCount: releaseInputs.length,
  schemaVersion: "runbook.signer-release.v1",
  seedArchiveSha256: "a941a709d311ec05993ce0f8d2c8c25ae8303f3fe2bd27458815f6c39b6d8946",
  sri: { script: scriptSri, style: styleSri },
};
writeFileSync(resolve(DIST, "index.html"), html);
writeFileSync(resolve(DIST, "_headers"), headers);
manifest.files["index.html"] = sha("sha256", Buffer.from(html));
manifest.files["_headers"] = sha("sha256", Buffer.from(headers));
writeFileSync(resolve(DIST, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
