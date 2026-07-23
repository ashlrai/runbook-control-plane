import { base64, concatBytes, dssePae, equalBytes, hex, jcsBytes, sha256, utf8 } from "./bytes.js";
import { assembleProofCapsuleZip, type ArchiveMember } from "./zip.js";

export { jcsBytes as serializeJcs } from "./bytes.js";

export const RUNBOOK_CAPSULE_MEDIA_TYPE = "application/vnd.runbook.proof+zip;version=1";
export const RUNBOOK_CAPSULE_PROFILE = "runbook.proof-capsule.v1";
export const RUNBOOK_CHECKPOINT_PAYLOAD_TYPE = "application/vnd.runbook.checkpoint+json;version=1";

const EMPTY_EVENT_HEAD = "0".repeat(64);
const CAPSULE_ID_DOMAIN = utf8("RUNBOOK_CHECKPOINT_ID_V1\0");
const ED25519_SPKI_PREFIX = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
const CAPSULE_ID_PATTERN = /^[a-f0-9]{64}$/;
const EXPERIMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREATED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const PATH_PATTERN = /^payload\/[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63}){0,7}$/;
const ROLES = new Set(["charter", "claims", "disclosures", "events", "report", "outcomes", "reconciliation", "evidence-projection", "commitment", "policy"]);
const RELATIONS = new Set(["root", "derived", "corrects", "supersedes"]);
const REQUIRED = new Map<CapsulePayloadMember["path"], { role: CapsulePayloadMember["role"]; mediaType: string }>([
  ["payload/charter.json", { role: "charter", mediaType: "application/json" }],
  ["payload/claims.json", { role: "claims", mediaType: "application/json" }],
  ["payload/disclosures.json", { role: "disclosures", mediaType: "application/json" }],
  ["payload/events.ndjson", { role: "events", mediaType: "application/x-ndjson" }],
  ["payload/report.html", { role: "report", mediaType: "text/html;charset=utf-8" }],
]);

export type CapsulePayloadRole = "charter" | "claims" | "disclosures" | "events" | "report" | "outcomes" | "reconciliation" | "evidence-projection" | "commitment" | "policy";
export type CapsulePayloadMember = { path: `payload/${string}`; role: CapsulePayloadRole; mediaType: string; bytes: Uint8Array };
export type ProofCapsuleLineage =
  | { relation: "root"; parents: readonly [] }
  | { relation: "derived"; parents: readonly string[] }
  | { relation: "corrects" | "supersedes"; parents: readonly [string] };

export type PrepareProofCapsuleInput = {
  checkpointSequence: number;
  createdAt: string;
  dataClass: "synthetic";
  eventChain: { eventCount: number; headHash: string };
  experimentId: string;
  lineage: ProofCapsuleLineage;
  payloads: readonly CapsulePayloadMember[];
  publicKeySpkiDer: Uint8Array;
};

export type PreparedProofCapsule = {
  readonly authorKeyId: `sha256:${string}`;
  readonly capsuleId: string;
  readonly manifestBytes: Uint8Array;
  readonly review: {
    readonly checkpointSequence: number;
    readonly createdAt: string;
    readonly dataClass: "synthetic";
    readonly experimentId: string;
    readonly lineage: { readonly relation: ProofCapsuleLineage["relation"]; readonly parents: readonly string[] };
    readonly members: readonly { readonly bytes: number; readonly path: string; readonly sha256: string }[];
  };
  readonly signingBytes: Uint8Array;
  readonly statementBytes: Uint8Array;
};

export type AuthoredProofCapsule = {
  readonly archiveBytes: Uint8Array;
  readonly archiveSha256: string;
  readonly authorKeyId: `sha256:${string}`;
  readonly capsuleId: string;
  readonly envelopeBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
  readonly statementBytes: Uint8Array;
};

type PreparedState = {
  authorKeyId: `sha256:${string}`;
  capsuleId: string;
  manifestBytes: Uint8Array;
  payloads: { path: string; bytes: Uint8Array }[];
  publicKeySpkiDer: Uint8Array;
  signingBytes: Uint8Array;
  statementBytes: Uint8Array;
};

const PREPARED = new WeakMap<PreparedProofCapsule, PreparedState>();

function fail(code: string): never { throw new Error(code); }
function copy(bytes: Uint8Array) { return new Uint8Array(bytes); }

function validateCreatedAt(value: string) {
  const match = CREATED_AT_PATTERN.exec(value);
  if (match === null) fail("author.created-at-invalid");
  const [, year, month, day, hour, minute, second, milliseconds] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), Number(milliseconds ?? "0"));
  if (!Number.isFinite(date.getTime()) || Number(year) < 1
    || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)
    || date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second)
    || date.getUTCMilliseconds() !== Number(milliseconds ?? "0")) fail("author.created-at-invalid");
}

