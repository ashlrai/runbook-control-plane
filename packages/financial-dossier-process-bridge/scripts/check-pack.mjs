import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executableFiles = [
  "dist/common-subject.d.ts", "dist/common-subject.js",
  "dist/framing.d.ts", "dist/framing.js", "dist/index.d.ts", "dist/index.js",
  "dist/loader.mjs", "dist/owned-target.d.ts", "dist/owned-target.js",
  "dist/process-attempt.d.ts", "dist/process-attempt.js",
  "dist/reference-common-subject.mjs", "dist/reference-finance-000-target.mjs",
  "dist/run.d.ts", "dist/run.js", "dist/types.d.ts", "dist/types.js",
];
const expectedFiles = ["README.md", ...executableFiles, "package.json"].sort();

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: packageDirectory,
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stdout !== "") process.stdout.write(result.stdout);
    if (result.stderr !== "") process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

run(process.execPath, ["scripts/build.mjs", "--quiet"]);
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "financial-dossier-process-pack-"));
try {
  const output = run("npm", ["pack", "--json", "--pack-destination", temporaryDirectory]);
  let report;
  try { report = JSON.parse(output)[0]; }
  catch { throw new Error("process-bridge.pack-report-invalid"); }
  if (report === undefined || !Array.isArray(report.files)) {
    throw new Error("process-bridge.pack-report-invalid");
  }
  const actualFiles = report.files.map((entry) => entry.path).sort();
  if (actualFiles.length !== expectedFiles.length ||
      actualFiles.some((name, index) => name !== expectedFiles[index])) {
    throw new Error(`process-bridge.pack-file-set-invalid:${actualFiles.join(",")}`);
  }
  for (const path of executableFiles) {
    const entry = report.files.find((candidate) => candidate.path === path);
    const bytes = await readFile(resolve(packageDirectory, path));
    if (entry === undefined || entry.size !== bytes.byteLength) {
      throw new Error(`process-bridge.pack-file-binding-invalid:${path}`);
    }
  }

  const prohibitedTargetText = [
    "@runbook/", "financial-dossier-harness", "private/runner", "sourceMappingURL",
    "scenario", "oracle", "corpus", "finding", "receipt",
  ];
  for (const path of [
    "dist/loader.mjs",
    "dist/reference-common-subject.mjs",
    "dist/reference-finance-000-target.mjs",
  ]) {
    const bytes = await readFile(resolve(packageDirectory, path));
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`process-bridge.target-file-not-utf8:${path}`);
    }
    if (prohibitedTargetText.some((word) => text.includes(word))) {
      throw new Error(`process-bridge.target-authority-leak:${path}`);
    }
  }

  const smoke = [
    "const root = await import('./dist/index.js');",
    "if (typeof root.runFinance000Process !== 'function') throw new Error('run export missing');",
    "if (typeof root.runCompletedProcess !== 'function') throw new Error('completed-run export missing');",
    "if (typeof root.runFinance003Process !== 'function') throw new Error('finance-003 export missing');",
    "if (typeof root.runFinance010Process !== 'function') throw new Error('finance-010 export missing');",
    "if (typeof root.runFinance027Process !== 'function') throw new Error('finance-027 export missing');",
    "if (typeof root.runFinance028Process !== 'function') throw new Error('finance-028 export missing');",
    "if (typeof root.runFinance030RecoverProcess !== 'function') throw new Error('finance-030-recover export missing');",
    "if (typeof root.runFinance030PrimaryCrashProcess !== 'function') throw new Error('finance-030-primary-crash export missing');",
    "if (typeof root.hostSeedFinance030PrimaryCrash !== 'function') throw new Error('host-seed export missing');",
    "if (typeof root.verifyCompletedProcessAttempt !== 'function') throw new Error('verifier export missing');",
    "if (typeof root.verifyAttemptedCrashProcessAttempt !== 'function') throw new Error('crash verifier export missing');",
    "if (typeof root.CommonSubjectAlgorithmV2 !== 'function') throw new Error('common subject export missing');",
    "if (typeof root.completedEventProgram !== 'function') throw new Error('event program export missing');",
    "if (typeof root.attemptedCrashEventProgram !== 'function') throw new Error('crash event program export missing');",
    "if (!Array.isArray(root.PROCESS_BRIDGED_SCENARIO_IDS) || root.PROCESS_BRIDGED_SCENARIO_IDS.length !== 5) {",
    "  throw new Error('bridged scenario set missing');",
    "}",
    "if (!Array.isArray(root.PROCESS_BRIDGED_RECOVER_TRIAL_IDS) || root.PROCESS_BRIDGED_RECOVER_TRIAL_IDS.length !== 3) {",
    "  throw new Error('recover trial set missing');",
    "}",
    "if (!Array.isArray(root.PROCESS_BRIDGED_PRIMARY_CRASH_TRIAL_IDS) || root.PROCESS_BRIDGED_PRIMARY_CRASH_TRIAL_IDS.length !== 1) {",
    "  throw new Error('primary crash trial set missing');",
    "}",
    "if (!Array.isArray(root.ATTEMPTED_CRASH_EVENT_DESIGN_NOTES) || root.ATTEMPTED_CRASH_EVENT_DESIGN_NOTES.length < 4) {",
    "  throw new Error('crash design notes missing');",
    "}",
  ].join("\n");
  run(process.execPath, ["--input-type=module", "--eval", smoke]);
  if (!process.argv.includes("--quiet")) {
    process.stdout.write(`process bridge pack verified: ${actualFiles.length} files\n`);
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
