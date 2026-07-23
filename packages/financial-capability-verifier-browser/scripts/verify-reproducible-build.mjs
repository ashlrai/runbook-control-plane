import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "runbook-capability-verifier-"));
const firstDirectory = join(temporaryRoot, "first");
const secondDirectory = join(temporaryRoot, "second");

function build(outputDirectory) {
  const result = spawnSync(
    "tsc",
    ["-p", join(packageDirectory, "tsconfig.json"), "--outDir", outputDirectory],
    { cwd: packageDirectory, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "reproduction.build-failed\n");
    process.exitCode = 1;
    throw new Error("reproduction.build-failed");
  }
}

function files(directory) {
  const output = [];
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = join(current, name);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else output.push(relative(directory, absolute));
    }
  };
  visit(directory);
  return output;
}

function distributionDigest(directory, names) {
  const digest = createHash("sha256");
  for (const name of names) {
    const bytes = readFileSync(join(directory, name));
    digest.update(Buffer.from(`${name}\0${bytes.byteLength}\0`, "utf8"));
    digest.update(bytes);
  }
  return digest.digest("hex");
}

try {
  build(firstDirectory);
  build(secondDirectory);
  const firstFiles = files(firstDirectory);
  const secondFiles = files(secondDirectory);
  if (JSON.stringify(firstFiles) !== JSON.stringify(secondFiles)) {
    throw new Error("reproduction.file-set-mismatch");
  }
  for (const name of firstFiles) {
    const first = readFileSync(join(firstDirectory, name));
    const second = readFileSync(join(secondDirectory, name));
    if (!first.equals(second)) throw new Error("reproduction.byte-mismatch");
  }
  process.stdout.write(`${distributionDigest(firstDirectory, firstFiles)}\n`);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
