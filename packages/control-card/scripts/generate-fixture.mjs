import { webcrypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeProofCapsule, serializeJcs } from "@runbook/capsule-author";
import {
  CONTROL_CARD_CORPUS_MANIFEST_SHA256,
  CONTROL_CARD_CORPUS_SHA256,
  CONTROL_CARD_MANIFEST_SHA256,
  CONTROL_CARD_OUTCOMES_SHA256,
  prepareControlCard,
  serializeControlCardVerificationReceipt,
  verifyControlCard,
} from "../dist/index.js";
import { verifyControlCardNode } from "../dist/node.js";

// RFC 8032 test vector 2. This private seed is public fixture material. It is
// forbidden for identity, continuity, production authoring, or any real claim.
// A distinct vector prevents false key continuity with the Creator Proof seed.
const PUBLIC_TEST_SEED = [
  "4ccd089b28ff96da",
  "9db6c346ec114e0f",
  "5b8a319f35aba624",
  "da8cf6ed4fb8a6fb",
].join("");
const PUBLIC_TEST_KEY = [
  "3d4017c3e843895a",
  "92b70aa74d1b7ebc",
  "9c982ccf2ec4968c",
  "c0cd55f12af4660c",
].join("");
const PKCS8_PREFIX = "302e020100300506032b657004220420";
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../fixtures");
const subtle = webcrypto.subtle;

mkdirSync(FIXTURES, { recursive: true });
const privateKey = await subtle.importKey(
  "pkcs8",
  Buffer.from(`${PKCS8_PREFIX}${PUBLIC_TEST_SEED}`, "hex"),
  { name: "Ed25519" },
  false,
  ["sign"],
);
const publicKey = await subtle.importKey(
  "raw",
  Buffer.from(PUBLIC_TEST_KEY, "hex"),
  { name: "Ed25519" },
  true,
  ["verify"],
);
const publicKeySpkiDer = new Uint8Array(await subtle.exportKey("spki", publicKey));
const prepared = await prepareControlCard({
  checkpointSequence: 1,
  createdAt: "2026-07-22T12:00:00Z",
  publicKeySpkiDer,
}, { subtle });
const signature = new Uint8Array(await subtle.sign("Ed25519", privateKey, prepared.signingBytes));
const authored = await finalizeProofCapsule(prepared, signature, { subtle });
const [browserReceipt, nodeReceipt] = await Promise.all([
  verifyControlCard(authored.archiveBytes, { subtle }),
  Promise.resolve(verifyControlCardNode(authored.archiveBytes)),
]);
if (!browserReceipt.valid || JSON.stringify(browserReceipt) !== JSON.stringify(nodeReceipt)) {
  throw new Error("control-card.fixture-self-verification-failed");
}
const metadata = {
  archiveBytes: authored.archiveBytes.byteLength,
  archiveSha256: authored.archiveSha256,
  authorKeyId: authored.authorKeyId,
  capsuleId: authored.capsuleId,
  corpusManifestSha256: CONTROL_CARD_CORPUS_MANIFEST_SHA256,
  corpusSha256: CONTROL_CARD_CORPUS_SHA256,
  fixtureKey: "public-rfc8032-test-vector-2-not-an-identity-or-issuer",
  manifestSha256: CONTROL_CARD_MANIFEST_SHA256,
  outcomesSha256: CONTROL_CARD_OUTCOMES_SHA256,
  schemaVersion: "runbook.synthetic-control-self-test-fixture.v0",
};

writeFileSync(resolve(FIXTURES, "synthetic-control-self-test-v0.runbook"), authored.archiveBytes);
writeFileSync(resolve(FIXTURES, "synthetic-control-self-test-v0.metadata.json"), serializeJcs(metadata));
writeFileSync(resolve(FIXTURES, "synthetic-control-self-test-v0.domain-receipt.jcs"), serializeControlCardVerificationReceipt(browserReceipt));
