import { z } from "zod";
import { openRunbookLocalDatabase, PROOF_LOOP_EVENTS_STORE } from "./local-store";

export const PROOF_LOOP_EVENT_SCHEMA_VERSION = "runbook.proof-loop-event.v1" as const;
export const PROOF_LOOP_EXPORT_SCHEMA_VERSION = "runbook.proof-loop-aggregate-export.v1" as const;
export const MAX_PROOF_LOOP_EVENTS = 256;
export const GOLDEN_ARCHIVE_SHA256 = "4a11da34f4f8ed3dcea6167f93e729dbbde7d69246e665d0b8616656eda74191";
export const TAMPERED_ARCHIVE_SHA256 = "eed412e23ce2a4c51c3e216a451585b8a82d9ad761e7dbfbe885f515b3a465e4";
export const PROOF_LOOP_VERIFIER_PROFILE = "runbook.proof-capsule.v1" as const;
/** Stored observations more than five minutes ahead of the normalization clock are hostile and are purged. */
export const MAX_PROOF_LOOP_FUTURE_SKEW_MS = 5 * 60 * 1000;

const GOLDEN_RECEIPT_BYTES = 2_536;
const TAMPERED_RECEIPT_BYTES = 2_588;
const GOLDEN_RECEIPT_SHA256 = "6d5c361575e2b2b8af36410234f249c8b3f97d5bd174400496253e090028e100";
const TAMPERED_RECEIPT_SHA256 = "e87859927bafcb26955b0cc7c2726b17344885e606f0735e1d44eb7b480eee9d";

export const proofLoopEventTypeSchema = z.enum([
  "pair-downloaded",
  "verify-started",
  "golden-validated",
  "tamper-rejected",
  "assurance-checkpoint-passed",
  "clone-starter-created",
  "challenge-link-copied",
]);

export const proofLoopOutcomeSchema = z.enum([
  "completed",
  "started",
  "valid",
  "rejected-as-expected",
]);

export const proofLoopFixtureRoleSchema = z.enum([
  "fixture-pair",
  "golden-valid",
  "digest-tampered",
  "user-local",
  "not-applicable",
]);

export const proofLoopSourceBucketSchema = z.enum([
  "proof-relay-bundled-fixtures",
  "proof-relay-file-picker",
  "proof-relay-assurance-gate",
  "proof-relay-clone-gate",
  "proof-relay-challenge-share",
]);

export const proofLoopArchiveSha256Schema = z.enum([
  GOLDEN_ARCHIVE_SHA256,
  TAMPERED_ARCHIVE_SHA256,
]).nullable();

export const proofLoopVerifierProfileSchema = z.literal(PROOF_LOOP_VERIFIER_PROFILE).nullable();

export const PROOF_LOOP_PERMITTED_TUPLES = [
  ["pair-downloaded", "completed", "fixture-pair", "proof-relay-bundled-fixtures", null, null],
  ["verify-started", "started", "golden-valid", "proof-relay-bundled-fixtures", GOLDEN_ARCHIVE_SHA256, PROOF_LOOP_VERIFIER_PROFILE],
  ["verify-started", "started", "digest-tampered", "proof-relay-bundled-fixtures", TAMPERED_ARCHIVE_SHA256, PROOF_LOOP_VERIFIER_PROFILE],
  ["verify-started", "started", "user-local", "proof-relay-file-picker", null, PROOF_LOOP_VERIFIER_PROFILE],
  ["golden-validated", "valid", "golden-valid", "proof-relay-bundled-fixtures", GOLDEN_ARCHIVE_SHA256, PROOF_LOOP_VERIFIER_PROFILE],
  ["tamper-rejected", "rejected-as-expected", "digest-tampered", "proof-relay-bundled-fixtures", TAMPERED_ARCHIVE_SHA256, PROOF_LOOP_VERIFIER_PROFILE],
  ["assurance-checkpoint-passed", "completed", "not-applicable", "proof-relay-assurance-gate", null, null],
  ["clone-starter-created", "completed", "not-applicable", "proof-relay-clone-gate", null, null],
  ["challenge-link-copied", "completed", "not-applicable", "proof-relay-challenge-share", null, null],
] as const;

