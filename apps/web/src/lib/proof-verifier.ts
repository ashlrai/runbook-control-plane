import {
  publicSnapshotSchema,
  type LedgerEventType,
  type PublicSnapshot,
} from "@runbook/engine/schema";

export const MAX_PASTED_ARTIFACT_BYTES = 2 * 1024 * 1024;

export function pastedArtifactSizeError(value: string) {
  const byteLength = new TextEncoder().encode(value).byteLength;
  return byteLength > MAX_PASTED_ARTIFACT_BYTES
    ? `artifact: pasted text exceeds the ${MAX_PASTED_ARTIFACT_BYTES.toLocaleString()}-byte local limit`
    : null;
}

export type SnapshotInspection =
  | { valid: false; errors: string[] }
  | {
      valid: true;
      snapshot: PublicSnapshot;
      eventCounts: Partial<Record<LedgerEventType, number>>;
      checks: Array<{ id: string; label: string; detail: string }>;
    };

function issueMessage(path: PropertyKey[], message: string) {
  return `${path.length > 0 ? path.join(".") : "artifact"}: ${message}`;
}

export function inspectPublicSnapshot(input: unknown): SnapshotInspection {
  const parsed = publicSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => issueMessage(issue.path, issue.message)),
    };
  }

  const snapshot = parsed.data;
  const errors: string[] = [];
  const finalEvent = snapshot.events.at(-1);
  if (finalEvent && snapshot.sourceLedger.eventCount < finalEvent.sequence) {
    errors.push("sourceLedger.eventCount: cannot be smaller than an exported global sequence");
  }
  if (finalEvent && finalEvent.sequence === snapshot.sourceLedger.eventCount && finalEvent.hash !== snapshot.sourceLedger.headHash) {
    errors.push("sourceLedger.headHash: must match the exported final global event");
  }

  const hashes = new Set<string>();
  let previousSequence = 0;
  const generatedAt = Date.parse(snapshot.generatedAt);
  const eventCounts: Partial<Record<LedgerEventType, number>> = {};
  for (const event of snapshot.events) {
    if (event.sequence <= previousSequence) {
      errors.push("events: sequences must be unique and strictly increasing");
      break;
    }
    previousSequence = event.sequence;
    if (hashes.has(event.hash)) {
      errors.push("events: event hashes must be unique within an artifact");
      break;
    }
    hashes.add(event.hash);
    if (Date.parse(event.occurredAt) > generatedAt) {
      errors.push(`events.${event.sequence}: occurrence time cannot be after export time`);
      break;
    }
    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    snapshot,
    eventCounts,
    checks: [
      { id: "schema", label: "Strict schema", detail: "Only the versioned metadata-only export contract was accepted." },
      { id: "ordering", label: "Event ordering", detail: "Sequences increase and event commitments are unique." },
      { id: "time", label: "Temporal consistency", detail: "No exported event claims to occur after the export was generated." },
      { id: "privacy", label: "Projection boundary", detail: "Dedicated payload, actor, broker-ID, and idempotency fields are absent; identifiers, times, event types, and hashes can still be sensitive." },
    ],
  };
}

export function buildVerificationReceipt(snapshot: PublicSnapshot, fingerprint: string) {
  return [
    "RUNBOOK LOCAL VERIFICATION RECEIPT",
    `Experiment: ${snapshot.experimentId}`,
    `Metadata events: ${snapshot.events.length}`,
    `Pasted-text SHA-256: ${fingerprint}`,
    `Source ledger head reported at export: ${snapshot.sourceLedger.headHash}`,
    "Assurance: local tamper evidence only; not independently verified",
    "Privacy: metadata-only projection",
  ].join("\n");
}

export function buildSyntheticCloneShell(snapshot: PublicSnapshot, fingerprint: string) {
  return JSON.stringify({
    schemaVersion: "runbook.clone-charter.v1",
    dataClass: "synthetic",
    derivedFrom: {
      experimentId: snapshot.experimentId,
      pastedTextSha256: fingerprint,
      assurance: "structure-and-pasted-text-fingerprint-only",
    },
    cloneRules: {
      changeExactlyOneAssumption: true,
      copyTradeOrPosition: false,
      requireNewProspectiveCharter: true,
      publication: "manual-human-reviewed",
    },
    fieldsToComplete: {
      question: "",
      changedAssumption: "",
      benchmark: "",
      observationWindow: "",
      stopCondition: "",
    },
  }, null, 2);
}
