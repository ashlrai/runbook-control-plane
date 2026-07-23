import type { PublicSnapshot } from "@runbook/engine/schema";
import { publicSnapshotSchema } from "@runbook/engine/schema";
import { RunbookService } from "./service.js";

export async function buildPublicSnapshot(
  service: RunbookService,
  experimentId: string,
  generatedAt = new Date().toISOString(),
): Promise<PublicSnapshot> {
  const { verification, events } = await service.snapshot(experimentId);
  if (!verification.valid) {
    throw new Error(`Refusing to export an invalid ledger: ${verification.errors.join(" ")}`);
  }
  if (events.length === 0) throw new Error(`No events found for experiment ${experimentId}.`);

  return publicSnapshotSchema.parse({
    schemaVersion: "runbook.public-snapshot.v1",
    generatedAt,
    experimentId,
    sourceLedger: {
      validAtExport: true,
      eventCount: verification.eventCount,
      headHash: verification.headHash,
      assurance: "local-tamper-evidence-only",
    },
    projection: {
      privacy: "metadata-only",
      independentlyVerifiable: false,
      note: "Filtered metadata projection; verify against the trusted source ledger head.",
    },
    events: events.map(({ sequence, type, occurredAt, hash }) => ({ sequence, type, occurredAt, hash })),
  });
}
