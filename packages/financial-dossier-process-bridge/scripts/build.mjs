import { spawnSync } from "node:child_process";
import { copyFile, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const distDirectory = resolve(packageDirectory, "dist");
const expectedFiles = [
  "common-subject.d.ts",
  "common-subject.js",
  "framing.d.ts",
  "framing.js",
  "index.d.ts",
  "index.js",
  "loader.mjs",
  "owned-target.d.ts",
  "owned-target.js",
  "process-attempt.d.ts",
  "process-attempt.js",
  "reference-common-subject.mjs",
  "reference-finance-000-target.mjs",
  "run.d.ts",
  "run.js",
  "types.d.ts",
  "types.js",
];

function runNode(script, cwd) {
  const result = spawnSync(process.execPath, [script, "--quiet"], {
    cwd,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const dependency of ["financial-dossier-adapter", "financial-dossier-harness"]) {
  const directory = resolve(repositoryRoot, "packages", dependency);
  runNode(resolve(directory, "scripts/build.mjs"), directory);
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

await copyFile(resolve(packageDirectory, "src/loader.mjs"), resolve(distDirectory, "loader.mjs"));
await copyFile(
  resolve(packageDirectory, "src/reference-common-subject.mjs"),
  resolve(distDirectory, "reference-common-subject.mjs"),
);
await copyFile(
  resolve(packageDirectory, "src/reference-finance-000-target.mjs"),
  resolve(distDirectory, "reference-finance-000-target.mjs"),
);

const actualFiles = (await readdir(distDirectory, { withFileTypes: true }))
  .map((entry) => {
    if (!entry.isFile()) throw new Error("process-bridge.dist-unexpected-directory");
    return entry.name;
  })
  .sort();
if (actualFiles.length !== expectedFiles.length ||
    actualFiles.some((name, index) => name !== expectedFiles[index])) {
  throw new Error(`process-bridge.dist-file-set-invalid:${actualFiles.join(",")}`);
}
if (!process.argv.includes("--quiet")) {
  process.stdout.write(`process bridge dist verified: ${actualFiles.length} files\n`);
}
