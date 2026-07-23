const DATABASE_NAME = "runbook-signer-keystore";
const DATABASE_VERSION = 1;
const STORE_NAME = "key_slots";
const DEVICE_AUTHOR_SLOT = "device-author-v1";
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
const SELF_TEST_DOMAIN = new TextEncoder().encode("RUNBOOK_DEVICE_KEY_SELF_TEST_V1\0");
const SHA256_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const DEVICE_KEY_DATABASE_NAME = DATABASE_NAME;
export const DEVICE_KEY_DATABASE_VERSION = DATABASE_VERSION;
export const DEVICE_KEY_STORE_NAME = STORE_NAME;
export const DEVICE_AUTHOR_KEY_SLOT = DEVICE_AUTHOR_SLOT;

export type DeviceKeyLifecycle = "staged" | "active";
export type DeviceKeyStorageMode = "persistent" | "best-effort";

export type DeviceAuthorKeyDescriptor = {
  algorithm: "Ed25519";
  createdAtDevice: string;
  createdByRelease: `sha256:${string}`;
  keyId: `sha256:${string}`;
  lifecycle: DeviceKeyLifecycle;
  publicSpkiDer: Uint8Array;
  schemaVersion: 1;
  slot: "device-author-v1";
  storageModeAtCreation: DeviceKeyStorageMode;
};

export type DeviceKeyStatus =
  | { state: "unsupported"; reason: "webcrypto-unavailable" | "indexeddb-unavailable" }
  | { state: "empty" }
  | ({ state: "staged" | "active" } & DeviceAuthorKeyDescriptor)
  | { state: "unavailable"; reason: "database-blocked" | "database-error" | "record-invalid" | "version-change" };

export type DeviceKeyRuntimeOptions = {
  crypto?: Crypto;
  indexedDB?: IDBFactory;
};

export type ProvisionDeviceAuthorKeyOptions = DeviceKeyRuntimeOptions & {
  createdAtDevice?: string;
  createdByRelease: `sha256:${string}`;
  storageModeAtCreation: DeviceKeyStorageMode;
};

export type DeviceAuthorSignature = {
  keyId: `sha256:${string}`;
  publicSpkiDer: Uint8Array;
  signature: Uint8Array;
};

export type DeviceKeyErrorCode =
  | "device-key.input-invalid"
  | "device-key.unsupported"
  | "device-key.database-blocked"
  | "device-key.database-unavailable"
  | "device-key.version-change"
  | "device-key.record-invalid"
  | "device-key.slot-empty"
  | "device-key.slot-occupied"
  | "device-key.not-active"
  | "device-key.generation-failed"
  | "device-key.persistence-failed"
  | "device-key.activation-failed"
  | "device-key.signing-failed";

export class DeviceKeyError extends Error {
  readonly code: DeviceKeyErrorCode;

  constructor(code: DeviceKeyErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "DeviceKeyError";
    this.code = code;
  }
}

type DeviceKeyRecord = {
  algorithm: "Ed25519";
  createdAtDevice: string;
  createdByRelease: `sha256:${string}`;
  keyId: `sha256:${string}`;
  lifecycle: DeviceKeyLifecycle;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicSpkiDer: Uint8Array;
  schemaVersion: 1;
  slot: "device-author-v1";
  storageModeAtCreation: DeviceKeyStorageMode;
};

type Runtime = { crypto: Crypto; indexedDB: IDBFactory };
type OpenedDatabase = { db: IDBDatabase; versionChanged: () => boolean };

