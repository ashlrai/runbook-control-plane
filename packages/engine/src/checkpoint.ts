import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";

export const RUNBOOK_CHECKPOINT_PAYLOAD_TYPE = "application/vnd.runbook.checkpoint+json;version=1";

const MAX_ENVELOPE_BYTES = 128 * 1024;
const MAX_STATEMENT_BYTES = 64 * 1024;
const MAX_PUBLIC_KEY_BYTES = 512;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 5_000;
const MAX_JSON_STRING_LENGTH = 32_768;
const CHECKPOINT_ID_DOMAIN = "RUNBOOK_CHECKPOINT_ID_V1\0";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CREDENTIAL_FIELD_PATTERN = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|password|passphrase|private[_-]?key|client[_-]?secret|secret|session[_-]?(?:id|key|token)|account[_-]?(?:id|number)|routing[_-]?number|email|phone|ssn|social[_-]?security)$/i;

const digestSchema = z.string().regex(SHA256_PATTERN);
const keyIdSchema = z.string().regex(KEY_ID_PATTERN);
const utcTimestampSchema = z.iso.datetime().refine(
  (value) => value.endsWith("Z") && !Number.isNaN(Date.parse(value)),
  "Timestamp must be UTC RFC3339 ending in Z.",
);

function decodeBase64(value: string): Buffer | null {
  if (value.length === 0 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(value) || value.length % 4 === 1) return null;
  const unpadded = value.replace(/=+$/, "");
  const usesStandardAlphabet = /[+/]/.test(unpadded);
  const usesUrlSafeAlphabet = /[-_]/.test(unpadded);
  if (usesStandardAlphabet && usesUrlSafeAlphabet) return null;
  const normalized = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const expectedPaddingLength = (4 - (normalized.length % 4)) % 4;
  const suppliedPaddingLength = value.length - unpadded.length;
  if (suppliedPaddingLength > 0 && (value.length % 4 !== 0 || suppliedPaddingLength !== expectedPaddingLength)) return null;
  const padding = "=".repeat(expectedPaddingLength);
  const decoded = Buffer.from(`${normalized}${padding}`, "base64");
  return decoded.toString("base64").replace(/=+$/, "") === normalized ? decoded : null;
}

const dsseBase64Schema = z.string().max(MAX_ENVELOPE_BYTES).refine((value) => decodeBase64(value) !== null);

export const dsseSignatureSchema = z.object({
  keyid: keyIdSchema,
  sig: dsseBase64Schema,
}).strict();

export const dsseEnvelopeSchema = z.object({
  payload: dsseBase64Schema,
  payloadType: z.string().min(1).max(200),
  signatures: z.tuple([dsseSignatureSchema]),
}).strict();

export const checkpointStatementSchema = z.object({
  schemaVersion: z.literal("runbook.checkpoint.v1"),
  experimentDigest: digestSchema,
  checkpointSequence: z.number().int().positive().max(10_000_000),
  createdAt: utcTimestampSchema,
  dataClass: z.enum(["synthetic", "live-author-declared"]),
  authorKeyId: keyIdSchema,
  eventChain: z.object({
    algorithm: z.literal("runbook-jsonl-chain-v1"),
    eventCount: z.number().int().nonnegative().max(10_000_000),
    headHash: digestSchema,
  }).strict(),
  proofScope: z.object({
    privacy: z.literal("metadata-only"),
    sourceCoverage: z.literal("author-declared"),
    underlyingRecordsIncluded: z.literal(false),
    independentlyRecomputable: z.literal(false),
    brokerAttestation: z.literal("absent"),
  }).strict(),
  assurancePolicy: z.literal("runbook.checkpoint-assurance.v1"),
}).strict();

export const checkpointVerificationErrorSchema = z.enum([
  "input.envelope-size-invalid",
  "input.statement-size-invalid",
  "input.public-key-size-invalid",
  "envelope.invalid-utf8",
  "envelope.invalid-json",
  "envelope.duplicate-key",
  "envelope.credential-shaped-field",
  "envelope.schema-invalid",
  "payload.type-unsupported",
  "payload.size-invalid",
  "payload.byte-mismatch",
  "statement.invalid-utf8",
  "statement.invalid-json",
  "statement.duplicate-key",
  "statement.credential-shaped-field",
  "statement.schema-invalid",
  "key.invalid",
  "key.algorithm-unsupported",
  "key.encoding-noncanonical",
  "key.fingerprint-mismatch",
  "signature.invalid",
]);