type ProofLoopTaxonomy = {
  eventType: z.infer<typeof proofLoopEventTypeSchema>;
  outcome: z.infer<typeof proofLoopOutcomeSchema>;
  fixtureRole: z.infer<typeof proofLoopFixtureRoleSchema>;
  sourceBucket: z.infer<typeof proofLoopSourceBucketSchema>;
  archiveSha256: z.infer<typeof proofLoopArchiveSha256Schema>;
  verifierProfile: z.infer<typeof proofLoopVerifierProfileSchema>;
};

function tupleKey(tuple: readonly unknown[]): string {
  return JSON.stringify(tuple);
}

const permittedTupleKeys = new Set(PROOF_LOOP_PERMITTED_TUPLES.map(tupleKey));

function validateTaxonomy(input: ProofLoopTaxonomy, context: z.RefinementCtx): void {
  const key = tupleKey([
    input.eventType,
    input.outcome,
    input.fixtureRole,
    input.sourceBucket,
    input.archiveSha256,
    input.verifierProfile,
  ]);
  if (!permittedTupleKeys.has(key)) {
    context.addIssue({
      code: "custom",
      path: ["eventType"],
      message: "Event fields do not match an exact permitted Proof Relay gate tuple.",
    });
  }
}

const taxonomyShape = {
  eventType: proofLoopEventTypeSchema,
  outcome: proofLoopOutcomeSchema,
  fixtureRole: proofLoopFixtureRoleSchema,
  sourceBucket: proofLoopSourceBucketSchema,
  archiveSha256: proofLoopArchiveSha256Schema,
  verifierProfile: proofLoopVerifierProfileSchema,
};

export const proofLoopEventInputSchema = z.object(taxonomyShape).strict().superRefine(validateTaxonomy);

const deviceLocalUuidV4Schema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Identifier must be a lowercase device-generated UUID v4.",
);

const canonicalMillisecondUtcSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "Timestamp must be canonical millisecond UTC.")
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
  }, "Timestamp must represent a real canonical UTC instant.");

export const proofLoopEventSchema = z.object({
  schemaVersion: z.literal(PROOF_LOOP_EVENT_SCHEMA_VERSION),
  eventId: deviceLocalUuidV4Schema,
  journeyId: deviceLocalUuidV4Schema,
  observedAt: canonicalMillisecondUtcSchema,
  ...taxonomyShape,
  observationScope: z.literal("device-local-only"),
  directIdentifiersIncluded: z.literal(false),
  containsPseudonymousInteractionData: z.literal(true),
}).strict().superRefine(validateTaxonomy);

export type ProofLoopEventInput = z.infer<typeof proofLoopEventInputSchema>;
export type ProofLoopEvent = z.infer<typeof proofLoopEventSchema>;

export type ProofLoopEventContext = {
  journeyId: string;
  randomUUID?: () => string;
  now?: () => Date;
};

function defaultRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("A secure device-local UUID generator is required.");
  }
  return globalThis.crypto.randomUUID();
}

export function createProofLoopJourneyId(randomUUID: () => string = defaultRandomUUID): string {
  return deviceLocalUuidV4Schema.parse(randomUUID());
}

function buildEvent(input: ProofLoopEventInput, context: ProofLoopEventContext): ProofLoopEvent {
  const parsedInput = proofLoopEventInputSchema.parse(input);
  const journeyId = deviceLocalUuidV4Schema.parse(context.journeyId);
  const now = (context.now ?? (() => new Date()))();
  if (Number.isNaN(now.valueOf())) {
    throw new Error("The device clock did not produce a valid timestamp.");
  }

  return proofLoopEventSchema.parse({
    schemaVersion: PROOF_LOOP_EVENT_SCHEMA_VERSION,
    eventId: (context.randomUUID ?? defaultRandomUUID)(),
    journeyId,
    observedAt: now.toISOString(),
    ...parsedInput,
    observationScope: "device-local-only",
    directIdentifiersIncluded: false,
    containsPseudonymousInteractionData: true,
  });
}

