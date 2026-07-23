/**
 * Session spine helpers for MCP tools — resolve store, active session, and optional bind hooks.
 * Local filesystem only. brokerEffect false; not a hard broker gateway.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  defaultSessionRoot,
  SessionStore,
  type ControlPlaneSession,
} from "@runbook/session";

export const ACTIVE_SESSION_MARKER = "active-session.json" as const;
export const RUNBOOK_SESSION_ID_ENV = "RUNBOOK_SESSION_ID" as const;
export const RUNBOOK_DATA_DIR_ENV = "RUNBOOK_DATA_DIR" as const;

export type SessionContextOptions = Readonly<{
  /** Absolute Runbook data directory (ledger root). Sessions live under dataDir/sessions. */
  dataDir?: string;
}>;

export type ActiveSessionMarker = {
  schemaVersion: "runbook.active-session.v1";
  sessionId: string;
  updatedAt: string;
  brokerEffect: false;
};

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

function assertAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be absolute`);
  }
  return resolve(path);
}

/**
 * Resolve the Runbook data directory (parent of `sessions/`).
 * Priority: options.dataDir → RUNBOOK_DATA_DIR → ~/.runbook
 */
export function resolveDataDir(options?: SessionContextOptions): string {
  if (options?.dataDir !== undefined && options.dataDir.length > 0) {
    return assertAbsolute(options.dataDir, "dataDir");
  }
  const fromEnv = process.env[RUNBOOK_DATA_DIR_ENV];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return assertAbsolute(fromEnv, "RUNBOOK_DATA_DIR");
  }
  return join(homedir(), ".runbook");
}

/** SessionStore rooted at dataDir/sessions (or defaultSessionRoot). */
export function resolveSessionStore(options?: SessionContextOptions): SessionStore {
  const dataDir = resolveDataDir(options);
  return new SessionStore({ rootDir: defaultSessionRoot(dataDir) });
}

export function activeSessionMarkerPath(dataDir: string): string {
  return join(assertAbsolute(dataDir, "dataDir"), ACTIVE_SESSION_MARKER);
}

export async function writeActiveSession(
  dataDir: string,
  sessionId: string,
): Promise<ActiveSessionMarker> {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error("Invalid sessionId");
  }
  const root = assertAbsolute(dataDir, "dataDir");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const marker: ActiveSessionMarker = {
    schemaVersion: "runbook.active-session.v1",
    sessionId,
    updatedAt: new Date().toISOString(),
    brokerEffect: false,
  };
  const path = activeSessionMarkerPath(root);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
  return marker;
}

export async function readActiveSessionId(dataDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(activeSessionMarkerPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    if (typeof parsed.sessionId === "string" && SESSION_ID_RE.test(parsed.sessionId)) {
      return parsed.sessionId;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve which control-plane session to update.
 * Priority: explicit argument → env RUNBOOK_SESSION_ID → dataDir/active-session.json
 */
export async function resolveSessionId(
  explicit?: string | undefined,
  options?: SessionContextOptions,
): Promise<string | undefined> {
  if (explicit !== undefined && explicit.trim().length > 0) {
    const id = explicit.trim();
    if (!SESSION_ID_RE.test(id)) throw new Error("Invalid sessionId");
    return id;
  }
  const fromEnv = process.env[RUNBOOK_SESSION_ID_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    const id = fromEnv.trim();
    if (!SESSION_ID_RE.test(id)) throw new Error("Invalid sessionId");
    return id;
  }
  return readActiveSessionId(resolveDataDir(options));
}

/**
 * When sessionId is defined, run fn against the store; otherwise no-op (returns undefined).
 * Mutating tools call this so session updates stay optional and fail-soft when no spine is active.
 */
export async function withSession<T>(
  sessionId: string | undefined,
  store: SessionStore,
  fn: (sessionId: string, store: SessionStore) => Promise<T>,
): Promise<T | undefined> {
  if (sessionId === undefined || sessionId.length === 0) return undefined;
  return fn(sessionId, store);
}

/** Append a short process note to a session (capped by schema). */
export async function appendSessionNote(
  store: SessionStore,
  sessionId: string,
  note: string,
): Promise<ControlPlaneSession> {
  const trimmed = note.trim().slice(0, 500);
  if (trimmed.length === 0) {
    return store.read(sessionId);
  }
  return store.update(sessionId, (s) => ({
    ...s,
    notes: [...s.notes, trimmed].slice(-50),
  }));
}

export { SESSION_ID_RE };
