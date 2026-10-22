import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MessageRecord, StoredChatArtifacts } from "../contracts";
import { ArchiveStorage } from "../storage/archiveStorage";
import { StaticArchiveRenderer } from "./render";

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
  return {
    chat: {
      schemaVersion: "1",
      chatId: "c1",
      title: "Test chat",
      url: "https://chatgpt.com/c/c1",
      archivedAt: "2026-01-01T00:00:00.000Z"
    },
    messages: [message],
    attachments: []
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