function fixedEvent(
  eventType: "pair-downloaded" | "assurance-checkpoint-passed" | "clone-starter-created" | "challenge-link-copied",
  context: ProofLoopEventContext,
): ProofLoopEvent {
  const byEvent = {
    "pair-downloaded": ["completed", "fixture-pair", "proof-relay-bundled-fixtures"],
    "assurance-checkpoint-passed": ["completed", "not-applicable", "proof-relay-assurance-gate"],
    "clone-starter-created": ["completed", "not-applicable", "proof-relay-clone-gate"],
    "challenge-link-copied": ["completed", "not-applicable", "proof-relay-challenge-share"],
  } as const;
  const [outcome, fixtureRole, sourceBucket] = byEvent[eventType];
  return buildEvent({ eventType, outcome, fixtureRole, sourceBucket, archiveSha256: null, verifierProfile: null }, context);
}

export function createPairDownloadedEvent(context: ProofLoopEventContext): ProofLoopEvent {
  return fixedEvent("pair-downloaded", context);
}

export function createVerifyStartedEvent(
  fixtureRole: "golden-valid" | "digest-tampered" | "user-local",
  context: ProofLoopEventContext,
): ProofLoopEvent {
  if (fixtureRole === "golden-valid") {
    return buildEvent({
      eventType: "verify-started",
      outcome: "started",
      fixtureRole,
      sourceBucket: "proof-relay-bundled-fixtures",
      archiveSha256: GOLDEN_ARCHIVE_SHA256,
      verifierProfile: PROOF_LOOP_VERIFIER_PROFILE,
    }, context);
  }
  if (fixtureRole === "digest-tampered") {
    return buildEvent({
      eventType: "verify-started",
      outcome: "started",
      fixtureRole,
      sourceBucket: "proof-relay-bundled-fixtures",
      archiveSha256: TAMPERED_ARCHIVE_SHA256,
      verifierProfile: PROOF_LOOP_VERIFIER_PROFILE,
    }, context);
  }
  return buildEvent({
    eventType: "verify-started",
    outcome: "started",
    fixtureRole,
    sourceBucket: "proof-relay-file-picker",
    archiveSha256: null,
    verifierProfile: PROOF_LOOP_VERIFIER_PROFILE,
  }, context);
}

type VerificationEvidence = {
  archiveSha256: string;
  receiptBytes: ArrayBuffer | Uint8Array;
};

