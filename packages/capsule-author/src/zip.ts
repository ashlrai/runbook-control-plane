import { concatBytes, utf8 } from "./bytes.js";

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size: number) {
  return new Uint8Array(size);
}

function set16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function set32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

export type ArchiveMember = { path: string; bytes: Uint8Array };

/** Emits the exact deterministic STORED-only ZIP profile required by Proof Capsule v1. */
export function assembleProofCapsuleZip(members: readonly ArchiveMember[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const member of members) {
    const name = utf8(member.path);
    const checksum = crc32(member.bytes);
    const local = header(30);
    set32(local, 0, 0x04034b50);
    set16(local, 4, 20);
    set16(local, 6, 0x0800);
    set16(local, 8, 0);
    set16(local, 10, 0);
    set16(local, 12, 0x0021);
    set32(local, 14, checksum);
    set32(local, 18, member.bytes.byteLength);
    set32(local, 22, member.bytes.byteLength);
    set16(local, 26, name.byteLength);
    set16(local, 28, 0);
    localParts.push(local, name, member.bytes);

    const central = header(46);
    set32(central, 0, 0x02014b50);
    set16(central, 4, 0x0314);
    set16(central, 6, 20);
    set16(central, 8, 0x0800);
    set16(central, 10, 0);
    set16(central, 12, 0);
    set16(central, 14, 0x0021);
    set32(central, 16, checksum);
    set32(central, 20, member.bytes.byteLength);
    set32(central, 24, member.bytes.byteLength);
    set16(central, 28, name.byteLength);
    set16(central, 30, 0);
    set16(central, 32, 0);
    set16(central, 34, 0);
    set16(central, 36, 0);
    set32(central, 38, 0x81a40000);
    set32(central, 42, localOffset);
    centralParts.push(central, name);

    localOffset += local.byteLength + name.byteLength + member.bytes.byteLength;
  }

  const centralDirectory = concatBytes(...centralParts);
  const eocd = header(22);
  set32(eocd, 0, 0x06054b50);
  set16(eocd, 4, 0);
  set16(eocd, 6, 0);
  set16(eocd, 8, members.length);
  set16(eocd, 10, members.length);
  set32(eocd, 12, centralDirectory.byteLength);
  set32(eocd, 16, localOffset);
  set16(eocd, 20, 0);
  return concatBytes(...localParts, centralDirectory, eocd);
}
