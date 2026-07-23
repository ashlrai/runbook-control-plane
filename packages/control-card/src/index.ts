import { verifyProofCapsule, type VerifyProofCapsuleOptions } from "@runbook/capsule-browser";
import {
  evaluateControlCardProfile,
  type ControlCardVerificationReceipt,
} from "./profile.js";

export {
  CONTROL_CARD_CLAIMS_SCHEMA,
  CONTROL_CARD_CORPUS_MANIFEST_SHA256,
  CONTROL_CARD_CORPUS_SHA256,
  CONTROL_CARD_DISCLOSURES,
  CONTROL_CARD_DISCLOSURES_SCHEMA,
  CONTROL_CARD_EXPERIMENT_ID,
  CONTROL_CARD_LIMITATIONS,
  CONTROL_CARD_MANIFEST_SHA256,
  CONTROL_CARD_OUTCOMES_SHA256,
  CONTROL_CARD_PROFILE,
  CONTROL_CARD_SAMPLE_ARCHIVE_SHA256,
  CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID,
  CONTROL_CARD_SAMPLE_CAPSULE_ID,
  CONTROL_CARD_SCENARIOS_SCHEMA,
  CONTROL_CARD_VERIFICATION_SCHEMA,
  controlCardProfileSnapshot,
  prepareControlCard,
  serializeControlCardVerificationReceipt,
  type ControlCardChecks,
  type ControlCardVerificationReceipt,
  type PrepareControlCardInput,
} from "./profile.js";

/** Browser-safe core plus fixed application-profile verification. */
export async function verifyControlCard(
  archiveInput: Uint8Array,
  options: VerifyProofCapsuleOptions = {},
): Promise<ControlCardVerificationReceipt> {
  const archive = new Uint8Array(archiveInput);
  const core = await verifyProofCapsule(archive, options);
  return evaluateControlCardProfile(archive, core);
}