function copy(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

function concat(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left, 0);
  result.set(right, left.byteLength);
  return result;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function runtime(options: DeviceKeyRuntimeOptions): Runtime | null {
  const crypto = options.crypto ?? globalThis.crypto;
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  if (crypto === undefined || crypto.subtle === undefined || typeof crypto.getRandomValues !== "function" || indexedDB === undefined) return null;
  return { crypto, indexedDB };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function validCreatedAtDevice(value: string) {
  if (!ISO_INSTANT_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validKey(key: unknown, expected: { type: "private" | "public"; extractable: boolean; usage: KeyUsage }) {
  if (!isRecord(key) || !Array.isArray(key.usages) || !isRecord(key.algorithm)) return false;
  return key.type === expected.type
    && key.extractable === expected.extractable
    && key.algorithm.name === "Ed25519"
    && key.usages.length === 1
    && key.usages[0] === expected.usage;
}

function parseRecord(value: unknown): DeviceKeyRecord {
  if (!isRecord(value) || !exactKeys(value, [
    "algorithm", "createdAtDevice", "createdByRelease", "keyId", "lifecycle", "privateKey", "publicKey",
    "publicSpkiDer", "schemaVersion", "slot", "storageModeAtCreation",
  ])) throw new DeviceKeyError("device-key.record-invalid");
  if (value.schemaVersion !== 1 || value.slot !== DEVICE_AUTHOR_SLOT || value.algorithm !== "Ed25519"
    || (value.lifecycle !== "staged" && value.lifecycle !== "active")
    || typeof value.createdAtDevice !== "string" || !validCreatedAtDevice(value.createdAtDevice)
    || typeof value.createdByRelease !== "string" || !SHA256_ID_PATTERN.test(value.createdByRelease)
    || typeof value.keyId !== "string" || !SHA256_ID_PATTERN.test(value.keyId)
    || (value.storageModeAtCreation !== "persistent" && value.storageModeAtCreation !== "best-effort")
    || !(value.publicSpkiDer instanceof Uint8Array)
    || !validKey(value.privateKey, { type: "private", extractable: false, usage: "sign" })
    || !validKey(value.publicKey, { type: "public", extractable: true, usage: "verify" })) {
    throw new DeviceKeyError("device-key.record-invalid");
  }
  return value as DeviceKeyRecord;
}

function descriptor(record: DeviceKeyRecord): DeviceAuthorKeyDescriptor {
  return {
    algorithm: "Ed25519",
    createdAtDevice: record.createdAtDevice,
    createdByRelease: record.createdByRelease,
    keyId: record.keyId,
    lifecycle: record.lifecycle,
    publicSpkiDer: copy(record.publicSpkiDer),
    schemaVersion: 1,
    slot: DEVICE_AUTHOR_SLOT,
    storageModeAtCreation: record.storageModeAtCreation,
  };
}

function isUnsupportedCrypto(error: unknown) {
  return isRecord(error) && (error.name === "NotSupportedError" || error.name === "NotImplementedError");
}

async function publicIdentity(record: DeviceKeyRecord, crypto: Crypto) {
  try {
    const exported = new Uint8Array(await crypto.subtle.exportKey("spki", record.publicKey));
    if (exported.byteLength !== 44 || !equalBytes(exported.subarray(0, ED25519_SPKI_PREFIX.byteLength), ED25519_SPKI_PREFIX)
      || !equalBytes(exported, record.publicSpkiDer)) throw new DeviceKeyError("device-key.record-invalid");
    const keyId = `sha256:${hex(new Uint8Array(await crypto.subtle.digest("SHA-256", copy(exported))))}` as const;
    if (keyId !== record.keyId) throw new DeviceKeyError("device-key.record-invalid");
    return { exported, keyId };
  } catch (error) {
    if (error instanceof DeviceKeyError) throw error;
    throw new DeviceKeyError("device-key.record-invalid", error);
  }
}

async function proveKeyPair(record: DeviceKeyRecord, crypto: Crypto) {
  await publicIdentity(record, crypto);
  const random = crypto.getRandomValues(new Uint8Array(32));
  const challenge = concat(SELF_TEST_DOMAIN, random);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, record.privateKey, challenge));
  if (signature.byteLength !== 64 || !await crypto.subtle.verify({ name: "Ed25519" }, record.publicKey, signature, challenge)) {
    throw new DeviceKeyError("device-key.record-invalid");
  }
}

function openDatabase(indexedDB: IDBFactory): Promise<OpenedDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(new DeviceKeyError("device-key.database-unavailable", error));
      return;
    }
    let settled = false;
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new DeviceKeyError("device-key.database-blocked"));
      }
    };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new DeviceKeyError("device-key.database-unavailable", request.error));
      }
    };
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) {
        request.transaction?.abort();
        return;
      }
      request.result.createObjectStore(STORE_NAME, { keyPath: "slot" });
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      const db = request.result;
      try {
        if (!db.objectStoreNames.contains(STORE_NAME)) throw new Error("missing-store");
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        if (store.keyPath !== "slot" || store.autoIncrement || store.indexNames.length !== 0) throw new Error("invalid-store");
      } catch (error) {
        db.close();
        settled = true;
        reject(new DeviceKeyError("device-key.database-unavailable", error));
        return;
      }
      let changed = false;
      db.onversionchange = () => {
        changed = true;
        db.close();
      };
      settled = true;
      resolve({ db, versionChanged: () => changed });
    };
  });
}

