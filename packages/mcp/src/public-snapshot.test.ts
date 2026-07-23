import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLedger } from "@runbook/engine/ledger";
import { publicSnapshotSchema } from "@runbook/engine/schema";
import { describe, expect, it } from "vitest";
import { buildPublicSnapshot } from "./public-snapshot.js";
import { RunbookService } from "./service.js";

describe("buildPublicSnapshot", () => {
  it("exports only verifiable experiment metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-public-"));
    const ledger = new FileLedger(directory);
    await ledger.append({
      experimentId: "RUN-PUBLIC-1",
      type: "experiment.created",
      occurredAt: "2026-07-21T14:00:00.000Z",
      actor: { type: "human", id: "private-actor" },
      idempotencyKey: "private-idempotency-key",
      payload: { brokerEventId: "private-broker-id", name: "Public test" },
    });
    const snapshot = await buildPublicSnapshot(new RunbookService(ledger), "RUN-PUBLIC-1", "2026-07-21T15:00:00.000Z");
    expect(publicSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("private-actor");
    expect(serialized).not.toContain("private-idempotency-key");
    expect(serialized).not.toContain("private-broker-id");
    expect(snapshot.projection.independentlyVerifiable).toBe(false);
  });

  it("rejects an export timestamp that predates an event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runbook-public-time-"));
    const ledger = new FileLedger(directory);
    await ledger.append({
      experimentId: "RUN-PUBLIC-TIME",
      type: "experiment.created",
      occurredAt: "2026-07-21T14:00:00.000Z",
      actor: { type: "human", id: "operator" },
      idempotencyKey: "public-time",
      payload: { name: "Timestamp test" },
    });
    await expect(buildPublicSnapshot(
      new RunbookService(ledger),
      "RUN-PUBLIC-TIME",
      "2026-07-21T13:59:59.000Z",
    )).rejects.toThrow();
  });
});
