import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRunbookLocalDatabase, PROOF_LOOP_EVENTS_STORE } from "./local-store";
import * as observationModule from "./proof-relay-observation";
import {
  buildProofLoopAggregateExport,
  clearProofLoopEvents,
  createAssuranceCheckpointPassedEvent,
  createChallengeLinkCopiedEvent,
  createCloneStarterCreatedEvent,
  createGoldenValidatedEvent,
  createPairDownloadedEvent,
  createProofLoopJourneyId,
  createTamperRejectedEvent,
  createVerifyStartedEvent,
  exportStoredProofLoopEvents,
  GOLDEN_ARCHIVE_SHA256,
  listProofLoopEvents,
  MAX_PROOF_LOOP_EVENTS,
  MAX_PROOF_LOOP_FUTURE_SKEW_MS,
  parseStoredProofLoopEvents,
  PROOF_LOOP_PERMITTED_TUPLES,
  proofLoopEventInputSchema,
  proofLoopEventSchema,
  proofLoopEventTypeSchema,
  saveProofLoopEvent,
  TAMPERED_ARCHIVE_SHA256,
  type ProofLoopEvent,
  type ProofLoopEventContext,
} from "./proof-relay-observation";

const goldenReceiptBytes = new Uint8Array(readFileSync(new URL(
  "../../../../conformance/expected/minimal-synthetic-root.receipt.json",
  import.meta.url,
)));
const tamperedReceiptBytes = new Uint8Array(readFileSync(new URL(
  "../../../../conformance/expected/minimal-synthetic-root-payload-tampered.receipt.json",
  import.meta.url,
)));

function uuidFor(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function contextFor(index: number, journeyIndex = 60_000): ProofLoopEventContext {
  return {
    journeyId: uuidFor(journeyIndex),
    randomUUID: () => uuidFor(index),
    now: () => new Date(Date.parse("2026-07-21T12:00:00.000Z") + index),
  };
}

function eventFor(index: number): ProofLoopEvent {
  return createPairDownloadedEvent(contextFor(index));
}

async function putRawRows(rows: readonly { key: string; value: unknown }[]): Promise<void> {
  const database = await openRunbookLocalDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROOF_LOOP_EVENTS_STORE, "readwrite");
      const store = transaction.objectStore(PROOF_LOOP_EVENTS_STORE);
      for (const row of rows) store.put(row.value, row.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function readRawRows(): Promise<unknown[]> {
  const database = await openRunbookLocalDatabase();
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(PROOF_LOOP_EVENTS_STORE, "readonly");
      const request = transaction.objectStore(PROOF_LOOP_EVENTS_STORE).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function createPopulatedVersionThreeDatabase(keepOpen = false): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("runbook-local-v1", 3);
    request.onupgradeneeded = () => {
      const experimentStore = request.result.createObjectStore("experiment-drafts");
      request.result.createObjectStore("content-observations");
      request.result.createObjectStore("social-baselines");
      experimentStore.put({ preserved: true }, "existing-draft");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (keepOpen) resolve(request.result);
      else {
        request.result.close();
        resolve(null);
      }
    };
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new IDBFactory(),
  });
});

