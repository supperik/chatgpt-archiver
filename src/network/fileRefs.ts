import type { ChatRole, FileRef } from "../contracts";

const FILE_ID_PATTERN = /file[-_](?!service:)[A-Za-z0-9]+/;
const SANDBOX_LINK_PATTERN = /sandbox:(\/mnt\/data\/[^)\s"]+)/g;

export function extractFileRefs(payload: unknown, chatId: string): FileRef[] {
  if (!isRecord(payload) || !isRecord(payload.mapping)) {
    return [];
  }

  const refs: FileRef[] = [];
  for (const node of Object.values(payload.mapping)) {
    if (!isRecord(node) || !isRecord(node.message)) {
      continue;
    }
    const message = node.message;
    const messageId = readString(message.id) ?? readString(node.id) ?? "";
    const role = normalizeRole(isRecord(message.author) ? readString(message.author.role) : undefined);
    const content = isRecord(message.content) ? message.content : {};
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const base = { chatId, messageId, role };

    if (Array.isArray(metadata.attachments)) {
      for (const attachment of metadata.attachments) {
        if (!isRecord(attachment)) {
          continue;
        }
        const key = readString(attachment.id);
        if (!key) {
          continue;
        }
        refs.push({
          key,
          kind: "attachment",
          ...base,
          ...optional("fileName", readString(attachment.name)),
          ...optional("mimeType", readString(attachment.mime_type) ?? readString(attachment.mimeType)),
          ...optional("sizeBytes", readNumber(attachment.size)),
        });
      }
    }

    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part) || part.content_type !== "image_asset_pointer") {
        continue;
      }
      const key = readString(part.asset_pointer)?.match(FILE_ID_PATTERN)?.[0];
      if (!key) {
        continue;
      }
      const partMetadata = isRecord(part.metadata) ? part.metadata : {};
      const generated = isNonNull(partMetadata.generation) || isNonNull(partMetadata.dalle);
      refs.push({
        key,
        kind: "image",
        ...base,
        ...optional("sizeBytes", readNumber(part.size_bytes)),
        ...(generated ? { generated: true } : {}),
      });
    }

    if (role === "assistant" && (content.content_type === "text" || content.content_type === "multimodal_text")) {
      for (const part of parts) {
        if (typeof part !== "string") {
          continue;
        }
        for (const match of part.matchAll(SANDBOX_LINK_PATTERN)) {
          const sandboxPath = decodeOrRaw(match[1] as string);
          refs.push({
            key: `sandbox:${chatId}:${messageId}:${sandboxPath}`,
            kind: "sandbox",
            ...base,
            fileName: sandboxPath.slice(sandboxPath.lastIndexOf("/") + 1),
            sandboxPath,
          });
        }
      }
    }
  }
  return refs;
}

function decodeOrRaw(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeRole(value: string | undefined): ChatRole {
  switch ((value ?? "").toLowerCase()) {
    case "assistant":
    case "user":
    case "system":
    case "tool":
      return (value as string).toLowerCase() as ChatRole;
    default:
      return "unknown";
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

function isNonNull(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