function asciiCompare(left: string, right: string) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function validateLineage(lineage: ProofCapsuleLineage) {
  if (lineage === null || typeof lineage !== "object" || !RELATIONS.has(lineage.relation) || !Array.isArray(lineage.parents)) fail("author.lineage-invalid");
  const parents = [...lineage.parents];
  if (parents.some((parent) => !CAPSULE_ID_PATTERN.test(parent))) fail("author.parent-id-invalid");
  if (new Set(parents).size !== parents.length || parents.some((parent, index) => index > 0 && asciiCompare(parents[index - 1] as string, parent) >= 0)) fail("author.lineage-invalid");
  if ((lineage.relation === "root" && parents.length !== 0)
    || (lineage.relation === "derived" && (parents.length < 1 || parents.length > 8))
    || ((lineage.relation === "corrects" || lineage.relation === "supersedes") && parents.length !== 1)) fail("author.lineage-invalid");
}

function validateAndCopyPayloads(payloads: readonly CapsulePayloadMember[]) {
  if (payloads.length < 5 || payloads.length > 59) fail("author.payload-count-invalid");
  const output: CapsulePayloadMember[] = [];
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const payload of payloads) {
    if (!PATH_PATTERN.test(payload.path) || payload.path.length > 240 || paths.has(payload.path)) fail("author.payload-path-invalid");
    paths.add(payload.path);
    if (!(payload.bytes instanceof Uint8Array) || payload.bytes.byteLength > 16 * 1024 * 1024) fail("author.payload-size-invalid");
    totalBytes += payload.bytes.byteLength;
    if (totalBytes > 60 * 1024 * 1024) fail("author.payload-total-invalid");
    if (!ROLES.has(payload.role) || typeof payload.mediaType !== "string" || payload.mediaType.length < 1 || payload.mediaType.length > 127
      || payload.mediaType !== payload.mediaType.toLowerCase() || !/^[\x20-\x7e]+$/.test(payload.mediaType)) fail("author.payload-profile-invalid");
    const required = REQUIRED.get(payload.path);
    const expectedMediaType = payload.role === "events" ? "application/x-ndjson" : payload.role === "report" ? "text/html;charset=utf-8" : "application/json";
    if ((required !== undefined && (payload.role !== required.role || payload.mediaType !== required.mediaType))
      || (required === undefined && payload.mediaType !== expectedMediaType)) fail("author.payload-profile-invalid");
    output.push({ ...payload, bytes: copy(payload.bytes) });
  }
  for (const required of REQUIRED.keys()) if (!paths.has(required)) fail("author.payload-required-missing");
  const sorted = [...output].sort((left, right) => asciiCompare(left.path, right.path));
  if (output.some((payload, index) => payload.path !== sorted[index]?.path)) fail("author.payload-order-invalid");
  return output;
}

