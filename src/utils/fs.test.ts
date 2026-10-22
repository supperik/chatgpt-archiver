import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, sanitizeFileName, toSafeFileName } from "./fs";

test("sanitizeFileName removes reserved characters", () => {
  assert.equal(sanitizeFileName('inv:alid*name?.txt'), "inv_alid_name_.txt");
});

test("sanitizeFileName falls back for empty results", () => {
  assert.equal(sanitizeFileName("..."), "unnamed");
});

test("toSafeFileName takes the basename on / and \\", () => {
  assert.equal(toSafeFileName("user-F5__72cb/a24e/mnt/data/QA_contact.png"), "QA_contact.png");
  assert.equal(toSafeFileName("C:\\dir\\report.pdf"), "report.pdf");
  assert.equal(toSafeFileName("../../etc/passwd"), "passwd");
});

test("toSafeFileName keeps unicode names", () => {
  assert.equal(
    toSafeFileName("Элегантная вывеска юридического офиса.png"),
    "Элегантная вывеска юридического офиса.png",
  );
});

test("toSafeFileName prefixes Windows reserved names", () => {
  assert.equal(toSafeFileName("CON.txt"), "_CON.txt");
  assert.equal(toSafeFileName("nul"), "_nul");
  assert.equal(toSafeFileName("com1.tar.gz"), "_com1.tar.gz");
});

test("toSafeFileName falls back to file plus mime extension", () => {
  assert.equal(toSafeFileName(undefined, "image/png"), "file.png");
  assert.equal(toSafeFileName("", "application/pdf"), "file.pdf");
  assert.equal(toSafeFileName(undefined, "image/svg+xml"), "file.svg");
  assert.equal(toSafeFileName(undefined, "text/plain; charset=utf-8"), "file.plain");
  assert.equal(toSafeFileName(undefined, undefined), "file");
});

test("toSafeFileName caps length at 120 keeping the extension", () => {
  const result = toSafeFileName("a".repeat(300) + ".docx");
  assert.ok(result.length <= 120);
  assert.ok(result.endsWith(".docx"));
});

test("formatBytes uses base 1024", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(4201864), "4.0 MB");
});
