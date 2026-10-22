import assert from "node:assert/strict";

export interface ParsedZipEntry {
  name: string;
  size: number;
  crc: number;
  data: Buffer;
}

export function parseZip(zip: Buffer): ParsedZipEntry[] {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries: ParsedZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    assert.equal(zip.readUInt16LE(offset + 8) & 0x0800, 0x0800);
    assert.equal(zip.readUInt16LE(offset + 10), 0);
    const crc = zip.readUInt32LE(offset + 16);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const dataStart = localOffset + 30 + localNameLength;
    entries.push({ name, size, crc, data: zip.subarray(dataStart, dataStart + size) });
    offset += 46 + nameLength;
  }
  return entries;
}
