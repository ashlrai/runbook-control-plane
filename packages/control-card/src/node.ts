import { verifyProofCapsule } from "@runbook/capsule";
import {
  evaluateControlCardProfile,
  type ControlCardVerificationReceipt,
} from "./profile.js";

export { serializeControlCardVerificationReceipt } from "./profile.js";

/** Node core plus the same fixed application-profile evaluator. */
export function verifyControlCardNode(archiveInput: Uint8Array): ControlCardVerificationReceipt {
  const archive = new Uint8Array(archiveInput);
  const core = verifyProofCapsule(archive);
  return evaluateControlCardProfile(archive, core);
}
