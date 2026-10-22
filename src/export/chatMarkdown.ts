import type { AttachmentRecord, MessageRecord, StoredChatArtifacts } from "../contracts";
import { isCommentaryMessage, shouldSkipMessageInRender } from "../renderer/render";

export type ExportMode = "with-files" | "without-files";

interface Section {
  heading: "User" | "ChatGPT";
  turnId?: string;
  parts: string[];
}

export function buildChatMarkdown(artifacts: StoredChatArtifacts, mode: ExportMode): string {
  const attachmentsByMessage = new Map<string, AttachmentRecord[]>();
  const projectFiles: AttachmentRecord[] = [];
  for (const attachment of artifacts.attachments) {
    if (!attachment.messageId) {
      projectFiles.push(attachment);
      continue;
    }
    const bucket = attachmentsByMessage.get(attachment.messageId) ?? [];
    bucket.push(attachment);
    attachmentsByMessage.set(attachment.messageId, bucket);
  }

  const sections: Section[] = [];
  for (const message of artifacts.messages) {
    const attachments = attachmentsByMessage.get(message.messageId) ?? [];
    const fileLines = describeFiles(attachments, mode);

    if (message.role === "tool") {
      if (attachments.length > 0) {
        appendToChatGpt(sections, message.sourceTurnExchangeId, fileLines);
      }
      continue;
    }
    if (!isExportedMessage(message)) {
      continue;
    }

    const text = rewriteSandboxLinks(message.plainText.trim());
    if (!text && attachments.length === 0) {
      continue;
    }
    const part = [text, fileLines].filter(Boolean).join("\n\n");
    if (message.role === "user") {
      sections.push({ heading: "User", parts: [part] });
    } else {
      appendToChatGpt(sections, message.sourceTurnExchangeId, part);
    }
  }

  const blocks = [`# ${artifacts.chat.title}`];
  if (projectFiles.length > 0) {
    blocks.push(`## Project files\n\n${describeFiles(projectFiles, mode)}`);
  }
  for (const section of sections) {
    blocks.push(`## ${section.heading}\n\n${section.parts.join("\n\n")}`);
  }
  return blocks.join("\n\n");
}

function isExportedMessage(message: MessageRecord): boolean {
  return (message.role === "user" || message.role === "assistant")
    && !shouldSkipMessageInRender(message)
    && !isCommentaryMessage(message)
    && (message.sourceContentType === undefined
      || message.sourceContentType === "text"
      || message.sourceContentType === "multimodal_text");
}

function appendToChatGpt(sections: Section[], turnId: string | undefined, part: string): void {
  const last = sections[sections.length - 1];
  if (last?.heading === "ChatGPT" && last.turnId === turnId) {
    last.parts.push(part);
    return;
  }
  sections.push({ heading: "ChatGPT", turnId, parts: [part] });
}

function describeFiles(attachments: AttachmentRecord[], mode: ExportMode): string {
  const names = (list: AttachmentRecord[]) => list.map((attachment) => attachment.fileName).join(", ");
  if (attachments.length === 0) {
    return "";
  }
  if (mode === "without-files") {
    return `Files (not included): ${names(attachments)}`;
  }
  const downloaded = attachments.filter((attachment) => attachment.status === "downloaded");
  const unavailable = attachments.filter((attachment) => attachment.status !== "downloaded");
  return [
    downloaded.length > 0 ? `Attached files: ${names(downloaded)}` : "",
    unavailable.length > 0 ? `Unavailable files: ${names(unavailable)}` : "",
  ].filter(Boolean).join("\n");
}

function rewriteSandboxLinks(text: string): string {
  return text.replace(/sandbox:\/mnt\/data\/[^\s)]+/g, (match) => {
    let decoded = match;
    try {
      decoded = decodeURIComponent(match);
    } catch {
      // malformed percent-encoding: use the raw form
    }
    return decoded.slice(decoded.lastIndexOf("/") + 1);
  });
}
