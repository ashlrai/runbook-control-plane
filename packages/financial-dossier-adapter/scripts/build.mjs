import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(packageDirectory, "dist");
const expectedFiles = [
  "canonical.d.ts",
  "canonical.js",
  "constants.d.ts",
  "constants.js",
  "helpers.d.ts",
  "helpers.js",
  "index.d.ts",
  "index.js",
  "types.d.ts",
  "types.js",
  "validate.d.ts",
  "validate.js",
];

await rm(distDirectory, { force: true, recursive: true });
const command = process.platform === "win32" ? "tsc.cmd" : "tsc";
const result = spawnSync(command, ["-p", "tsconfig.json"], {
  cwd: packageDirectory,
  encoding: "utf8",
});
if (result.error !== undefined) throw result.error;
if (result.stdout !== "") process.stdout.write(result.stdout);
if (result.stderr !== "") process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

const actualFiles = (await readdir(distDirectory, { withFileTypes: true }))
  .map((entry) => {
    if (!entry.isFile()) throw new Error("adapter.dist-unexpected-directory");
    return entry.name;
  })
  .sort();
if (
  actualFiles.length !== expectedFiles.length ||
  actualFiles.some((name, index) => name !== expectedFiles[index])
) {
  throw new Error(`adapter.dist-file-set-invalid:${actualFiles.join(",")}`);
}
if (!process.argv.includes("--quiet")) {
  process.stdout.write(`adapter dist verified: ${actualFiles.length} files\n`);
}