function requestResult<T>(request: IDBRequest<T>, transaction: IDBTransaction): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { /* The transaction handlers own the rejection. */ };
    transaction.oncomplete = () => resolve(result!);
    transaction.onabort = () => reject(new DeviceKeyError("device-key.database-unavailable", transaction.error ?? request.error));
    transaction.onerror = () => { /* `abort` follows for unhandled request errors. */ };
  });
}

async function readSlot(opened: OpenedDatabase) {
  if (opened.versionChanged()) throw new DeviceKeyError("device-key.version-change");
  const transaction = opened.db.transaction(STORE_NAME, "readonly");
  return requestResult(transaction.objectStore(STORE_NAME).get(DEVICE_AUTHOR_SLOT), transaction);
}

function addStagedSlot(opened: OpenedDatabase, record: DeviceKeyRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opened.versionChanged()) {
      reject(new DeviceKeyError("device-key.version-change"));
      return;
    }
    const transaction = opened.db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const read = store.get(DEVICE_AUTHOR_SLOT);
    read.onerror = () => { /* The transaction owns the rejection. */ };
    read.onsuccess = () => {
      if (read.result !== undefined) {
        transaction.abort();
        reject(new DeviceKeyError("device-key.slot-occupied"));
        return;
      }
      store.add(record);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      if (transaction.error !== null) reject(new DeviceKeyError("device-key.persistence-failed", transaction.error));
    };
    transaction.onerror = () => { /* `abort` follows. */ };
  });
}

function samePersistedIdentity(left: DeviceKeyRecord, right: DeviceKeyRecord) {
  return left.schemaVersion === right.schemaVersion && left.slot === right.slot && left.algorithm === right.algorithm
    && left.lifecycle === right.lifecycle && left.createdAtDevice === right.createdAtDevice
    && left.createdByRelease === right.createdByRelease && left.keyId === right.keyId
    && left.storageModeAtCreation === right.storageModeAtCreation && equalBytes(left.publicSpkiDer, right.publicSpkiDer);
}

