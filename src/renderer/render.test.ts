import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AttachmentRecord, MessageRecord, StoredChatArtifacts } from "../contracts";
import { ArchiveStorage } from "../storage/archiveStorage";
import { StaticArchiveRenderer, rewriteSandboxLinks } from "./render";

export async function renderChatHtml(artifacts: StoredChatArtifacts): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "archiver-render-"));
  try {
    const storage = new ArchiveStorage(dir);
    await storage.ensureBaseStructure();
    await new StaticArchiveRenderer(storage).renderChat(artifacts);
    return await fs.readFile(path.join(dir, "chats", artifacts.chat.chatId, "chat.html"), "utf8");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function makeMessage(overrides: Partial<MessageRecord>): MessageRecord {
  return {
    messageId: "m1",
    chatId: "c1",
    ordinal: 0,
    role: "assistant",
    plainText: "",
    attachmentRefs: [],
    preferredSource: "network",
    sourceChannel: null,
    ...overrides
  };
}

function artifactsWith(message: MessageRecord): StoredChatArtifacts {
  return artifactsWithAll([message], []);
}

function artifactsWithAll(messages: MessageRecord[], attachments: AttachmentRecord[]): StoredChatArtifacts {
  return {
    chat: {
      schemaVersion: "1",
      chatId: "c1",
      title: "Test chat",
      url: "https://chatgpt.com/c/c1",
      archivedAt: "2026-01-01T00:00:00.000Z"
    },
    messages,
    attachments
  };
}

test("code message uses content.language for the fence", async () => {
  const html = await renderChatHtml(artifactsWith(makeMessage({
    sourceContentType: "code",
    plainText: '{"q":"x"}',
    sourceContent: { language: "json" }
  })));
  assert.match(html, /data-language="json"/);
  assert.doesNotMatch(html, /data-language="python"/);
});

test("code message with unknown language gets a plain fence", async () => {
  const html = await renderChatHtml(artifactsWith(makeMessage({
    sourceContentType: "code",
    plainText: "print(1)",
    sourceContent: { language: "unknown" }
  })));
  assert.match(html, /<pre><code/);
  assert.doesNotMatch(html, /data-language=/);
});

function makeAttachment(overrides: Partial<AttachmentRecord>): AttachmentRecord {
  return {
    attachmentId: "a1",
    chatId: "c1",
    messageId: "m1",
    fileName: "a.png",
    localPath: "files/a.png",
    status: "downloaded",
    ...overrides
  };
}

test("rewriteSandboxLinks maps raw and encoded links and leaves others", () => {
  const links = new Map([["sandbox:/mnt/data/П.zip", "./files/%D0%9F.zip"]]);
  assert.equal(rewriteSandboxLinks("[z](sandbox:/mnt/data/%D0%9F.zip)", links), "[z](./files/%D0%9F.zip)");
  assert.equal(rewriteSandboxLinks("[z](sandbox:/mnt/data/П.zip)", links), "[z](./files/%D0%9F.zip)");
  assert.equal(rewriteSandboxLinks("[z](sandbox:/mnt/data/other.zip)", links), "[z](sandbox:/mnt/data/other.zip)");
});

test("renders a downloaded image inline", async () => {
  const html = await renderChatHtml(artifactsWithAll(
    [makeMessage({ role: "user", plainText: "hi" })],
    [makeAttachment({ mimeType: "image/png", localPath: "files/a b.png" })]
  ));
  assert.match(html, /<img src="\.\/files\/a%20b\.png"/);
});

test("renders a pdf card with size and type", async () => {
  const html = await renderChatHtml(artifactsWithAll(
    [makeMessage({ role: "user", plainText: "hi" })],
    [makeAttachment({ fileName: "r.pdf", localPath: "files/r.pdf", mimeType: "application/pdf", sizeBytes: 4201864 })]
  ));
  assert.match(html, /4\.0 MB · application\/pdf/);
  assert.match(html, /Open local copy/);
});

test("renders a placeholder for missing files", async () => {
  const html = await renderChatHtml(artifactsWithAll(
    [makeMessage({ role: "user", plainText: "hi" })],
    [makeAttachment({ status: "missing" })]
  ));
  assert.match(html, /Unavailable on server/);
  assert.doesNotMatch(html, /href="\.\/files\//);
});

test("renders project files in the header", async () => {
  const html = await renderChatHtml(artifactsWithAll(
    [makeMessage({ role: "user", plainText: "hi" })],
    [makeAttachment({ messageId: undefined, fileName: "spec.txt", localPath: "files/spec.txt" })]
  ));
  const headerIndex = html.indexOf("<h2>Project files</h2>");
  assert.ok(headerIndex >= 0);
  assert.ok(headerIndex < html.indexOf('class="message-list"'));
});

test("attaches generated images to the assistant turn", async () => {
  const html = await renderChatHtml(artifactsWithAll(
    [
      makeMessage({ messageId: "m1", ordinal: 0, role: "user", plainText: "draw" }),
      makeMessage({ messageId: "m2", ordinal: 1, role: "assistant", plainText: "Here", sourceTurnExchangeId: "t1" }),
      makeMessage({ messageId: "m3", ordinal: 2, role: "tool", plainText: '{"json":1}', sourceTurnExchangeId: "t1" })
    ],
    [makeAttachment({ messageId: "m3", mimeType: "image/png" })]
  ));
  const assistantItems = html.match(/<li class="message role-assistant"/g) ?? [];
  assert.equal(assistantItems.length, 1);
  const item = html.slice(html.indexOf('<li class="message role-assistant"'));
  assert.match(item, /Here/);
  assert.match(item, /<img /);
  assert.doesNotMatch(html, /\{"json":1\}/);
});

test("rewrites downloaded sandbox links", async () => {
  const html = await renderChatHtml(artifactsWithAll(
    [makeMessage({ plainText: "[zip](sandbox:/mnt/data/x.zip)" })],
    [makeAttachment({ messageId: "m1", fileName: "x.zip", localPath: "files/x.zip", sourceUrl: "sandbox:/mnt/data/x.zip" })]
  ));
  assert.match(html, /href="\.\/files\/x\.zip"/);
});

test("escapes attachment file names", async () => {
  const html = await renderChatHtml(artifactsWithAll(
    [makeMessage({ role: "user", plainText: "hi" })],
    [makeAttachment({ fileName: "<b>x</b>.png", mimeType: "image/png" })]
  ));
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});
