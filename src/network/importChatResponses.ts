import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ArchiveManifest, ChatIndexEntry, MessageRecord, StoredChatArtifacts } from "../contracts";
import { getChatIdFromUrl, getProjectNameFromProjectId, resolveProjectMetadata } from "../discovery/urlPatterns";
import { StaticArchiveRenderer } from "../renderer/render";
import { ArchiveStorage } from "../storage/archiveStorage";
import { readJsonFile, readJsonFileIfExists } from "../utils/fs";
import { shortHash } from "../utils/hash";

export interface ImportOptions {
  baseUrl: string;
  outDir: string;
  responsesDir: string;
  targetsFile: string;
}

interface ChatTarget {
  chatId: string;
  title: string;
  url: string;
  projectId?: string;
  projectName?: string;
}

interface NormalizedNode {
  id: string;
  parentId?: string;
  childIds: string[];
  role: MessageRecord["role"];
  text: string;
  createdAt?: string;
  sequence: number;
  keep: boolean;
  contentType?: string;
  channel?: string | null;
  status?: string;
  recipient?: string | null;
  sourceAnalysisMessageId?: string;
  rawContent?: Record<string, unknown>;
  rawMetadata?: Record<string, unknown>;
  turnExchangeId?: string;
  reasoningStatus?: string;
  isThinkingPreambleMessage?: boolean;
  isVisuallyHiddenFromConversation?: boolean;
}

const SCHEMA_VERSION = "1.0.0";
const TOOL_VERSION = "0.1.0";

async function main(): Promise<void> {
  const options = parseImportArgs(process.argv.slice(2));
  await importFetchedChats(options);
}

export function createDefaultImportOptions(): ImportOptions {
  const outDir = path.resolve("archive");
  return {
    baseUrl: "https://chatgpt.com",
    outDir,
    responsesDir: path.join(outDir, "network", "chats"),
    targetsFile: path.join(outDir, "network", "discovery", "chat-targets.json"),
  };
}

export async function importFetchedChats(overrides: Partial<ImportOptions> = {}): Promise<void> {
  const options: ImportOptions = {
    ...createDefaultImportOptions(),
    ...overrides,
  };
  const storage = new ArchiveStorage(options.outDir);
  const renderer = new StaticArchiveRenderer(storage);

  await storage.ensureBaseStructure();
  await storage.writeManifest(buildManifest(options));
  await renderer.writeAssets();

  const targets = await loadTargets(options.targetsFile);
  const existingIndex = await storage.readChatIndex();
  const indexById = new Map(existingIndex.map((entry) => [entry.chatId, entry]));

  const files = (await readdir(options.responsesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(options.responsesDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`No JSON responses found in ${options.responsesDir}`);
  }

  let importedCount = 0;

  for (const filePath of files) {
    const payload = await readJsonFile<unknown>(filePath);
    const fileChatId = path.basename(filePath, path.extname(filePath));
    const artifacts = convertResponseToArtifacts(payload, fileChatId, targets, options.baseUrl);

    await storage.writeChatArtifacts(artifacts);
    await renderer.renderChat(artifacts);

    const current = indexById.get(artifacts.chat.chatId);
    const project = resolveProjectMetadata(artifacts.chat.url, artifacts.chat);
    const nextEntry: ChatIndexEntry = {
      chatId: artifacts.chat.chatId,
      title: artifacts.chat.title,
      url: artifacts.chat.url,
      archived: true,
      status: "done",
      messageCount: artifacts.messages.length,
      attachmentCount: 0,
      ...(project ?? {}),
    };

    indexById.set(artifacts.chat.chatId, current ? { ...current, ...nextEntry } : nextEntry);
    importedCount += 1;
    console.log(`[info] Imported ${artifacts.chat.chatId} from ${path.basename(filePath)}`);
  }

  const nextIndex = Array.from(indexById.values()).sort((left, right) => left.title.localeCompare(right.title));
  await storage.writeChatIndex(nextIndex);
  await renderer.renderIndex(nextIndex);

  console.log(`[info] Imported ${importedCount} chats`);
}

export function parseImportArgs(argv: string[]): ImportOptions {
  const options = createDefaultImportOptions();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--base-url":
        options.baseUrl = readValue(argv, ++index, arg);
        break;
      case "--out-dir":
        options.outDir = path.resolve(readValue(argv, ++index, arg));
        options.responsesDir = path.join(options.outDir, "network", "chats");
        options.targetsFile = path.join(options.outDir, "network", "discovery", "chat-targets.json");
        break;
      case "--responses-dir":
        options.responsesDir = path.resolve(readValue(argv, ++index, arg));
        break;
      case "--targets-file":
        options.targetsFile = path.resolve(readValue(argv, ++index, arg));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function buildManifest(options: ImportOptions): ArchiveManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    createdAt: new Date().toISOString(),
    source: "chatgpt-web",
    baseUrl: options.baseUrl,
  };
}