describe("exact Proof Relay event contract", () => {
  it("pins the renamed seven-gate vocabulary and exact permitted tuple table", () => {
    expect(proofLoopEventTypeSchema.options).toEqual([
      "pair-downloaded",
      "verify-started",
      "golden-validated",
      "tamper-rejected",
      "assurance-checkpoint-passed",
      "clone-starter-created",
      "challenge-link-copied",
    ]);
    expect(PROOF_LOOP_PERMITTED_TUPLES).toHaveLength(9);
    expect(proofLoopEventTypeSchema.options).not.toContain("assurance-comprehended");
    expect(proofLoopEventTypeSchema.options).not.toContain("verification-completed");
  });

  it.each(PROOF_LOOP_PERMITTED_TUPLES)(
    "accepts exact tuple %s / %s / %s",
    (eventType, outcome, fixtureRole, sourceBucket, archiveSha256, verifierProfile) => {
      expect(proofLoopEventInputSchema.parse({
        eventType,
        outcome,
        fixtureRole,
        sourceBucket,
        archiveSha256,
        verifierProfile,
      })).toBeDefined();
    },
  );

  it("rejects every cross-tuple splice even when each individual value is known", () => {
    expect(() => proofLoopEventInputSchema.parse({
      eventType: "golden-validated",
      outcome: "valid",
      fixtureRole: "digest-tampered",
      sourceBucket: "proof-relay-bundled-fixtures",
      archiveSha256: TAMPERED_ARCHIVE_SHA256,
      verifierProfile: "runbook.proof-capsule.v1",
    })).toThrow(/exact permitted/);
    expect(() => proofLoopEventInputSchema.parse({
      eventType: "challenge-link-copied",
      outcome: "completed",
      fixtureRole: "not-applicable",
      sourceBucket: "proof-relay-assurance-gate",
      archiveSha256: null,
      verifierProfile: null,
    })).toThrow(/exact permitted/);
  });

  it.each([
    ["email", "person@example.com"],
    ["username", "MasonWyatt23"],
    ["accountId", "account-123"],
    ["symbol", "HOOD"],
    ["postText", "arbitrary free text"],
    ["proofUrl", "https://example.test/proof"],
  ])("rejects unknown direct-identifier or free-text field %s", (field, value) => {
    const event = eventFor(1);
    expect(() => proofLoopEventSchema.parse({ ...event, [field]: value })).toThrow();
  });

  it("requires one explicit journey ID and generates only the event ID", () => {
    const randomUUID = vi.fn(() => uuidFor(42));
    const event = createPairDownloadedEvent({
      journeyId: uuidFor(900),
      randomUUID,
      now: () => new Date("2026-07-21T14:05:06.000Z"),
    });

    expect(randomUUID).toHaveBeenCalledOnce();
    expect(event.journeyId).toBe(uuidFor(900));
    expect(event.eventId).toBe(uuidFor(42));
    expect(event.directIdentifiersIncluded).toBe(false);
    expect(event.containsPseudonymousInteractionData).toBe(true);
    expect(event).not.toHaveProperty("personalDataIncluded");
    expect(() => createPairDownloadedEvent({
      randomUUID: () => uuidFor(1),
      now: () => new Date(),
    } as unknown as ProofLoopEventContext)).toThrow(/expected string/);
  });

  it("creates journey IDs explicitly but never exposes a generic event constructor", () => {
    expect(createProofLoopJourneyId(() => uuidFor(77))).toBe(uuidFor(77));
    expect(observationModule).not.toHaveProperty("buildProofLoopEvent");
    expect(observationModule).not.toHaveProperty("recordProofLoopEvent");
  });

  it("accepts only canonical real millisecond UTC timestamps", () => {
    const event = eventFor(1);
    expect(() => proofLoopEventSchema.parse({ ...event, observedAt: "2026-07-21T12:00:00Z" })).toThrow(/millisecond UTC/);
    expect(() => proofLoopEventSchema.parse({ ...event, observedAt: "2026-07-21T08:00:00.001-04:00" })).toThrow();
    expect(() => proofLoopEventSchema.parse({ ...event, observedAt: "2026-02-30T12:00:00.000Z" })).toThrow(/real canonical/);
  });
});

describe("receipt-bound result constructors", () => {
  it("constructs golden-validated only from the exact serialized frozen receipt bytes", async () => {
    const event = await createGoldenValidatedEvent({
      receiptBytes: goldenReceiptBytes,
      archiveSha256: GOLDEN_ARCHIVE_SHA256,
    }, contextFor(1));
    expect(event).toMatchObject({
      eventType: "golden-validated",
      outcome: "valid",
      archiveSha256: GOLDEN_ARCHIVE_SHA256,
    });

    await expect(createGoldenValidatedEvent({
      receiptBytes: goldenReceiptBytes,
      archiveSha256: TAMPERED_ARCHIVE_SHA256,
    }, contextFor(2))).rejects.toThrow(/actual valid frozen receipt/);
    const changedBytes = goldenReceiptBytes.slice();
    changedBytes[100] ^= 1;
    await expect(createGoldenValidatedEvent({
      receiptBytes: changedBytes,
      archiveSha256: GOLDEN_ARCHIVE_SHA256,
    }, contextFor(3))).rejects.toThrow(/frozen deterministic receipt oracle/);
    await expect(createGoldenValidatedEvent({
      receiptBytes: new TextEncoder().encode(JSON.stringify({ valid: true })),
      archiveSha256: GOLDEN_ARCHIVE_SHA256,
    }, contextFor(4))).rejects.toThrow(/frozen deterministic receipt oracle/);
  });

  it("constructs tamper-rejected only from the exact serialized rejection oracle", async () => {
    const event = await createTamperRejectedEvent({
      receiptBytes: tamperedReceiptBytes,
      archiveSha256: TAMPERED_ARCHIVE_SHA256,
    }, contextFor(5));
    expect(event).toMatchObject({
      eventType: "tamper-rejected",
      outcome: "rejected-as-expected",
      archiveSha256: TAMPERED_ARCHIVE_SHA256,
    });

    await expect(createTamperRejectedEvent({
      receiptBytes: tamperedReceiptBytes,
      archiveSha256: GOLDEN_ARCHIVE_SHA256,
    }, contextFor(6))).rejects.toThrow(/actual rejected frozen receipt/);
    const truncatedBytes = tamperedReceiptBytes.slice(0, -1);
    await expect(createTamperRejectedEvent({
      receiptBytes: truncatedBytes,
      archiveSha256: TAMPERED_ARCHIVE_SHA256,
    }, contextFor(7))).rejects.toThrow(/frozen deterministic receipt oracle/);
  });

  it("constructs every non-result gate without accepting arbitrary metadata", () => {
    expect(createVerifyStartedEvent("golden-valid", contextFor(10)).archiveSha256).toBe(GOLDEN_ARCHIVE_SHA256);
    expect(createVerifyStartedEvent("digest-tampered", contextFor(11)).archiveSha256).toBe(TAMPERED_ARCHIVE_SHA256);
    expect(createVerifyStartedEvent("user-local", contextFor(12)).archiveSha256).toBeNull();
    expect(createAssuranceCheckpointPassedEvent(contextFor(13)).eventType).toBe("assurance-checkpoint-passed");
    expect(createCloneStarterCreatedEvent(contextFor(14)).eventType).toBe("clone-starter-created");
    expect(createChallengeLinkCopiedEvent(contextFor(15)).eventType).toBe("challenge-link-copied");
  });
});

