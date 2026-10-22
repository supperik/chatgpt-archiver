import test from "node:test";
import assert from "node:assert/strict";
import type { AttachmentRecord, MessageRecord, StoredChatArtifacts } from "../contracts";
import { buildChatMarkdown } from "./chatMarkdown";

function msg(overrides: Partial<MessageRecord>): MessageRecord {
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

function att(overrides: Partial<AttachmentRecord>): AttachmentRecord {
  return {
    attachmentId: "a1",
    chatId: "c1",
    messageId: "m1",
    fileName: "a.png",
    localPath: "../../network/files/file_1/a.png",
    status: "downloaded",
    ...overrides
  };
}

function chat(messages: MessageRecord[], attachments: AttachmentRecord[] = []): StoredChatArtifacts {
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

test("renders title and User/ChatGPT sections without extras", () => {
  const md = buildChatMarkdown(chat([
    msg({ messageId: "m1", ordinal: 0, role: "user", plainText: " Hello " }),
    msg({ messageId: "m2", ordinal: 1, role: "assistant", plainText: "Hi **there**" })
  ]), "without-files");
  assert.equal(md, "# Test chat\n\n## User\n\nHello\n\n## ChatGPT\n\nHi **there**");
});

test("leaves out thoughts, commentary, tool calls, hidden and system messages", () => {
  const md = buildChatMarkdown(chat([
    msg({ messageId: "m1", ordinal: 0, role: "user", plainText: "q" }),
    msg({ messageId: "m2", ordinal: 1, sourceContentType: "thoughts", plainText: "THOUGHT" }),
    msg({ messageId: "m3", ordinal: 2, sourceContentType: "reasoning_recap", plainText: "RECAP" }),
    msg({ messageId: "m4", ordinal: 3, sourceChannel: "commentary", plainText: "COMMENTARY" }),
    msg({ messageId: "m5", ordinal: 4, sourceContentType: "code", plainText: "CODE" }),
    msg({ messageId: "m6", ordinal: 5, plainText: '{"queries":["x"]}' }),
    msg({ messageId: "m7", ordinal: 6, sourceIsVisuallyHiddenFromConversation: true, plainText: "HIDDEN" }),
    msg({ messageId: "m8", ordinal: 7, role: "system", plainText: "SYSTEM" }),
    msg({ messageId: "m9", ordinal: 8, role: "tool", plainText: '{"json":1}' }),
    msg({ messageId: "m10", ordinal: 9, sourceContentType: "text", plainText: "answer" })
  ]), "without-files");
  assert.equal(md, "# Test chat\n\n## User\n\nq\n\n## ChatGPT\n\nanswer");
});

test("merges assistant messages of the same turn", () => {
  const md = buildChatMarkdown(chat([
    msg({ messageId: "m1", ordinal: 0, plainText: "one", sourceTurnExchangeId: "t1" }),
    msg({ messageId: "m2", ordinal: 1, plainText: "two", sourceTurnExchangeId: "t1" }),
    msg({ messageId: "m3", ordinal: 2, plainText: "three", sourceTurnExchangeId: "t2" }),
    msg({ messageId: "m4", ordinal: 3, plainText: "four" }),
    msg({ messageId: "m5", ordinal: 4, plainText: "five" })
  ]), "without-files");
  assert.equal(md, "# Test chat\n\n## ChatGPT\n\none\n\ntwo\n\n## ChatGPT\n\nthree\n\n## ChatGPT\n\nfour\n\nfive");
});

test("lists attachments per mode including unavailable ones", () => {
  const artifacts = chat(
    [msg({ messageId: "m1", role: "user", plainText: "see" })],
    [
      att({ attachmentId: "a1", fileName: "a.pdf" }),
      att({ attachmentId: "a2", fileName: "b.png" }),
      att({ attachmentId: "a3", fileName: "c.png", status: "missing" })
    ]
  );
  assert.equal(
    buildChatMarkdown(artifacts, "with-files"),
    "# Test chat\n\n## User\n\nsee\n\nAttached files: a.pdf, b.png\nUnavailable files: c.png"
  );
  assert.equal(
    buildChatMarkdown(artifacts, "without-files"),
    "# Test chat\n\n## User\n\nsee\n\nFiles (not included): a.pdf, b.png, c.png"
  );
});

test("a user message with only an image still yields a section", () => {
  const md = buildChatMarkdown(chat(
    [msg({ messageId: "m1", role: "user", plainText: "", sourceContentType: "multimodal_text" })],
    [att({ fileName: "pic.png" })]
  ), "with-files");
  assert.equal(md, "# Test chat\n\n## User\n\nAttached files: pic.png");
});

test("a tool message with an image attaches to the assistant section", () => {
  const messages = [
    msg({ messageId: "m1", ordinal: 0, role: "user", plainText: "draw" }),
    msg({ messageId: "m2", ordinal: 1, plainText: "Here", sourceTurnExchangeId: "t1" }),
    msg({ messageId: "m3", ordinal: 2, role: "tool", plainText: '{"json":1}', sourceTurnExchangeId: "t1" })
  ];
  const md = buildChatMarkdown(chat(messages, [att({ messageId: "m3", fileName: "gen.png" })]), "with-files");
  assert.equal(md, "# Test chat\n\n## User\n\ndraw\n\n## ChatGPT\n\nHere\n\nAttached files: gen.png");
});

test("a tool message with an image creates a ChatGPT section when none exists", () => {
  const md = buildChatMarkdown(chat(
    [msg({ messageId: "m3", role: "tool", plainText: "x" })],
    [att({ messageId: "m3", fileName: "gen.png" })]
  ), "with-files");
  assert.equal(md, "# Test chat\n\n## ChatGPT\n\nAttached files: gen.png");
});

test("rewrites sandbox links to file names", () => {
  const md = buildChatMarkdown(chat([
    msg({ plainText: "[z](sandbox:/mnt/data/x.zip) and [p](sandbox:/mnt/data/dir/%D0%9F%20a.zip)" })
  ]), "without-files");
  assert.match(md, /\[z\]\(x\.zip\) and \[p\]\(П a\.zip\)/);
});

test("renders project files right after the title", () => {
  const artifacts = chat(
    [msg({ messageId: "m1", role: "user", plainText: "hi" })],
    [att({ messageId: undefined, fileName: "spec.txt" })]
  );
  assert.equal(
    buildChatMarkdown(artifacts, "with-files"),
    "# Test chat\n\n## Project files\n\nAttached files: spec.txt\n\n## User\n\nhi"
  );
  assert.equal(
    buildChatMarkdown(artifacts, "without-files"),
    "# Test chat\n\n## Project files\n\nFiles (not included): spec.txt\n\n## User\n\nhi"
  );
});