async function loadTargets(targetsFile: string): Promise<Map<string, ChatTarget>> {
  const raw = await readJsonFileIfExists<ChatTarget[]>(targetsFile);
  return new Map((raw ?? []).map((entry) => [entry.chatId, entry]));
}

function convertResponseToArtifacts(
  payload: unknown,
  fileChatId: string,
  targets: Map<string, ChatTarget>,
  baseUrl: string,
): StoredChatArtifacts {
  const chatId = resolveChatId(payload, fileChatId);
  const target = targets.get(chatId);
  const responseTitle = pickMetadataString(payload, "title", "conversation_title");
  const projectId = findProjectId(payload) ?? target?.projectId;
  const projectName = target?.projectName
    ?? (projectId ? getProjectNameFromProjectId(projectId) ?? projectId : undefined);
  const url = target?.url
    ?? pickMetadataString(payload, "url", "href", "link")
    ?? buildChatUrl(baseUrl, chatId, projectId);
  const title = chooseBetterTitle(responseTitle ?? target?.title ?? `Chat ${chatId}`, `Chat ${chatId}`);

  const nodes = normalizeNodes(extractMessageNodes(payload));
  const messages = orderNodes(nodes).map((node, ordinal) => ({
    messageId: node.id || shortHash(`${chatId}|${ordinal}|${node.text}`),
    chatId,
    ordinal,
    role: node.role,
    createdAt: node.createdAt,
    plainText: node.text,
    preferredSource: "network" as const,
    attachmentRefs: [],
    ...(node.contentType ? { sourceContentType: node.contentType } : {}),
    sourceChannel: node.channel ?? null,
    ...(node.status ? { sourceStatus: node.status } : {}),
    sourceRecipient: node.recipient ?? null,
    ...(node.turnExchangeId ? { sourceTurnExchangeId: node.turnExchangeId } : {}),
    ...(node.parentId ? { sourceParentId: node.parentId } : {}),
    ...(node.reasoningStatus ? { sourceReasoningStatus: node.reasoningStatus } : {}),
    ...(node.sourceAnalysisMessageId ? { sourceSourceAnalysisMessageId: node.sourceAnalysisMessageId } : {}),
    ...(node.isThinkingPreambleMessage ? { sourceIsThinkingPreambleMessage: true } : {}),
    ...(node.isVisuallyHiddenFromConversation ? { sourceIsVisuallyHiddenFromConversation: true } : {}),
    ...(node.rawContent ? { sourceContent: node.rawContent } : {}),
    ...(node.rawMetadata ? { sourceMetadata: node.rawMetadata } : {}),
  }));

  if (messages.length === 0) {
    throw new Error(`No user/assistant messages with non-empty content found for ${chatId}`);
  }

  return {
    chat: {
      schemaVersion: SCHEMA_VERSION,
      chatId,
      title,
      url,
      archivedAt: new Date().toISOString(),
      ...(projectId ? { projectId } : {}),
      ...(projectName ? { projectName } : {}),
    },
    messages,
    attachments: [],
  };
}

function resolveChatId(payload: unknown, fileChatId: string): string {
  const directUrl = pickMetadataString(payload, "url", "href", "link");
  const directUrlChatId = directUrl ? getChatIdFromUrl(directUrl) : null;
  const direct = pickMetadataString(payload, "conversation_id", "conversationId", "chat_id", "chatId");
  const payloadId = isRecord(payload) && typeof payload.id === "string" && !payload.id.startsWith("g-p-")
    ? payload.id
    : undefined;

  return directUrlChatId ?? direct ?? payloadId ?? fileChatId;
}

function findProjectId(payload: unknown): string | undefined {
  const direct = pickMetadataString(payload, "project_id", "projectId", "gizmo_id", "gizmoId");
  if (direct) {
    return direct;
  }

  if (isRecord(payload) && typeof payload.id === "string" && payload.id.startsWith("g-p-")) {
    return payload.id;
  }

  const url = pickMetadataString(payload, "url", "href", "link");
  return url ? resolveProjectMetadata(url)?.projectId : undefined;
}

