import seedArchive from "../../../packages/creator-proof/fixtures/rich-synthetic-seed.runbook";
import { openVerifiedCreatorSeed } from "@runbook/creator-proof";

export const EXPECTED_SEED_ARCHIVE_SHA256 = "a941a709d311ec05993ce0f8d2c8c25ae8303f3fe2bd27458815f6c39b6d8946";
export const CREATOR_SEED_ARCHIVE = new Uint8Array(seedArchive);

function hex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function openEmbeddedCreatorSeed(subtle: SubtleCrypto = crypto.subtle) {
  const archiveSha256 = hex(new Uint8Array(await subtle.digest("SHA-256", new Uint8Array(CREATOR_SEED_ARCHIVE))));
  if (archiveSha256 !== EXPECTED_SEED_ARCHIVE_SHA256) throw new Error("signer.seed-hash-mismatch");
  const verified = await openVerifiedCreatorSeed(CREATOR_SEED_ARCHIVE, { subtle });
  return { archiveSha256, verified };
}
