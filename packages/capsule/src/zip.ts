export const CAPSULE_CONTROL_MEMBER_NAMES = [
  "mimetype",
  "runbook/manifest.json",
  "runbook/checkpoint.statement.json",
  "runbook/checkpoint.dsse.json",
  "runbook/author-key.spki.der",
] as const;

export type CapsuleControlMemberName = typeof CAPSULE_CONTROL_MEMBER_NAMES[number];

export type ZipErrorCode =
  | "input.size-limit"
  | "zip.eocd-invalid"
  | "zip.multidisk-forbidden"
  | "zip.zip64-forbidden"
  | "zip.entry-count-limit"
  | "zip.field-unsupported"
  | "zip.compression-forbidden"
  | "zip.encryption-forbidden"
  | "zip.data-descriptor-forbidden"
  | "zip.extra-field-forbidden"
  | "zip.comment-forbidden"
  | "zip.path-invalid"
  | "zip.path-duplicate"
  | "zip.path-case-collision"
  | "zip.order-invalid"
  | "zip.header-mismatch"
  | "zip.range-invalid"
  | "zip.trailing-data"
  | "zip.crc-mismatch"
  | "control.member-missing"
  | "control.member-extra"
  | "control.mimetype-invalid"
  | "manifest.size-invalid"
  | "statement.size-invalid"
  | "envelope.size-invalid"
  | "key.invalid";

export class ZipError extends Error {
  constructor(readonly code: ZipErrorCode) {
    super(code);
  }
}

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 64;
const MAX_PAYLOAD_ENTRIES = 59;
const MAX_PAYLOAD_MEMBER_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_BYTES = 60 * 1024 * 1024;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const REQUIRED_FLAGS = 0x0800;
const REQUIRED_VERSION = 20;
const REQUIRED_VERSION_MADE_BY = 0x0314;
const REQUIRED_DOS_TIME = 0x0000;
const REQUIRED_DOS_DATE = 0x0021;
const REQUIRED_EXTERNAL_ATTRIBUTES = 0x81a40000;

const CONTROL_LIMITS: Record<CapsuleControlMemberName, { minimum: number; maximum: number; error: ZipErrorCode }> = {
  mimetype: { minimum: 43, maximum: 43, error: "control.mimetype-invalid" },
  "runbook/manifest.json": { minimum: 1, maximum: 64 * 1024, error: "manifest.size-invalid" },
  "runbook/checkpoint.statement.json": { minimum: 1, maximum: 64 * 1024, error: "statement.size-invalid" },
  "runbook/checkpoint.dsse.json": { minimum: 1, maximum: 128 * 1024, error: "envelope.size-invalid" },
  "runbook/author-key.spki.der": { minimum: 44, maximum: 44, error: "key.invalid" },
};

type CentralEntry = {
  name: string;
  nameBytes: Buffer;
  crc32: number;
  size: number;
  localOffset: number;
};

export type ParsedCapsuleZip = {
  members: Map<string, Buffer>;
  order: string[];
};

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(bytes: Buffer, offset: number, code: ZipErrorCode = "zip.eocd-invalid") {
  if (offset < 0 || offset + 2 > bytes.length) throw new ZipError(code);
  return bytes.readUInt16LE(offset);
}

function u32(bytes: Buffer, offset: number, code: ZipErrorCode = "zip.eocd-invalid") {
  if (offset < 0 || offset + 4 > bytes.length) throw new ZipError(code);
  return bytes.readUInt32LE(offset);
}

function findEocd(bytes: Buffer) {
  if (bytes.length < 22) throw new ZipError("zip.eocd-invalid");
  const exactOffset = bytes.length - 22;
  if (u32(bytes, exactOffset) === EOCD_SIGNATURE) {
    if (u16(bytes, exactOffset + 20) !== 0) throw new ZipError("zip.comment-forbidden");
    return exactOffset;
  }
  const minimum = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = exactOffset - 1; offset >= minimum; offset -= 1) {
    if (u32(bytes, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = u16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length && commentLength > 0) throw new ZipError("zip.comment-forbidden");
    throw new ZipError("zip.trailing-data");
  }
  throw new ZipError("zip.eocd-invalid");
}

function validatePath(nameBytes: Buffer) {
  if (nameBytes.length === 0 || nameBytes.length > 240) throw new ZipError("zip.path-invalid");
  if ([...nameBytes].some((byte) => byte < 0x20 || byte > 0x7e || (byte >= 0x41 && byte <= 0x5a))) {
    throw new ZipError("zip.path-invalid");
  }
  const name = nameBytes.toString("ascii");
  if ((CAPSULE_CONTROL_MEMBER_NAMES as readonly string[]).includes(name)) return name;
  if (name.startsWith("runbook/")) throw new ZipError("control.member-extra");
  if (!name.startsWith("payload/") || name.startsWith("/") || name.endsWith("/") || name.includes("\\") || name.includes("%")) {
    throw new ZipError("zip.path-invalid");
  }
  const components = name.split("/");
  if (components.length < 2 || components.length > 9) throw new ZipError("zip.path-invalid");
  if (components.slice(1).some((component) => !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(component))) {
    throw new ZipError("zip.path-invalid");
  }
  return name;
}

