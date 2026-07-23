import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ownRegularFile,
} from "../src/node.js";
import { runFinancialBenchDockerSandboxWithOwnedRunnerV1 } from "../src/run.js";
import {
  canonicalizeJcs,
  verifySandboxEvidenceBytes,
} from "../src/index.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.length === 0) throw new Error(`cli.missing-${name.slice(2)}`);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2] === "verify" ? "verify" : "run";
  if (command === "verify") {
    const evidence = ownRegularFile(argument("--evidence"), {
      maxBytes: 64 * 1024 * 1024,
    });
    const expectedIndex = process.argv.indexOf("--expected-host-runner-sha256");
    const expectedHostRunnerSha256 =
      expectedIndex < 0 ? undefined : process.argv[expectedIndex + 1];
    if (expectedIndex >= 0 && expectedHostRunnerSha256 === undefined) {
      throw new Error("cli.expected-host-runner-sha256-missing");
    }
    const verification = verifySandboxEvidenceBytes(
      evidence.bytes,
      expectedHostRunnerSha256 === undefined ? {} : { expectedHostRunnerSha256 },
    );
    if (
      !verification.valid ||
      verification.receipt === null ||
      verification.receiptBytes === null
    ) {
      process.stderr.write(canonicalizeJcs({ errors: verification.errors, valid: false }));
      process.exitCode = 1;
      return;
    }
    process.stdout.write(verification.receiptBytes);
    return;
  }
  const ownPath = fileURLToPath(import.meta.url);
  const hostRunnerArtifact = ownRegularFile(ownPath, { maxBytes: 16 * 1024 * 1024 });
  const output = await runFinancialBenchDockerSandboxWithOwnedRunnerV1(
    {
      adapterBundlePath: argument("--adapter"),
      expectedAdapterBundleSha256: argument("--adapter-sha256"),
      publicConfigurationPath: argument("--configuration"),
    },
    hostRunnerArtifact,
  );
  const outputPath = argument("--evidence-out");
  await writeFile(outputPath, output.evidenceBytes, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    evidenceSha256: createHash("sha256").update(output.evidenceBytes).digest("hex"),
    hostRunnerArtifactSha256: hostRunnerArtifact.sha256,
    receipt: output.receipt,
  })}\n`);
}

await main().catch(() => {
  process.stderr.write(canonicalizeJcs({ error: "cli.invocation-or-io-failed" }));
  process.exitCode = 2;
});
