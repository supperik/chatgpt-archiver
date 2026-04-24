import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFileName } from "./fs";

test("sanitizeFileName removes reserved characters", () => {
  assert.equal(sanitizeFileName('inv:alid*name?.txt'), "inv_alid_name_.txt");
});

test("sanitizeFileName falls back for empty results", () => {
  assert.equal(sanitizeFileName("..."), "unnamed");
});
