import { copyFile } from "node:fs/promises";
import path from "node:path";
import type { AttachmentRecord, FileManifest, FileRef, MessageAttachmentRef } from "../contracts";
import { ensureDir, toSafeFileName, uniqueFileName } from "../utils/fs";

export interface ChatFileLinks {
  attachments: AttachmentRecord[];
  refsByMessageId: Map<string, MessageAttachmentRef[]>;
  copies: Array<{ from: string; to: string }>;
}

export function buildChatFileLinks(chatId: string, refs: FileRef[], manifest: FileManifest): ChatFileLinks {
  const attachments = new Map<string, AttachmentRecord>();
  const refsByMessageId = new Map<string, MessageAttachmentRef[]>();
  const copies: ChatFileLinks["copies"] = [];
  const takenNames = new Set<string>();

  for (const ref of refs) {
    const messageRefs = refsByMessageId.get(ref.messageId) ?? [];
    refsByMessageId.set(ref.messageId, messageRefs);
    if (!messageRefs.some((item) => item.attachmentId === ref.key)) {
      messageRefs.push({ attachmentId: ref.key, relation: ref.kind, ordinal: messageRefs.length });
    }

    if (attachments.has(ref.key)) {
      continue;
    }

    const entry = manifest[ref.key];
    const fileName = entry?.fileName ?? toSafeFileName(ref.fileName, ref.mimeType);
    const mimeType = entry?.mimeType ?? ref.mimeType;
    const sizeBytes = entry?.sizeBytes ?? ref.sizeBytes;
    const record: AttachmentRecord = {
      attachmentId: ref.key,
      chatId,
      ...(ref.role === "system" ? {} : { messageId: ref.messageId }),
      fileName,
      ...(mimeType ? { mimeType } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(ref.sandboxPath ? { sourceUrl: `sandbox:${ref.sandboxPath}` } : {}),
      localPath: `files/${uniqueFileName(fileName, takenNames)}`,
      ...(entry?.sha256 ? { sha256: entry.sha256 } : {}),
      status: entry?.status ?? "missing",
      ...(entry ? (entry.error ? { error: entry.error } : {}) : { error: "not in manifest" }),
    };
    attachments.set(ref.key, record);

    if (entry?.status === "downloaded" && entry.localPath) {
      copies.push({ from: entry.localPath, to: record.localPath });
    }
  }

  return { attachments: Array.from(attachments.values()), refsByMessageId, copies };
}

export async function copyChatFiles(
  copies: ChatFileLinks["copies"],
  filesRoot: string,
  chatDir: string,
): Promise<string[]> {
  const missing: string[] = [];
  for (const { from, to } of copies) {
    const destPath = path.join(chatDir, ...to.split("/"));
    await ensureDir(path.dirname(destPath));
    try {
      await copyFile(path.join(filesRoot, ...from.split("/")), destPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      missing.push(to);
    }
  }
  return missing;
}