function extractMessageNodes(payload: unknown): unknown[] {
  const fromMapping = findMessageMapping(payload);
  if (fromMapping) {
    return fromMapping;
  }

  const fromArray = findMessageArray(payload);
  if (fromArray) {
    return fromArray;
  }

  throw new Error("Could not find message nodes in the response body");
}

function findMessageMapping(value: unknown): unknown[] | null {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = findMessageMapping(item);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  }

  if (isRecord(value.mapping)) {
    const items = Object.values(value.mapping);
    if (items.some((item) => looksLikeMessageNode(item))) {
      return items;
    }
  }

  for (const nested of Object.values(value)) {
    const result = findMessageMapping(nested);
    if (result) {
      return result;
    }
  }

  return null;
}

function findMessageArray(value: unknown): unknown[] | null {
  if (Array.isArray(value) && value.some((item) => looksLikeMessageNode(item))) {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.items) && value.items.some((item) => looksLikeMessageNode(item))) {
    return value.items;
  }

  for (const nested of Object.values(value)) {
    const result = findMessageArray(nested);
    if (result) {
      return result;
    }
  }

  return null;
}

function looksLikeMessageNode(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return isRecord(value.message)
    || "parent" in value
    || "children" in value
    || "author" in value
    || "content" in value;
}

function normalizeNodes(rawNodes: unknown[]): NormalizedNode[] {
  return rawNodes.flatMap((rawNode, sequence) => {
    const node = normalizeNode(rawNode, sequence);
    return node ? [node] : [];
  });
}

function normalizeNode(rawNode: unknown, sequence: number): NormalizedNode | null {
  if (!isRecord(rawNode)) {
    return null;
  }

  const message = isRecord(rawNode.message) ? rawNode.message : rawNode;
  const messageMetadata = isRecord(message.metadata) ? message.metadata : undefined;
  const id = firstString(rawNode.id, message.id) ?? shortHash(JSON.stringify(rawNode));
  const parentId = firstString(rawNode.parent, message.parent);
  const childIds = extractStringArray(rawNode.children ?? message.children);
  const author = isRecord(message.author) ? message.author : undefined;
  const content = isRecord(message.content) ? message.content : isRecord(rawNode.content) ? rawNode.content : undefined;
  const channel = readNullableString(message.channel ?? rawNode.channel);
  const recipient = readNullableString(message.recipient ?? rawNode.recipient);
  const status = firstString(message.status, rawNode.status);
  const role = normalizeRole(firstString(author?.role, rawNode.author_role, rawNode.role));
  const contentType = firstString(content?.content_type);
  const text = extractMessageText(content);
  const createdAt = normalizeTimestamp(message.create_time ?? rawNode.create_time ?? message.created_at ?? rawNode.created_at);
  const keep = (role === "user" || role === "assistant") && text.trim().length > 0;

  return {
    id,
    parentId,
    childIds,
    role,
    text,
    createdAt,
    sequence,
    keep,
    ...(contentType ? { contentType } : {}),
    channel,
    ...(status ? { status } : {}),
    recipient,
    ...(firstString(content?.source_analysis_msg_id) ? { sourceAnalysisMessageId: firstString(content?.source_analysis_msg_id) } : {}),
    ...(content ? { rawContent: content } : {}),
    ...(messageMetadata ? { rawMetadata: messageMetadata } : {}),
    ...(firstString(messageMetadata?.turn_exchange_id) ? { turnExchangeId: firstString(messageMetadata?.turn_exchange_id) } : {}),
    ...(firstString(messageMetadata?.reasoning_status) ? { reasoningStatus: firstString(messageMetadata?.reasoning_status) } : {}),
    ...(messageMetadata?.is_thinking_preamble_message === true ? { isThinkingPreambleMessage: true } : {}),
    ...(messageMetadata?.is_visually_hidden_from_conversation === true ? { isVisuallyHiddenFromConversation: true } : {}),
  };
}

function orderNodes(nodes: NormalizedNode[]): NormalizedNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, NormalizedNode[]>();

  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    const bucket = childrenByParent.get(node.parentId) ?? [];
    bucket.push(node);
    childrenByParent.set(node.parentId, bucket);
  }

  const visited = new Set<string>();
  const ordered: NormalizedNode[] = [];
  const roots = nodes
    .filter((node) => !node.parentId || !byId.has(node.parentId))
    .sort(compareNodes);

  for (const root of roots) {
    visitNode(root, byId, childrenByParent, visited, ordered);
  }

  for (const node of [...nodes].sort(compareNodes)) {
    visitNode(node, byId, childrenByParent, visited, ordered);
  }

  return ordered.filter((node) => node.keep);
}

