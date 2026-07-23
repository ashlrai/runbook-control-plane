import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateCapabilityAdmission,
  parseExactJcsAdmissionPolicyBytes,
} from "./index.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/robinhood/", import.meta.url));
const POLICY_PATH = fileURLToPath(
  new URL(
    "../fixtures/robinhood/public-docs-review-required-policy.jcs",
    import.meta.url,
  ),
);
const POLICY_SHA256 =
  "b4863e7bb22b9b379b3eaa44e39e13bd3e9c458734e9efcb8c613b3a8aaa3435";

const readFixture = (name: string): Uint8Array =>
  readFileSync(`${FIXTURE_DIR}${name}`);

describe("Robinhood public-documentation example admission policy", () => {
  it("is exact JCS and deliberately quarantines the material 45-to-50 delta", async () => {
    const policyBytes = readFileSync(POLICY_PATH);
    expect(policyBytes.at(-1)).not.toBe(0x0a);
    expect(createHash("sha256").update(policyBytes).digest("hex")).toBe(
      POLICY_SHA256,
    );
    const policy = parseExactJcsAdmissionPolicyBytes(policyBytes);
    expect(policy).toMatchObject({
      allowedSourceAuthorities: ["public-documentation"],
      requireReviewForMaterialChanges: true,
      trustedReviewerKeyIds: [],
      unknownRiskDecision: "reject",
    });

    const receipt = await evaluateCapabilityAdmission({
      baselineSnapshotBytes: readFixture("trading-45-snapshot.jcs"),
      candidateSnapshotBytes: readFixture("trading-50-snapshot.jcs"),
      evaluatedAtDeclared: "2026-07-22T07:10:00Z",
      policyBytes,
    });
    expect(receipt.outcome).toBe("quarantine");
    expect(receipt.reviewSignatureVerified).toBe(false);
    expect(receipt.checks).toContainEqual({
      code: "material-review-satisfied",
      passed: false,
    });
  });
});
