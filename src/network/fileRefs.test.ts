import test from "node:test";
import assert from "node:assert/strict";
import { extractFileRefs } from "./fileRefs";

function payloadWith(role: string, content: unknown, metadata: unknown = {}): unknown {
  return { mapping: { n1: { id: "m1", message: { id: "m1", author: { role }, content, metadata } } } };
}

test("extractFileRefs reads user attachments", () => {
  const payload = payloadWith(
    "user",
    { content_type: "text", parts: ["hi"] },
    { attachments: [{ id: "file_00a", name: "20261021_145816.jpg", mime_type: "image/jpeg", size: 1025181 }] },
  );
  assert.deepEqual(extractFileRefs(payload, "c1"), [
    {
      key: "file_00a",
      kind: "attachment",
      chatId: "c1",
      messageId: "m1",
      role: "user",
      fileName: "20261021_145816.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1025181,
    },
  ]);
});

test("extractFileRefs accepts camelCase mimeType", () => {
  const payload = payloadWith("user", { content_type: "text", parts: [] }, { attachments: [{ id: "file_00a", name: "a.png", mimeType: "image/png" }] });
  assert.equal(extractFileRefs(payload, "c1")[0]?.mimeType, "image/png");
});

test("extractFileRefs reads image asset pointers", () => {
  const payload = payloadWith("user", {
    content_type: "multimodal_text",
    parts: ["text", { content_type: "image_asset_pointer", asset_pointer: "sediment://file_00b", size_bytes: 2009383 }],
  });
  const refs = extractFileRefs(payload, "c1");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.key, "file_00b");
  assert.equal(refs[0]?.kind, "image");
  assert.equal(refs[0]?.sizeBytes, 2009383);
  assert.ok(!refs[0]?.generated);
});

test("extractFileRefs marks generated images", () => {
  const payload = payloadWith("tool", {
    content_type: "multimodal_text",
    parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file_00c", metadata: { generation: { gen_id: "g" }, dalle: null } }],
  });
  const refs = extractFileRefs(payload, "c1");
  assert.equal(refs[0]?.generated, true);
  assert.equal(refs[0]?.role, "tool");
});

test("extractFileRefs parses composite sediment pointers", () => {
  const payload = payloadWith("assistant", {
    content_type: "multimodal_text",
    parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://4cd614053a4baf0#file_000000002eec#p_0.91d6fec838.jpg" }],
  });
  assert.equal(extractFileRefs(payload, "c1")[0]?.key, "file_000000002eec");
});

test("extractFileRefs parses legacy file-service pointers", () => {
  const payload = payloadWith("user", {
    content_type: "multimodal_text",
    parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://file-AbC123xyz" }],
  });
  assert.equal(extractFileRefs(payload, "c1")[0]?.key, "file-AbC123xyz");
});

test("extractFileRefs finds sandbox links in assistant text", () => {
  const payload = payloadWith("assistant", {
    content_type: "text",
    parts: ["see [zip](sandbox:/mnt/data/%D0%9F%D0%BE%D0%BF%D0%BE%D0%B2.zip)"],
  });
  assert.deepEqual(extractFileRefs(payload, "c1"), [
    {
      key: "sandbox:c1:m1:/mnt/data/Попов.zip",
      kind: "sandbox",
      chatId: "c1",
      messageId: "m1",
      role: "assistant",
      fileName: "Попов.zip",
      sandboxPath: "/mnt/data/Попов.zip",
    },
  ]);
});

test("extractFileRefs ignores /mnt/data paths in code content", () => {
  const payload = payloadWith("assistant", { content_type: "code", text: "path='/mnt/data/x.csv'", language: "python" });
  assert.deepEqual(extractFileRefs(payload, "c1"), []);
});

test("extractFileRefs keeps system message attachments", () => {
  const payload = payloadWith("system", { content_type: "text", parts: [] }, { attachments: [{ id: "file_00d", name: "s.txt" }] });
  assert.equal(extractFileRefs(payload, "c1")[0]?.role, "system");
});

test("extractFileRefs returns empty for missing message or mapping", () => {
  assert.deepEqual(extractFileRefs({ mapping: { n1: { id: "n1", message: null } } }, "c1"), []);
  assert.deepEqual(extractFileRefs({}, "c1"), []);
});
