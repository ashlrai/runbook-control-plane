import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RUNBOOK_CAPSULE_MEDIA_TYPE,
  serializeProofVerificationReceipt,
  verifyProofCapsule,
} from "./index.js";
import { ZIP_PROFILE_CONSTANTS, crc32 } from "./zip.js";

const KEY_ID = "sha256:06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9";
const PUBLIC_KEY = Buffer.from("MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=", "base64");
const MANIFEST_SHA = "acd7a75e66cacdd2efca720b05bb281063844fd1c917e8cd412421cfbcf2f7dd";
const CAPSULE_ID = "d7fd740267665c9b40f6c35a661d364b65ca2b85b2571de25487f33b714b001b";

const PAYLOADS = new Map<string, Buffer>([
  ["payload/charter.json", Buffer.from('{"capitalAtRiskUsd":"0","mode":"synthetic","schemaVersion":"runbook.charter.fixture.v1"}')],
  ["payload/claims.json", Buffer.from('{"claims":[],"schemaVersion":"runbook.claims.fixture.v1"}')],
  ["payload/disclosures.json", Buffer.from('{"disclosures":["synthetic-fixture-not-investment-advice"],"schemaVersion":"runbook.disclosures.fixture.v1"}')],
  ["payload/events.ndjson", Buffer.from('{"event":"fixture-created","sequence":1}\n')],
  ["payload/report.html", Buffer.from('<!doctype html><meta charset="utf-8"><title>Synthetic fixture</title><p>No returns or brokerage activity.</p>')],
]);
const MANIFEST = Buffer.from('{"capsuleProfile":"runbook.proof-capsule.v1","experimentId":"EXP-SYNTHETIC-001","lineage":{"parents":[],"relation":"root"},"members":[{"bytes":88,"mediaType":"application/json","path":"payload/charter.json","role":"charter","sha256":"171bbc540d464c836dd2411c1777c218f18a019a2d470e3e1778f46db92f1a15"},{"bytes":57,"mediaType":"application/json","path":"payload/claims.json","role":"claims","sha256":"00d119d975703ecc5c70f41f4ba6c5fbb4ef7788747e0588a796c3a7db4c7757"},{"bytes":108,"mediaType":"application/json","path":"payload/disclosures.json","role":"disclosures","sha256":"3d204c82dfee69ca28136e731c7fa2151eed9f57bdcada84854a1e1c908451b8"},{"bytes":41,"mediaType":"application/x-ndjson","path":"payload/events.ndjson","role":"events","sha256":"b86fcb6adf58a32c74c929c16dd73fe7e16b3b15933396e4a92a463fee1e0576"},{"bytes":109,"mediaType":"text/html;charset=utf-8","path":"payload/report.html","role":"report","sha256":"8c3a9f27f0bf7ea86cfadeb56457db0033f76f07b467e8210c9503b92789aa16"}],"schemaVersion":"runbook.proof-manifest.v1"}');
const STATEMENT = Buffer.from('{"assurancePolicy":"runbook.checkpoint-assurance.v1","authorKeyId":"sha256:06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9","checkpointSequence":1,"createdAt":"2026-07-21T18:00:00.000Z","dataClass":"synthetic","eventChain":{"algorithm":"runbook-jsonl-chain-v1","eventCount":1,"headHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"experimentDigest":"acd7a75e66cacdd2efca720b05bb281063844fd1c917e8cd412421cfbcf2f7dd","proofScope":{"brokerAttestation":"absent","independentlyRecomputable":false,"privacy":"metadata-only","sourceCoverage":"author-declared","underlyingRecordsIncluded":false},"schemaVersion":"runbook.checkpoint.v1"}');
const SIGNATURE = "jQAO3Iz4bvyJ8/ouD9FZ5y9Vz3O6c9w2WljrZSNk6UHhF6L/hF3iRDnbzISWQsxOAUxNkhonvCjACJH5u2NmCQ==";
const ENVELOPE_VALUE = {
  payload: STATEMENT.toString("base64"),
  payloadType: "application/vnd.runbook.checkpoint+json;version=1",
  signatures: [{ keyid: KEY_ID, sig: SIGNATURE }],
};
const ENVELOPE = Buffer.from(JSON.stringify(ENVELOPE_VALUE));

