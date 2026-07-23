import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  lstat,
  unlink,
} from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  type JsonValue,
  type LedgerEvent,
  type LedgerEventInput,
  ledgerActorSchema,
  ledgerEventInputSchema,
  ledgerEventTypeSchema,
} from "./schema.js";

const GENESIS_HASH = "0".repeat(64);
const MAX_LEDGER_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const MAX_STRING_LENGTH = 16_384;
const MAX_ARRAY_LENGTH = 2_048;
const MAX_OBJECT_KEYS = 512;
const LOCK_TIMEOUT_MS = 2_000;
const LEDGER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const SECRET_KEY_PATTERN = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|auth|bearer|password|passphrase|private[_-]?key|client[_-]?secret|credential|secret|session[_-]?(?:id|key|token)|account[_-]?(?:id|number)|routing[_-]?number|cookie)$/i;
const SAFE_DIGEST_PATTERN = /^(?:(?:sha256:)?[a-f0-9]{64}|sha512:[a-f0-9]{128})$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_SYNTHETIC_ID_PATTERN = /^(?:synthetic|fixture|mock|demo|example)[-_:][A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/i;
const SAFE_DOMAIN_ID_PATTERN = /^(?:RUN|EXP|PROPOSAL|POLICY|EVENT|CAPSULE|RECEIPT|CHECKPOINT)[-_:][A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i;
const GENERIC_HEX_SECRET_PATTERN = /(?:^|[^A-Fa-f0-9])[A-Fa-f0-9]{32,128}(?:$|[^A-Fa-f0-9])/;
const EMBEDDED_CREDENTIAL_URI_PATTERN = /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^/\s@]+@/i;
const CREDENTIAL_ASSIGNMENT_PATTERN = /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|auth(?:orization)?|bearer|password|passphrase|private[ _-]?key|client[ _-]?secret|credential|secret|session[ _-]?(?:id|key|token)|cookie)\b["']?\s*(?:=|:)\s*["']?([^\s"',;]{12,})/gi;
const COMMON_TOKEN_PATTERNS = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/,
  /\bgh[pousr]_[0-9A-Za-z]{20,}\b/,
  /\bglpat-[0-9A-Za-z_-]{20,}\b/,
  /\bnpm_[0-9A-Za-z]{30,}\b/,
  /\bdckr_pat_[0-9A-Za-z_-]{20,}\b/,
  /\bhf_[0-9A-Za-z]{30,}\b/,
  /\bsk-(?:ant-(?:api\d{2}-)?|live_|test_)?[0-9A-Za-z_-]{20,}\b/,
  /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  /\bwhsec_[0-9A-Za-z]{16,}\b/,
  /\bSK[A-Fa-f0-9]{32}\b/,
  /\b(?:xox[aboprsce]-)[0-9A-Za-z-]{10,}\b/,
  /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}\b/,
  /\bvercel_blob_rw_[0-9A-Za-z_-]{20,}\b/,
  /\bAGE-SECRET-KEY-1[0-9A-Z]{20,}\b/,
  /\b(?:Bearer|Basic)\s+[0-9A-Za-z._~+/=-]{8,}\b/i,
] as const;
const HASH_DOMAIN = "RUNBOOK_LEDGER_EVENT_V1\0";

export type LedgerVerification = {
  valid: boolean;
  eventCount: number;
  headHash: string;
  errors: string[];
};

export type LedgerSnapshot = {
  verification: LedgerVerification;
  events: LedgerEvent[];
};

type EventWithoutHash = Omit<LedgerEvent, "hash">;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function formatMode(mode: number) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function assertCurrentUserOwnedPrivate(entry: Stats, label: string) {
  if (typeof process.getuid !== "function") {
    throw new Error(`Cannot verify ${label} ownership on this platform; refusing to use it.`);
  }
  if (entry.uid !== process.getuid()) {
    throw new Error(`${label[0]?.toUpperCase()}${label.slice(1)} is not owned by the current user.`);
  }
  if ((entry.mode & 0o077) !== 0) {
    throw new Error(`${label[0]?.toUpperCase()}${label.slice(1)} must deny all group and other access; found mode ${formatMode(entry.mode)}.`);
  }
}

