import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(packageRoot, "dist/host-runner.mjs");
await mkdir(dirname(outfile), { recursive: true });
await build({
  absWorkingDir: packageRoot,
  banner: { js: "#!/usr/bin/env node" },
  bundle: true,
  charset: "utf8",
  entryPoints: ["scripts/host-runner-entry.ts"],
  format: "esm",
  legalComments: "none",
  logLevel: "warning",
  minify: false,
  outfile,
  packages: "bundle",
  platform: "node",
  sourcemap: false,
  target: ["node22"],
  treeShaking: true,
});