function copyReceiptBytes(value: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("Receipt evidence must be exact serialized bytes.");
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error("Web Crypto SHA-256 is required to validate receipt evidence.");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertExactReceiptOracle(
  value: ArrayBuffer | Uint8Array,
  expectedBytes: number,
  expectedSha256: string,
): Promise<void> {
  const bytes = copyReceiptBytes(value);
  if (bytes.byteLength !== expectedBytes || await sha256Hex(bytes) !== expectedSha256) {
    throw new Error("Serialized receipt bytes do not match the frozen deterministic receipt oracle.");
  }
}

export async function createGoldenValidatedEvent(
  evidence: VerificationEvidence,
  context: ProofLoopEventContext,
): Promise<ProofLoopEvent> {
  if (evidence.archiveSha256 !== GOLDEN_ARCHIVE_SHA256) {
    throw new Error("Golden validation event requires the actual valid frozen receipt and archive hash.");
  }
  await assertExactReceiptOracle(evidence.receiptBytes, GOLDEN_RECEIPT_BYTES, GOLDEN_RECEIPT_SHA256);
  return buildEvent({
    eventType: "golden-validated",
    outcome: "valid",
    fixtureRole: "golden-valid",
    sourceBucket: "proof-relay-bundled-fixtures",
    archiveSha256: GOLDEN_ARCHIVE_SHA256,
    verifierProfile: PROOF_LOOP_VERIFIER_PROFILE,
  }, context);
}

export async function createTamperRejectedEvent(
  evidence: VerificationEvidence,
  context: ProofLoopEventContext,
): Promise<ProofLoopEvent> {
  if (evidence.archiveSha256 !== TAMPERED_ARCHIVE_SHA256) {
    throw new Error("Tamper rejection event requires the actual rejected frozen receipt and archive hash.");
  }
  await assertExactReceiptOracle(evidence.receiptBytes, TAMPERED_RECEIPT_BYTES, TAMPERED_RECEIPT_SHA256);
  return buildEvent({
    eventType: "tamper-rejected",
    outcome: "rejected-as-expected",
    fixtureRole: "digest-tampered",
    sourceBucket: "proof-relay-bundled-fixtures",
    archiveSha256: TAMPERED_ARCHIVE_SHA256,
    verifierProfile: PROOF_LOOP_VERIFIER_PROFILE,
  }, context);
}

export function createAssuranceCheckpointPassedEvent(context: ProofLoopEventContext): ProofLoopEvent {
  return fixedEvent("assurance-checkpoint-passed", context);
}

export function createCloneStarterCreatedEvent(context: ProofLoopEventContext): ProofLoopEvent {
  return fixedEvent("clone-starter-created", context);
}

export function createChallengeLinkCopiedEvent(context: ProofLoopEventContext): ProofLoopEvent {
  return fixedEvent("challenge-link-copied", context);
}

function compareEvents(left: ProofLoopEvent, right: ProofLoopEvent): number {
  if (left.observedAt !== right.observedAt) return left.observedAt < right.observedAt ? -1 : 1;
  return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
}

function canonicalEvent(event: ProofLoopEvent): string {
  return JSON.stringify(event);
}

export function parseStoredProofLoopEvents(rows: readonly unknown[]): ProofLoopEvent[] {
  const byEventId = new Map<string, { canonical: string; event: ProofLoopEvent }>();
  const conflictingIds = new Set<string>();

  for (const row of rows) {
    const parsed = proofLoopEventSchema.safeParse(row);
    if (!parsed.success || conflictingIds.has(parsed.data.eventId)) continue;
    const canonical = canonicalEvent(parsed.data);
    const existing = byEventId.get(parsed.data.eventId);
    if (existing === undefined) {
      byEventId.set(parsed.data.eventId, { canonical, event: parsed.data });
    } else if (existing.canonical !== canonical) {
      byEventId.delete(parsed.data.eventId);
      conflictingIds.add(parsed.data.eventId);
    }
  }

  return [...byEventId.values()]
    .map(({ event }) => event)
    .toSorted(compareEvents)
    .slice(-MAX_PROOF_LOOP_EVENTS);
}

function requireIndexedDb(): void {
  if (typeof globalThis.indexedDB === "undefined") {
    throw new Error("Proof loop observations require device-local IndexedDB storage.");
  }
}

type RetainedRow = { event: ProofLoopEvent; key: IDBValidKey };
export type ProofLoopStorageClock = { now?: () => Date };

function findOldestIndex(rows: readonly RetainedRow[]): number {
  let oldestIndex = 0;
  for (let index = 1; index < rows.length; index += 1) {
    if (compareEvents(rows[index].event, rows[oldestIndex].event) < 0) oldestIndex = index;
  }
  return oldestIndex;
}

function resolveNormalizationNow(options: ProofLoopStorageClock): number {
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.valueOf())) throw new Error("The normalization clock did not produce a valid timestamp.");
  return now.valueOf();
}

function isHostileFutureEvent(event: ProofLoopEvent, nowMs: number): boolean {
  return Date.parse(event.observedAt) > nowMs + MAX_PROOF_LOOP_FUTURE_SKEW_MS;
}