function isCompactJwt(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  if (!header || !payload || signature === undefined) return false;
  if (header.length < 8 || payload.length < 2) return false;
  if (!parts.every((part) => /^[0-9A-Za-z_-]+$/.test(part))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
      (typeof (parsed as { alg?: unknown }).alg === "string" ||
        (parsed as { typ?: unknown }).typ === "JWT");
  } catch {
    return false;
  }
}

function containsCompactJwt(value: string) {
  const candidates = value.match(/[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/g) ?? [];
  return candidates.some((candidate) => isCompactJwt(candidate));
}

function shannonEntropy(value: string) {
  const frequencies = new Map<string, number>();
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isHighEntropyToken(value: string) {
  const candidates = value.match(/[0-9A-Za-z_+/=-]{32,}/g) ?? [];
  return candidates.some((candidate) => {
    if (SAFE_DIGEST_PATTERN.test(candidate) || UUID_PATTERN.test(candidate)) return false;
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[_+/=-]/].filter((pattern) => pattern.test(candidate)).length;
    return classes >= 3 && shannonEntropy(candidate) >= 3.75;
  });
}

function hasHighEntropyCredentialAssignment(value: string) {
  CREDENTIAL_ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(CREDENTIAL_ASSIGNMENT_PATTERN)) {
    const candidate = match[1];
    if (!candidate) continue;
    if (COMMON_TOKEN_PATTERNS.some((pattern) => pattern.test(candidate))) return true;
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^0-9A-Za-z]/].filter((pattern) => pattern.test(candidate)).length;
    if (candidate.length >= 16 && classes >= 2 && shannonEntropy(candidate) >= 3.5) return true;
  }
  return false;
}

function isAccountLike(value: string) {
  const trimmed = value.trim();
  if (/(?:^|\D)\d{8,17}(?:$|\D)/.test(trimmed)) return true;
  if (/^[\d -]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 19) return true;
  }
  if (/^[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}$/i.test(trimmed)) return true;
  return /\b(?:account|acct|routing|aba|iban)\b[^\r\n]{0,24}(?:[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}|\d[\d -]{6,20}\d)/i.test(value);
}

function isCredentialLikeValue(value: string) {
  const trimmed = value.trim();
  const hasExplicitCredentialShape = PRIVATE_KEY_PATTERN.test(value) ||
    EMBEDDED_CREDENTIAL_URI_PATTERN.test(value) ||
    COMMON_TOKEN_PATTERNS.some((pattern) => pattern.test(value)) ||
    containsCompactJwt(value) ||
    hasHighEntropyCredentialAssignment(value);
  if (hasExplicitCredentialShape) return true;
  if (SAFE_DIGEST_PATTERN.test(trimmed) ||
      UUID_PATTERN.test(trimmed) ||
      SAFE_SYNTHETIC_ID_PATTERN.test(trimmed) ||
      SAFE_DOMAIN_ID_PATTERN.test(trimmed)) return false;
  return GENERIC_HEX_SECRET_PATTERN.test(value) ||
    isAccountLike(value) ||
    isHighEntropyToken(value);
}