const checkStatusSchema = z.enum(["valid", "invalid", "not-evaluated"]);

export const checkpointAssuranceSchema = z.object({
  envelopeSchema: checkStatusSchema,
  payloadType: checkStatusSchema,
  payloadBinding: checkStatusSchema,
  statementSchema: checkStatusSchema,
  publicKey: checkStatusSchema,
  keyFingerprint: checkStatusSchema,
  authorSignature: checkStatusSchema,
  authorIdentity: z.enum(["self-asserted-key", "not-evaluated"]),
  independentTime: z.literal("absent"),
  eventChain: z.enum(["author-signed-commitment-only", "not-evaluated"]),
  sourceCoverage: z.enum(["author-declared-metadata-only", "not-evaluated"]),
  brokerIssuance: z.literal("not-evaluated"),
  brokerExecution: z.literal("not-evaluated"),
  recordCompleteness: z.literal("not-evaluated"),
}).strict();

export const checkpointLimitationSchema = z.enum([
  "signature-does-not-prove-broker-issuance",
  "checkpoint-does-not-prove-execution",
  "checkpoint-does-not-prove-record-completeness",
  "checkpoint-does-not-prove-investment-skill",
]);

export const checkpointVerificationResultSchema = z.object({
  schemaVersion: z.literal("runbook.checkpoint-verification.v1"),
  valid: z.boolean(),
  checkpointId: digestSchema.nullable(),
  publicKeyFingerprint: keyIdSchema.nullable(),
  statement: checkpointStatementSchema.nullable(),
  assurance: checkpointAssuranceSchema,
  errors: z.array(checkpointVerificationErrorSchema),
  limitations: z.tuple([
    z.literal("signature-does-not-prove-broker-issuance"),
    z.literal("checkpoint-does-not-prove-execution"),
    z.literal("checkpoint-does-not-prove-record-completeness"),
    z.literal("checkpoint-does-not-prove-investment-skill"),
  ]),
}).strict();

export type DsseEnvelope = z.infer<typeof dsseEnvelopeSchema>;
export type CheckpointStatement = z.infer<typeof checkpointStatementSchema>;
export type CheckpointVerificationError = z.infer<typeof checkpointVerificationErrorSchema>;
export type CheckpointAssurance = z.infer<typeof checkpointAssuranceSchema>;
export type CheckpointVerificationResult = z.infer<typeof checkpointVerificationResultSchema>;

export type CheckpointVerificationInput = {
  envelopeJson: Uint8Array;
  statementJson: Uint8Array;
  publicKeySpkiDer: Uint8Array;
};

type JsonParseError = "invalid-utf8" | "invalid-json" | "duplicate-key" | "credential-shaped-field";
type StrictJsonResult = { ok: true; value: unknown } | { ok: false; error: JsonParseError };

class StrictJsonParser {
  private index = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new Error("invalid-json");
    return value;
  }

  private parseValue(depth: number): unknown {
    this.nodes += 1;
    if (depth > MAX_JSON_DEPTH || this.nodes > MAX_JSON_NODES) throw new Error("invalid-json");
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "{") return this.parseObject(depth + 1);
    if (character === "[") return this.parseArray(depth + 1);
    if (character === '"') return this.parseString();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    return this.parseNumber();
  }

  private parseObject(depth: number): Record<string, unknown> {
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') throw new Error("invalid-json");
      const key = this.parseString();
      if (keys.has(key)) throw new Error("duplicate-key");
      if (CREDENTIAL_FIELD_PATTERN.test(key)) throw new Error("credential-shaped-field");
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") throw new Error("invalid-json");
      this.index += 1;
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") throw new Error("invalid-json");
      this.index += 1;
    }
    throw new Error("invalid-json");
  }

  private parseArray(depth: number): unknown[] {
    const result: unknown[] = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") throw new Error("invalid-json");
      this.index += 1;
    }
    throw new Error("invalid-json");
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index] as string;
      if (!escaped && character === '"') {
        this.index += 1;
        const raw = this.source.slice(start, this.index);
        let value: unknown;
        try {
          value = JSON.parse(raw) as unknown;
        } catch {
          throw new Error("invalid-json");
        }
        if (typeof value !== "string" || value.length > MAX_JSON_STRING_LENGTH) throw new Error("invalid-json");
        return value;
      }
      if (!escaped && character === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      this.index += 1;
    }
    throw new Error("invalid-json");
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (this.source.slice(this.index, this.index + literal.length) !== literal) throw new Error("invalid-json");
    this.index += literal.length;
    return value;
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index));
    if (!match) throw new Error("invalid-json");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error("invalid-json");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("invalid-json");
    return value;
  }

  private skipWhitespace() {
    while (this.index < this.source.length && /[\t\n\r ]/.test(this.source[this.index] as string)) this.index += 1;
  }
}

