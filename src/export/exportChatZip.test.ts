import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importFetchedChats } from "../network/importChatResponses";
import { exportChatZip } from "./exportChatZip";
import { parseZip } from "./parseZip.testHelper";

const CHAT_ID = "chat12345678";

async function setupArchive(outDir: string): Promise<void> {
  const payload = {
    title: "My/Chat",
    mapping: {
      n1: {
        id: "m1",
        parent: null,
        children: [],
        message: {
          id: "m1",
          author: { role: "user" },
          content: { content_type: "text", parts: ["hi"] },
          metadata: {
            attachments: [
              { id: "file_1", name: "doc (1).txt", mime_type: "text/plain" },
              { id: "file_2", name: "Doc (1).txt", mime_type: "text/plain" },
              { id: "file_3", name: "gone.txt", mime_type: "text/plain" },
            ],
          },
        },
      },
    },
  };
  const manifest: Record<string, unknown> = {};
  await mkdir(path.join(outDir, "network", "chats"), { recursive: true });
  await writeFile(path.join(outDir, "network", "chats", `${CHAT_ID}.json`), JSON.stringify(payload));
  for (const [key, fileName, content] of [["file_1", "doc (1).txt", "one"], ["file_2", "Doc (1).txt", "two"], ["file_3", "gone.txt", ""]] as const) {
    manifest[key] = { key, kind: "attachment", fileName, status: "downloaded", localPath: `${key}/${fileName}`, seenIn: [] };
    if (key !== "file_3") {
      await mkdir(path.join(outDir, "network", "files", key), { recursive: true });
      await writeFile(path.join(outDir, "network", "files", key, fileName), content);
    }
  }
  await writeFile(path.join(outDir, "network", "files", "manifest.json"), JSON.stringify(manifest));
  await importFetchedChats({ outDir });
}

test("exportChatZip packs markdown and uniquely named files", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "archiver-export-"));
  try {
    await setupArchive(outDir);
    const result = await exportChatZip(outDir, CHAT_ID);

    assert.equal(result.zipPath, path.join(outDir, "exports", "My_Chat (chat1234).zip"));
    assert.equal(result.fileCount, 2);
    assert.equal(result.totalBytes, 6);

    const entries = parseZip(await readFile(result.zipPath));
    assert.deepEqual(entries.map((entry) => entry.name), ["My_Chat.md", "doc (1).txt", "Doc (1) (2).txt"]);
    const markdown = entries[0]!.data.toString("utf8");
    assert.match(markdown, /Attached files: doc \(1\)\.txt, Doc \(1\) \(2\)\.txt/);
    assert.match(markdown, /Unavailable files: gone\.txt/);
    assert.equal(entries[1]!.data.toString("utf8"), "one");
    assert.equal(entries[2]!.data.toString("utf8"), "two");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("exportChatZip rejects an unknown chat", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "archiver-export-"));
  try {
    await assert.rejects(
      exportChatZip(outDir, "nope"),
      new Error(`Chat nope not found in ${path.join(outDir, "chats")}`),
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