function visitNode(
  node: NormalizedNode,
  byId: Map<string, NormalizedNode>,
  childrenByParent: Map<string, NormalizedNode[]>,
  visited: Set<string>,
  ordered: NormalizedNode[],
): void {
  if (visited.has(node.id)) {
    return;
  }
  visited.add(node.id);
  ordered.push(node);

  const seenChildren = new Set<string>();
  const next: NormalizedNode[] = [];

  for (const childId of node.childIds) {
    const child = byId.get(childId);
    if (!child || seenChildren.has(child.id)) {
      continue;
    }
    next.push(child);
    seenChildren.add(child.id);
  }

  for (const child of (childrenByParent.get(node.id) ?? []).sort(compareNodes)) {
    if (seenChildren.has(child.id)) {
      continue;
    }
    next.push(child);
    seenChildren.add(child.id);
  }

  for (const child of next) {
    visitNode(child, byId, childrenByParent, visited, ordered);
  }
}

function compareNodes(left: NormalizedNode, right: NormalizedNode): number {
  const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NaN;
  const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.NaN;

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.sequence - right.sequence;
}

function extractMessageText(content: Record<string, unknown> | undefined): string {
  if (!content) {
    return "";
  }

  const partsText = extractTextParts(content.parts);
  if (partsText) {
    return partsText;
  }

  const thoughtsText = extractThoughts(content.thoughts);
  if (thoughtsText) {
    return thoughtsText;
  }

  return firstString(content.text, content.result, content.value) ?? "";
}

function extractTextParts(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  const parts = value
    .flatMap((item) => {
      if (typeof item === "string") {
        return [item.trim()];
      }
      if (isRecord(item)) {
        const text = firstString(item.text, item.content, item.value);
        return text ? [text] : [];
      }
      return [];
    })
    .filter((part) => part.length > 0);

  return parts.join("\n\n");
}

function extractThoughts(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  const entries = value
    .flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const summary = firstString(item.summary);
      const content = firstString(item.content);
      const chunks = Array.isArray(item.chunks)
        ? item.chunks.filter((chunk): chunk is string => typeof chunk === "string" && chunk.trim().length > 0)
        : [];

      const body = content ?? chunks.join("\n");
      const pieces = [summary ? `Summary: ${summary}` : null, body].filter((piece): piece is string => Boolean(piece));
      if (pieces.length === 0) {
        return [];
      }
      return [pieces.join("\n\n")];
    })
    .filter((entry) => entry.trim().length > 0);

  return entries.join("\n\n---\n\n");
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim().length > 0) {
      return [item.trim()];
    }
    if (isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0) {
      return [item.id.trim()];
    }
    return [];
  });
}

function normalizeRole(value: string | undefined): MessageRecord["role"] {
  switch ((value ?? "").toLowerCase()) {
    case "assistant":
      return "assistant";
    case "user":
      return "user";
    case "system":
      return "system";
    case "tool":
      return "tool";
    default:
      return "unknown";
  }
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return undefined;
}

function chooseBetterTitle(left: string, right: string): string {
  const leftTrimmed = left.trim();
  const rightTrimmed = right.trim();
  const leftIsFallback = /^chat [a-z0-9-]+$/i.test(leftTrimmed);
  const rightIsFallback = /^chat [a-z0-9-]+$/i.test(rightTrimmed);

  if (leftIsFallback && !rightIsFallback) {
    return rightTrimmed;
  }
  return leftTrimmed || rightTrimmed;
}

function buildChatUrl(baseUrl: string, chatId: string, projectId?: string): string {
  return projectId ? `${baseUrl}/g/${projectId}/c/${chatId}` : `${baseUrl}/c/${chatId}`;
}

function pickMetadataString(value: unknown, ...keys: string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const direct = readOwnString(value, ...keys);
  if (direct) {
    return direct;
  }

  for (const nestedKey of ["conversation", "data", "item", "chat", "payload"]) {
    const nested = value[nestedKey];
    if (!isRecord(nested)) {
      continue;
    }
    const candidate = readOwnString(nested, ...keys);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function readOwnString(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

function findFirstString(value: unknown, ...keys: string[]): string | undefined {
  if (isRecord(value)) {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    for (const nested of Object.values(value)) {
      const candidate = findFirstString(nested, ...keys);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findFirstString(item, ...keys);
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readNullableString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
