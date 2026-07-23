import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEVICE_AUTHOR_KEY_SLOT,
  DEVICE_KEY_DATABASE_NAME,
  DEVICE_KEY_DATABASE_VERSION,
  DEVICE_KEY_STORE_NAME,
  DeviceKeyError,
  activateStagedDeviceAuthorKey,
  inspectDeviceAuthorKey,
  provisionDeviceAuthorKey,
  signWithDeviceAuthorKey,
} from "./index.js";

const release = `sha256:${"a".repeat(64)}` as const;
const createdAtDevice = "2026-07-21T22:00:00.000Z";
const crypto = webcrypto as unknown as Crypto;
let indexedDB: IDBFactory;

function provisionOptions(overrides: Partial<Parameters<typeof provisionDeviceAuthorKey>[0]> = {}) {
  return {
    createdAtDevice,
    createdByRelease: release,
    crypto,
    indexedDB,
    storageModeAtCreation: "persistent" as const,
    ...overrides,
  };
}

function openRaw(factory = indexedDB) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DEVICE_KEY_DATABASE_NAME, DEVICE_KEY_DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function replaceRecord(mutator: (record: Record<string, unknown>) => void) {
  const db = await openRaw();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DEVICE_KEY_STORE_NAME, "readwrite");
      const store = transaction.objectStore(DEVICE_KEY_STORE_NAME);
      const request = store.get(DEVICE_AUTHOR_KEY_SLOT);
      request.onsuccess = () => {
        const record = request.result as Record<string, unknown>;
        mutator(record);
        store.put(record);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => { /* `abort` follows. */ };
    });
  } finally {
    db.close();
  }
}