describe("bounded cursor-backed local storage", () => {
  it("uses its own store and preserves populated version-three records during upgrade", async () => {
    await createPopulatedVersionThreeDatabase();
    const database = await openRunbookLocalDatabase();
    expect([...database.objectStoreNames]).toContain(PROOF_LOOP_EVENTS_STORE);
    const preserved = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction("experiment-drafts", "readonly").objectStore("experiment-drafts").get("existing-draft");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    expect(preserved).toEqual({ preserved: true });
  });

  it("fails promptly when a version-three connection blocks the upgrade", async () => {
    const blockingConnection = await createPopulatedVersionThreeDatabase(true);
    await expect(openRunbookLocalDatabase()).rejects.toThrow(/upgrade is blocked/);
    blockingConnection?.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retried = await openRunbookLocalDatabase();
    expect([...retried.objectStoreNames]).toContain(PROOF_LOOP_EVENTS_STORE);
    retried.close();
  });

  it("physically purges malformed and excess rows while retaining only the newest window", async () => {
    const rows: { key: string; value: unknown }[] = Array.from(
      { length: MAX_PROOF_LOOP_EVENTS + 40 },
      (_, index) => ({
      key: eventFor(index).eventId,
      value: eventFor(index),
      }),
    );
    rows.push({ key: "malformed", value: { ...eventFor(500), username: "MasonWyatt23" } });
    rows.push({ key: "wrong-key", value: eventFor(501) });
    await putRawRows(rows);

    const retained = await listProofLoopEvents();
    expect(retained).toHaveLength(MAX_PROOF_LOOP_EVENTS);
    expect(retained[0]).toEqual(eventFor(40));
    expect(retained.at(-1)).toEqual(eventFor(MAX_PROOF_LOOP_EVENTS + 39));
    expect(await readRawRows()).toHaveLength(MAX_PROOF_LOOP_EVENTS);
  });

  it("rejects new events beyond the documented future skew using an injected clock", async () => {
    const normalizationNow = new Date("2026-07-21T12:00:00.000Z");
    const beyondSkew = createPairDownloadedEvent({
      ...contextFor(700),
      now: () => new Date(normalizationNow.valueOf() + MAX_PROOF_LOOP_FUTURE_SKEW_MS + 1),
    });
    await expect(saveProofLoopEvent(beyondSkew, { now: () => normalizationNow })).rejects.toThrow(
      /five-minute future clock skew/,
    );
    expect(await readRawRows()).toEqual([]);

    const boundary = createPairDownloadedEvent({
      ...contextFor(701),
      now: () => new Date(normalizationNow.valueOf() + MAX_PROOF_LOOP_FUTURE_SKEW_MS),
    });
    await saveProofLoopEvent(boundary, { now: () => normalizationNow });
    expect(await listProofLoopEvents({ now: () => normalizationNow })).toEqual([boundary]);
  });

  it("purges hostile future rows before retention so they cannot evict legitimate observations", async () => {
    const normalizationNow = new Date("2026-07-21T12:01:00.000Z");
    const legitimate = Array.from({ length: MAX_PROOF_LOOP_EVENTS }, (_, index) => eventFor(index));
    const hostileFuture = Array.from({ length: 40 }, (_, index) => createPairDownloadedEvent({
      journeyId: uuidFor(60_000),
      randomUUID: () => uuidFor(10_000 + index),
      now: () => new Date(Date.parse("2099-01-01T00:00:00.000Z") + index),
    }));
    await putRawRows([...legitimate, ...hostileFuture].map((event) => ({
      key: event.eventId,
      value: event,
    })));

    const retained = await listProofLoopEvents({ now: () => normalizationNow });
    expect(retained).toEqual(legitimate);
    expect(await readRawRows()).toEqual(legitimate);
  });

  it("normalizes with a cursor and never calls getAll in production storage paths", async () => {
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, "getAll");
    try {
      await saveProofLoopEvent(eventFor(1));
      expect(await listProofLoopEvents()).toEqual([eventFor(1)]);
      expect(getAllSpy).not.toHaveBeenCalled();
    } finally {
      getAllSpy.mockRestore();
    }
  });

  it("handles duplicate IDs deterministically and purges key/value identity mismatches", async () => {
    const canonical = eventFor(1);
    const conflicting = { ...createChallengeLinkCopiedEvent(contextFor(2)), eventId: canonical.eventId };
    expect(parseStoredProofLoopEvents([canonical, canonical])).toEqual([canonical]);
    expect(parseStoredProofLoopEvents([canonical, conflicting])).toEqual([]);
    expect(parseStoredProofLoopEvents([conflicting, canonical])).toEqual([]);

    await putRawRows([
      { key: canonical.eventId, value: canonical },
      { key: "duplicate-alias", value: canonical },
    ]);
    expect(await listProofLoopEvents()).toEqual([canonical]);
    expect(await readRawRows()).toEqual([canonical]);
  });

  it("clears all rows and the subsystem itself makes no network call", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchSpy });
    try {
      await saveProofLoopEvent(eventFor(1));
      await exportStoredProofLoopEvents();
      await clearProofLoopEvents();
      expect(await listProofLoopEvents()).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    }
  });
});

