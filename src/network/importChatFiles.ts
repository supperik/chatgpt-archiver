import type { AttachmentRecord, FileManifest, FileRef, MessageAttachmentRef } from "../contracts";
import { toSafeFileName } from "../utils/fs";

export interface ChatFileLinks {
  attachments: AttachmentRecord[];
  refsByMessageId: Map<string, MessageAttachmentRef[]>;
}

export function buildChatFileLinks(
  chatId: string,
  refs: FileRef[],
  manifest: FileManifest,
  filesPrefix: string,
): ChatFileLinks {
  const attachments = new Map<string, AttachmentRecord>();
  const refsByMessageId = new Map<string, MessageAttachmentRef[]>();

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
      localPath: entry?.status === "downloaded" && entry.localPath ? `${filesPrefix}/${entry.localPath}` : "",
      ...(entry?.sha256 ? { sha256: entry.sha256 } : {}),
      status: entry?.status ?? "missing",
      ...(entry ? (entry.error ? { error: entry.error } : {}) : { error: "not in manifest" }),
    };
    attachments.set(ref.key, record);
  }

  return { attachments: Array.from(attachments.values()), refsByMessageId };
}
