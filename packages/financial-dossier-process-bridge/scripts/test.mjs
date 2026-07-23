import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(directory, "../..");
for (const dependency of ["financial-dossier-adapter", "financial-dossier-harness"]) {
  const dependencyDirectory = resolve(repositoryRoot, "packages", dependency);
  const build = spawnSync(process.execPath, [resolve(dependencyDirectory, "scripts/build.mjs"), "--quiet"], {
    cwd: dependencyDirectory,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (build.error !== undefined) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const vitest = resolve(directory, "node_modules/vitest/vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run"], {
  cwd: directory,
  encoding: "utf8",
  stdio: "inherit",
});
if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