function parseStrictJson(bytes: Buffer): StrictJsonResult {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "invalid-utf8" };
  }
  try {
    return { ok: true, value: new StrictJsonParser(source).parse() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid-json";
    if (message === "duplicate-key" || message === "credential-shaped-field") return { ok: false, error: message };
    return { ok: false, error: "invalid-json" };
  }
}

/** DSSE v1 pre-authentication encoding over exact payload bytes. */
export function dssePreAuthenticationEncoding(payloadType: string, payload: Uint8Array): Buffer {
  const typeBytes = Buffer.from(payloadType, "utf8");
  const payloadBytes = Buffer.from(payload);
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${typeBytes.length} `, "ascii"),
    typeBytes,
    Buffer.from(` ${payloadBytes.length} `, "ascii"),
    payloadBytes,
  ]);
}

function initialAssurance(): CheckpointAssurance {
  return {
    envelopeSchema: "not-evaluated",
    payloadType: "not-evaluated",
    payloadBinding: "not-evaluated",
    statementSchema: "not-evaluated",
    publicKey: "not-evaluated",
    keyFingerprint: "not-evaluated",
    authorSignature: "not-evaluated",
    authorIdentity: "not-evaluated",
    independentTime: "absent",
    eventChain: "not-evaluated",
    sourceCoverage: "not-evaluated",
    brokerIssuance: "not-evaluated",
    brokerExecution: "not-evaluated",
    recordCompleteness: "not-evaluated",
  };
}

const LIMITATIONS = [
  "signature-does-not-prove-broker-issuance",
  "checkpoint-does-not-prove-execution",
  "checkpoint-does-not-prove-record-completeness",
  "checkpoint-does-not-prove-investment-skill",
] as const;

function checkpointId(payload: Buffer) {
  return createHash("sha256").update(CHECKPOINT_ID_DOMAIN).update(payload).digest("hex");
}

function parseErrorCode(prefix: "envelope" | "statement", error: JsonParseError): CheckpointVerificationError {
  return `${prefix}.${error}` as CheckpointVerificationError;
}

/**
 * Offline verifier for the single-signature Runbook DSSE v1 checkpoint profile.
 * It never interprets a valid signature as broker issuance, execution, or completeness.
 */
export function verifyCheckpoint(input: CheckpointVerificationInput): CheckpointVerificationResult {
  const errors: CheckpointVerificationError[] = [];
  const assurance = initialAssurance();
  const envelopeBytes = Buffer.from(input.envelopeJson);
  const suppliedStatementBytes = Buffer.from(input.statementJson);
  const publicKeyBytes = Buffer.from(input.publicKeySpkiDer);
  let envelope: DsseEnvelope | null = null;
  let payload: Buffer | null = null;
  let statement: CheckpointStatement | null = null;
  let publicKeyFingerprint: `sha256:${string}` | null = null;
  let publicKey: ReturnType<typeof createPublicKey> | null = null;

  if (envelopeBytes.length === 0 || envelopeBytes.length > MAX_ENVELOPE_BYTES) errors.push("input.envelope-size-invalid");
  if (suppliedStatementBytes.length === 0 || suppliedStatementBytes.length > MAX_STATEMENT_BYTES) errors.push("input.statement-size-invalid");
  if (publicKeyBytes.length === 0 || publicKeyBytes.length > MAX_PUBLIC_KEY_BYTES) errors.push("input.public-key-size-invalid");

  if (!errors.includes("input.envelope-size-invalid")) {
    const parsedEnvelopeJson = parseStrictJson(envelopeBytes);
    if (!parsedEnvelopeJson.ok) {
      errors.push(parseErrorCode("envelope", parsedEnvelopeJson.error));
      assurance.envelopeSchema = "invalid";
    } else {
      const parsedEnvelope = dsseEnvelopeSchema.safeParse(parsedEnvelopeJson.value);
      if (!parsedEnvelope.success) {
        errors.push("envelope.schema-invalid");
        assurance.envelopeSchema = "invalid";
      } else {
        envelope = parsedEnvelope.data;
        assurance.envelopeSchema = "valid";
        assurance.payloadType = envelope.payloadType === RUNBOOK_CHECKPOINT_PAYLOAD_TYPE ? "valid" : "invalid";
        if (assurance.payloadType === "invalid") errors.push("payload.type-unsupported");
        payload = decodeBase64(envelope.payload);
        if (payload === null || payload.length === 0 || payload.length > MAX_STATEMENT_BYTES) {
          payload = null;
          errors.push("payload.size-invalid");
        }
      }
    }
  }

  if (payload !== null && !errors.includes("input.statement-size-invalid")) {
    assurance.payloadBinding = payload.equals(suppliedStatementBytes) ? "valid" : "invalid";
    if (assurance.payloadBinding === "invalid") errors.push("payload.byte-mismatch");
    const parsedStatementJson = parseStrictJson(payload);
    if (!parsedStatementJson.ok) {
      errors.push(parseErrorCode("statement", parsedStatementJson.error));
      assurance.statementSchema = "invalid";
    } else {
      const parsedStatement = checkpointStatementSchema.safeParse(parsedStatementJson.value);
      if (!parsedStatement.success) {
        errors.push("statement.schema-invalid");
        assurance.statementSchema = "invalid";
      } else {
        statement = parsedStatement.data;
        assurance.statementSchema = "valid";
      }
    }
  }

  if (!errors.includes("input.public-key-size-invalid")) {
    try {
      publicKey = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
      if (publicKey.asymmetricKeyType !== "ed25519") {
        errors.push("key.algorithm-unsupported");
        assurance.publicKey = "invalid";
        publicKey = null;
      } else {
        const canonical = publicKey.export({ format: "der", type: "spki" });
        if (!Buffer.isBuffer(canonical) || !canonical.equals(publicKeyBytes)) {
          errors.push("key.encoding-noncanonical");
          assurance.publicKey = "invalid";
          publicKey = null;
        } else {
          publicKeyFingerprint = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
          assurance.publicKey = "valid";
        }
      }
    } catch {
      errors.push("key.invalid");
      assurance.publicKey = "invalid";
    }
  }

  if (envelope !== null && statement !== null && publicKeyFingerprint !== null) {
    const signatureKeyId = envelope.signatures[0].keyid;
    assurance.keyFingerprint = signatureKeyId === publicKeyFingerprint && statement.authorKeyId === publicKeyFingerprint
      ? "valid"
      : "invalid";
    if (assurance.keyFingerprint === "invalid") errors.push("key.fingerprint-mismatch");
  }

  if (envelope !== null && payload !== null && publicKey !== null) {
    const signature = decodeBase64(envelope.signatures[0].sig);
    const signatureValid = signature !== null
      && signature.length === 64
      && verify(null, dssePreAuthenticationEncoding(envelope.payloadType, payload), publicKey, signature);
    assurance.authorSignature = signatureValid ? "valid" : "invalid";
    if (!signatureValid) errors.push("signature.invalid");
  }

  const valid = errors.length === 0
    && assurance.envelopeSchema === "valid"
    && assurance.payloadType === "valid"
    && assurance.payloadBinding === "valid"
    && assurance.statementSchema === "valid"
    && assurance.publicKey === "valid"
    && assurance.keyFingerprint === "valid"
    && assurance.authorSignature === "valid";

  if (valid) {
    assurance.authorIdentity = "self-asserted-key";
    assurance.eventChain = "author-signed-commitment-only";
    assurance.sourceCoverage = "author-declared-metadata-only";
  }

  return checkpointVerificationResultSchema.parse({
    schemaVersion: "runbook.checkpoint-verification.v1",
    valid,
    checkpointId: valid && payload !== null ? checkpointId(payload) : null,
    publicKeyFingerprint,
    statement: valid ? statement : null,
    assurance,
    errors,
    limitations: LIMITATIONS,
  });
}
