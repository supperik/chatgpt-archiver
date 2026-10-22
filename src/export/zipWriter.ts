import { rename, writeFile } from "node:fs/promises";
import zlib from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const MAX_ZIP_BYTES = 0xffffffff;
const MAX_ZIP_ENTRIES = 0xffff;
const UTF8_FLAG = 0x0800;

export function assertZipLimits(entrySizes: number[]): void {
  if (entrySizes.length > MAX_ZIP_ENTRIES) {
    throw new Error(`Zip supports at most ${MAX_ZIP_ENTRIES} entries, got ${entrySizes.length}`);
  }
  const total = entrySizes.reduce((sum, size) => sum + size, 0);
  if (entrySizes.some((size) => size > MAX_ZIP_BYTES) || total > MAX_ZIP_BYTES) {
    throw new Error("Zip without Zip64 cannot hold a file or a total larger than 4 GiB");
  }
}

export async function writeZip(destPath: string, entries: ZipEntry[]): Promise<void> {
  assertZipLimits(entries.map((entry) => entry.data.length));

  const { dosTime, dosDate } = toDosDateTime(new Date());
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = zlib.crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + size;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  assertZipLimits([offset + centralSize]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  const partPath = `${destPath}.part`;
  await writeFile(partPath, Buffer.concat([...localParts, ...centralParts, end]));
  await rename(partPath, destPath);
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    dosDate: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
