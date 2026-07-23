import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  bundle: true,
  charset: "utf8",
  entryPoints: [fileURLToPath(new URL("./cli-entry.ts", import.meta.url))],
  format: "esm",
  legalComments: "none",
  logLevel: "silent",
  minify: false,
  outfile: fileURLToPath(
    new URL("../dist/runbook-capabilities.mjs", import.meta.url),
  ),
  platform: "node",
  sourcemap: false,
  target: "node22",
});
