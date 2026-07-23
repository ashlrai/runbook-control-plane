import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROL_CARD_CORPUS_MANIFEST_SHA256,
  CONTROL_CARD_CORPUS_SHA256,
  CONTROL_CARD_MANIFEST_SHA256,
  CONTROL_CARD_OUTCOMES_SHA256,
  CONTROL_CARD_SAMPLE_ARCHIVE_SHA256,
  CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID,
  CONTROL_CARD_SAMPLE_CAPSULE_ID,
} from "../../../packages/control-card/dist/index.js";
import {
  serializeControlCardVerificationReceipt,
  verifyControlCardNode,
} from "../../../packages/control-card/dist/node.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = join(root, "packages/control-card/fixtures");
const destination = join(root, "apps/web/public/control-card");
const names = {
  archive: "synthetic-control-self-test-v0.runbook",
  domainReceipt: "synthetic-control-self-test-v0.domain-receipt.jcs",
  metadata: "synthetic-control-self-test-v0.metadata.json",
};
const encoder = new TextEncoder();

function fail(code) {
  throw new Error(`control-card-assets.${code}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesEqual(left, right) {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function verifyReleaseAssets(assets) {
  const archive = new Uint8Array(assets.archive);
  const metadata = new Uint8Array(assets.metadata);
  const domainReceipt = new Uint8Array(assets.domainReceipt);

  if (sha256(archive) !== CONTROL_CARD_SAMPLE_ARCHIVE_SHA256) {
    fail("archive-sha256-mismatch");
  }

  let receipt;
  try {
    receipt = verifyControlCardNode(archive);
  } catch {
    fail("archive-domain-verification-failed");
  }
  if (!receipt.valid || !Object.values(receipt.checks).every(Boolean)) {
    fail("archive-profile-invalid");
  }
  if (receipt.authorKeyId !== CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID
    || receipt.capsuleId !== CONTROL_CARD_SAMPLE_CAPSULE_ID) {
    fail("archive-published-identity-mismatch");
  }

  // Keys are intentionally inserted in ASCII order, so this flat primitive
  // object serializes to the same exact JCS bytes as the fixture generator.
  const expectedMetadata = encoder.encode(JSON.stringify({
    archiveBytes: archive.byteLength,
    archiveSha256: CONTROL_CARD_SAMPLE_ARCHIVE_SHA256,
    authorKeyId: CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID,
    capsuleId: CONTROL_CARD_SAMPLE_CAPSULE_ID,
    corpusManifestSha256: CONTROL_CARD_CORPUS_MANIFEST_SHA256,
    corpusSha256: CONTROL_CARD_CORPUS_SHA256,
    fixtureKey: "public-rfc8032-test-vector-2-not-an-identity-or-issuer",
    manifestSha256: CONTROL_CARD_MANIFEST_SHA256,
    outcomesSha256: CONTROL_CARD_OUTCOMES_SHA256,
    schemaVersion: "runbook.synthetic-control-self-test-fixture.v0",
  }));
  if (!bytesEqual(metadata, expectedMetadata)) {
    fail("metadata-published-identity-mismatch");
  }

  const expectedDomainReceipt = serializeControlCardVerificationReceipt(receipt);
  if (!bytesEqual(domainReceipt, expectedDomainReceipt)) {
    fail("domain-receipt-mismatch");
  }

  return Object.freeze({ archive, domainReceipt, metadata });
}

async function readSourceAssets() {
  const [archive, domainReceipt, metadata] = await Promise.all([
    readFile(join(source, names.archive)),
    readFile(join(source, names.domainReceipt)),
    readFile(join(source, names.metadata)),
  ]);
  return { archive, domainReceipt, metadata };
}

function requireTamperFailure(label, assets, expectedCode) {
  try {
    verifyReleaseAssets(assets);
  } catch (error) {
    if (error instanceof Error && error.message === `control-card-assets.${expectedCode}`) {
      return;
    }
    throw error;
  }
  fail(`self-test-${label}-accepted`);
}

async function selfTest() {
  const valid = verifyReleaseAssets(await readSourceAssets());
  const archive = new Uint8Array(valid.archive);
  archive[archive.byteLength - 1] ^= 1;
  requireTamperFailure("archive-tamper", { ...valid, archive }, "archive-sha256-mismatch");

  const metadata = new Uint8Array(valid.metadata);
  metadata[0] ^= 1;
  requireTamperFailure("metadata-tamper", { ...valid, metadata }, "metadata-published-identity-mismatch");

  const domainReceipt = new Uint8Array(valid.domainReceipt);
  domainReceipt[0] ^= 1;
  requireTamperFailure("domain-receipt-tamper", { ...valid, domainReceipt }, "domain-receipt-mismatch");
}

const arguments_ = process.argv.slice(2);
if (arguments_.length === 1 && arguments_[0] === "--self-test") {
  await selfTest();
} else if (arguments_.length === 0) {
  const verified = verifyReleaseAssets(await readSourceAssets());
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(join(destination, names.archive), verified.archive),
    writeFile(join(destination, names.domainReceipt), verified.domainReceipt),
    writeFile(join(destination, names.metadata), verified.metadata),
  ]);
} else {
  fail("arguments-invalid");
}
