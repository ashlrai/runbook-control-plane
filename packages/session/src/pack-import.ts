/**
 * Import a local session evidence pack JSON into a ControlPlaneSession shape.
 * Local paste only — never network-fetched.
 */

import { controlPlaneSessionSchema, sessionEvidencePackSchema, type ControlPlaneSession, type SessionEvidencePack } from "./types.js";

export class SessionPackImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionPackImportError";
  }
}

/**
 * Parse and validate a session evidence pack from JSON text or object.
 */
export function parseSessionEvidencePack(input: unknown): SessionEvidencePack {
  let value = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      throw new SessionPackImportError("Session pack import refuses URL fetch.");
    }
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      throw new SessionPackImportError("Invalid session evidence pack JSON.");
    }
  }
  try {
    return sessionEvidencePackSchema.parse(value);
  } catch {
    throw new SessionPackImportError("Invalid session evidence pack JSON.");
  }
}

/**
 * Extract and re-validate the session record for local store import.
 * Re-keys sessionId optionally so browser demos do not clobber existing rows.
 */
export function sessionFromEvidencePack(
  pack: SessionEvidencePack,
  options?: { sessionId?: string },
): ControlPlaneSession {
  const base = controlPlaneSessionSchema.parse(pack.session);
  if (options?.sessionId === undefined) return base;
  return controlPlaneSessionSchema.parse({
    ...base,
    sessionId: options.sessionId,
    updatedAt: new Date().toISOString(),
  });
}
