import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const executableFiles = [
  "dist/canonical.d.ts",
  "dist/canonical.js",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/private/programs.d.ts",
  "dist/private/programs.js",
  "dist/private/runner.d.ts",
  "dist/private/runner.js",
  "dist/types.d.ts",
  "dist/types.js",
  "dist/verify.d.ts",
  "dist/verify.js",
];
const expectedFiles = ["README.md", ...executableFiles, "package.json"].sort();

function run(command, arguments_, cwd = packageDirectory) {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 2_000_000 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stdout !== "") process.stdout.write(result.stdout);
    if (result.stderr !== "") process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

run(process.execPath, ["scripts/build.mjs", "--quiet"]);
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "financial-dossier-harness-pack-"));
try {
  const reportText = run("npm", ["pack", "--json", "--pack-destination", temporaryDirectory]);
  let report;
  try {
    report = JSON.parse(reportText)[0];
  } catch {
    throw new Error("harness.pack-report-invalid");
  }
  if (report === undefined || !Array.isArray(report.files) || typeof report.filename !== "string") {
    throw new Error("harness.pack-report-invalid");
  }
  const actualFiles = report.files.map((entry) => entry.path).sort();
  if (actualFiles.length !== expectedFiles.length ||
      actualFiles.some((name, index) => name !== expectedFiles[index])) {
    throw new Error(`harness.pack-file-set-invalid:${actualFiles.join(",")}`);
  }
  for (const path of executableFiles) {
    const entry = report.files.find((candidate) => candidate.path === path);
    const bytes = await readFile(resolve(packageDirectory, path));
    if (entry === undefined || entry.size !== bytes.byteLength) {
      throw new Error(`harness.pack-file-binding-invalid:${path}`);
    }
  }

  run("tar", ["-xzf", resolve(temporaryDirectory, report.filename), "-C", temporaryDirectory]);
  const smokeDirectory = resolve(temporaryDirectory, "smoke");
  const scopeDirectory = resolve(smokeDirectory, "node_modules/@runbook");
  const packedDependencyScope = resolve(temporaryDirectory, "package/node_modules/@runbook");
  await mkdir(scopeDirectory, { recursive: true });
  await mkdir(packedDependencyScope, { recursive: true });
  await symlink(resolve(temporaryDirectory, "package"), resolve(scopeDirectory, "financial-dossier-harness"), "dir");
  await symlink(resolve(repositoryRoot, "packages/financial-dossier-adapter"), resolve(packedDependencyScope, "financial-dossier-adapter"), "dir");
  const smoke = [
    "const root = await import('@runbook/financial-dossier-harness');",
    "if (typeof root.replayRunnerEvidenceBytes !== 'function') throw new Error('root export missing');",
    "const runner = await import('@runbook/financial-dossier-harness/private/runner');",
    "if (typeof runner.ObservedHostSessionV2 !== 'function') throw new Error('runner export missing');",
    "try { await import('@runbook/financial-dossier-harness/private/testing'); throw new Error('testing export exposed'); }",
    "catch (error) { if (error instanceof Error && error.message === 'testing export exposed') throw error; }",
    "try { await import('@runbook/financial-dossier-harness/private/programs'); throw new Error('programs export exposed'); }",
    "catch (error) { if (error instanceof Error && error.message === 'programs export exposed') throw error; }",
  ].join("\n");
  run(process.execPath, ["--input-type=module", "--eval", smoke], smokeDirectory);
  if (!process.argv.includes("--quiet")) {
    process.stdout.write(`harness pack verified: ${actualFiles.length} files\n`);
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
