import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathExists } from "../utils/fs";
import type { FileManifest, FileManifestEntry, FileRef } from "../contracts";
import { buildChatFileLinks } from "./importChatFiles";
import { convertResponseToArtifacts, importFetchedChats } from "./importChatResponses";

const PREFIX = "../../network/files";

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
  const links = buildChatFileLinks("c1", [ref({ fileName: "x.jpg" })], manifest, PREFIX);
  assert.equal(links.attachments.length, 1);
  assert.equal(links.attachments[0]?.status, "downloaded");
  assert.equal(links.attachments[0]?.messageId, "m1");
  assert.equal(links.attachments[0]?.localPath, "../../network/files/file_1/20261021_145816.jpg");
});

test("buildChatFileLinks dedups a key across parts and messages", () => {
  const manifest: FileManifest = { file_1: entry({}) };
  const links = buildChatFileLinks(
    "c1",
    [ref({}), ref({ kind: "image" }), ref({ messageId: "m3" })],
    manifest,
    PREFIX,
  );
  assert.equal(links.attachments.length, 1);
  assert.equal(links.attachments[0]?.messageId, "m1");
  assert.deepEqual(links.refsByMessageId.get("m1"), [{ attachmentId: "file_1", relation: "attachment", ordinal: 0 }]);
  assert.deepEqual(links.refsByMessageId.get("m3"), [{ attachmentId: "file_1", relation: "attachment", ordinal: 0 }]);
});

test("buildChatFileLinks leaves system refs without a message", () => {
  const links = buildChatFileLinks("c1", [ref({ role: "system" })], { file_1: entry({}) }, PREFIX);
  assert.equal(links.attachments[0]?.messageId, undefined);
});

test("buildChatFileLinks keeps each key directory for equal file names", () => {
  const manifest: FileManifest = {
    file_1: entry({ fileName: "scan.png", localPath: "file_1/scan.png" }),
    file_2: entry({ key: "file_2", fileName: "scan.png", localPath: "file_2/scan.png" }),
  };
  const links = buildChatFileLinks("c1", [ref({}), ref({ key: "file_2" })], manifest, PREFIX);
  assert.deepEqual(links.attachments.map((item) => item.localPath), [`${PREFIX}/file_1/scan.png`, `${PREFIX}/file_2/scan.png`]);
});

test("buildChatFileLinks marks keys absent from manifest as missing", () => {
  const links = buildChatFileLinks("c1", [ref({ fileName: "a.png" })], {}, PREFIX);
  assert.equal(links.attachments[0]?.status, "missing");
  assert.equal(links.attachments[0]?.error, "not in manifest");
  assert.equal(links.attachments[0]?.localPath, "");
});

test("buildChatFileLinks sets sourceUrl for sandbox refs", () => {
  const key = "sandbox:c1:m1:/mnt/data/Попов.zip";
  const links = buildChatFileLinks(
    "c1",
    [ref({ key, kind: "sandbox", role: "assistant", fileName: "Попов.zip", sandboxPath: "/mnt/data/Попов.zip" })],
    {},
    PREFIX,
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
  const result = convertResponseToArtifacts(payload, "c1", new Map(), "https://chatgpt.com", {}, PREFIX);
  assert.ok(result);
  assert.deepEqual(result.messages.map((message) => message.role), ["user", "tool"]);
  assert.ok(result.messages.every((message) => message.attachmentRefs.length > 0));
  assert.equal(result.attachments.length, 2);
});

test("convertResponseToArtifacts returns null for an empty chat", () => {
  const payload = {
    title: "New chat",
    mapping: { root: { id: "root", parent: null, children: [], message: null } },
  };
  assert.equal(convertResponseToArtifacts(payload, "c1", new Map(), "https://chatgpt.com", {}, PREFIX), null);
});

async function setupImport(outDir: string): Promise<void> {
  const payload = {
    title: "Chat",
    mapping: {
      n1: {
        id: "m1",
        parent: null,
        children: [],
        message: {
          id: "m1",
          author: { role: "user" },
          content: { content_type: "text", parts: ["hi"] },
          metadata: { attachments: [{ id: "file_1", name: "a.pdf", mime_type: "application/pdf" }] },
        },
      },
    },
  };
  const manifest = {
    file_1: { key: "file_1", kind: "attachment", fileName: "a.pdf", status: "downloaded", localPath: "file_1/a.pdf", seenIn: [] },
  };
  await mkdir(path.join(outDir, "network", "chats"), { recursive: true });
  await mkdir(path.join(outDir, "network", "files", "file_1"), { recursive: true });
  await writeFile(path.join(outDir, "network", "chats", "c1.json"), JSON.stringify(payload));
  await writeFile(path.join(outDir, "network", "files", "manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(outDir, "network", "files", "file_1", "a.pdf"), "pdf");
}

test("importFetchedChats links the shared store and drops stale copies", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "archiver-import-"));
  try {
    await setupImport(outDir);
    await mkdir(path.join(outDir, "chats", "c1", "files"), { recursive: true });
    await writeFile(path.join(outDir, "chats", "c1", "files", "old.txt"), "old");

    await importFetchedChats({ outDir });

    const attachments = JSON.parse(await readFile(path.join(outDir, "chats", "c1", "attachments.json"), "utf8"));
    assert.equal(attachments[0].status, "downloaded");
    assert.equal(attachments[0].localPath, "../../network/files/file_1/a.pdf");
    assert.equal(await pathExists(path.join(outDir, "chats", "c1", "files")), false);
    assert.equal(await readFile(path.join(outDir, "network", "files", "file_1", "a.pdf"), "utf8"), "pdf");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("importFetchedChats marks a downloaded file absent from disk as missing", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "archiver-import-"));
  try {
    await setupImport(outDir);
    await rm(path.join(outDir, "network", "files", "file_1", "a.pdf"));

    await importFetchedChats({ outDir });

    const attachments = JSON.parse(await readFile(path.join(outDir, "chats", "c1", "attachments.json"), "utf8"));
    assert.equal(attachments[0].status, "missing");
    assert.equal(attachments[0].error, "local file missing");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
