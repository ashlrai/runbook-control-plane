import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const commands = [
  [node, ["scripts/build.mjs", "--quiet"]],
  [node, ["scripts/check-pack.mjs", "--quiet"]],
  [process.platform === "win32" ? "vitest.cmd" : "vitest", ["run"]],
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: packageDirectory,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
