import type { Page } from "playwright";

export type ChatRole = "system" | "user" | "assistant" | "tool" | "unknown";
export type TextSource = "network";
export type AttachmentStatus = "downloaded" | "skipped" | "failed" | "missing";
export type ChatProcessingStatus = "pending" | "done" | "partial" | "failed";
export type BrowserFlavor = "auto" | "yandex" | "chrome" | "edge";

export interface ProjectMetadata {
  projectId?: string;
  projectName?: string;
}

export interface ArchiveManifest {
  schemaVersion: string;
  toolVersion: string;
  createdAt: string;
  source: "chatgpt-web";
  baseUrl: string;
}

export interface ChatIndexEntry extends ProjectMetadata {
  chatId: string;
  title: string;
  url: string;
  archived: boolean;
  messageCount?: number;
  attachmentCount?: number;
  status: ChatProcessingStatus;
  error?: string;
}

export interface ChatRecord extends ProjectMetadata {
  schemaVersion: string;
  chatId: string;
  title: string;
  url: string;
  archivedAt: string;
  sourceFingerprint?: string;
}

export interface MessageAttachmentRef {
  attachmentId: string;
  relation: string;
  ordinal: number;
  caption?: string;
}

export interface MessageRecord {
  messageId: string;
  chatId: string;
  ordinal: number;
  role: ChatRole;
  createdAt?: string;
  plainText: string;
  renderedHtml?: string;
  copiedMarkdown?: string;
  preferredSource: TextSource;
  attachmentRefs: MessageAttachmentRef[];
  sourceContentType?: string;
  sourceChannel?: string | null;
  sourceStatus?: string;
  sourceRecipient?: string | null;
  sourceTurnExchangeId?: string;
  sourceParentId?: string;
  sourceReasoningStatus?: string;
  sourceSourceAnalysisMessageId?: string;
  sourceIsThinkingPreambleMessage?: boolean;
  sourceIsVisuallyHiddenFromConversation?: boolean;
  sourceContent?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
}

export interface AttachmentRecord {
  attachmentId: string;
  chatId: string;
  messageId?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceUrl?: string;
  localPath: string;
  sha256?: string;
  status: AttachmentStatus;
  error?: string;
}

export interface AppOptions {
  command: CommandName;
  baseUrl: string;
  outDir: string;
  profileDir: string;
  remoteDebugProfileDir: string;
  browserChannel?: string;
  browserExecutablePath?: string;
  browserFlavor: BrowserFlavor;
  remoteDebuggingPort: number;
  cdpUrl?: string;
  headless: boolean;
  manualLogin: boolean;
}

export interface RuntimePaths {
  rootDir: string;
  assetsDir: string;
  chatsDir: string;
}

export interface BrowserSession {
  baseUrl: string;
  baseOrigin: string;
  userAgent: string;
  page: Page;
  close: () => Promise<void>;
}

export interface StoredChatArtifacts {
  chat: ChatRecord;
  messages: MessageRecord[];
  attachments: AttachmentRecord[];
}

export interface LogSink {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface StorageWriter {
  ensureBaseStructure(): Promise<void>;
  writeManifest(manifest: ArchiveManifest): Promise<void>;
  readChatIndex(): Promise<ChatIndexEntry[]>;
  writeChatIndex(entries: ChatIndexEntry[]): Promise<void>;
  writeChatArtifacts(artifacts: StoredChatArtifacts): Promise<void>;
}

export interface ArchiveRenderer {
  writeAssets(): Promise<void>;
  renderIndex(entries: ChatIndexEntry[]): Promise<void>;
  renderChat(artifacts: StoredChatArtifacts): Promise<void>;
}

export type CommandName = "help" | "fetch" | "import" | "run" | "launch-browser";
