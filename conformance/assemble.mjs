#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url));
const FIXED_MIMETYPE = Buffer.from("application/vnd.runbook.proof+zip;version=1", "ascii");
const PAYLOAD_TYPE = "application/vnd.runbook.checkpoint+json;version=1";
const CAPSULE_ID_DOMAIN = Buffer.from("RUNBOOK_CHECKPOINT_ID_V1\0", "ascii");
const MEMBER_ORDER = Object.freeze([
  "mimetype",
  "runbook/manifest.json",
  "runbook/checkpoint.statement.json",
  "runbook/checkpoint.dsse.json",
  "runbook/author-key.spki.der",
  "payload/charter.json",
  "payload/claims.json",
  "payload/disclosures.json",
  "payload/events.ndjson",
  "payload/report.html",
]);
const CONTROL_PATHS = Object.freeze(MEMBER_ORDER.slice(0, 5));
const PAYLOAD_PATHS = Object.freeze(MEMBER_ORDER.slice(5));
const FIXED_LIMITATIONS = Object.freeze([
  "signature-does-not-prove-identity",
  "signature-does-not-prove-independent-time",
  "signature-does-not-prove-broker-issuance",
  "capsule-does-not-prove-execution",
  "capsule-does-not-prove-record-completeness",
  "capsule-does-not-prove-investment-skill",
  "capsule-does-not-prove-suitability-or-compliance",
]);
const FIXTURES = Object.freeze([
  {
    expectedDigestMismatches: [],
    name: "minimal-synthetic-root",
  },
  {
    expectedDigestMismatches: ["payload/charter.json"],
    name: "minimal-synthetic-root-payload-tampered",
  },
]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert(Number.isSafeInteger(value) && !Object.is(value, -0), "Control JSON contains a forbidden number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  assert(typeof value === "object", "Control JSON contains a non-JSON value.");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function parseCanonicalJson(bytes, label) {
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${label} has a UTF-8 BOM.`);
  const text = bytes.toString("utf8");
  assert(Buffer.from(text, "utf8").equals(bytes), `${label} is not strict UTF-8.`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assert(canonicalize(parsed) === text, `${label} is not exact JCS with no trailing bytes.`);
  return parsed;
}

function decodeProducerBase64(value, label) {
  assert(typeof value === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), `${label} is not padded standard Base64.`);
  const decoded = Buffer.from(value, "base64");
  assert(decoded.toString("base64") === value, `${label} is not canonical Base64.`);
  return decoded;
}

function assertObjectKeys(value, expected, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} has an unexpected field set.`);
}

