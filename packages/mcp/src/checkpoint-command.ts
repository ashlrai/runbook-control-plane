import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CheckpointVerificationResult,
  verifyCheckpoint,
} from "@runbook/engine/checkpoint";

const INPUT_LIMITS = {
  envelopeJson: 128 * 1024,
  statementJson: 64 * 1024,
  publicKeySpkiDer: 512,
} as const;

export type CheckpointCommandResult = {
  exitCode: 0 | 2;
  verification: CheckpointVerificationResult;
};

async function readBoundedRegularFile(path: string, maximumBytes: number, label: string) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const file = await handle.stat();
    if (!file.isFile()) throw new Error(`${label} must be a regular file.`);

    // The engine returns the granular size error. Avoid reading an attacker-sized
    // file merely to learn that it exceeds the verification profile's limit.
    if (file.size > maximumBytes) return Buffer.alloc(maximumBytes + 1);

    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export function checkpointVerificationExitCode(result: CheckpointVerificationResult): 0 | 2 {
  return result.valid ? 0 : 2;
}

export async function verifyCheckpointFiles(
  envelopeJsonPath: string,
  statementJsonPath: string,
  publicKeyDerPath: string,
): Promise<CheckpointVerificationResult> {
  const [envelopeJson, statementJson, publicKeySpkiDer] = await Promise.all([
    readBoundedRegularFile(envelopeJsonPath, INPUT_LIMITS.envelopeJson, "Envelope JSON"),
    readBoundedRegularFile(statementJsonPath, INPUT_LIMITS.statementJson, "Statement JSON"),
    readBoundedRegularFile(publicKeyDerPath, INPUT_LIMITS.publicKeySpkiDer, "Public key DER"),
  ]);

  return verifyCheckpoint({ envelopeJson, statementJson, publicKeySpkiDer });
}

export async function runCheckpointVerificationCommand(
  args: string[],
  writeOutput: (output: string) => void = console.log,
): Promise<CheckpointCommandResult> {
  if (args.length !== 3 || args.some((value) => value.length === 0 || value.startsWith("--"))) {
    throw new Error("verify-checkpoint requires exactly three file paths: ENVELOPE_JSON STATEMENT_JSON PUBLIC_KEY_DER.");
  }

  const [envelopePath, statementPath, publicKeyPath] = args as [string, string, string];
  const verification = await verifyCheckpointFiles(envelopePath, statementPath, publicKeyPath);
  writeOutput(JSON.stringify(verification, null, 2));
  return { exitCode: checkpointVerificationExitCode(verification), verification };
}
