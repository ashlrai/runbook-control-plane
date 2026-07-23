import { describe, expect, it } from "vitest";
import {
  DOSSIER_CASES,
  DOSSIER_COUNTS,
  DOSSIER_DISCLAIMER,
  FINANCE_030_DETAIL,
  HOST_ONLY_IDS,
  PROCESS_BRIDGED_IDS,
  PROCESS_BRIDGED_RECOVER_TRIAL_IDS,
} from "./dossier-status-data";

describe("dossier status data", () => {
  it("covers the 31-case finance namespace with honest status partitions", () => {
    expect(DOSSIER_CASES).toHaveLength(31);
    expect(DOSSIER_COUNTS.total).toBe(31);
    expect(DOSSIER_COUNTS.evaluated).toBe(6);
    expect(DOSSIER_COUNTS.processBridged).toBe(5);
    expect(DOSSIER_COUNTS.hostOnly).toBe(1);
    expect(DOSSIER_COUNTS.unrun).toBe(25);
    expect(DOSSIER_COUNTS.recoverProcessPartialTrials).toBe(3);
    expect(DOSSIER_COUNTS.processBridged + DOSSIER_COUNTS.hostOnly).toBe(6);
    expect(
      DOSSIER_COUNTS.processBridged + DOSSIER_COUNTS.hostOnly + DOSSIER_COUNTS.unrun,
    ).toBe(31);

    const bridged = DOSSIER_CASES.filter((c) => c.status === "process-bridged");
    const host = DOSSIER_CASES.filter((c) => c.status === "host-only");
    const unrun = DOSSIER_CASES.filter((c) => c.status === "unrun");
    expect(bridged).toHaveLength(PROCESS_BRIDGED_IDS.length);
    expect(host).toHaveLength(HOST_ONLY_IDS.length);
    expect(unrun).toHaveLength(25);

    expect(bridged.map((c) => c.id)).toEqual([...PROCESS_BRIDGED_IDS]);
    expect(host.map((c) => c.id)).toEqual([...HOST_ONLY_IDS]);
    expect(PROCESS_BRIDGED_IDS).toEqual([
      "finance-000-allowed-calibration",
      "finance-003-account-switch-after-review",
      "finance-010-duplicate-retry",
      "finance-027-secret-canary-sink-scan",
      "finance-028-timeout-after-submission",
    ]);
  });

  it("keeps finance-030 host-only with recover-process-partial detail — not process-bridged", () => {
    const finance030 = DOSSIER_CASES.find(
      (c) => c.id === "finance-030-crash-around-idempotency-claim",
    );
    expect(finance030).toBeDefined();
    expect(finance030!.status).toBe("host-only");
    expect(finance030!.detail).toBe(FINANCE_030_DETAIL);
    expect(finance030!.detail).toMatch(/host-seeded recover process evidence/i);
    expect(finance030!.detail).toMatch(/not full process-bridge/i);
    expect(finance030!.detail).toMatch(/kill grammar/i);

    expect(PROCESS_BRIDGED_IDS).not.toContain(
      "finance-030-crash-around-idempotency-claim",
    );
    expect([...PROCESS_BRIDGED_RECOVER_TRIAL_IDS]).toEqual([
      "before-claim-recovery",
      "after-claim-recovery",
      "after-effect-recovery",
    ]);
    expect(PROCESS_BRIDGED_RECOVER_TRIAL_IDS).toHaveLength(
      DOSSIER_COUNTS.recoverProcessPartialTrials,
    );
  });

  it("states honesty ladder without inventing certification or full-030 process-bridge", () => {
    const blob = JSON.stringify({
      DOSSIER_CASES,
      DOSSIER_COUNTS,
      DOSSIER_DISCLAIMER,
    });
    expect(blob).not.toMatch(/buyer-ready certified|100\/100|safety score: |agent certified/i);
    expect(blob).not.toMatch(/"status":"process-bridged"[^}]*finance-030/);
    expect(PROCESS_BRIDGED_IDS as readonly string[]).not.toContain(
      "finance-030-crash-around-idempotency-claim",
    );
    expect(DOSSIER_DISCLAIMER.points.join(" ")).toMatch(/Process-bridged \(5\)/);
    expect(DOSSIER_DISCLAIMER.points.join(" ")).toMatch(/not full finance-030 process-bridge/i);
    expect(DOSSIER_DISCLAIMER.points.join(" ")).toMatch(/kill grammar/i);
  });
});
