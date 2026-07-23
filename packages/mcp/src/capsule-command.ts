import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ProofVerificationReceipt,
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "@runbook/capsule";

const MAX_CAPSULE_BYTES = 64 * 1024 * 1024;
const RESOURCE_ERROR_CODES = new Set(["input.size-limit", "zip.entry-count-limit"]);

export type CapsuleCommandResult = {
  exitCode: 0 | 1 | 2;
  verification: ProofVerificationReceipt;
};

export function capsuleVerificationExitCode(
  result: Pick<ProofVerificationReceipt, "valid" | "errors">,
): 0 | 1 | 2 {
  if (result.valid) return 0;
  return result.errors.some((issue) => RESOURCE_ERROR_CODES.has(issue.code)) ? 2 : 1;
}

async function readCapsuleFile(path: string) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const file = await handle.stat();
    if (!file.isFile()) throw new Error("Capsule input must be a regular file.");
    if (file.size < 1 || file.size > MAX_CAPSULE_BYTES) {
      throw new Error("Capsule input must be between 1 byte and 64 MiB.");
    }

    const bytes = Buffer.allocUnsafe(file.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error("Capsule input changed or ended while it was being read.");
      offset += bytesRead;
    }

    const afterRead = await handle.stat();
    if (!afterRead.isFile() || afterRead.size !== file.size) {
      throw new Error("Capsule input changed while it was being read.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function verifyCapsuleFile(path: string) {
  return verifyProofCapsule(await readCapsuleFile(path));
}

export async function runCapsuleVerificationCommand(
  args: string[],
  writeOutput: (output: string) => void = (output) => { process.stdout.write(output); },
): Promise<CapsuleCommandResult> {
  if (args.length !== 1 || !args[0] || args[0].startsWith("--")) {
    throw new Error("verify-capsule requires exactly one local .runbook file path.");
  }
  const verification = await verifyCapsuleFile(args[0]);
  writeOutput(serializeProofVerificationReceipt(verification).toString("utf8"));
  return { exitCode: capsuleVerificationExitCode(verification), verification };
}