function countedFactory(factory: IDBFactory) {
  let opens = 0;
  const proxy = new Proxy(factory, {
    get(target, property) {
      if (property === "open") return (...args: Parameters<IDBFactory["open"]>) => {
        opens += 1;
        return target.open(...args);
      };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as IDBFactory;
  return { factory: proxy, opens: () => opens };
}

function cryptoFailingOnSecondSignature() {
  let signatures = 0;
  const subtle = {
    digest: crypto.subtle.digest.bind(crypto.subtle),
    exportKey: crypto.subtle.exportKey.bind(crypto.subtle),
    generateKey: crypto.subtle.generateKey.bind(crypto.subtle),
    sign: async (...args: Parameters<SubtleCrypto["sign"]>) => {
      signatures += 1;
      if (signatures === 2) throw new DOMException("injected", "OperationError");
      return crypto.subtle.sign(...args);
    },
    verify: crypto.subtle.verify.bind(crypto.subtle),
  } as unknown as SubtleCrypto;
  return {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle,
  } as unknown as Crypto;
}

beforeEach(() => {
  indexedDB = new IDBFactory();
});

describe("device-local author key lifecycle", () => {
  it("stages, closes/reopens, reload-tests, and activates an exact Ed25519 identity", async () => {
    const counted = countedFactory(indexedDB);
    const active = await provisionDeviceAuthorKey(provisionOptions({ indexedDB: counted.factory }));

    expect(counted.opens()).toBe(2);
    expect(active).toMatchObject({
      algorithm: "Ed25519",
      createdAtDevice,
      createdByRelease: release,
      lifecycle: "active",
      schemaVersion: 1,
      slot: DEVICE_AUTHOR_KEY_SLOT,
      storageModeAtCreation: "persistent",
    });
    expect(active.publicSpkiDer).toHaveLength(44);
    expect([...active.publicSpkiDer.subarray(0, 12)]).toEqual([48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0]);
    const expectedKeyId = `sha256:${Buffer.from(await crypto.subtle.digest("SHA-256", active.publicSpkiDer)).toString("hex")}`;
    expect(active.keyId).toBe(expectedKeyId);
    await expect(inspectDeviceAuthorKey({ crypto, indexedDB })).resolves.toMatchObject({ state: "active", keyId: active.keyId });
  });

  it("signs an owned exact-byte snapshot only from the active persisted pair", async () => {
    const active = await provisionDeviceAuthorKey(provisionOptions());
    const original = new TextEncoder().encode("DSSEv1 4 test 5 exact");
    const input = new Uint8Array(original);
    const signing = signWithDeviceAuthorKey(input, { crypto, indexedDB });
    input.fill(0xff);
    const result = await signing;

    expect(result).toMatchObject({ keyId: active.keyId });
    expect(result.signature).toHaveLength(64);
    const publicKey = await crypto.subtle.importKey("spki", result.publicSpkiDer, { name: "Ed25519" }, false, ["verify"]);
    await expect(crypto.subtle.verify({ name: "Ed25519" }, publicKey, result.signature, original)).resolves.toBe(true);
    await expect(crypto.subtle.verify({ name: "Ed25519" }, publicKey, result.signature, input)).resolves.toBe(false);
  });

  it("leaves a failed reload test staged and permits only an explicit later activation retry", async () => {
    await expect(provisionDeviceAuthorKey(provisionOptions({ crypto: cryptoFailingOnSecondSignature() })))
      .rejects.toMatchObject({ code: "device-key.activation-failed" });
    await expect(inspectDeviceAuthorKey({ crypto, indexedDB })).resolves.toMatchObject({ state: "staged" });
    await expect(signWithDeviceAuthorKey(new Uint8Array([1]), { crypto, indexedDB }))
      .rejects.toMatchObject({ code: "device-key.not-active" });

    const active = await activateStagedDeviceAuthorKey({ crypto, indexedDB });
    expect(active.lifecycle).toBe("active");
    await expect(inspectDeviceAuthorKey({ crypto, indexedDB })).resolves.toMatchObject({ state: "active", keyId: active.keyId });
  });

  it("never auto-replaces an existing slot", async () => {
    const first = await provisionDeviceAuthorKey(provisionOptions());
    await expect(provisionDeviceAuthorKey(provisionOptions({ createdAtDevice: "2026-07-21T22:01:00.000Z" })))
      .rejects.toMatchObject({ code: "device-key.slot-occupied" });
    await expect(inspectDeviceAuthorKey({ crypto, indexedDB })).resolves.toMatchObject({ state: "active", keyId: first.keyId });
  });

  it("fails closed on unknown or corrupted persisted schema without replacing it", async () => {
    await provisionDeviceAuthorKey(provisionOptions());
    await replaceRecord((record) => { record.schemaVersion = 2; });

    await expect(inspectDeviceAuthorKey({ crypto, indexedDB })).resolves.toEqual({ state: "unavailable", reason: "record-invalid" });
    await expect(signWithDeviceAuthorKey(new Uint8Array([1]), { crypto, indexedDB }))
      .rejects.toMatchObject({ code: "device-key.record-invalid" });
    await expect(provisionDeviceAuthorKey(provisionOptions()))
      .rejects.toMatchObject({ code: "device-key.slot-occupied" });
  });

  it("reports a well-shaped but mismatched persisted key pair as unavailable", async () => {
    await provisionDeviceAuthorKey(provisionOptions());
    const unrelated = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    await replaceRecord((record) => { record.privateKey = unrelated.privateKey; });

    await expect(inspectDeviceAuthorKey({ crypto, indexedDB }))
      .resolves.toEqual({ state: "unavailable", reason: "record-invalid" });
    await expect(provisionDeviceAuthorKey(provisionOptions()))
      .rejects.toMatchObject({ code: "device-key.slot-occupied" });
  });

  it("rejects malformed release/time input before persistence and reports unsupported crypto honestly", async () => {
    await expect(provisionDeviceAuthorKey(provisionOptions({ createdByRelease: "sha256:no" as `sha256:${string}` })))
      .rejects.toMatchObject({ code: "device-key.input-invalid" });
    await expect(provisionDeviceAuthorKey(provisionOptions({ createdAtDevice: "2026-02-30T00:00:00.000Z" })))
      .rejects.toMatchObject({ code: "device-key.input-invalid" });
    await expect(inspectDeviceAuthorKey({ crypto, indexedDB })).resolves.toEqual({ state: "empty" });

    const unsupportedCrypto = {
      getRandomValues: crypto.getRandomValues.bind(crypto),
      subtle: {
        generateKey: async () => { throw new DOMException("unsupported", "NotSupportedError"); },
      } as unknown as SubtleCrypto,
    } as unknown as Crypto;
    await expect(provisionDeviceAuthorKey(provisionOptions({ crypto: unsupportedCrypto })))
      .rejects.toMatchObject({ code: "device-key.unsupported" });
  });

  it("distinguishes missing browser primitives without creating state", async () => {
    const previous = globalThis.indexedDB;
    try {
      Reflect.deleteProperty(globalThis, "indexedDB");
      await expect(inspectDeviceAuthorKey({ crypto })).resolves.toEqual({ state: "unsupported", reason: "indexeddb-unavailable" });
    } finally {
      if (previous !== undefined) Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previous });
    }
  });
});