function assertJsonValue(
  value: unknown,
  path = "payload",
  depth = 0,
  counter = { nodes: 0 },
): asserts value is JsonValue {
  counter.nodes += 1;
  if (counter.nodes > MAX_JSON_NODES) throw new Error(`${path} exceeds the maximum JSON node count.`);
  if (depth > MAX_JSON_DEPTH) throw new Error(`${path} exceeds the maximum nesting depth.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) throw new Error(`${path} contains a string longer than ${MAX_STRING_LENGTH} characters.`);
    if (isCredentialLikeValue(value)) throw new Error(`${path} contains a credential-like value that Runbook will not persist.`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
    if (Object.is(value, -0)) throw new Error(`${path} contains negative zero, which is not canonical.`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${path} contains an unsafe integer.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw new Error(`${path} contains too many array items.`);
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1, counter));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain plain JSON objects only.`);
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS) throw new Error(`${path} contains too many object keys.`);
    for (const [key, item] of entries) {
      if (key.length > 200) throw new Error(`${path} contains a key longer than 200 characters.`);
      if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${path} contains a credential-like field that Runbook will not persist.`);
      if (item === undefined) throw new Error(`${path}.${key} cannot be undefined.`);
      assertJsonValue(item, `${path}.${key}`, depth + 1, counter);
    }
    return;
  }
  throw new Error(`${path} contains a value that cannot be represented as JSON.`);
}

export function canonicalize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize a non-finite number.");
    if (Object.is(value, -0)) throw new Error("Cannot canonicalize negative zero.");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("Cannot canonicalize an unsafe integer.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`)
    .join(",")}}`;
}

function hashEvent(event: EventWithoutHash) {
  assertJsonValue(event);
  return createHash("sha256").update(HASH_DOMAIN).update(canonicalize(event)).digest("hex");
}

function normalizeInput(input: LedgerEventInput): LedgerEventInput {
  const parsed = ledgerEventInputSchema.parse(input);
  assertJsonValue(parsed, "event");
  return parsed as LedgerEventInput;
}

function assertUtcTimestamp(value: string, label: string) {
  if (!value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a UTC RFC3339 timestamp ending in Z.`);
  }
}