type TestEntry = { name: string; data: Buffer; method?: number; flags?: number; version?: number; versionMadeBy?: number; dosTime?: number; dosDate?: number; externalAttributes?: number };

function zip(entries: TestEntry[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.version ?? ZIP_PROFILE_CONSTANTS.version, 4);
    local.writeUInt16LE(entry.flags ?? ZIP_PROFILE_CONSTANTS.flags, 6);
    local.writeUInt16LE(entry.method ?? 0, 8);
    local.writeUInt16LE(entry.dosTime ?? ZIP_PROFILE_CONSTANTS.dosTime, 10);
    local.writeUInt16LE(entry.dosDate ?? ZIP_PROFILE_CONSTANTS.dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.versionMadeBy ?? ZIP_PROFILE_CONSTANTS.versionMadeBy, 4);
    central.writeUInt16LE(entry.version ?? ZIP_PROFILE_CONSTANTS.version, 6);
    central.writeUInt16LE(entry.flags ?? ZIP_PROFILE_CONSTANTS.flags, 8);
    central.writeUInt16LE(entry.method ?? 0, 10);
    central.writeUInt16LE(entry.dosTime ?? ZIP_PROFILE_CONSTANTS.dosTime, 12);
    central.writeUInt16LE(entry.dosDate ?? ZIP_PROFILE_CONSTANTS.dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? ZIP_PROFILE_CONSTANTS.externalAttributes, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, entry.data);
    centrals.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

function fixtureEntries(): TestEntry[] {
  return [
    { name: "mimetype", data: Buffer.from(RUNBOOK_CAPSULE_MEDIA_TYPE) },
    { name: "runbook/manifest.json", data: MANIFEST },
    { name: "runbook/checkpoint.statement.json", data: STATEMENT },
    { name: "runbook/checkpoint.dsse.json", data: ENVELOPE },
    { name: "runbook/author-key.spki.der", data: PUBLIC_KEY },
    ...[...PAYLOADS].map(([name, data]) => ({ name, data })),
  ];
}

function errors(bytes: Buffer) {
  return verifyProofCapsule(bytes).errors.map((issue) => issue.code);
}

function centralOffset(bytes: Buffer) {
  return bytes.readUInt32LE(bytes.length - 22 + 16);
}

function secondCentralOffset(bytes: Buffer) {
  const first = centralOffset(bytes);
  return first + 46 + bytes.readUInt16LE(first + 28);
}

describe("verifyProofCapsule", () => {
  it("verifies the immutable synthetic root fixture with exact assurance limits", () => {
    expect(PUBLIC_KEY).toHaveLength(44);
    expect(createHash("sha256").update(MANIFEST).digest("hex")).toBe(MANIFEST_SHA);
    const result = verifyProofCapsule(zip(fixtureEntries()));
    expect(result.valid).toBe(true);
    expect(result.capsuleId).toBe(CAPSULE_ID);
    expect(result.authorKeyId).toBe(KEY_ID);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.lineage).toEqual({ parents: [], relation: "root", status: "root" });
    expect(result.assurance).toEqual({
      authorContinuity: "not-evaluated", authorIdentity: "self-asserted-key", authorSignature: "valid",
      brokerExecution: "not-evaluated", brokerIssuance: "not-evaluated", eventChain: "author-signed-commitment-only",
      independentTime: "absent", investmentSkill: "not-evaluated", packageIntegrity: "valid",
      recordCompleteness: "not-evaluated", sourceCoverage: "author-declared-metadata-only",
      suitabilityOrCompliance: "not-evaluated", transportProfile: "valid",
    });
    expect(result.limitations).toHaveLength(7);
    expect(result.members.every((member) => member.status === "valid")).toBe(true);
  });

  it("emits repeatable JCS receipt bytes independent of object insertion order", () => {
    const result = verifyProofCapsule(zip(fixtureEntries()));
    const first = serializeProofVerificationReceipt(result);
    const second = serializeProofVerificationReceipt(result);
    expect(first.equals(second)).toBe(true);
    expect(first.toString()).toBe(JSON.stringify(JSON.parse(first.toString())));
    expect(first.toString().startsWith('{"assurance":')).toBe(true);
    expect(first.toString()).toContain('"members":[{"bytes":43,"path":"mimetype","sha256":');
  });

  it("does not consult locale collation while ordering issues", () => {
    const entries = fixtureEntries();
    entries[5] = { ...entries[5]!, data: Buffer.from(`${entries[5]!.data.toString()} `) };
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => { throw new Error("locale collation consulted"); };
    let result;
    try {
      result = verifyProofCapsule(zip(entries));
    } finally {
      String.prototype.localeCompare = original;
    }
    expect(result.errors.map((issue) => issue.code)).toEqual([
      "manifest.member-digest-mismatch",
      "manifest.member-size-mismatch",
    ]);
  });

  it("rejects DEFLATE and any nonzero compression method", () => {
    for (const method of [8, 99]) {
      const entries = fixtureEntries();
      entries[1] = { ...entries[1]!, method };
      expect(errors(zip(entries))).toContain("zip.compression-forbidden");
    }
  });

  it("rejects unsupported deterministic ZIP field values", () => {
    for (const mutation of [
      { version: 19 }, { versionMadeBy: 20 }, { dosTime: 1 }, { dosDate: 0 }, { externalAttributes: 0 }, { flags: 0 },
    ]) {
      const entries = fixtureEntries();
      entries[1] = { ...entries[1]!, ...mutation };
      expect(errors(zip(entries))).toContain("zip.field-unsupported");
    }
  });

  it("distinguishes encryption and data descriptors", () => {
    const encrypted = fixtureEntries();
    encrypted[1] = { ...encrypted[1]!, flags: ZIP_PROFILE_CONSTANTS.flags | 1 };
    const descriptor = fixtureEntries();
    descriptor[1] = { ...descriptor[1]!, flags: ZIP_PROFILE_CONSTANTS.flags | 8 };
    expect(errors(zip(encrypted))).toContain("zip.encryption-forbidden");
    expect(errors(zip(descriptor))).toContain("zip.data-descriptor-forbidden");
  });

  it("rejects extra fields, archive comments, multidisk, and ZIP64 sentinels", () => {
    const extra = zip(fixtureEntries());
    extra.writeUInt16LE(1, centralOffset(extra) + 30);
    const commented = Buffer.concat([zip(fixtureEntries()), Buffer.from("x")]);
    commented.writeUInt16LE(1, commented.length - 3);
    const multidisk = zip(fixtureEntries());
    multidisk.writeUInt16LE(1, multidisk.length - 22 + 4);
    const zip64 = zip(fixtureEntries());
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 8);
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
    expect(errors(extra)).toContain("zip.extra-field-forbidden");
    expect(errors(commented)).toContain("zip.comment-forbidden");
    expect(errors(multidisk)).toContain("zip.multidisk-forbidden");
    expect(errors(zip64)).toContain("zip.zip64-forbidden");
  });

  it("requires exact control order and sorted payload order", () => {
    const wrongFirst = fixtureEntries();
    [wrongFirst[0], wrongFirst[1]] = [wrongFirst[1]!, wrongFirst[0]!];
    const payloadOrder = fixtureEntries();
    [payloadOrder[5], payloadOrder[6]] = [payloadOrder[6]!, payloadOrder[5]!];
    expect(errors(zip(wrongFirst))).toContain("control.member-missing");
    expect(errors(zip(payloadOrder))).toContain("zip.order-invalid");
  });

  it("requires the exact mimetype and exact 44-byte public key", () => {
    const mime = fixtureEntries();
    mime[0] = { ...mime[0]!, data: Buffer.from("x".repeat(43)) };
    const highBitMime = fixtureEntries();
    const highBitData = Buffer.from(highBitMime[0]!.data);
    highBitData[0] = (highBitData[0] as number) | 0x80;
    highBitMime[0] = { ...highBitMime[0]!, data: highBitData };
    const key = fixtureEntries();
    key[4] = { ...key[4]!, data: PUBLIC_KEY.subarray(0, 43) };
    expect(errors(zip(mime))).toContain("control.mimetype-invalid");
    expect(errors(zip(highBitMime))).toContain("control.mimetype-invalid");
    expect(errors(zip(key))).toContain("key.invalid");
  });

  it("rejects malformed DSSE key IDs at the envelope schema boundary", () => {
    const entries = fixtureEntries();
    entries[3] = {
      ...entries[3]!,
      data: Buffer.from(JSON.stringify({
        ...ENVELOPE_VALUE,
        signatures: [{ ...ENVELOPE_VALUE.signatures[0], keyid: `${KEY_ID.slice(0, -1)}x` }],
      })),
    };
    const result = verifyProofCapsule(zip(entries));
    expect(result.authorKeyId).toBeNull();
    expect(result.errors).toEqual([{ code: "envelope.schema-invalid", path: "runbook/checkpoint.dsse.json" }]);
  });

  it("rejects hostile paths and non-ASCII paths without extraction", () => {
    for (const path of ["../x", "/payload/x", "payload/../x", "payload\\x", "payload/%2e%2e/x", "payload/UPPER.json", "payload/é.json", "payload//x"] as const) {
      const entries = fixtureEntries();
      entries.push({ name: path, data: Buffer.from("x") });
      expect(errors(zip(entries))).toContain("zip.path-invalid");
    }
  });

  it("does not mask a high-bit path byte into a false ASCII duplicate", () => {
    const archive = zip([
      ...fixtureEntries(),
      { name: "payload/a", data: Buffer.from("a") },
      { name: "payload/b", data: Buffer.from("b") },
    ]);
    const marker = Buffer.from("payload/b", "ascii");
    let cursor = 0;
    let replacements = 0;
    while ((cursor = archive.indexOf(marker, cursor)) >= 0) {
      archive[cursor + marker.length - 1] = 0xe1;
      replacements += 1;
      cursor += marker.length;
    }
    expect(replacements).toBe(2);
    expect(errors(archive)).toEqual(["zip.path-invalid"]);
  });

  it("rejects duplicate member names", () => {
    const entries = [...fixtureEntries(), { ...fixtureEntries()[9]! }];
    expect(errors(zip(entries))).toContain("zip.path-duplicate");
  });

  it("distinguishes case collisions and undeclared controls", () => {
    const collision = [...fixtureEntries(), { name: "PAYLOAD/REPORT.HTML", data: Buffer.from("x") }];
    const control = [...fixtureEntries(), { name: "runbook/extra.json", data: Buffer.from("{}") }];
    expect(errors(zip(collision))).toContain("zip.path-case-collision");
    expect(errors(zip(control))).toContain("control.member-extra");
  });

  it("rejects undeclared and missing payload members", () => {
    const extra = [...fixtureEntries(), { name: "payload/z.json", data: Buffer.from("{}") }];
    const missing = fixtureEntries().filter((entry) => entry.name !== "payload/report.html");
    expect(errors(zip(extra))).toContain("manifest.member-set-mismatch");
    expect(errors(zip(missing))).toContain("manifest.member-set-mismatch");
  });

  it("rejects noncanonical manifest and statement bytes before trust", () => {
    const manifest = fixtureEntries();
    manifest[1] = { ...manifest[1]!, data: Buffer.from(` ${MANIFEST.toString()}`) };
    const statement = fixtureEntries();
    statement[2] = { ...statement[2]!, data: Buffer.from(`${STATEMENT.toString()}\n`) };
    expect(errors(zip(manifest))).toContain("manifest.noncanonical-json");
    expect(errors(zip(statement))).toContain("statement.noncanonical-json");
  });

  it("rejects duplicate keys in security-critical JSON", () => {
    const entries = fixtureEntries();
    entries[1] = { ...entries[1]!, data: Buffer.from(MANIFEST.toString().replace('{"capsuleProfile":', '{"capsuleProfile":"runbook.proof-capsule.v1","capsuleProfile":')) };
    expect(errors(zip(entries))).toContain("manifest.duplicate-key");
  });

  it("rejects credential-shaped signed fields as schema-invalid", () => {
    const entries = fixtureEntries();
    entries[2] = { ...entries[2]!, data: Buffer.from(STATEMENT.toString().replace('{"assurancePolicy":', '{"apiKey":"forbidden","assurancePolicy":')) };
    expect(errors(zip(entries))).toContain("statement.schema-invalid");
  });

  it("accepts bounded unknown DSSE fields with a deterministic warning", () => {
    const entries = fixtureEntries();
    entries[3] = { ...entries[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, extension: { inert: true } })) };
    const result = verifyProofCapsule(zip(entries));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([{ code: "envelope.ignored-extension", path: "runbook/checkpoint.dsse.json" }]);
  });

  it("accepts 32,768-code-unit ordinary envelope strings and rejects 32,769", () => {
    const atLimit = fixtureEntries();
    atLimit[3] = { ...atLimit[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, extension: "x".repeat(32_768) })) };
    const overLimit = fixtureEntries();
    overLimit[3] = { ...overLimit[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, extension: "x".repeat(32_769) })) };
    const accepted = verifyProofCapsule(zip(atLimit));
    expect(accepted.valid).toBe(true);
    expect(accepted.warnings).toEqual([{ code: "envelope.ignored-extension", path: "runbook/checkpoint.dsse.json" }]);
    expect(errors(zip(overLimit))).toContain("envelope.invalid-json");
  });

  it("does not grant the top-level payload exception to nested payload fields", () => {
    const entries = fixtureEntries();
    entries[3] = {
      ...entries[3]!,
      data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, extension: { payload: "x".repeat(32_769) } })),
    };
    expect(errors(zip(entries))).toContain("envelope.invalid-json");
  });

  it("accepts the 87,384-character top-level payload parser boundary and rejects 87,385", () => {
    const atLimitPayload = Buffer.alloc(65_536).toString("base64");
    const atLimit = fixtureEntries();
    atLimit[3] = { ...atLimit[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, payload: atLimitPayload })) };
    const overLimit = fixtureEntries();
    overLimit[3] = { ...overLimit[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, payload: "A".repeat(87_385) })) };
    expect(atLimitPayload).toHaveLength(87_384);
    expect(errors(zip(atLimit))).toContain("payload.byte-mismatch");
    expect(errors(zip(overLimit))).toContain("envelope.invalid-json");
  });

  it("rejects decoded payload overflow within the encoded string ceiling", () => {
    const entries = fixtureEntries();
    entries[3] = { ...entries[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, payload: "A".repeat(87_384) })) };
    expect(errors(zip(entries))).toContain("payload.base64-invalid");
  });

  it("rejects DSSE payload-type replay and payload-byte substitution", () => {
    const type = fixtureEntries();
    type[3] = { ...type[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, payloadType: "application/json" })) };
    const payload = fixtureEntries();
    payload[3] = { ...payload[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, payload: Buffer.from("{}").toString("base64") })) };
    expect(errors(zip(type))).toContain("payload.type-unsupported");
    expect(errors(zip(payload))).toContain("payload.byte-mismatch");
  });

  it("rejects malformed Base64 and signature mutation", () => {
    const base64 = fixtureEntries();
    base64[3] = { ...base64[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, payload: "a+_b" })) };
    const signature = fixtureEntries();
    signature[3] = { ...signature[3]!, data: Buffer.from(JSON.stringify({ ...ENVELOPE_VALUE, signatures: [{ keyid: KEY_ID, sig: Buffer.alloc(64).toString("base64") }] })) };
    expect(errors(zip(base64))).toContain("payload.base64-invalid");
    expect(errors(zip(signature))).toContain("signature.invalid");
  });

  it("keeps a valid author signature separate from a changed manifest", () => {
    const entries = fixtureEntries();
    entries[1] = { ...entries[1]!, data: Buffer.from(MANIFEST.toString().replace("EXP-SYNTHETIC-001", "EXP-SYNTHETIC-002")) };
    const result = verifyProofCapsule(zip(entries));
    expect(result.assurance.authorSignature).toBe("valid");
    expect(result.assurance.packageIntegrity).toBe("invalid");
    expect(result.errors.map((issue) => issue.code)).toContain("statement.manifest-digest-mismatch");
  });

  it("detects exact payload size and digest mismatches", () => {
    const value = JSON.parse(MANIFEST.toString()) as { members: Array<{ path: string; bytes: number; sha256: string }> };
    value.members[0]!.bytes -= 1;
    value.members[1]!.sha256 = "0".repeat(64);
    const entries = fixtureEntries();
    entries[1] = { ...entries[1]!, data: Buffer.from(jcs(value)) };
    const statement = JSON.parse(STATEMENT.toString()) as Record<string, unknown>;
    statement.experimentDigest = createHash("sha256").update(entries[1]!.data).digest("hex");
    entries[2] = { ...entries[2]!, data: Buffer.from(jcs(statement)) };
    // This intentionally keeps the old signature, so signature binding fails before member claims are trusted.
    expect(errors(zip(entries))).toContain("payload.byte-mismatch");

    const changedPayload = fixtureEntries();
    changedPayload[5] = { ...changedPayload[5]!, data: Buffer.from(`${changedPayload[5]!.data.toString()} `) };
    expect(errors(zip(changedPayload))).toContain("manifest.member-size-mismatch");
    expect(errors(zip(changedPayload))).toContain("manifest.member-digest-mismatch");
  });

  it("rejects CRC corruption, central/local disagreement, overlaps, prefixes, and suffixes", () => {
    const valid = zip(fixtureEntries());
    const crc = Buffer.from(valid);
    crc[30 + Buffer.byteLength("mimetype")]! ^= 1;
    const mismatch = Buffer.from(valid);
    mismatch.writeUInt16LE(0, 6);
    const overlap = Buffer.from(valid);
    overlap.writeUInt32LE(0, secondCentralOffset(overlap) + 42);
    expect(errors(crc)).toContain("zip.crc-mismatch");
    expect(errors(mismatch)).toContain("zip.field-unsupported");
    expect(errors(overlap)).toContain("zip.range-invalid");
    expect(errors(Buffer.concat([Buffer.from("x"), valid]))).toContain("zip.range-invalid");
    expect(errors(Buffer.concat([valid, Buffer.from("x")]))).toContain("zip.trailing-data");
  });

  it("treats ZIP signatures and scripts inside report HTML as opaque bytes", () => {
    const entries = fixtureEntries();
    entries[9] = { ...entries[9]!, data: Buffer.concat([Buffer.from("<script>"), Buffer.from("504b0506", "hex"), Buffer.from("</script>")]) };
    const result = verifyProofCapsule(zip(entries));
    expect(result.assurance.transportProfile).toBe("valid");
    expect(result.errors.map((issue) => issue.code)).toEqual([
      "manifest.member-digest-mismatch",
      "manifest.member-size-mismatch",
    ]);
  });
});

function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${jcs(record[key])}`).join(",")}}`;
}
