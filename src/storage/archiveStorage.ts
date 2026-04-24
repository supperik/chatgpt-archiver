import path from "node:path";
import type {
  ArchiveManifest,
  ChatIndexEntry,
  RuntimePaths,
  StorageWriter,
  StoredChatArtifacts,
} from "../contracts";
import {
  ensureDir,
  listSubdirectories,
  pathExists,
  readJsonFile,
  readJsonFileIfExists,
  writeJsonFile,
} from "../utils/fs";

export class ArchiveStorage implements StorageWriter {
  readonly paths: RuntimePaths;

  constructor(readonly rootDir: string) {
    this.paths = {
      rootDir,
      assetsDir: path.join(rootDir, "assets"),
      chatsDir: path.join(rootDir, "chats"),
    };
  }

  async ensureBaseStructure(): Promise<void> {
    await Promise.all([
      ensureDir(this.paths.rootDir),
      ensureDir(this.paths.assetsDir),
      ensureDir(this.paths.chatsDir),
    ]);
  }

  async writeManifest(manifest: ArchiveManifest): Promise<void> {
    await writeJsonFile(this.manifestPath, manifest);
  }

  async readManifest(): Promise<ArchiveManifest | null> {
    return readJsonFileIfExists<ArchiveManifest>(this.manifestPath);
  }

  async readChatIndex(): Promise<ChatIndexEntry[]> {
    return (await readJsonFileIfExists<ChatIndexEntry[]>(this.chatIndexPath)) ?? [];
  }

  async writeChatIndex(entries: ChatIndexEntry[]): Promise<void> {
    const ordered = [...entries].sort((left, right) => left.title.localeCompare(right.title));
    await writeJsonFile(this.chatIndexPath, ordered);
  }

  async writeChatArtifacts(artifacts: StoredChatArtifacts): Promise<void> {
    const chatDir = this.getChatDir(artifacts.chat.chatId);
    await ensureDir(chatDir);
    await ensureDir(this.getChatFilesDir(artifacts.chat.chatId));

    await Promise.all([
      writeJsonFile(path.join(chatDir, "chat.json"), artifacts.chat),
      writeJsonFile(path.join(chatDir, "messages.json"), artifacts.messages),
      writeJsonFile(path.join(chatDir, "attachments.json"), artifacts.attachments),
    ]);
  }

  async readStoredChat(chatId: string): Promise<StoredChatArtifacts | null> {
    const chatDir = this.getChatDir(chatId);
    if (!(await pathExists(chatDir))) {
      return null;
    }

    const [chat, messages, attachments] = await Promise.all([
      readJsonFile<StoredChatArtifacts["chat"]>(path.join(chatDir, "chat.json")),
      readJsonFile<StoredChatArtifacts["messages"]>(path.join(chatDir, "messages.json")),
      readJsonFile<StoredChatArtifacts["attachments"]>(path.join(chatDir, "attachments.json")),
    ]);

    return {
      chat,
      messages,
      attachments,
    };
  }

  async readAllStoredChatIds(): Promise<string[]> {
    if (!(await pathExists(this.paths.chatsDir))) {
      return [];
    }
    return listSubdirectories(this.paths.chatsDir);
  }

  getChatDir(chatId: string): string {
    return path.join(this.paths.chatsDir, chatId);
  }

  getChatFilesDir(chatId: string): string {
    return path.join(this.getChatDir(chatId), "files");
  }

  get manifestPath(): string {
    return path.join(this.paths.rootDir, "manifest.json");
  }

  get chatIndexPath(): string {
    return path.join(this.paths.chatsDir, "index.json");
  }
}
