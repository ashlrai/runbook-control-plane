import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "./index.js";

const corpusRoot = new URL("../../../conformance/", import.meta.url);

async function corpusFile(path: string) {
  return readFile(fileURLToPath(new URL(path, corpusRoot)));
}

describe("frozen independent conformance corpus", () => {
  it("accepts the separately assembled synthetic root with the frozen identities", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root.runbook");
    const expectedReceipt = await corpusFile("expected/minimal-synthetic-root.receipt.json");
    const result = verifyProofCapsule(capsule);

    expect(result.valid).toBe(true);
    expect(result.capsuleId).toBe("66b200560e20f723ece402931277043b85316687aac30f73c4da6a4d5a323578");
    expect(result.authorKeyId).toBe("sha256:b4d90a08583c87e8b69423aa17746e8d0359b8f3765ead1567531d232c28ce55");
    expect(result.errors).toEqual([]);
    expect(result.assurance).toMatchObject({
      transportProfile: "valid",
      packageIntegrity: "valid",
      authorSignature: "valid",
      authorIdentity: "self-asserted-key",
      independentTime: "absent",
      brokerIssuance: "not-evaluated",
      brokerExecution: "not-evaluated",
      recordCompleteness: "not-evaluated",
    });
    expect(serializeProofVerificationReceipt(result)).toEqual(expectedReceipt);
  });

  it("rejects the separately assembled one-byte payload mutation at package integrity only", async () => {
    const capsule = await corpusFile("fixtures/minimal-synthetic-root-payload-tampered.runbook");
    const expectedReceipt = await corpusFile("expected/minimal-synthetic-root-payload-tampered.receipt.json");
    const result = verifyProofCapsule(capsule);

    expect(result.valid).toBe(false);
    expect(result.capsuleId).toBe("66b200560e20f723ece402931277043b85316687aac30f73c4da6a4d5a323578");
    expect(result.assurance.transportProfile).toBe("valid");
    expect(result.assurance.authorSignature).toBe("valid");
    expect(result.assurance.packageIntegrity).toBe("invalid");
    expect(result.errors).toEqual([{
      code: "manifest.member-digest-mismatch",
      path: "payload/charter.json",
    }]);
    expect(result.members.find((member) => member.path === "payload/charter.json")?.status).toBe("invalid");
    expect(result.members.filter((member) => member.path !== "payload/charter.json").every((member) => member.status === "valid")).toBe(true);
    expect(serializeProofVerificationReceipt(result)).toEqual(expectedReceipt);
  });
});