function parseLedgerEvent(value: unknown, lineNumber: number): LedgerEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Line ${lineNumber} is not an object.`);
  }
  const event = value as Partial<LedgerEvent>;
  if (event.schemaVersion !== "runbook.ledger.v1") throw new Error(`Line ${lineNumber} has an unsupported schema version.`);
  if (!Number.isSafeInteger(event.sequence) || (event.sequence ?? 0) < 1) throw new Error(`Line ${lineNumber} has an invalid sequence.`);
  if (typeof event.eventId !== "string" || event.eventId.length < 1) throw new Error(`Line ${lineNumber} has an invalid event ID.`);
  if (typeof event.experimentId !== "string" || event.experimentId.length < 1) throw new Error(`Line ${lineNumber} has an invalid experiment ID.`);
  ledgerEventTypeSchema.parse(event.type);
  if (typeof event.occurredAt !== "string") throw new Error(`Line ${lineNumber} has an invalid occurrence timestamp.`);
  if (typeof event.recordedAt !== "string") throw new Error(`Line ${lineNumber} has an invalid record timestamp.`);
  assertUtcTimestamp(event.occurredAt, `Line ${lineNumber} occurrence timestamp`);
  assertUtcTimestamp(event.recordedAt, `Line ${lineNumber} record timestamp`);
  ledgerActorSchema.parse(event.actor);
  if (typeof event.idempotencyKey !== "string" || event.idempotencyKey.length < 1) throw new Error(`Line ${lineNumber} has an invalid idempotency key.`);
  assertJsonValue(event, `line ${lineNumber}`);
  if (typeof event.previousHash !== "string" || !/^[a-f0-9]{64}$/.test(event.previousHash)) throw new Error(`Line ${lineNumber} has an invalid previous hash.`);
  if (typeof event.hash !== "string" || !/^[a-f0-9]{64}$/.test(event.hash)) throw new Error(`Line ${lineNumber} has an invalid hash.`);
  return event as LedgerEvent;
}

export class FileLedger {
  readonly rootDir: string;
  readonly ledgerId: string;
  readonly path: string;
  readonly lockPath: string;

  constructor(rootDir: string, ledgerId = "events") {
    if (!isAbsolute(rootDir)) throw new Error("Ledger root must be absolute.");
    if (!LEDGER_ID_PATTERN.test(ledgerId)) throw new Error("Ledger ID must use only letters, numbers, underscores, or hyphens.");
    this.rootDir = rootDir;
    this.ledgerId = ledgerId;
    this.path = join(rootDir, `${ledgerId}.jsonl`);
    this.lockPath = join(rootDir, `${ledgerId}.lock`);
  }

  async append(input: LedgerEventInput): Promise<{ event: LedgerEvent; duplicate: boolean }> {
    return this.withLock(async () => {
      const normalizedInput = normalizeInput(input);
      assertUtcTimestamp(normalizedInput.occurredAt, "Occurrence timestamp");
      const events = await this.readEvents();
      const verification = verifyEvents(events);
      if (!verification.valid) {
        throw new Error(`Refusing to append to an invalid ledger: ${verification.errors.join(" ")}`);
      }
      const existing = events.find((event) => event.idempotencyKey === normalizedInput.idempotencyKey);
      if (existing) {
        const sameInput = canonicalize({
          experimentId: existing.experimentId,
          type: existing.type,
          occurredAt: existing.occurredAt,
          actor: existing.actor,
          idempotencyKey: existing.idempotencyKey,
          payload: existing.payload,
        }) === canonicalize(normalizedInput);
        if (!sameInput) throw new Error(`Idempotency conflict for key ${normalizedInput.idempotencyKey}.`);
        return { event: existing, duplicate: true };
      }

      const eventWithoutHash: EventWithoutHash = {
        schemaVersion: "runbook.ledger.v1",
        sequence: events.length + 1,
        eventId: randomUUID(),
        experimentId: normalizedInput.experimentId,
        type: normalizedInput.type,
        occurredAt: normalizedInput.occurredAt,
        recordedAt: new Date().toISOString(),
        actor: normalizedInput.actor,
        idempotencyKey: normalizedInput.idempotencyKey,
        payload: normalizedInput.payload,
        previousHash: events.at(-1)?.hash ?? GENESIS_HASH,
      };
      const event: LedgerEvent = { ...eventWithoutHash, hash: hashEvent(eventWithoutHash) };

      await this.ensureOwnedRoot();
      await this.rejectSymlinkIfPresent(this.path, "ledger");
      const line = `${canonicalize(event)}\n`;
      const lineBytes = Buffer.byteLength(line);
      if (lineBytes > MAX_EVENT_BYTES) throw new Error("Event exceeds the 256 KiB local safety limit.");
      const handle = await open(
        this.path,
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw new Error("Opened ledger is not a regular file.");
        assertCurrentUserOwnedPrivate(opened, "opened ledger");
        if (opened.size + lineBytes > MAX_LEDGER_BYTES) throw new Error("Append would exceed the 50 MiB local ledger safety limit.");
        const bytes = Buffer.from(line);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
          if (bytesWritten < 1) throw new Error("Incomplete ledger write; verification is required before continuing.");
          offset += bytesWritten;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      const directoryHandle = await open(
        this.rootDir,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        const openedRoot = await directoryHandle.stat();
        if (!openedRoot.isDirectory()) throw new Error("Opened ledger root is not a directory.");
        assertCurrentUserOwnedPrivate(openedRoot, "opened ledger root");
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
      return { event, duplicate: false };
    });
  }

  async list(experimentId?: string): Promise<LedgerEvent[]> {
    const events = await this.readEvents();
    return experimentId ? events.filter((event) => event.experimentId === experimentId) : events;
  }

  /** Reads once so the filtered events and global ledger head describe the same point in time. */
  async snapshot(experimentId?: string): Promise<LedgerSnapshot> {
    const events = await this.readEvents();
    const verification = verifyEvents(events);
    return {
      verification,
      events: experimentId ? events.filter((event) => event.experimentId === experimentId) : events,
    };
  }

  async verify(): Promise<LedgerVerification> {
    try {
      return verifyEvents(await this.readEvents());
    } catch (error) {
      return {
        valid: false,
        eventCount: 0,
        headHash: GENESIS_HASH,
        errors: [error instanceof Error ? error.message : "Unknown ledger read error."],
      };
    }
  }

  private async readEvents(): Promise<LedgerEvent[]> {
    await this.ensureOwnedRoot();
    await this.assertExistingPrivateFile(this.lockPath, "writer lock");
    await this.rejectSymlinkIfPresent(this.path, "ledger");
    let handle;
    try {
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    let content: string;
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) throw new Error("Opened ledger is not a regular file.");
      assertCurrentUserOwnedPrivate(opened, "opened ledger");
      if (opened.size > MAX_LEDGER_BYTES) throw new Error("Ledger exceeds the 50 MiB local safety limit.");
      content = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    if (!content) return [];
    if (!content.endsWith("\n")) throw new Error("Ledger has an incomplete trailing record. Refusing automatic recovery.");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        try {
          const event = parseLedgerEvent(JSON.parse(line) as unknown, index + 1);
          if (line !== canonicalize(event)) throw new Error(`Line ${index + 1} is not canonically serialized.`);
          return event;
        } catch (error) {
          throw new Error(`Ledger parse failure: ${error instanceof Error ? error.message : `line ${index + 1}`}`);
        }
      });
  }

  private async ensureOwnedRoot() {
    let created = false;
    try {
      const rootStat = await lstat(this.rootDir);
      if (rootStat.isSymbolicLink()) throw new Error("Refusing a symlinked ledger root.");
      if (!rootStat.isDirectory()) throw new Error("Ledger root exists but is not a directory.");
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      created = true;
    }

    try {
      const handle = await open(
        this.rootDir,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        const opened = await handle.stat();
        if (!opened.isDirectory()) throw new Error("Opened ledger root is not a directory.");
        assertCurrentUserOwnedPrivate(opened, "ledger root");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (created && isMissingFile(error)) {
        throw new Error("Ledger root disappeared during secure creation.");
      }
      throw error;
    }
  }

  private async assertExistingPrivateFile(path: string, label: string) {
    await this.rejectSymlinkIfPresent(path, label);
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) throw new Error(`Opened ${label} is not a regular file.`);
      assertCurrentUserOwnedPrivate(opened, `opened ${label}`);
      return true;
    } finally {
      await handle.close();
    }
  }

  private async rejectSymlinkIfPresent(path: string, label: string) {
    try {
      const linkStat = await lstat(path);
      if (linkStat.isSymbolicLink()) throw new Error(`Refusing a symlinked ${label}.`);
      if (!linkStat.isFile()) throw new Error(`${label[0]?.toUpperCase()}${label.slice(1)} path exists but is not a regular file.`);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureOwnedRoot();
    await this.rejectSymlinkIfPresent(this.lockPath, "writer lock");
    const startedAt = Date.now();
    let lockHandle;
    while (!lockHandle) {
      try {
        lockHandle = await open(
          this.lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
        const stillExists = await this.assertExistingPrivateFile(this.lockPath, "writer lock");
        if (!stillExists) continue;
        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new Error("Timed out waiting for the ledger writer lock. Refusing automatic stale-lock deletion; inspect the lock owner before recovery.");
        }
        await sleep(25);
      }
    }
    const lockIdentity = await lockHandle.stat();
    try {
      if (!lockIdentity.isFile()) throw new Error("Opened writer lock is not a regular file.");
      assertCurrentUserOwnedPrivate(lockIdentity, "opened writer lock");
      await lockHandle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
      await lockHandle.sync();
      return await operation();
    } finally {
      await lockHandle.close();
      try {
        const currentLock = await lstat(this.lockPath);
        if (currentLock.dev === lockIdentity.dev && currentLock.ino === lockIdentity.ino) {
          await unlink(this.lockPath);
        }
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  }
}

export function verifyEvents(events: LedgerEvent[]): LedgerVerification {
  const errors: string[] = [];
  const idempotencyKeys = new Set<string>();
  const eventIds = new Set<string>();
  let previousHash = GENESIS_HASH;

  events.forEach((event, index) => {
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) errors.push(`Event ${index + 1} has sequence ${event.sequence}; expected ${expectedSequence}.`);
    if (event.previousHash !== previousHash) errors.push(`Event ${event.sequence} does not reference the preceding hash.`);
    if (idempotencyKeys.has(event.idempotencyKey)) errors.push(`Event ${event.sequence} repeats idempotency key ${event.idempotencyKey}.`);
    idempotencyKeys.add(event.idempotencyKey);
    if (eventIds.has(event.eventId)) errors.push(`Event ${event.sequence} repeats event ID ${event.eventId}.`);
    eventIds.add(event.eventId);
    const { hash, ...withoutHash } = event;
    const expectedHash = hashEvent(withoutHash);
    if (hash !== expectedHash) errors.push(`Event ${event.sequence} hash does not match its contents.`);
    previousHash = hash;
  });

  return {
    valid: errors.length === 0,
    eventCount: events.length,
    headHash: events.at(-1)?.hash ?? GENESIS_HASH,
    errors,
  };
}

export { GENESIS_HASH };