describe("aggregate-only privacy export", () => {
  it("exports deterministic fixed-gate counts without identifiers, hashes, or timestamps", () => {
    const rows = [
      createChallengeLinkCopiedEvent(contextFor(3)),
      eventFor(1),
      eventFor(2),
    ];
    const left = buildProofLoopAggregateExport(rows);
    const right = buildProofLoopAggregateExport([...rows].reverse());
    const parsed = JSON.parse(left) as {
      containsPseudonymousInteractionData: boolean;
      directIdentifiersIncluded: boolean;
      gates: { count: number; eventType: string }[];
      recordCount: number;
    };

    expect(left).toBe(right);
    expect(parsed.recordCount).toBe(3);
    expect(parsed.gates).toHaveLength(7);
    expect(parsed.gates.find((gate) => gate.eventType === "pair-downloaded")?.count).toBe(2);
    expect(parsed.gates.find((gate) => gate.eventType === "challenge-link-copied")?.count).toBe(1);
    expect(parsed.directIdentifiersIncluded).toBe(false);
    expect(parsed.containsPseudonymousInteractionData).toBe(true);
    expect(left).not.toMatch(/eventId|journeyId|observedAt|localSessionCount/);
    expect(left).not.toContain(rows[0].eventId);
    expect(left).not.toContain(rows[0].journeyId);
    expect(left).not.toContain(GOLDEN_ARCHIVE_SHA256);
    expect(left).not.toMatch(/2026-07-21T\d{2}:\d{2}:\d{2}/);
    expect(left).toContain("This observation subsystem itself initiates no network or analytics calls");
    expect(left).toContain("does not describe the surrounding page, browser, or application");
  });

  it("applies deterministic duplicate and malformed-row exclusion before aggregation", () => {
    const event = eventFor(1);
    const conflict = { ...createChallengeLinkCopiedEvent(contextFor(2)), eventId: event.eventId };
    const malformed = { ...eventFor(3), email: "person@example.com" };
    const exportJson = buildProofLoopAggregateExport([event, event, malformed, conflict]);
    const parsed = JSON.parse(exportJson) as { recordCount: number };
    expect(parsed.recordCount).toBe(0);
    expect(exportJson).not.toContain("person@example.com");
  });
});