async function normalizeProofLoopStore(
  eventToSave?: ProofLoopEvent,
  options: ProofLoopStorageClock = {},
): Promise<ProofLoopEvent[]> {
  requireIndexedDb();
  const nowMs = resolveNormalizationNow(options);
  if (eventToSave !== undefined && isHostileFutureEvent(eventToSave, nowMs)) {
    throw new Error("Proof loop observation is beyond the permitted five-minute future clock skew.");
  }
  const database = await openRunbookLocalDatabase();
  try {
    return await new Promise<ProofLoopEvent[]>((resolve, reject) => {
      const retained: RetainedRow[] = [];
      const transaction = database.transaction(PROOF_LOOP_EVENTS_STORE, "readwrite", { durability: "strict" });
      const store = transaction.objectStore(PROOF_LOOP_EVENTS_STORE);
      if (eventToSave !== undefined) store.put(eventToSave, eventToSave.eventId);
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) return;
        const parsed = proofLoopEventSchema.safeParse(cursor.value);
        if (
          !parsed.success
          || typeof cursor.key !== "string"
          || cursor.key !== parsed.data.eventId
          || isHostileFutureEvent(parsed.data, nowMs)
        ) {
          cursor.delete();
          cursor.continue();
          return;
        }

        if (retained.length < MAX_PROOF_LOOP_EVENTS) {
          retained.push({ event: parsed.data, key: cursor.key });
        } else {
          const oldestIndex = findOldestIndex(retained);
          if (compareEvents(parsed.data, retained[oldestIndex].event) > 0) {
            store.delete(retained[oldestIndex].key);
            retained[oldestIndex] = { event: parsed.data, key: cursor.key };
          } else {
            cursor.delete();
          }
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Could not scan proof loop observations."));
      transaction.oncomplete = () => resolve(retained.map(({ event }) => event).toSorted(compareEvents));
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not normalize proof loop observations."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The proof loop observation normalization was aborted."));
    });
  } finally {
    database.close();
  }
}

export async function saveProofLoopEvent(event: ProofLoopEvent, options: ProofLoopStorageClock = {}): Promise<void> {
  await normalizeProofLoopStore(proofLoopEventSchema.parse(event), options);
}

export async function listProofLoopEvents(options: ProofLoopStorageClock = {}): Promise<ProofLoopEvent[]> {
  return normalizeProofLoopStore(undefined, options);
}

export async function clearProofLoopEvents(): Promise<void> {
  requireIndexedDb();
  const database = await openRunbookLocalDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROOF_LOOP_EVENTS_STORE, "readwrite", { durability: "strict" });
      transaction.objectStore(PROOF_LOOP_EVENTS_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear proof loop observations."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The proof loop observation reset was aborted."));
    });
  } finally {
    database.close();
  }
}

export function buildProofLoopAggregateExport(rows: readonly unknown[]): string {
  const events = parseStoredProofLoopEvents(rows);
  const counts = new Map<z.infer<typeof proofLoopEventTypeSchema>, number>(
    proofLoopEventTypeSchema.options.map((eventType) => [eventType, 0]),
  );
  for (const event of events) counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);

  const payload = {
    schemaVersion: PROOF_LOOP_EXPORT_SCHEMA_VERSION,
    dataClass: "fixed-gate-aggregate-device-local-observations",
    observationScope: "device-local-only",
    directIdentifiersIncluded: false,
    containsPseudonymousInteractionData: true,
    retentionLimit: MAX_PROOF_LOOP_EVENTS,
    recordCount: events.length,
    gates: proofLoopEventTypeSchema.options.map((eventType) => ({ eventType, count: counts.get(eventType) ?? 0 })),
    limitations: [
      "This observation subsystem itself initiates no network or analytics calls; this statement does not describe the surrounding page, browser, or application.",
      "The export contains fixed-gate counts only, with no event IDs, journey IDs, archive hashes, or timestamps.",
      "Counts describe device-local interactions, not unique people or causal outcomes.",
    ],
  } as const;

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function exportStoredProofLoopEvents(options: ProofLoopStorageClock = {}): Promise<string> {
  return buildProofLoopAggregateExport(await listProofLoopEvents(options));
}