function promoteStagedSlot(opened: OpenedDatabase, expected: DeviceKeyRecord): Promise<DeviceKeyRecord> {
  return new Promise((resolve, reject) => {
    if (opened.versionChanged()) {
      reject(new DeviceKeyError("device-key.version-change"));
      return;
    }
    const transaction = opened.db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const read = store.get(DEVICE_AUTHOR_SLOT);
    let promoted: DeviceKeyRecord | undefined;
    read.onerror = () => { /* The transaction owns the rejection. */ };
    read.onsuccess = () => {
      try {
        const current = parseRecord(read.result);
        if (current.lifecycle !== "staged" || !samePersistedIdentity(current, expected)) throw new DeviceKeyError("device-key.record-invalid");
        promoted = { ...current, lifecycle: "active" };
        store.put(promoted);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    transaction.oncomplete = () => resolve(promoted!);
    transaction.onabort = () => {
      if (transaction.error !== null) reject(new DeviceKeyError("device-key.activation-failed", transaction.error));
    };
    transaction.onerror = () => { /* `abort` follows. */ };
  });
}

function mapUnavailable(error: unknown): DeviceKeyStatus {
  if (error instanceof DeviceKeyError && error.code === "device-key.database-blocked") return { state: "unavailable", reason: "database-blocked" };
  if (error instanceof DeviceKeyError && error.code === "device-key.record-invalid") return { state: "unavailable", reason: "record-invalid" };
  if (error instanceof DeviceKeyError && error.code === "device-key.version-change") return { state: "unavailable", reason: "version-change" };
  return { state: "unavailable", reason: "database-error" };
}

/** Inspect the fixed device-author slot without creating, replacing, or mutating a key. */
export async function inspectDeviceAuthorKey(options: DeviceKeyRuntimeOptions = {}): Promise<DeviceKeyStatus> {
  const resolved = runtime(options);
  if (resolved === null) {
    const crypto = options.crypto ?? globalThis.crypto;
    return { state: "unsupported", reason: crypto === undefined || crypto.subtle === undefined ? "webcrypto-unavailable" : "indexeddb-unavailable" };
  }
  let opened: OpenedDatabase | undefined;
  try {
    opened = await openDatabase(resolved.indexedDB);
    const raw = await readSlot(opened);
    if (raw === undefined) return { state: "empty" };
    const record = parseRecord(raw);
    try {
      await proveKeyPair(record, resolved.crypto);
    } catch (error) {
      if (error instanceof DeviceKeyError && error.code === "device-key.record-invalid") throw error;
      throw new DeviceKeyError("device-key.record-invalid", error);
    }
    return { state: record.lifecycle, ...descriptor(record) };
  } catch (error) {
    return mapUnavailable(error);
  } finally {
    opened?.db.close();
  }
}

async function generateStagedRecord(options: ProvisionDeviceAuthorKeyOptions, resolved: Runtime): Promise<DeviceKeyRecord> {
  if (!SHA256_ID_PATTERN.test(options.createdByRelease)
    || (options.storageModeAtCreation !== "persistent" && options.storageModeAtCreation !== "best-effort")) {
    throw new DeviceKeyError("device-key.input-invalid");
  }
  const createdAtDevice = options.createdAtDevice ?? new Date().toISOString();
  if (!validCreatedAtDevice(createdAtDevice)) throw new DeviceKeyError("device-key.input-invalid");
  try {
    const generated = await resolved.crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    if (!("privateKey" in generated) || !validKey(generated.privateKey, { type: "private", extractable: false, usage: "sign" })
      || !validKey(generated.publicKey, { type: "public", extractable: true, usage: "verify" })) {
      throw new DeviceKeyError("device-key.generation-failed");
    }
    const publicSpkiDer = new Uint8Array(await resolved.crypto.subtle.exportKey("spki", generated.publicKey));
    if (publicSpkiDer.byteLength !== 44 || !equalBytes(publicSpkiDer.subarray(0, ED25519_SPKI_PREFIX.byteLength), ED25519_SPKI_PREFIX)) {
      throw new DeviceKeyError("device-key.generation-failed");
    }
    const keyId = `sha256:${hex(new Uint8Array(await resolved.crypto.subtle.digest("SHA-256", copy(publicSpkiDer))))}` as const;
    const record: DeviceKeyRecord = {
      algorithm: "Ed25519", createdAtDevice, createdByRelease: options.createdByRelease, keyId, lifecycle: "staged",
      privateKey: generated.privateKey, publicKey: generated.publicKey, publicSpkiDer, schemaVersion: 1,
      slot: DEVICE_AUTHOR_SLOT, storageModeAtCreation: options.storageModeAtCreation,
    };
    await proveKeyPair(record, resolved.crypto);
    return record;
  } catch (error) {
    if (error instanceof DeviceKeyError) throw error;
    if (isUnsupportedCrypto(error)) throw new DeviceKeyError("device-key.unsupported", error);
    throw new DeviceKeyError("device-key.generation-failed", error);
  }
}

/**
 * Create the one device-local key. The slot is written as staged, the database
 * is closed and reopened, and only a second metadata/fingerprint/key-pair test
 * may promote it to active. An existing record is never replaced.
 */
export async function provisionDeviceAuthorKey(options: ProvisionDeviceAuthorKeyOptions): Promise<DeviceAuthorKeyDescriptor> {
  const resolved = runtime(options);
  if (resolved === null) throw new DeviceKeyError("device-key.unsupported");
  const record = await generateStagedRecord(options, resolved);
  let opened = await openDatabase(resolved.indexedDB);
  try {
    await addStagedSlot(opened, record);
  } finally {
    opened.db.close();
  }
  opened = await openDatabase(resolved.indexedDB);
  try {
    const reloaded = parseRecord(await readSlot(opened));
    if (reloaded.lifecycle !== "staged" || !samePersistedIdentity(reloaded, record)) throw new DeviceKeyError("device-key.activation-failed");
    await proveKeyPair(reloaded, resolved.crypto);
    const active = await promoteStagedSlot(opened, reloaded);
    return descriptor(active);
  } catch (error) {
    if (error instanceof DeviceKeyError && error.code === "device-key.record-invalid") {
      throw new DeviceKeyError("device-key.activation-failed", error);
    }
    if (error instanceof DeviceKeyError) throw error;
    throw new DeviceKeyError("device-key.activation-failed", error);
  } finally {
    opened.db.close();
  }
}

/** Explicitly retry validation of a staged record; this never creates or replaces it. */
export async function activateStagedDeviceAuthorKey(options: DeviceKeyRuntimeOptions = {}): Promise<DeviceAuthorKeyDescriptor> {
  const resolved = runtime(options);
  if (resolved === null) throw new DeviceKeyError("device-key.unsupported");
  const opened = await openDatabase(resolved.indexedDB);
  try {
    const raw = await readSlot(opened);
    if (raw === undefined) throw new DeviceKeyError("device-key.slot-empty");
    const staged = parseRecord(raw);
    if (staged.lifecycle !== "staged") throw new DeviceKeyError("device-key.slot-occupied");
    await proveKeyPair(staged, resolved.crypto);
    return descriptor(await promoteStagedSlot(opened, staged));
  } catch (error) {
    if (error instanceof DeviceKeyError) throw error;
    throw new DeviceKeyError("device-key.activation-failed", error);
  } finally {
    opened.db.close();
  }
}

/** Sign an owned snapshot of exact caller bytes, but only with a fully active slot. */
export async function signWithDeviceAuthorKey(bytes: Uint8Array, options: DeviceKeyRuntimeOptions = {}): Promise<DeviceAuthorSignature> {
  if (!(bytes instanceof Uint8Array)) throw new DeviceKeyError("device-key.input-invalid");
  const resolved = runtime(options);
  if (resolved === null) throw new DeviceKeyError("device-key.unsupported");
  const message = copy(bytes);
  const opened = await openDatabase(resolved.indexedDB);
  try {
    const raw = await readSlot(opened);
    if (raw === undefined) throw new DeviceKeyError("device-key.slot-empty");
    const active = parseRecord(raw);
    if (active.lifecycle !== "active") throw new DeviceKeyError("device-key.not-active");
    await publicIdentity(active, resolved.crypto);
    const signature = new Uint8Array(await resolved.crypto.subtle.sign({ name: "Ed25519" }, active.privateKey, message));
    if (signature.byteLength !== 64 || !await resolved.crypto.subtle.verify({ name: "Ed25519" }, active.publicKey, signature, message)) {
      throw new DeviceKeyError("device-key.signing-failed");
    }
    return { keyId: active.keyId, publicSpkiDer: copy(active.publicSpkiDer), signature };
  } catch (error) {
    if (error instanceof DeviceKeyError) throw error;
    throw new DeviceKeyError("device-key.signing-failed", error);
  } finally {
    opened.db.close();
  }
}
