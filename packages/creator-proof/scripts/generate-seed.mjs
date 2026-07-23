import { webcrypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeProofCapsule, serializeJcs } from "@runbook/capsule-author";
import { prepareCreatorSeed } from "../dist/index.js";

// RFC 8032 test vector 1. This private seed is public fixture material. It is
// forbidden for identity, continuity, production authoring, or any real claim.
const PUBLIC_TEST_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
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
  Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"),
  { name: "Ed25519" },
  true,
  ["verify"],
);
const publicKeySpkiDer = new Uint8Array(await subtle.exportKey("spki", publicKey));
const prepared = await prepareCreatorSeed({
  checkpointSequence: 1,
  createdAt: "2026-07-21T22:00:00Z",
  experimentId: "RUNBOOK-CREATOR-PROOF-SEED-001",
  publicKeySpkiDer,
  subtle,
});
const signature = new Uint8Array(await subtle.sign("Ed25519", privateKey, prepared.signingBytes));
const authored = await finalizeProofCapsule(prepared, signature, { subtle });
const metadata = {
  archiveBytes: authored.archiveBytes.byteLength,
  archiveSha256: authored.archiveSha256,
  authorKeyId: authored.authorKeyId,
  capsuleId: authored.capsuleId,
  fixtureKey: "public-rfc8032-test-vector-1-not-an-identity",
  schemaVersion: "runbook.creator-seed-fixture.v1",
};

writeFileSync(resolve(FIXTURES, "rich-synthetic-seed.runbook"), authored.archiveBytes);
writeFileSync(resolve(FIXTURES, "rich-synthetic-seed.metadata.json"), serializeJcs(metadata));
