import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executableFiles = [
  "dist/canonical.d.ts",
  "dist/canonical.js",
  "dist/constants.d.ts",
  "dist/constants.js",
  "dist/helpers.d.ts",
  "dist/helpers.js",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/types.d.ts",
  "dist/types.js",
  "dist/validate.d.ts",
  "dist/validate.js",
];
const expectedFiles = ["README.md", ...executableFiles, "package.json"];
const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: packageDirectory,
  encoding: "utf8",
  maxBuffer: 1_048_576,
});
if (result.error !== undefined) throw result.error;
if (result.status !== 0) {
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
let report;
try {
  report = JSON.parse(result.stdout)[0];
} catch {
  throw new Error("adapter.pack-report-invalid");
}
if (report === undefined || !Array.isArray(report.files)) {
  throw new Error("adapter.pack-report-invalid");
}
const actualFiles = report.files.map((entry) => entry.path).sort();
if (
  actualFiles.length !== expectedFiles.length ||
  actualFiles.some((name, index) => name !== expectedFiles[index])
) {
  throw new Error(`adapter.pack-file-set-invalid:${actualFiles.join(",")}`);
}

const prohibited = [
  ["ora", "cle"],
  ["cor", "pus"],
  ["sce", "nario"],
  ["ordi", "nal"],
  ["fam", "ily"],
  ["condi", "tion"],
  ["find", "ing"],
  ["rece", "ipt"],
].map((parts) => parts.join(""));
for (const path of executableFiles) {
  const entry = report.files.find((candidate) => candidate.path === path);
  const absolutePath = resolve(packageDirectory, path);
  const metadata = await stat(absolutePath);
  if (entry === undefined || entry.size !== metadata.size || !metadata.isFile()) {
    throw new Error(`adapter.pack-file-binding-invalid:${path}`);
  }
  const bytes = await readFile(absolutePath);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).toLowerCase();
  } catch {
    throw new Error(`adapter.pack-file-not-text:${path}`);
  }
  if (prohibited.some((word) => text.includes(word)) || /finance-[0-9]{3}/.test(text)) {
    throw new Error(`adapter.pack-authority-vocabulary:${path}`);
  }
}
if (!process.argv.includes("--quiet")) {
  process.stdout.write(`adapter pack verified: ${actualFiles.length} files\n`);
}