function validateFlags(flags: number) {
  if ((flags & 0x0041) !== 0) throw new ZipError("zip.encryption-forbidden");
  if ((flags & 0x0008) !== 0) throw new ZipError("zip.data-descriptor-forbidden");
  if (flags !== REQUIRED_FLAGS) throw new ZipError("zip.field-unsupported");
}

function validateArchiveOrder(names: string[]) {
  for (let index = 0; index < CAPSULE_CONTROL_MEMBER_NAMES.length; index += 1) {
    if (names[index] !== CAPSULE_CONTROL_MEMBER_NAMES[index]) throw new ZipError("control.member-missing");
  }
  const payloadNames = names.slice(CAPSULE_CONTROL_MEMBER_NAMES.length);
  if (payloadNames.length > MAX_PAYLOAD_ENTRIES) throw new ZipError("zip.entry-count-limit");
  const sorted = [...payloadNames].sort((left, right) => Buffer.compare(Buffer.from(left, "ascii"), Buffer.from(right, "ascii")));
  if (payloadNames.some((name, index) => name !== sorted[index])) throw new ZipError("zip.order-invalid");
}

function parseCentralDirectory(bytes: Buffer, eocdOffset: number) {
  const diskNumber = u16(bytes, eocdOffset + 4);
  const centralDisk = u16(bytes, eocdOffset + 6);
  const entriesOnDisk = u16(bytes, eocdOffset + 8);
  const entryCount = u16(bytes, eocdOffset + 10);
  const centralSize = u32(bytes, eocdOffset + 12);
  const centralOffset = u32(bytes, eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new ZipError("zip.multidisk-forbidden");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new ZipError("zip.zip64-forbidden");
  if (entryCount < CAPSULE_CONTROL_MEMBER_NAMES.length || entryCount > MAX_ENTRIES) throw new ZipError("zip.entry-count-limit");
  if (centralOffset + centralSize !== eocdOffset || centralOffset >= eocdOffset) throw new ZipError("zip.eocd-invalid");

  const entries: CentralEntry[] = [];
  const names = new Set<string>();
  const foldedNames = new Set<string>();
  let totalPayloadBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocdOffset || u32(bytes, cursor, "zip.eocd-invalid") !== CENTRAL_SIGNATURE) {
      throw new ZipError("zip.eocd-invalid");
    }
    const versionMadeBy = u16(bytes, cursor + 4);
    const versionNeeded = u16(bytes, cursor + 6);
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const dosTime = u16(bytes, cursor + 12);
    const dosDate = u16(bytes, cursor + 14);
    const entryCrc = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const diskStart = u16(bytes, cursor + 34);
    const internalAttributes = u16(bytes, cursor + 36);
    const externalAttributes = u32(bytes, cursor + 38);
    const localOffset = u32(bytes, cursor + 42);
    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff
      || diskStart === 0xffff
    ) throw new ZipError("zip.zip64-forbidden");
    validateFlags(flags);
    if (method !== 0) throw new ZipError("zip.compression-forbidden");
    if (extraLength !== 0) throw new ZipError("zip.extra-field-forbidden");
    if (commentLength !== 0) throw new ZipError("zip.comment-forbidden");
    if (
      versionMadeBy !== REQUIRED_VERSION_MADE_BY
      || versionNeeded !== REQUIRED_VERSION
      || dosTime !== REQUIRED_DOS_TIME
      || dosDate !== REQUIRED_DOS_DATE
      || diskStart !== 0
      || internalAttributes !== 0
      || externalAttributes !== REQUIRED_EXTERNAL_ATTRIBUTES
    ) throw new ZipError("zip.field-unsupported");
    if (compressedSize !== uncompressedSize) throw new ZipError("zip.header-mismatch");
    const end = cursor + 46 + nameLength;
    if (nameLength === 0 || end > eocdOffset) throw new ZipError("zip.eocd-invalid");
    const nameBytes = Buffer.from(bytes.subarray(cursor + 46, end));
    // latin1 preserves every raw byte for precedence checks; Node's "ascii"
    // decoder masks bit 7 and can turn an invalid path into a false duplicate.
    const rawName = nameBytes.toString("latin1");
    const folded = rawName.toLowerCase();
    if (names.has(rawName)) throw new ZipError("zip.path-duplicate");
    if (foldedNames.has(folded)) throw new ZipError("zip.path-case-collision");
    const name = validatePath(nameBytes);
    names.add(name);
    foldedNames.add(folded);

    const controlLimit = CONTROL_LIMITS[name as CapsuleControlMemberName];
    if (controlLimit !== undefined) {
      if (uncompressedSize < controlLimit.minimum || uncompressedSize > controlLimit.maximum) throw new ZipError(controlLimit.error);
    } else {
      if (uncompressedSize > MAX_PAYLOAD_MEMBER_BYTES) throw new ZipError("input.size-limit");
      totalPayloadBytes += uncompressedSize;
      if (totalPayloadBytes > MAX_TOTAL_PAYLOAD_BYTES) throw new ZipError("input.size-limit");
    }
    entries.push({ name, nameBytes, crc32: entryCrc, size: uncompressedSize, localOffset });
    cursor = end;
  }
  if (cursor !== eocdOffset) throw new ZipError("zip.eocd-invalid");
  validateArchiveOrder(entries.map((entry) => entry.name));
  return { entries, centralOffset };
}

