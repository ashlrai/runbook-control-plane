import { createHash } from "node:crypto";
import {
  RUNBOOK_CHECKPOINT_PAYLOAD_TYPE,
  checkpointStatementSchema,
  verifyCheckpoint,
} from "@runbook/engine/checkpoint";
import { StrictJsonError, parseStrictJson } from "./strict-json.js";
import {
  CAPSULE_CONTROL_MEMBER_NAMES,
  type ZipErrorCode,
  ZipError,
  readCapsuleMembers,
} from "./zip.js";

export const RUNBOOK_CAPSULE_MEDIA_TYPE = "application/vnd.runbook.proof+zip;version=1";
export const RUNBOOK_CAPSULE_PROFILE = "runbook.proof-capsule.v1";

const REQUIRED_PAYLOADS = new Map([
  ["payload/charter.json", { role: "charter", mediaType: "application/json" }],
  ["payload/claims.json", { role: "claims", mediaType: "application/json" }],
  ["payload/disclosures.json", { role: "disclosures", mediaType: "application/json" }],
  ["payload/events.ndjson", { role: "events", mediaType: "application/x-ndjson" }],
  ["payload/report.html", { role: "report", mediaType: "text/html;charset=utf-8" }],
]);
const ROLES = new Set(["charter", "claims", "disclosures", "events", "report", "outcomes", "reconciliation", "evidence-projection", "commitment", "policy"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EXPERIMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CHECKPOINT_ID_DOMAIN = "RUNBOOK_CHECKPOINT_ID_V1\0";
const MAX_STATEMENT_BYTES = 65_536;
const MAX_ENVELOPE_PAYLOAD_CHARACTERS = 87_384;
const RUNBOOK_CAPSULE_MEDIA_TYPE_BYTES = Buffer.from(RUNBOOK_CAPSULE_MEDIA_TYPE, "ascii");

export type ManifestMember = {
  bytes: number;
  mediaType: string;
  path: string;
  role: "charter" | "claims" | "disclosures" | "events" | "report" | "outcomes" | "reconciliation" | "evidence-projection" | "commitment" | "policy";
  sha256: string;
};

export type ProofManifest = {
  capsuleProfile: "runbook.proof-capsule.v1";
  experimentId: string;
  lineage: {
    parents: string[];
    relation: "root" | "derived" | "corrects" | "supersedes";
  };
  members: ManifestMember[];
  schemaVersion: "runbook.proof-manifest.v1";
};

export type VerificationIssue = { code: string; path?: string };
export type ReceiptMember = { path: string; bytes: number; sha256: string; status: "valid" | "invalid" | "not-evaluated" };

export type ProofVerificationReceipt = {
  assurance: {
    authorContinuity: "not-evaluated";
    authorIdentity: "self-asserted-key" | "not-evaluated";
    authorSignature: "valid" | "invalid" | "not-evaluated";
    brokerExecution: "not-evaluated";
    brokerIssuance: "not-evaluated";
    eventChain: "author-signed-commitment-only" | "not-evaluated";
    independentTime: "absent" | "not-evaluated";
    investmentSkill: "not-evaluated";
    packageIntegrity: "valid" | "invalid" | "not-evaluated";
    recordCompleteness: "not-evaluated";
    sourceCoverage: "author-declared-metadata-only" | "not-evaluated";
    suitabilityOrCompliance: "not-evaluated";
    transportProfile: "valid" | "invalid" | "not-evaluated";
  };
  authorKeyId: string | null;
  capsuleId: string | null;
  errors: VerificationIssue[];
  lineage: { parents: string[]; relation: "root" | "derived" | "corrects" | "supersedes" | null; status: "root" | "declared-unresolved" | "not-evaluated" };
  limitations: readonly [
    "signature-does-not-prove-identity",
    "signature-does-not-prove-independent-time",
    "signature-does-not-prove-broker-issuance",
    "capsule-does-not-prove-execution",
    "capsule-does-not-prove-record-completeness",
    "capsule-does-not-prove-investment-skill",
    "capsule-does-not-prove-suitability-or-compliance",
  ];
  members: ReceiptMember[];
  schemaVersion: "runbook.proof-verification.v1";
  valid: boolean;
  verifierProfile: "runbook.proof-capsule.v1";
  warnings: VerificationIssue[];
};

const LIMITATIONS = [
  "signature-does-not-prove-identity",
  "signature-does-not-prove-independent-time",
  "signature-does-not-prove-broker-issuance",
  "capsule-does-not-prove-execution",
  "capsule-does-not-prove-record-completeness",
  "capsule-does-not-prove-investment-skill",
  "capsule-does-not-prove-suitability-or-compliance",
] as const;

function initialReceipt(): ProofVerificationReceipt {
  return {
    assurance: {
      authorContinuity: "not-evaluated",
      authorIdentity: "not-evaluated",
      authorSignature: "not-evaluated",
      brokerExecution: "not-evaluated",
      brokerIssuance: "not-evaluated",
      eventChain: "not-evaluated",
      independentTime: "not-evaluated",
      investmentSkill: "not-evaluated",
      packageIntegrity: "not-evaluated",
      recordCompleteness: "not-evaluated",
      sourceCoverage: "not-evaluated",
      suitabilityOrCompliance: "not-evaluated",
      transportProfile: "not-evaluated",
    },
    authorKeyId: null,
    capsuleId: null,
    errors: [],
    lineage: { parents: [], relation: null, status: "not-evaluated" },
    limitations: LIMITATIONS,
    members: [],
    schemaVersion: "runbook.proof-verification.v1",
    valid: false,
    verifierProfile: RUNBOOK_CAPSULE_PROFILE,
    warnings: [],
  };
}

function issueSort(left: VerificationIssue, right: VerificationIssue) {
  return Buffer.compare(Buffer.from(left.code, "utf8"), Buffer.from(right.code, "utf8"))
    || Buffer.compare(Buffer.from(left.path ?? "", "ascii"), Buffer.from(right.path ?? "", "ascii"));
}

function finalize(receipt: ProofVerificationReceipt) {
  receipt.errors.sort(issueSort);
  receipt.warnings.sort(issueSort);
  receipt.valid = receipt.errors.length === 0
    && receipt.assurance.transportProfile === "valid"
    && receipt.assurance.packageIntegrity === "valid"
    && receipt.assurance.authorSignature === "valid";
  return receipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function assertWellFormedString(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) throw new Error("invalid-unicode");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("invalid-unicode");
    }
  }
}

function canonicalizeJcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertWellFormedString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("invalid-number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeJcs(item)).join(",")}]`;
  if (!isRecord(value)) throw new Error("invalid-value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      assertWellFormedString(key);
      return `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`;
    })
    .join(",")}}`;
}

/** Serializes a verification receipt as deterministic RFC 8785 JCS UTF-8 bytes. */
export function serializeProofVerificationReceipt(receipt: ProofVerificationReceipt) {
  return Buffer.from(canonicalizeJcs(receipt), "utf8");
}

function parseControlJson(bytes: Buffer, prefix: "manifest" | "statement") {
  try {
    const value = parseStrictJson(bytes);
    if (!Buffer.from(canonicalizeJcs(value), "utf8").equals(bytes)) throw new Error("noncanonical");
    return value;
  } catch (error) {
    if (error instanceof StrictJsonError) {
      if (error.code === "invalid-utf8") throw new Error(`${prefix}.invalid-utf8`);
      if (error.code === "duplicate-key") throw new Error(`${prefix}.duplicate-key`);
      if (error.code === "credential-shaped-field") throw new Error(`${prefix}.schema-invalid`);
      throw new Error(`${prefix}.invalid-json`);
    }
    if (error instanceof Error && error.message === "noncanonical") throw new Error(`${prefix}.noncanonical-json`);
    throw new Error(`${prefix}.invalid-json`);
  }
}

function validPayloadPath(path: string) {
  if (Buffer.byteLength(path, "ascii") > 240 || !/^payload\/[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63}){0,7}$/.test(path)) return false;
  return path.split("/").every((component) => component !== "." && component !== "..");
}

function parseManifestMember(value: unknown): ManifestMember {
  if (!isRecord(value) || !exactKeys(value, ["bytes", "mediaType", "path", "role", "sha256"])) throw new Error("manifest.schema-invalid");
  if (
    !Number.isSafeInteger(value.bytes)
    || (value.bytes as number) < 0
    || (value.bytes as number) > 16 * 1024 * 1024
    || typeof value.mediaType !== "string"
    || value.mediaType.length < 1
    || value.mediaType.length > 127
    || value.mediaType !== value.mediaType.toLowerCase()
    || !/^[\x20-\x7e]+$/.test(value.mediaType)
    || typeof value.path !== "string"
    || !validPayloadPath(value.path)
    || typeof value.role !== "string"
    || !ROLES.has(value.role)
    || typeof value.sha256 !== "string"
    || !SHA256_PATTERN.test(value.sha256)
  ) throw new Error("manifest.schema-invalid");
  const required = REQUIRED_PAYLOADS.get(value.path);
  if (required !== undefined && (value.role !== required.role || value.mediaType !== required.mediaType)) throw new Error("manifest.schema-invalid");
  if (required === undefined) {
    const expectedMediaType = value.role === "events" ? "application/x-ndjson" : value.role === "report" ? "text/html;charset=utf-8" : "application/json";
    if (value.mediaType !== expectedMediaType) throw new Error("manifest.schema-invalid");
  }
  return value as ManifestMember;
}

function parseLineage(value: unknown): ProofManifest["lineage"] {
  if (!isRecord(value) || !exactKeys(value, ["parents", "relation"]) || !Array.isArray(value.parents)) throw new Error("manifest.schema-invalid");
  if (value.relation !== "root" && value.relation !== "derived" && value.relation !== "corrects" && value.relation !== "supersedes") {
    throw new Error("manifest.schema-invalid");
  }
  if (value.parents.some((parent) => typeof parent !== "string" || !SHA256_PATTERN.test(parent))) throw new Error("lineage.parent-id-invalid");
  const parents = value.parents as string[];
  const sorted = [...parents].sort();
  if (new Set(parents).size !== parents.length || parents.some((parent, index) => parent !== sorted[index])) throw new Error("lineage.parent-id-invalid");
  const validCount = value.relation === "root" ? parents.length === 0
    : value.relation === "derived" ? parents.length >= 1 && parents.length <= 8
      : parents.length === 1;
  if (!validCount) throw new Error("manifest.schema-invalid");
  return { parents, relation: value.relation };
}

function parseManifest(bytes: Buffer): ProofManifest {
  const value = parseControlJson(bytes, "manifest");
  if (!isRecord(value) || !exactKeys(value, ["capsuleProfile", "experimentId", "lineage", "members", "schemaVersion"])) {
    throw new Error("manifest.schema-invalid");
  }
  if (
    value.capsuleProfile !== RUNBOOK_CAPSULE_PROFILE
    || value.schemaVersion !== "runbook.proof-manifest.v1"
    || typeof value.experimentId !== "string"
    || !EXPERIMENT_ID_PATTERN.test(value.experimentId)
    || !Array.isArray(value.members)
    || value.members.length < 5
    || value.members.length > 59
  ) throw new Error("manifest.schema-invalid");
  const members = value.members.map((member) => parseManifestMember(member));
  const paths = members.map((member) => member.path);
  const sortedPaths = [...paths].sort((left, right) => Buffer.compare(Buffer.from(left, "ascii"), Buffer.from(right, "ascii")));
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== sortedPaths[index])) throw new Error("manifest.schema-invalid");
  if ([...REQUIRED_PAYLOADS.keys()].some((path) => !paths.includes(path))) throw new Error("manifest.schema-invalid");
  return {
    capsuleProfile: RUNBOOK_CAPSULE_PROFILE,
    experimentId: value.experimentId,
    lineage: parseLineage(value.lineage),
    members,
    schemaVersion: "runbook.proof-manifest.v1",
  };
}

type ParsedEnvelope = { sanitized: Buffer; payload: Buffer; ignoredExtension: boolean };

function decodeDsseBase64(value: string, maxDecodedBytes?: number) {
  if (value.length === 0 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(value) || value.length % 4 === 1) return null;
  const unpadded = value.replace(/=+$/, "");
  if (/[+/]/.test(unpadded) && /[-_]/.test(unpadded)) return null;
  const normalized = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const expectedPadding = (4 - (normalized.length % 4)) % 4;
  const suppliedPadding = value.length - unpadded.length;
  if (suppliedPadding > 0 && (value.length % 4 !== 0 || suppliedPadding !== expectedPadding)) return null;
  if (maxDecodedBytes !== undefined && Math.floor(normalized.length * 3 / 4) > maxDecodedBytes) return null;
  const decoded = Buffer.from(`${normalized}${"=".repeat(expectedPadding)}`, "base64");
  return decoded.toString("base64").replace(/=+$/, "") === normalized ? decoded : null;
}

function parseEnvelope(bytes: Buffer): ParsedEnvelope {
  let value: unknown;
  try {
    value = parseStrictJson(bytes, {
      rejectCredentialFields: false,
      topLevelStringValueLimits: { payload: MAX_ENVELOPE_PAYLOAD_CHARACTERS },
    });
  } catch (error) {
    if (error instanceof StrictJsonError && error.code === "duplicate-key") throw new Error("envelope.duplicate-key");
    throw new Error("envelope.invalid-json");
  }
  if (!isRecord(value) || typeof value.payload !== "string" || typeof value.payloadType !== "string" || !Array.isArray(value.signatures)) {
    throw new Error("envelope.schema-invalid");
  }
  if (value.signatures.length !== 1) throw new Error("signature.count-unsupported");
  const signature = value.signatures[0];
  if (
    !isRecord(signature)
    || typeof signature.keyid !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(signature.keyid)
    || typeof signature.sig !== "string"
    || value.payloadType.length < 1
    || value.payloadType.length > 200
  ) throw new Error("envelope.schema-invalid");
  const payload = decodeDsseBase64(value.payload, MAX_STATEMENT_BYTES);
  if (payload === null) throw new Error("payload.base64-invalid");
  if (decodeDsseBase64(signature.sig) === null) throw new Error("signature.invalid");
  if (value.payloadType !== RUNBOOK_CHECKPOINT_PAYLOAD_TYPE) throw new Error("payload.type-unsupported");
  const ignoredExtension = !exactKeys(value, ["payload", "payloadType", "signatures"]) || !exactKeys(signature, ["keyid", "sig"]);
  return {
    ignoredExtension,
    payload,
    sanitized: Buffer.from(JSON.stringify({
      payload: value.payload,
      payloadType: value.payloadType,
      signatures: [{ keyid: signature.keyid, sig: signature.sig }],
    })),
  };
}

function validCreatedAt(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (days[month - 1] as number);
}

function statementCapsuleId(statementBytes: Buffer) {
  return createHash("sha256").update(CHECKPOINT_ID_DOMAIN).update(statementBytes).digest("hex");
}

function memberReceipts(order: string[], members: Map<string, Buffer>): ReceiptMember[] {
  return order.map((path) => {
    const bytes = members.get(path) as Buffer;
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), status: "not-evaluated" };
  });
}

function addError(receipt: ProofVerificationReceipt, code: string, path?: string) {
  receipt.errors.push(path === undefined ? { code } : { code, path });
}

function mapCheckpointErrors(receipt: ProofVerificationReceipt, errors: string[]) {
  const mapping: Record<string, string> = {
    "payload.type-unsupported": "payload.type-unsupported",
    "payload.byte-mismatch": "payload.byte-mismatch",
    "key.invalid": "key.invalid",
    "key.algorithm-unsupported": "key.algorithm-unsupported",
    "key.encoding-noncanonical": "key.encoding-noncanonical",
    "key.fingerprint-mismatch": "key.fingerprint-mismatch",
    "signature.invalid": "signature.invalid",
    "statement.schema-invalid": "statement.schema-invalid",
  };
  for (const code of errors) addError(receipt, mapping[code] ?? "envelope.schema-invalid");
}

/** Verifies the draft `runbook.proof-capsule.v1` core profile fully offline. */
export function verifyProofCapsule(input: Uint8Array): ProofVerificationReceipt {
  const receipt = initialReceipt();
  let parsedZip: ReturnType<typeof readCapsuleMembers>;
  try {
    parsedZip = readCapsuleMembers(input);
  } catch (error) {
    receipt.assurance.transportProfile = "invalid";
    addError(receipt, error instanceof ZipError ? error.code : "zip.eocd-invalid");
    return finalize(receipt);
  }
  receipt.assurance.transportProfile = "valid";
  receipt.members = memberReceipts(parsedZip.order, parsedZip.members);
  const member = (path: string) => parsedZip.members.get(path) as Buffer;
  if (!member("mimetype").equals(RUNBOOK_CAPSULE_MEDIA_TYPE_BYTES)) {
    addError(receipt, "control.mimetype-invalid", "mimetype");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }

  let manifest: ProofManifest;
  try {
    manifest = parseManifest(member("runbook/manifest.json"));
  } catch (error) {
    addError(receipt, error instanceof Error ? error.message : "manifest.invalid-json", "runbook/manifest.json");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }

  let statementValue: unknown;
  try {
    statementValue = parseControlJson(member("runbook/checkpoint.statement.json"), "statement");
  } catch (error) {
    addError(receipt, error instanceof Error ? error.message : "statement.invalid-json", "runbook/checkpoint.statement.json");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }
  const parsedStatement = checkpointStatementSchema.safeParse(statementValue);
  if (!parsedStatement.success || !validCreatedAt(parsedStatement.data.createdAt)) {
    addError(receipt, "statement.schema-invalid", "runbook/checkpoint.statement.json");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }
  const statementBytes = member("runbook/checkpoint.statement.json");
  receipt.capsuleId = statementCapsuleId(statementBytes);

  let envelope: ParsedEnvelope;
  try {
    envelope = parseEnvelope(member("runbook/checkpoint.dsse.json"));
  } catch (error) {
    addError(receipt, error instanceof Error ? error.message : "envelope.invalid-json", "runbook/checkpoint.dsse.json");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }
  if (envelope.ignoredExtension) receipt.warnings.push({ code: "envelope.ignored-extension", path: "runbook/checkpoint.dsse.json" });
  if (!envelope.payload.equals(statementBytes)) {
    addError(receipt, "payload.byte-mismatch", "runbook/checkpoint.statement.json");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }

  const checkpoint = verifyCheckpoint({
    envelopeJson: envelope.sanitized,
    statementJson: statementBytes,
    publicKeySpkiDer: member("runbook/author-key.spki.der"),
  });
  receipt.authorKeyId = checkpoint.publicKeyFingerprint;
  if (!checkpoint.valid) {
    receipt.assurance.authorSignature = checkpoint.assurance.authorSignature === "invalid" ? "invalid" : "not-evaluated";
    receipt.assurance.packageIntegrity = "invalid";
    mapCheckpointErrors(receipt, checkpoint.errors);
    return finalize(receipt);
  }
  receipt.assurance.authorSignature = "valid";
  receipt.assurance.authorIdentity = "self-asserted-key";

  const manifestBytes = member("runbook/manifest.json");
  if (createHash("sha256").update(manifestBytes).digest("hex") !== parsedStatement.data.experimentDigest) {
    addError(receipt, "statement.manifest-digest-mismatch", "runbook/manifest.json");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }
  const actualPayloadOrder = parsedZip.order.slice(CAPSULE_CONTROL_MEMBER_NAMES.length);
  const declaredPaths = manifest.members.map((entry) => entry.path);
  if (actualPayloadOrder.length !== declaredPaths.length || actualPayloadOrder.some((path, index) => path !== declaredPaths[index])) {
    addError(receipt, "manifest.member-set-mismatch", "runbook/manifest.json");
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }
  const receiptMembers = new Map(receipt.members.map((entry) => [entry.path, entry]));
  for (const controlPath of CAPSULE_CONTROL_MEMBER_NAMES) {
    (receiptMembers.get(controlPath) as ReceiptMember).status = "valid";
  }
  for (const declaration of manifest.members) {
    const payload = parsedZip.members.get(declaration.path);
    const receiptMember = receiptMembers.get(declaration.path) as ReceiptMember;
    if (payload === undefined) {
      addError(receipt, "manifest.member-set-mismatch", declaration.path);
      continue;
    }
    let memberValid = true;
    if (payload.length !== declaration.bytes) {
      addError(receipt, "manifest.member-size-mismatch", declaration.path);
      memberValid = false;
    }
    if (createHash("sha256").update(payload).digest("hex") !== declaration.sha256) {
      addError(receipt, "manifest.member-digest-mismatch", declaration.path);
      memberValid = false;
    }
    receiptMember.status = memberValid ? "valid" : "invalid";
  }
  if (manifest.lineage.parents.includes(receipt.capsuleId)) addError(receipt, "lineage.parent-id-invalid", "runbook/manifest.json");
  receipt.lineage = {
    parents: manifest.lineage.parents,
    relation: manifest.lineage.relation,
    status: manifest.lineage.relation === "root" ? "root" : "declared-unresolved",
  };
  if (receipt.errors.length > 0) {
    receipt.assurance.packageIntegrity = "invalid";
    return finalize(receipt);
  }
  receipt.assurance.eventChain = "author-signed-commitment-only";
  receipt.assurance.independentTime = "absent";
  receipt.assurance.packageIntegrity = "valid";
  receipt.assurance.sourceCoverage = "author-declared-metadata-only";
  return finalize(receipt);
}

export { CAPSULE_CONTROL_MEMBER_NAMES } from "./zip.js";
