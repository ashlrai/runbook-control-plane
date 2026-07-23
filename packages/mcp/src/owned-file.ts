/**
 * Symlink-resistant, regular-file-only local reads for offline MCP tools.
 * Never follows symlinks. Refuses secrets-shaped basenames and .ssh paths.
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";

export const DEFAULT_MAX_OWNED_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_CAPSULE_OWNED_BYTES = 64 * 1024 * 1024;
export const MAX_POLICY_OWNED_BYTES = 64 * 1024;
export const MAX_PUBLIC_AUTH_OWNED_BYTES = 64 * 1024;

export type OwnedFile = Readonly<{
  bytes: Uint8Array;
  sha256: string;
  size: number;
}>;

export type OwnAbsoluteFileOptions = Readonly<{
  maxBytes?: number;
  minBytes?: number;
}>;

export class OwnedFileError extends Error {
  readonly name = "OwnedFileError";

  constructor(readonly code: "path.invalid" | "path.size-limit") {
    super(code);
  }
}

const SECRET_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
]);

function isSecretsBasename(name: string): boolean {
  if (SECRET_BASENAMES.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  return false;
}

function pathHasSshComponent(absolutePath: string): boolean {
  const parts = absolutePath.split(sep).filter(Boolean);
  return parts.some((part) => part === ".ssh");
}

function assertSafeAbsolutePath(path: string): string {
  if (typeof path !== "string" || path.length < 1 || path.length > 4_096) {
    throw new OwnedFileError("path.invalid");
  }
  if (!isAbsolute(path)) {
    throw new OwnedFileError("path.invalid");
  }
  const absolute = resolve(path);
  if (pathHasSshComponent(absolute) || isSecretsBasename(basename(absolute))) {
    throw new OwnedFileError("path.invalid");
  }
  return absolute;
}

/**
 * Open and fully read one absolute regular file with O_NOFOLLOW.
 * Returns owned bytes and SHA-256. Never includes the path in thrown messages.
 */
export async function ownAbsoluteFile(
  path: string,
  options: OwnAbsoluteFileOptions = {},
): Promise<OwnedFile> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OWNED_FILE_BYTES;
  const minBytes = options.minBytes ?? 1;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(minBytes) ||
    minBytes < 1 ||
    minBytes > maxBytes
  ) {
    throw new OwnedFileError("path.invalid");
  }

  const absolute = assertSafeAbsolutePath(path);
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new OwnedFileError("path.invalid");
    }
    if (before.size < minBytes) {
      throw new OwnedFileError("path.invalid");
    }
    if (before.size > maxBytes) {
      throw new OwnedFileError("path.size-limit");
    }

    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) {
        throw new OwnedFileError("path.invalid");
      }
      offset += result.bytesRead;
    }

    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      throw new OwnedFileError("path.invalid");
    }

    return {
      bytes: new Uint8Array(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: before.size,
    };
  } catch (error) {
    if (error instanceof OwnedFileError) throw error;
    throw new OwnedFileError("path.invalid");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