function readLocalEntries(bytes: Buffer, entries: CentralEntry[], centralOffset: number): ParsedCapsuleZip {
  const members = new Map<string, Buffer>();
  let expectedOffset = 0;
  for (const entry of entries) {
    if (entry.localOffset !== expectedOffset) throw new ZipError("zip.range-invalid");
    const offset = entry.localOffset;
    if (offset + 30 > centralOffset || u32(bytes, offset, "zip.range-invalid") !== LOCAL_SIGNATURE) {
      throw new ZipError("zip.range-invalid");
    }
    const versionNeeded = u16(bytes, offset + 4, "zip.range-invalid");
    const flags = u16(bytes, offset + 6, "zip.range-invalid");
    const method = u16(bytes, offset + 8, "zip.range-invalid");
    const dosTime = u16(bytes, offset + 10, "zip.range-invalid");
    const dosDate = u16(bytes, offset + 12, "zip.range-invalid");
    const entryCrc = u32(bytes, offset + 14, "zip.range-invalid");
    const compressedSize = u32(bytes, offset + 18, "zip.range-invalid");
    const uncompressedSize = u32(bytes, offset + 22, "zip.range-invalid");
    const nameLength = u16(bytes, offset + 26, "zip.range-invalid");
    const extraLength = u16(bytes, offset + 28, "zip.range-invalid");
    validateFlags(flags);
    if (method !== 0) throw new ZipError("zip.compression-forbidden");
    if (extraLength !== 0) throw new ZipError("zip.extra-field-forbidden");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new ZipError("zip.range-invalid");
    const localName = bytes.subarray(nameStart, nameStart + nameLength);
    if (
      versionNeeded !== REQUIRED_VERSION
      || flags !== REQUIRED_FLAGS
      || dosTime !== REQUIRED_DOS_TIME
      || dosDate !== REQUIRED_DOS_DATE
      || entryCrc !== entry.crc32
      || compressedSize !== entry.size
      || uncompressedSize !== entry.size
      || !localName.equals(entry.nameBytes)
    ) throw new ZipError("zip.header-mismatch");
    const memberBytes = Buffer.from(bytes.subarray(dataStart, dataEnd));
    if (crc32(memberBytes) !== entry.crc32) throw new ZipError("zip.crc-mismatch");
    members.set(entry.name, memberBytes);
    expectedOffset = dataEnd;
  }
  if (expectedOffset !== centralOffset) throw new ZipError("zip.range-invalid");
  return { members, order: entries.map((entry) => entry.name) };
}

export function readCapsuleMembers(input: Uint8Array): ParsedCapsuleZip {
  if (input.byteLength < 1 || input.byteLength > MAX_ARCHIVE_BYTES) throw new ZipError("input.size-limit");
  const bytes = Buffer.from(input);
  if (bytes.length < 4 || u32(bytes, 0, "zip.range-invalid") !== LOCAL_SIGNATURE) throw new ZipError("zip.range-invalid");
  const eocdOffset = findEocd(bytes);
  const { entries, centralOffset } = parseCentralDirectory(bytes, eocdOffset);
  return readLocalEntries(bytes, entries, centralOffset);
}

export const ZIP_PROFILE_CONSTANTS = {
  flags: REQUIRED_FLAGS,
  version: REQUIRED_VERSION,
  versionMadeBy: REQUIRED_VERSION_MADE_BY,
  dosTime: REQUIRED_DOS_TIME,
  dosDate: REQUIRED_DOS_DATE,
  externalAttributes: REQUIRED_EXTERNAL_ATTRIBUTES,
} as const;
