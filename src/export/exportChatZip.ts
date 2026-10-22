import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AttachmentRecord } from "../contracts";
import { ArchiveStorage } from "../storage/archiveStorage";
import { ensureDir, pathExists, sanitizeFileName } from "../utils/fs";
import { buildChatMarkdown } from "./chatMarkdown";
import { writeZip, type ZipEntry } from "./zipWriter";

export interface ExportChatZipResult {
  zipPath: string;
  fileCount: number;
  totalBytes: number;
}

export async function exportChatZip(outDir: string, chatId: string): Promise<ExportChatZipResult> {
  const storage = new ArchiveStorage(outDir);
  const artifacts = await storage.readStoredChat(chatId);
  if (!artifacts) {
    throw new Error(`Chat ${chatId} not found in ${storage.paths.chatsDir}`);
  }

  const chatDir = storage.getChatDir(chatId);
  const stem = sanitizeFileName(artifacts.chat.title).slice(0, 120);
  const usedNames = new Set([`${stem}.md`.toLowerCase()]);
  const files: ZipEntry[] = [];
  const attachments: AttachmentRecord[] = [];

  for (const attachment of artifacts.attachments) {
    const filePath = path.join(chatDir, ...attachment.localPath.split("/"));
    if (attachment.status !== "downloaded" || !(await pathExists(filePath))) {
      attachments.push({ ...attachment, status: "missing" });
      continue;
    }
    const name = uniqueName(attachment.fileName, usedNames);
    files.push({ name, data: await readFile(filePath) });
    attachments.push({ ...attachment, fileName: name });
  }

  const markdown = buildChatMarkdown({ ...artifacts, attachments }, "with-files");
  const exportsDir = path.join(outDir, "exports");
  await ensureDir(exportsDir);
  const zipPath = path.join(exportsDir, `${stem} (${chatId.slice(0, 8)}).zip`);
  await writeZip(zipPath, [{ name: `${stem}.md`, data: Buffer.from(markdown, "utf8") }, ...files]);

  return {
    zipPath,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.data.length, 0),
  };
}

function uniqueName(fileName: string, used: Set<string>): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = fileName;
  for (let counter = 2; used.has(candidate.toLowerCase()); counter += 1) {
    candidate = `${stem} (${counter})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