export async function prepareProofCapsule(input: PrepareProofCapsuleInput, options: { subtle?: SubtleCrypto } = {}): Promise<PreparedProofCapsule> {
  // Own every caller-controlled value before the first asynchronous boundary.
  // Later hashing must never reread a mutable input object after validation.
  const experimentId = input.experimentId;
  const checkpointSequence = input.checkpointSequence;
  const createdAt = input.createdAt;
  const dataClass = input.dataClass;
  const eventChain = { eventCount: input.eventChain.eventCount, headHash: input.eventChain.headHash };
  validateLineage(input.lineage);
  const lineage = {
    relation: input.lineage.relation,
    parents: [...input.lineage.parents],
  } as ProofCapsuleLineage;
  validateLineage(lineage);
  if (!EXPERIMENT_ID_PATTERN.test(experimentId)) fail("author.experiment-id-invalid");
  if (!Number.isSafeInteger(checkpointSequence) || checkpointSequence < 1 || checkpointSequence > 10_000_000) fail("author.checkpoint-sequence-invalid");
  validateCreatedAt(createdAt);
  if (dataClass !== "synthetic") fail("author.data-class-invalid");
  if (!Number.isSafeInteger(eventChain.eventCount) || eventChain.eventCount < 0 || eventChain.eventCount > 10_000_000
    || !CAPSULE_ID_PATTERN.test(eventChain.headHash)
    || (eventChain.eventCount === 0 && eventChain.headHash !== EMPTY_EVENT_HEAD)) fail("author.event-chain-invalid");
  const publicKeySpkiDer = copy(input.publicKeySpkiDer);
  if (publicKeySpkiDer.byteLength !== 44 || !equalBytes(publicKeySpkiDer.subarray(0, 12), ED25519_SPKI_PREFIX)) fail("author.key-invalid");
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) fail("author.crypto-unavailable");
  const payloads = validateAndCopyPayloads(input.payloads);
  const authorKeyId = `sha256:${hex(await sha256(publicKeySpkiDer, subtle))}` as const;
  const members = [];
  for (const payload of payloads) {
    members.push({ bytes: payload.bytes.byteLength, mediaType: payload.mediaType, path: payload.path, role: payload.role, sha256: hex(await sha256(payload.bytes, subtle)) });
  }
  const manifestBytes = jcsBytes({
    capsuleProfile: RUNBOOK_CAPSULE_PROFILE,
    experimentId,
    lineage: { parents: [...lineage.parents], relation: lineage.relation },
    members,
    schemaVersion: "runbook.proof-manifest.v1",
  });
  const statementBytes = jcsBytes({
    assurancePolicy: "runbook.checkpoint-assurance.v1",
    authorKeyId,
    checkpointSequence,
    createdAt,
    dataClass,
    eventChain: { algorithm: "runbook-jsonl-chain-v1", eventCount: eventChain.eventCount, headHash: eventChain.headHash },
    experimentDigest: hex(await sha256(manifestBytes, subtle)),
    proofScope: { brokerAttestation: "absent", independentlyRecomputable: false, privacy: "metadata-only", sourceCoverage: "author-declared", underlyingRecordsIncluded: false },
    schemaVersion: "runbook.checkpoint.v1",
  });
  const signingBytes = dssePae(RUNBOOK_CHECKPOINT_PAYLOAD_TYPE, statementBytes);
  const capsuleId = hex(await sha256(concatBytes(CAPSULE_ID_DOMAIN, statementBytes), subtle));
  const review = Object.freeze({
      checkpointSequence,
      createdAt,
      dataClass,
      experimentId,
      lineage: Object.freeze({ relation: lineage.relation, parents: Object.freeze([...lineage.parents]) }),
      members: Object.freeze(members.map(({ bytes, path, sha256 }) => Object.freeze({ bytes, path, sha256 }))),
    });
  const prepared = Object.freeze(Object.defineProperties({} as PreparedProofCapsule, {
    authorKeyId: { enumerable: true, get: () => authorKeyId },
    capsuleId: { enumerable: true, get: () => capsuleId },
    manifestBytes: { enumerable: true, get: () => copy(manifestBytes) },
    review: { enumerable: true, get: () => review },
    signingBytes: { enumerable: true, get: () => copy(signingBytes) },
    statementBytes: { enumerable: true, get: () => copy(statementBytes) },
  }));
  PREPARED.set(prepared, {
    authorKeyId,
    capsuleId,
    manifestBytes: copy(manifestBytes),
    payloads: payloads.map(({ path, bytes }) => ({ path, bytes: copy(bytes) })),
    publicKeySpkiDer,
    signingBytes: copy(signingBytes),
    statementBytes: copy(statementBytes),
  });
  return prepared;
}

export async function finalizeProofCapsule(prepared: PreparedProofCapsule, signatureInput: Uint8Array, options: { subtle?: SubtleCrypto } = {}): Promise<AuthoredProofCapsule> {
  const state = PREPARED.get(prepared);
  if (state === undefined) fail("author.prepared-invalid");
  const signature = copy(signatureInput);
  if (signature.byteLength !== 64) fail("author.signature-invalid");
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) fail("author.crypto-unavailable");
  let publicKey: CryptoKey;
  try {
    publicKey = await subtle.importKey("spki", copy(state.publicKeySpkiDer), { name: "Ed25519" }, false, ["verify"]);
    if (!await subtle.verify({ name: "Ed25519" }, publicKey, signature, copy(state.signingBytes))) fail("author.signature-invalid");
  } catch (error) {
    if (error instanceof Error && error.message === "author.signature-invalid") throw error;
    fail("author.crypto-operation-failed");
  }
  const envelopeBytes = jcsBytes({
    payload: base64(state.statementBytes),
    payloadType: RUNBOOK_CHECKPOINT_PAYLOAD_TYPE,
    signatures: [{ keyid: state.authorKeyId, sig: base64(signature) }],
  });
  const members: ArchiveMember[] = [
    { path: "mimetype", bytes: utf8(RUNBOOK_CAPSULE_MEDIA_TYPE) },
    { path: "runbook/manifest.json", bytes: state.manifestBytes },
    { path: "runbook/checkpoint.statement.json", bytes: state.statementBytes },
    { path: "runbook/checkpoint.dsse.json", bytes: envelopeBytes },
    { path: "runbook/author-key.spki.der", bytes: state.publicKeySpkiDer },
    ...state.payloads,
  ];
  const archiveBytes = assembleProofCapsuleZip(members);
  return {
    archiveBytes: copy(archiveBytes),
    archiveSha256: hex(await sha256(archiveBytes, subtle)),
    authorKeyId: state.authorKeyId,
    capsuleId: state.capsuleId,
    envelopeBytes: copy(envelopeBytes),
    manifestBytes: copy(state.manifestBytes),
    statementBytes: copy(state.statementBytes),
  };
}