function pae(payloadType, payload) {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType, "utf8")} ${payloadType} ${payload.length} `, "utf8"),
    payload,
  ]);
}

function listFiles(root) {
  const output = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const absolute = join(directory, entry.name);
      const status = lstatSync(absolute);
      assert(!status.isSymbolicLink(), `Symlink forbidden in corpus: ${relative(CONFORMANCE_DIR, absolute)}`);
      if (entry.isDirectory()) walk(absolute);
      else {
        assert(entry.isFile(), `Non-file forbidden in corpus: ${relative(CONFORMANCE_DIR, absolute)}`);
        output.push(absolute);
      }
    }
  }
  walk(root);
  return output;
}

function sourceMembers(fixture) {
  const root = join(CONFORMANCE_DIR, "sources", fixture.name);
  const discovered = listFiles(root).map((path) => relative(root, path).split(sep).join("/"));
  const expectedSet = [...MEMBER_ORDER].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  assert(JSON.stringify(discovered) === JSON.stringify(expectedSet), `${fixture.name} source tree does not contain exactly the frozen member set.`);
  return MEMBER_ORDER.map((path) => ({ bytes: readFileSync(join(root, ...path.split("/"))), path }));
}

function validateControlGraph(fixture, members) {
  const byPath = new Map(members.map((member) => [member.path, member.bytes]));
  assert(byPath.get("mimetype").equals(FIXED_MIMETYPE), `${fixture.name}: mimetype bytes differ.`);

  const manifestBytes = byPath.get("runbook/manifest.json");
  const statementBytes = byPath.get("runbook/checkpoint.statement.json");
  const envelopeBytes = byPath.get("runbook/checkpoint.dsse.json");
  const keyDer = byPath.get("runbook/author-key.spki.der");
  const manifest = parseCanonicalJson(manifestBytes, `${fixture.name} manifest`);
  const statement = parseCanonicalJson(statementBytes, `${fixture.name} statement`);
  const envelope = parseCanonicalJson(envelopeBytes, `${fixture.name} envelope`);

  assertObjectKeys(manifest, ["capsuleProfile", "experimentId", "lineage", "members", "schemaVersion"], `${fixture.name} manifest`);
  assertObjectKeys(manifest.lineage, ["parents", "relation"], `${fixture.name} manifest lineage`);
  assertObjectKeys(statement, ["assurancePolicy", "authorKeyId", "checkpointSequence", "createdAt", "dataClass", "eventChain", "experimentDigest", "proofScope", "schemaVersion"], `${fixture.name} statement`);
  assertObjectKeys(statement.eventChain, ["algorithm", "eventCount", "headHash"], `${fixture.name} event chain`);
  assertObjectKeys(statement.proofScope, ["brokerAttestation", "independentlyRecomputable", "privacy", "sourceCoverage", "underlyingRecordsIncluded"], `${fixture.name} proof scope`);
  assertObjectKeys(envelope, ["payload", "payloadType", "signatures"], `${fixture.name} envelope`);

  assert(keyDer.length === 44, `${fixture.name}: Ed25519 SPKI must be exactly 44 bytes.`);
  assert(keyDer.subarray(0, 12).equals(Buffer.from("302a300506032b6570032100", "hex")), `${fixture.name}: SPKI is not canonical Ed25519 DER.`);
  const authorKeyId = `sha256:${sha256(keyDer)}`;
  assert(statement.authorKeyId === authorKeyId, `${fixture.name}: statement authorKeyId mismatch.`);
  assert(statement.experimentDigest === sha256(manifestBytes), `${fixture.name}: statement does not bind exact manifest bytes.`);
  assert(statement.schemaVersion === "runbook.checkpoint.v1", `${fixture.name}: statement schema mismatch.`);
  assert(statement.assurancePolicy === "runbook.checkpoint-assurance.v1", `${fixture.name}: assurance policy mismatch.`);
  assert(statement.checkpointSequence === 1, `${fixture.name}: minimal checkpoint sequence must be one.`);
  assert(/^2026-07-21T20:00:00Z$/.test(statement.createdAt), `${fixture.name}: frozen author-declared timestamp mismatch.`);
  assert(statement.dataClass === "synthetic", `${fixture.name}: fixture must be visibly synthetic.`);
  assert(statement.eventChain?.algorithm === "runbook-jsonl-chain-v1", `${fixture.name}: event-chain algorithm mismatch.`);
  assert(statement.eventChain?.eventCount === 0, `${fixture.name}: minimal corpus ledger must be empty.`);
  assert(statement.eventChain?.headHash === "0".repeat(64), `${fixture.name}: empty ledger must use the genesis head.`);
  assert(statement.proofScope?.brokerAttestation === "absent", `${fixture.name}: broker attestation must be absent.`);
  assert(statement.proofScope?.independentlyRecomputable === false, `${fixture.name}: recomputability must be false.`);
  assert(statement.proofScope?.privacy === "metadata-only", `${fixture.name}: privacy scope mismatch.`);
  assert(statement.proofScope?.sourceCoverage === "author-declared", `${fixture.name}: source coverage mismatch.`);
  assert(statement.proofScope?.underlyingRecordsIncluded === false, `${fixture.name}: raw records must be absent.`);

  assert(envelope.payloadType === PAYLOAD_TYPE, `${fixture.name}: DSSE payload type mismatch.`);
  assert(Array.isArray(envelope.signatures) && envelope.signatures.length === 1, `${fixture.name}: v1 requires one signature.`);
  assertObjectKeys(envelope.signatures[0], ["keyid", "sig"], `${fixture.name} envelope signature`);
  const payload = decodeProducerBase64(envelope.payload, `${fixture.name} DSSE payload`);
  const signature = decodeProducerBase64(envelope.signatures[0]?.sig, `${fixture.name} DSSE signature`);
  assert(payload.equals(statementBytes), `${fixture.name}: DSSE payload differs from statement member.`);
  assert(envelope.signatures[0]?.keyid === authorKeyId, `${fixture.name}: DSSE keyid mismatch.`);
  assert(signature.length === 64, `${fixture.name}: Ed25519 signature must be 64 bytes.`);
  const publicKey = createPublicKey({ key: keyDer, format: "der", type: "spki" });
  assert(verifySignature(null, pae(PAYLOAD_TYPE, payload), publicKey, signature), `${fixture.name}: DSSE signature invalid.`);

  assert(manifest.capsuleProfile === "runbook.proof-capsule.v1", `${fixture.name}: manifest profile mismatch.`);
  assert(manifest.schemaVersion === "runbook.proof-manifest.v1", `${fixture.name}: manifest schema mismatch.`);
  assert(manifest.experimentId === "RUNBOOK-SYNTHETIC-CORPUS-001", `${fixture.name}: frozen experiment ID mismatch.`);
  assert(manifest.lineage?.relation === "root" && Array.isArray(manifest.lineage.parents) && manifest.lineage.parents.length === 0, `${fixture.name}: fixture must be a signed root.`);
  assert(Array.isArray(manifest.members) && manifest.members.length === PAYLOAD_PATHS.length, `${fixture.name}: manifest member count mismatch.`);

  const mismatches = [];
  const expectedRoles = ["charter", "claims", "disclosures", "events", "report"];
  const expectedMediaTypes = ["application/json", "application/json", "application/json", "application/x-ndjson", "text/html;charset=utf-8"];
  for (let index = 0; index < PAYLOAD_PATHS.length; index += 1) {
    const path = PAYLOAD_PATHS[index];
    const declaration = manifest.members[index];
    const bytes = byPath.get(path);
    assertObjectKeys(declaration, ["bytes", "mediaType", "path", "role", "sha256"], `${fixture.name} manifest member ${index}`);
    assert(declaration?.path === path, `${fixture.name}: manifest path order mismatch at ${path}.`);
    assert(declaration.role === expectedRoles[index], `${fixture.name}: manifest role mismatch at ${path}.`);
    assert(declaration.mediaType === expectedMediaTypes[index], `${fixture.name}: manifest media type mismatch at ${path}.`);
    assert(declaration.bytes === bytes.length, `${fixture.name}: manifest byte count mismatch at ${path}.`);
    assert(typeof declaration.sha256 === "string" && /^[a-f0-9]{64}$/.test(declaration.sha256), `${fixture.name}: malformed manifest digest at ${path}.`);
    if (declaration.sha256 !== sha256(bytes)) mismatches.push(path);
  }
  assert(JSON.stringify(mismatches) === JSON.stringify(fixture.expectedDigestMismatches), `${fixture.name}: unexpected payload digest result: ${mismatches.join(", ") || "none"}.`);

  return {
    authorKeyId,
    capsuleId: sha256(Buffer.concat([CAPSULE_ID_DOMAIN, statementBytes])),
    mismatches,
  };
}

function assertOneByteMutation(rootMembers, tamperedMembers) {
  let differences = 0;
  let changedPath = null;
  let changedOffset = null;
  let before = null;
  let after = null;
  for (let memberIndex = 0; memberIndex < rootMembers.length; memberIndex += 1) {
    const left = rootMembers[memberIndex];
    const right = tamperedMembers[memberIndex];
    assert(left.path === right.path && left.bytes.length === right.bytes.length, "Mutation fixture changed a path or member length.");
    for (let offset = 0; offset < left.bytes.length; offset += 1) {
      if (left.bytes[offset] !== right.bytes[offset]) {
        differences += 1;
        changedPath = left.path;
        changedOffset = offset;
        before = left.bytes[offset];
        after = right.bytes[offset];
      }
    }
  }
  assert(differences === 1, `Mutation fixture must differ by exactly one source byte; found ${differences}.`);
  assert(changedPath === "payload/charter.json" && changedOffset === 22 && before === 0x63 && after === 0x78, "Mutation fixture is not the frozen charter c-to-x mutation at byte 22.");
}

function assembleArchive(members) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const member of members) {
    const name = Buffer.from(member.path, "ascii");
    const checksum = crc32(member.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0x0000, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(member.bytes.length, 18);
    local.writeUInt32LE(member.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, member.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0x0000, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(member.bytes.length, 20);
    central.writeUInt32LE(member.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0x81a40000, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);

    localOffset += local.length + name.length + member.bytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function inspectArchive(archive, members, label) {
  let cursor = 0;
  const localOffsets = [];
  const expectedNames = members.map((member) => Buffer.from(member.path, "ascii"));
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const name = expectedNames[index];
    localOffsets.push(cursor);
    assert(archive.readUInt32LE(cursor) === 0x04034b50, `${label}: bad local signature ${index}.`);
    assert(archive.readUInt16LE(cursor + 4) === 20, `${label}: bad local version-needed.`);
    assert(archive.readUInt16LE(cursor + 6) === 0x0800, `${label}: bad local flags.`);
    assert(archive.readUInt16LE(cursor + 8) === 0, `${label}: local member is not STORED.`);
    assert(archive.readUInt16LE(cursor + 10) === 0 && archive.readUInt16LE(cursor + 12) === 0x0021, `${label}: local timestamp differs.`);
    assert(archive.readUInt32LE(cursor + 14) === crc32(member.bytes), `${label}: local CRC differs.`);
    assert(archive.readUInt32LE(cursor + 18) === member.bytes.length && archive.readUInt32LE(cursor + 22) === member.bytes.length, `${label}: local sizes differ.`);
    assert(archive.readUInt16LE(cursor + 26) === name.length && archive.readUInt16LE(cursor + 28) === 0, `${label}: local name/extra lengths differ.`);
    cursor += 30;
    assert(archive.subarray(cursor, cursor + name.length).equals(name), `${label}: local name differs.`);
    cursor += name.length;
    assert(archive.subarray(cursor, cursor + member.bytes.length).equals(member.bytes), `${label}: stored member bytes differ.`);
    cursor += member.bytes.length;
  }

  const centralOffset = cursor;
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const name = expectedNames[index];
    assert(archive.readUInt32LE(cursor) === 0x02014b50, `${label}: bad central signature ${index}.`);
    assert(archive.readUInt16LE(cursor + 4) === 0x0314 && archive.readUInt16LE(cursor + 6) === 20, `${label}: central versions differ.`);
    assert(archive.readUInt16LE(cursor + 8) === 0x0800 && archive.readUInt16LE(cursor + 10) === 0, `${label}: central flags/method differ.`);
    assert(archive.readUInt16LE(cursor + 12) === 0 && archive.readUInt16LE(cursor + 14) === 0x0021, `${label}: central timestamp differs.`);
    assert(archive.readUInt32LE(cursor + 16) === crc32(member.bytes), `${label}: central CRC differs.`);
    assert(archive.readUInt32LE(cursor + 20) === member.bytes.length && archive.readUInt32LE(cursor + 24) === member.bytes.length, `${label}: central sizes differ.`);
    assert(archive.readUInt16LE(cursor + 28) === name.length, `${label}: central name length differs.`);
    assert(archive.readUInt16LE(cursor + 30) === 0 && archive.readUInt16LE(cursor + 32) === 0, `${label}: central extra/comment forbidden.`);
    assert(archive.readUInt16LE(cursor + 34) === 0 && archive.readUInt16LE(cursor + 36) === 0, `${label}: central disk/internal attrs differ.`);
    assert(archive.readUInt32LE(cursor + 38) === 0x81a40000, `${label}: central external attrs differ.`);
    assert(archive.readUInt32LE(cursor + 42) === localOffsets[index], `${label}: central local offset differs.`);
    cursor += 46;
    assert(archive.subarray(cursor, cursor + name.length).equals(name), `${label}: central name differs.`);
    cursor += name.length;
  }

  const centralSize = cursor - centralOffset;
  assert(archive.length - cursor === 22, `${label}: EOCD must be exactly 22 bytes at EOF.`);
  assert(archive.readUInt32LE(cursor) === 0x06054b50, `${label}: bad EOCD signature.`);
  assert(archive.readUInt16LE(cursor + 4) === 0 && archive.readUInt16LE(cursor + 6) === 0, `${label}: multi-disk EOCD forbidden.`);
  assert(archive.readUInt16LE(cursor + 8) === members.length && archive.readUInt16LE(cursor + 10) === members.length, `${label}: EOCD entry counts differ.`);
  assert(archive.readUInt32LE(cursor + 12) === centralSize && archive.readUInt32LE(cursor + 16) === centralOffset, `${label}: EOCD directory range differs.`);
  assert(archive.readUInt16LE(cursor + 20) === 0, `${label}: EOCD comment forbidden.`);
}

function expectedReceipt(result) {
  const valid = result.controls.mismatches.length === 0;
  return {
    assurance: {
      authorContinuity: "not-evaluated",
      authorIdentity: "self-asserted-key",
      authorSignature: "valid",
      brokerExecution: "not-evaluated",
      brokerIssuance: "not-evaluated",
      eventChain: valid ? "author-signed-commitment-only" : "not-evaluated",
      independentTime: valid ? "absent" : "not-evaluated",
      investmentSkill: "not-evaluated",
      packageIntegrity: valid ? "valid" : "invalid",
      recordCompleteness: "not-evaluated",
      sourceCoverage: valid ? "author-declared-metadata-only" : "not-evaluated",
      suitabilityOrCompliance: "not-evaluated",
      transportProfile: "valid",
    },
    authorKeyId: result.controls.authorKeyId,
    capsuleId: result.controls.capsuleId,
    errors: valid ? [] : [{ code: "manifest.member-digest-mismatch", path: "payload/charter.json" }],
    limitations: [...FIXED_LIMITATIONS],
    lineage: { parents: [], relation: "root", status: "root" },
    members: result.members.map((member) => ({
      bytes: member.bytes.length,
      path: member.path,
      sha256: sha256(member.bytes),
      status: valid || member.path !== "payload/charter.json" ? "valid" : "invalid",
    })),
    schemaVersion: "runbook.proof-verification.v1",
    valid,
    verifierProfile: "runbook.proof-capsule.v1",
    warnings: [],
  };
}

function verifyReceiptOracle(result, entry) {
  const expectedPath = `expected/${result.fixture.name}.receipt.json`;
  assert(entry.receiptPath === expectedPath, `${entry.name}: receipt path mismatch.`);
  const bytes = readFileSync(join(CONFORMANCE_DIR, ...expectedPath.split("/")));
  const receipt = parseCanonicalJson(bytes, `${entry.name} expected receipt`);
  assert(entry.receiptBytes === bytes.length, `${entry.name}: receipt byte count mismatch.`);
  assert(entry.receiptSha256 === sha256(bytes), `${entry.name}: receipt digest mismatch.`);
  assert(canonicalize(receipt) === canonicalize(expectedReceipt(result)), `${entry.name}: full expected receipt differs from the independently derived corpus outcome.`);
}

function verifyIndex(results) {
  const path = join(CONFORMANCE_DIR, "corpus-index.v1.json");
  const bytes = readFileSync(path);
  const index = parseCanonicalJson(bytes, "corpus index");
  assert(index.schemaVersion === "runbook.proof-corpus-index.v1", "Corpus index schema mismatch.");
  assert(index.corpusProfile === "runbook.proof-capsule.v1", "Corpus index capsule profile mismatch.");
  assert(Array.isArray(index.fixtures) && index.fixtures.length === results.length, "Corpus index fixture count mismatch.");
  for (let position = 0; position < results.length; position += 1) {
    const result = results[position];
    const entry = index.fixtures[position];
    assert(entry.name === result.fixture.name, `Corpus index order/name mismatch at ${position}.`);
    assert(entry.path === `fixtures/${result.fixture.name}.runbook`, `${entry.name}: index path mismatch.`);
    assert(entry.sourcePath === `sources/${result.fixture.name}`, `${entry.name}: source path mismatch.`);
    assert(entry.archiveBytes === result.archive.length && entry.archiveSha256 === sha256(result.archive), `${entry.name}: index archive metadata mismatch.`);
    assert(entry.capsuleId === result.controls.capsuleId && entry.authorKeyId === result.controls.authorKeyId, `${entry.name}: index identity metadata mismatch.`);
    verifyReceiptOracle(result, entry);
    const expectedValid = result.controls.mismatches.length === 0;
    assert(entry.expected?.valid === expectedValid, `${entry.name}: expected validity mismatch.`);
    assert(entry.expected?.transportProfile === "valid" && entry.expected?.authorSignature === "valid", `${entry.name}: transport/signature expectation mismatch.`);
    assert(entry.expected?.authorIdentity === "self-asserted-key", `${entry.name}: embedded key must remain explicitly self-asserted.`);
    assert(entry.expected?.packageIntegrity === (expectedValid ? "valid" : "invalid"), `${entry.name}: package-integrity expectation mismatch.`);
    const expectedCodes = expectedValid ? [] : ["manifest.member-digest-mismatch"];
    assert(JSON.stringify(entry.expected?.errorCodes) === JSON.stringify(expectedCodes), `${entry.name}: expected error-code mismatch.`);
    if (expectedValid) {
      assert(entry.mutation === undefined && entry.controlsIdenticalTo === undefined, `${entry.name}: valid root must not declare a mutation parent.`);
    } else {
      assert(entry.controlsIdenticalTo === "minimal-synthetic-root", `${entry.name}: signed-control identity declaration mismatch.`);
      assert(canonicalize(entry.mutation) === canonicalize({ afterHex: "78", beforeHex: "63", byteOffset: 22, path: "payload/charter.json" }), `${entry.name}: mutation descriptor mismatch.`);
    }
  }
}

function verifyChecksums() {
  const checksumPath = join(CONFORMANCE_DIR, "SHA256SUMS");
  const lines = readFileSync(checksumPath, "utf8").split("\n");
  assert(lines.at(-1) === "", "SHA256SUMS must end with one LF.");
  lines.pop();
  const expectedPaths = listFiles(CONFORMANCE_DIR)
    .map((path) => relative(CONFORMANCE_DIR, path).split(sep).join("/"))
    .filter((path) => path !== "SHA256SUMS")
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const listedPaths = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    assert(match, `Malformed SHA256SUMS line: ${line}`);
    const [, expected, relativePath] = match;
    assert(!relativePath.startsWith("/") && !relativePath.split("/").includes(".."), `Unsafe checksum path: ${relativePath}`);
    const absolute = resolve(CONFORMANCE_DIR, relativePath);
    assert(absolute.startsWith(`${CONFORMANCE_DIR}${sep}`), `Checksum path escapes corpus: ${relativePath}`);
    listedPaths.push(relativePath);
    assert(sha256(readFileSync(absolute)) === expected, `Checksum mismatch: ${relativePath}`);
  }
  assert(JSON.stringify(listedPaths) === JSON.stringify(expectedPaths), "SHA256SUMS does not cover every corpus file exactly once in ASCII order.");
}

function main() {
  const mode = process.argv[2] ?? "--check";
  assert(["--check", "--write"].includes(mode) && process.argv.length <= 3, "Usage: node conformance/assemble.mjs [--check|--write]");

  const prepared = FIXTURES.map((fixture) => {
    const members = sourceMembers(fixture);
    const controls = validateControlGraph(fixture, members);
    const archive = assembleArchive(members);
    inspectArchive(archive, members, fixture.name);
    return { archive, controls, fixture, members };
  });
  assertOneByteMutation(prepared[0].members, prepared[1].members);
  for (const controlPath of CONTROL_PATHS) {
    const first = prepared[0].members.find((member) => member.path === controlPath).bytes;
    const second = prepared[1].members.find((member) => member.path === controlPath).bytes;
    assert(first.equals(second), `Tampered fixture changed signed control ${controlPath}.`);
  }

  for (const result of prepared) {
    const outputPath = join(CONFORMANCE_DIR, "fixtures", `${result.fixture.name}.runbook`);
    if (mode === "--write") {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, result.archive);
    } else {
      assert(readFileSync(outputPath).equals(result.archive), `${result.fixture.name}: committed archive is not reproducible from sources.`);
    }
  }

  verifyIndex(prepared);
  verifyChecksums();
  process.stdout.write(`ok: ${prepared.length} deterministic archives, exact ZIP profile, signed control graph, one-byte mutation, index, and checksums\n`);
}

main();
