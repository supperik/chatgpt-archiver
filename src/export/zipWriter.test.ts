import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { parseZip } from "./parseZip.testHelper";
import { assertZipLimits, writeZip } from "./zipWriter";

test("writeZip stores entries with UTF-8 names and correct CRC", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "archiver-zip-"));
  try {
    const dest = path.join(dir, "out.zip");
    const binary = Buffer.from([0, 255, 1, 254, 128]);
    await writeZip(dest, [
      { name: "Попов.md", data: Buffer.from("привет", "utf8") },
      { name: "b.bin", data: binary },
    ]);

    const entries = parseZip(await readFile(dest));
    assert.deepEqual(entries.map((entry) => entry.name), ["Попов.md", "b.bin"]);
    assert.equal(entries[0]!.data.toString("utf8"), "привет");
    assert.deepEqual(entries[1]!.data, binary);
    assert.equal(entries[1]!.crc, zlib.crc32(binary));
    assert.equal(entries[1]!.size, binary.length);
    assert.deepEqual(await readdir(dir), ["out.zip"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertZipLimits rejects oversized files, totals and too many entries", () => {
  assert.doesNotThrow(() => assertZipLimits([1, 2, 3]));
  assert.throws(() => assertZipLimits([2 ** 32]), /4 GiB/);
  assert.throws(() => assertZipLimits([2 ** 31, 2 ** 31]), /4 GiB/);
  assert.throws(() => assertZipLimits(new Array(65536).fill(0)), /65535/);
});
