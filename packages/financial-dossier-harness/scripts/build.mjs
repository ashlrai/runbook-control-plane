import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(packageDirectory, "dist");
const expectedFiles = [
  "canonical.d.ts",
  "canonical.js",
  "index.d.ts",
  "index.js",
  "private/programs.d.ts",
  "private/programs.js",
  "private/runner.d.ts",
  "private/runner.js",
  "types.d.ts",
  "types.js",
  "verify.d.ts",
  "verify.js",
];

async function filesBelow(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(absolutePath));
    else if (entry.isFile()) output.push(relative(distDirectory, absolutePath));
    else throw new Error("harness.dist-unexpected-entry");
  }
  return output;
}

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

const actualFiles = (await filesBelow(distDirectory)).sort();
if (actualFiles.length !== expectedFiles.length ||
    actualFiles.some((name, index) => name !== expectedFiles[index])) {
  throw new Error(`harness.dist-file-set-invalid:${actualFiles.join(",")}`);
}
if (!process.argv.includes("--quiet")) {
  process.stdout.write(`harness dist verified: ${actualFiles.length} files\n`);
}
