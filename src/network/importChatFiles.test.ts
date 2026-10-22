import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FileManifest, FileManifestEntry, FileRef } from "../contracts";
import { buildChatFileLinks, copyChatFiles } from "./importChatFiles";
import { convertResponseToArtifacts } from "./importChatResponses";

function ref(overrides: Partial<FileRef>): FileRef {
  return { key: "file_1", kind: "attachment", chatId: "c1", messageId: "m1", role: "user", ...overrides };
}

function entry(overrides: Partial<FileManifestEntry>): FileManifestEntry {
  return { key: "file_1", kind: "attachment", fileName: "a.png", status: "downloaded", localPath: "file_1/a.png", seenIn: [], ...overrides };
}

test("buildChatFileLinks links a downloaded user image", () => {
  const manifest: FileManifest = {
    file_1: entry({ fileName: "20261021_145816.jpg", localPath: "file_1/20261021_145816.jpg" }),
  };
  const links = buildChatFileLinks("c1", [ref({ fileName: "x.jpg" })], manifest);
  assert.equal(links.attachments.length, 1);
  assert.equal(links.attachments[0]?.status, "downloaded");
  assert.equal(links.attachments[0]?.messageId, "m1");
  assert.equal(links.attachments[0]?.localPath, "files/20261021_145816.jpg");
  assert.deepEqual(links.copies, [{ from: "file_1/20261021_145816.jpg", to: "files/20261021_145816.jpg" }]);
});

test("buildChatFileLinks dedups a key across parts and messages", () => {
  const manifest: FileManifest = { file_1: entry({}) };
  const links = buildChatFileLinks(
    "c1",
    [ref({}), ref({ kind: "image" }), ref({ messageId: "m3" })],
    manifest,
  );
  assert.equal(links.attachments.length, 1);
  assert.equal(links.attachments[0]?.messageId, "m1");
  assert.deepEqual(links.refsByMessageId.get("m1"), [{ attachmentId: "file_1", relation: "attachment", ordinal: 0 }]);
  assert.deepEqual(links.refsByMessageId.get("m3"), [{ attachmentId: "file_1", relation: "attachment", ordinal: 0 }]);
});

test("buildChatFileLinks leaves system refs without a message", () => {
  const links = buildChatFileLinks("c1", [ref({ role: "system" })], { file_1: entry({}) });
  assert.equal(links.attachments[0]?.messageId, undefined);
});

test("buildChatFileLinks makes local names unique", () => {
  const manifest: FileManifest = {
    file_1: entry({ fileName: "scan.png", localPath: "file_1/scan.png" }),
    file_2: entry({ key: "file_2", fileName: "scan.png", localPath: "file_2/scan.png" }),
  };
  const links = buildChatFileLinks("c1", [ref({}), ref({ key: "file_2" })], manifest);
  assert.deepEqual(links.attachments.map((item) => item.localPath), ["files/scan.png", "files/scan (2).png"]);
});

test("buildChatFileLinks marks keys absent from manifest as missing", () => {
  const links = buildChatFileLinks("c1", [ref({ fileName: "a.png" })], {});
  assert.equal(links.attachments[0]?.status, "missing");
  assert.equal(links.attachments[0]?.error, "not in manifest");
  assert.deepEqual(links.copies, []);
});

test("buildChatFileLinks sets sourceUrl for sandbox refs", () => {
  const key = "sandbox:c1:m1:/mnt/data/Попов.zip";
  const links = buildChatFileLinks(
    "c1",
    [ref({ key, kind: "sandbox", role: "assistant", fileName: "Попов.zip", sandboxPath: "/mnt/data/Попов.zip" })],
    {},
  );
  assert.equal(links.attachments[0]?.sourceUrl, "sandbox:/mnt/data/Попов.zip");
});

test("convertResponseToArtifacts keeps file-bearing messages", () => {
  const payload = {
    mapping: {
      n1: {
        id: "m1",
        parent: null,
        children: ["m2", "m3"],
        message: {
          id: "m1",
          author: { role: "user" },
          content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://file_000aaa" }] },
        },
      },
      n2: {
        id: "m2",
        parent: "m1",
        children: [],
        message: {
          id: "m2",
          author: { role: "tool" },
          content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file_000bbb", metadata: { dalle: {} } }] },
        },
      },
      n3: {
        id: "m3",
        parent: "m1",
        children: [],
        message: { id: "m3", author: { role: "tool" }, content: { content_type: "text", parts: [""] } },
      },
    },
  };
  const result = convertResponseToArtifacts(payload, "c1", new Map(), "https://chatgpt.com", {});
  assert.deepEqual(result.messages.map((message) => message.role), ["user", "tool"]);
  assert.ok(result.messages.every((message) => message.attachmentRefs.length > 0));
  assert.equal(result.attachments.length, 2);
});

test("copyChatFiles copies files and reports missing sources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "archiver-import-"));
  try {
    const filesRoot = path.join(root, "files");
    const chatDir = path.join(root, "chat");
    await mkdir(path.join(filesRoot, "file_1"), { recursive: true });
    await writeFile(path.join(filesRoot, "file_1", "a.png"), "data");

    const missing = await copyChatFiles(
      [
        { from: "file_1/a.png", to: "files/a.png" },
        { from: "file_2/b.png", to: "files/b.png" },
      ],
      filesRoot,
      chatDir,
    );

    assert.deepEqual(missing, ["files/b.png"]);
    assert.equal(await readFile(path.join(chatDir, "files", "a.png"), "utf8"), "data");
    assert.deepEqual(await readdir(path.join(chatDir, "files")), ["a.png"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
