import path from "node:path";
import type {
  ArchiveRenderer,
  AttachmentRecord,
  ChatIndexEntry,
  ChatRole,
  MessageRecord,
  StoredChatArtifacts,
} from "../contracts";
import { resolveProjectMetadata } from "../discovery/urlPatterns";
import { plainTextToHtml, escapeHtml } from "../utils/html";
import { writeTextFile } from "../utils/fs";
import { ArchiveStorage } from "../storage/archiveStorage";

const SITE_CSS = `
:root {
  color-scheme: light;
  --bg: #f6f3ee;
  --panel: #fffdf8;
  --panel-border: #d8d0c2;
  --text: #1e1b16;
  --muted: #6a6256;
  --accent: #116466;
  --accent-soft: #e0f0ef;
  --user-bg: #f4efe3;
  --assistant-bg: #fcfbf7;
  --code-bg: #1f2430;
  --code-text: #f8f8f2;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Segoe UI", system-ui, sans-serif;
  background:
    radial-gradient(circle at top right, rgba(17, 100, 102, 0.08), transparent 20rem),
    linear-gradient(180deg, #faf8f2, var(--bg));
  color: var(--text);
}

a {
  color: var(--accent);
}

.shell {
  width: min(1120px, calc(100vw - 2rem));
  margin: 0 auto;
  padding: 2rem 0 4rem;
}

.topbar {
  margin-bottom: 1.5rem;
}

.title {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 2.8rem);
}

.subtitle,
.meta {
  color: var(--muted);
}

.chat-groups {
  display: grid;
  gap: 1.4rem;
}

.chat-list,
.message-list,
.attachment-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.chat-list {
  display: grid;
  gap: 0.9rem;
}

.chat-group-header,
.chat-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.chat-group-header {
  margin-bottom: 0.8rem;
}

.group-kicker {
  margin: 0 0 0.25rem;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.group-title {
  margin: 0;
  font-size: 1.2rem;
}

.group-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.chat-list li,
.message,
.attachment-card {
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 18px;
  box-shadow: 0 10px 25px rgba(31, 36, 48, 0.05);
}

.chat-list li {
  padding: 1rem 1.1rem;
}

.chat-link {
  flex: 1 1 auto;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}

.chat-link strong {
  display: block;
  margin-bottom: 0.35rem;
}

.project-pill,
.project-filter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  font-size: 0.82rem;
  line-height: 1;
}

.project-pill {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
  white-space: nowrap;
}

.project-filter {
  border: 1px solid rgba(17, 100, 102, 0.18);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
}

.project-filter:hover {
  background: var(--accent-soft);
}

.project-filter:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.message {
  padding: 1rem 1.2rem;
  margin-bottom: 1rem;
}

.message.role-user {
  background: var(--user-bg);
}

.message.role-assistant {
  background: var(--assistant-bg);
}

.message header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.8rem;
}

.message-stack,
.thought-list,
.message-subtle-group {
  display: block;
}

.message-stack > * + *,
.thought-list > * + *,
.message-subtle-group > * + * {
  margin-top: 0.9rem;
}

.message-block + .message-block,
.message-subtle-group,
.message-thoughts,
.message-files {
  border-top: 1px solid rgba(30, 27, 22, 0.08);
  padding-top: 0.85rem;
}

.message-block.is-subtle .message-body {
  color: var(--muted);
  font-style: italic;
}

.message-recap {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: rgba(17, 100, 102, 0.08);
  color: var(--muted);
  font-size: 0.82rem;
}

.message-thoughts summary {
  cursor: pointer;
  color: var(--muted);
  font-weight: 600;
}

.message-thoughts[open] summary {
  margin-bottom: 0.85rem;
}

.thought-block {
  padding: 0.85rem 0.95rem;
  border-radius: 14px;
  border-left: 3px solid rgba(17, 100, 102, 0.35);
  background: rgba(17, 100, 102, 0.06);
}

.thought-title {
  margin: 0 0 0.5rem;
  font-size: 0.92rem;
  color: var(--accent);
}

.badge {
  display: inline-flex;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.message-body pre,
.message-body code {
  font-family: Consolas, "SFMono-Regular", monospace;
}

.message-body > :first-child {
  margin-top: 0;
}

.message-body > :last-child {
  margin-bottom: 0;
}

.message-body p,
.message-body ul,
.message-body ol,
.message-body blockquote,
.message-body table,
.message-body pre {
  margin: 0.75rem 0;
}

.message-body h1,
.message-body h2,
.message-body h3,
.message-body h4,
.message-body h5,
.message-body h6 {
  margin: 1rem 0 0.65rem;
  line-height: 1.25;
}

.message-body pre {
  background: var(--code-bg);
  color: var(--code-text);
  overflow-x: auto;
  padding: 0.9rem;
  border-radius: 12px;
}

.message-body :not(pre) > code,
.message-body p code,
.message-body li code,
.message-body td code,
.message-body th code,
.message-body blockquote code {
  background: rgba(31, 36, 48, 0.08);
  padding: 0.1rem 0.35rem;
  border-radius: 6px;
}

.message-body blockquote {
  margin-left: 0;
  padding-left: 1rem;
  border-left: 3px solid rgba(17, 100, 102, 0.35);
  color: var(--muted);
}

.message-body table {
  border-collapse: collapse;
  width: 100%;
}

.message-body th,
.message-body td {
  border: 1px solid var(--panel-border);
  padding: 0.45rem 0.6rem;
  text-align: left;
}

.message details {
  margin-top: 0.8rem;
}

.attachment-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.85rem;
}

.attachment-card {
  padding: 0.9rem 1rem;
}

.empty-state {
  margin: 1rem 0 0;
  color: var(--muted);
}
`;

const SITE_JS = `
document.addEventListener("DOMContentLoaded", () => {
  const filterInput = document.querySelector("[data-chat-filter]");
  const emptyState = document.querySelector("[data-chat-empty]");

  const applyFilter = () => {
    const query = filterInput instanceof HTMLInputElement ? filterInput.value.toLowerCase().trim() : "";
    let visibleCount = 0;

    for (const item of document.querySelectorAll("[data-chat-item]")) {
      const text = (item.getAttribute("data-chat-search") || item.textContent || "").toLowerCase();
      const matches = query.length === 0 || text.includes(query);
      item.hidden = !matches;
      if (matches) {
        visibleCount += 1;
      }
    }

    for (const group of document.querySelectorAll("[data-chat-group]")) {
      const shown = group.querySelectorAll("[data-chat-item]:not([hidden])").length;
      group.hidden = shown === 0;
      const counter = group.querySelector("[data-chat-count]");
      if (counter) {
        const label = counter.getAttribute("data-count-label") || "";
        counter.textContent = query.length > 0 ? shown + " shown" : label;
      }
    }

    if (emptyState) {
      emptyState.hidden = visibleCount > 0;
    }
  };

  if (filterInput instanceof HTMLInputElement) {
    filterInput.addEventListener("input", applyFilter);
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-project-filter]") : null;
    if (!(button instanceof HTMLElement) || !(filterInput instanceof HTMLInputElement)) {
      return;
    }

    filterInput.value = button.getAttribute("data-project-filter") || "";
    applyFilter();
    filterInput.focus();
  });

  applyFilter();
});
`;

interface ChatGroup {
  title: string;
  projectId?: string;
  projectName?: string;
  entries: ChatIndexEntry[];
}

interface RenderBlock {
  html: string;
  copiedMarkdown?: string;
}

interface RenderMessageGroup {
  role: ChatRole;
  startOrdinal: number;
  endOrdinal: number;
  contentBlocks: RenderBlock[];
  subtleBlocks: RenderBlock[];
  thoughtBlocks: RenderBlock[];
  attachments: AttachmentRecord[];
  awaitingThoughtResult: boolean;
  recapLabel?: string;
  sourceTurnExchangeId?: string;
}

export class StaticArchiveRenderer implements ArchiveRenderer {
  constructor(private readonly storage: ArchiveStorage) {}

  async writeAssets(): Promise<void> {
    await Promise.all([
      writeTextFile(path.join(this.storage.paths.assetsDir, "site.css"), `${SITE_CSS.trim()}\n`),
      writeTextFile(path.join(this.storage.paths.assetsDir, "site.js"), `${SITE_JS.trim()}\n`),
    ]);
  }

  async renderIndex(entries: ChatIndexEntry[]): Promise<void> {
    const sorted = [...entries].sort((left, right) => left.title.localeCompare(right.title));
    const groups = buildChatGroups(sorted);
    const groupMarkup = groups
      .map((group) => {
        const countLabel = `${group.entries.length} chats`;
        return `
          <section class="chat-group" data-chat-group>
            <div class="chat-group-header">
              <div>
                <p class="group-kicker">${group.projectId ? "Project" : "Chats"}</p>
                <h2 class="group-title">${escapeHtml(group.title)}</h2>
              </div>
              <div class="group-actions">
                ${group.projectName
                  ? `<button class="project-filter" type="button" data-project-filter="${escapeHtml(group.projectName)}">Only this project</button>`
                  : ""}
                <span class="meta" data-chat-count data-count-label="${escapeHtml(countLabel)}">${escapeHtml(countLabel)}</span>
              </div>
            </div>
            <ul class="chat-list">
              ${group.entries.map((entry) => renderChatIndexItem(entry)).join("\n")}
            </ul>
          </section>
        `;
      })
      .join("\n");

    const emptyMarkup = sorted.length === 0
      ? '<p class="empty-state">No chats have been archived yet.</p>'
      : '<p class="empty-state" data-chat-empty hidden>No chats match the current filter.</p>';
    const sectionsMeta = groups.length > 0 ? ` across ${groups.length} sections` : "";
    const html = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ChatGPT Archive</title>
          <link rel="stylesheet" href="./assets/site.css">
          <script defer src="./assets/site.js"></script>
        </head>
        <body>
          <main class="shell">
            <header class="topbar">
              <p class="subtitle">Local archive generated by chatgpt-archiver</p>
              <h1 class="title">ChatGPT Archive</h1>
              <p class="meta">${sorted.length} chats${sectionsMeta}</p>
              <input data-chat-filter type="search" placeholder="Filter chats" style="width:min(32rem,100%);padding:0.8rem 1rem;border-radius:999px;border:1px solid #d8d0c2;">
            </header>
            ${emptyMarkup}
            <div class="chat-groups">${groupMarkup}</div>
          </main>
        </body>
      </html>
    `;

    await writeTextFile(path.join(this.storage.rootDir, "index.html"), minifyShell(html));
  }

  async renderChat(artifacts: StoredChatArtifacts): Promise<void> {
    const project = resolveProjectMetadata(artifacts.chat.url, artifacts.chat);
    const attachmentByMessageId = new Map<string, AttachmentRecord[]>();
    for (const attachment of artifacts.attachments) {
      if (!attachment.messageId) {
        continue;
      }
      const bucket = attachmentByMessageId.get(attachment.messageId) ?? [];
      bucket.push(attachment);
      attachmentByMessageId.set(attachment.messageId, bucket);
    }

    const renderableMessages = buildRenderableMessages(artifacts.messages, attachmentByMessageId);
    const messageMarkup = renderableMessages.length === 0
      ? `
        <li class="message">
          <div class="message-body">
            <p>No renderable messages remained after filtering.</p>
          </div>
        </li>
      `
      : renderableMessages.map((message) => renderRenderableMessage(message)).join("\n");

    const html = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${escapeHtml(artifacts.chat.title)}</title>
          <link rel="stylesheet" href="../../assets/site.css">
        </head>
        <body>
          <main class="shell">
            <header class="topbar">
              <p class="subtitle"><a href="../../index.html">Back to archive index</a></p>
              <h1 class="title">${escapeHtml(artifacts.chat.title)}</h1>
              ${project ? `<p class="meta">Project: ${escapeHtml(project.projectName)}</p>` : ""}
              <p class="meta">${escapeHtml(artifacts.chat.url)}</p>
            </header>
            <ul class="message-list">${messageMarkup}</ul>
          </main>
        </body>
      </html>
    `;

    await writeTextFile(
      path.join(this.storage.getChatDir(artifacts.chat.chatId), "chat.html"),
      minifyShell(html),
    );
  }
}

function buildRenderableMessages(
  messages: MessageRecord[],
  attachmentByMessageId: Map<string, AttachmentRecord[]>,
): RenderMessageGroup[] {
  if (messages.some((message) => message.sourceContentType || message.sourceTurnExchangeId || message.sourceChannel != null)) {
    return buildMetadataAwareRenderableMessages(messages, attachmentByMessageId);
  }

  return buildLegacyRenderableMessages(messages, attachmentByMessageId);
}

function buildMetadataAwareRenderableMessages(
  messages: MessageRecord[],
  attachmentByMessageId: Map<string, AttachmentRecord[]>,
): RenderMessageGroup[] {
  const groups: RenderMessageGroup[] = [];
  let currentAssistant: RenderMessageGroup | null = null;

  for (const message of messages) {
    if (shouldSkipMessageInRender(message)) {
      continue;
    }

    const attachments = attachmentByMessageId.get(message.messageId) ?? [];

    if (message.role === "user") {
      const group = createRenderMessageGroup("user", message.ordinal);
      group.contentBlocks.push(createRenderBlock(message));
      group.attachments.push(...attachments);
      groups.push(group);
      currentAssistant = null;
      continue;
    }

    if (message.role !== "assistant") {
      continue;
    }

    const turnId = message.sourceTurnExchangeId ?? `assistant-${message.ordinal}`;
    if (!currentAssistant || currentAssistant.sourceTurnExchangeId !== turnId) {
      currentAssistant = createRenderMessageGroup("assistant", message.ordinal);
      currentAssistant.sourceTurnExchangeId = turnId;
      groups.push(currentAssistant);
    }

    currentAssistant.endOrdinal = message.ordinal;
    currentAssistant.attachments.push(...attachments);
    appendMetadataAwareAssistantMessage(currentAssistant, message);
  }

  return groups.filter((group) => {
    return group.contentBlocks.length > 0
      || group.subtleBlocks.length > 0
      || group.thoughtBlocks.length > 0
      || group.attachments.length > 0
      || Boolean(group.recapLabel);
  });
}

function buildLegacyRenderableMessages(
  messages: MessageRecord[],
  attachmentByMessageId: Map<string, AttachmentRecord[]>,
): RenderMessageGroup[] {
  const groups: RenderMessageGroup[] = [];
  let current: RenderMessageGroup | null = null;

  for (const message of messages) {
    if (shouldSkipMessageInRender(message)) {
      continue;
    }

    if (!current || current.role !== message.role) {
      current = createRenderMessageGroup(message.role, message.ordinal);
      groups.push(current);
    }

    current.endOrdinal = message.ordinal;
    const attachments = attachmentByMessageId.get(message.messageId) ?? [];
    current.attachments.push(...attachments);

    if (message.role === "assistant") {
      appendAssistantMessage(current, message);
      continue;
    }

    current.awaitingThoughtResult = false;
    current.contentBlocks.push(createRenderBlock(message));
  }

  return groups.filter((group) => {
    return group.contentBlocks.length > 0
      || group.subtleBlocks.length > 0
      || group.thoughtBlocks.length > 0
      || group.attachments.length > 0;
  });
}

function createRenderMessageGroup(role: ChatRole, ordinal: number): RenderMessageGroup {
  return {
    role,
    startOrdinal: ordinal,
    endOrdinal: ordinal,
    contentBlocks: [],
    subtleBlocks: [],
    thoughtBlocks: [],
    attachments: [],
    awaitingThoughtResult: false,
    sourceTurnExchangeId: undefined,
  };
}

function appendMetadataAwareAssistantMessage(group: RenderMessageGroup, message: MessageRecord): void {
  switch (message.sourceContentType) {
    case "model_editable_context":
      return;
    case "thoughts": {
      const thoughtBlocks = createThoughtRenderBlocks(message);
      group.thoughtBlocks.push(...thoughtBlocks);
      group.awaitingThoughtResult = thoughtBlocks.length > 0;
      return;
    }
    case "reasoning_recap": {
      const recapLabel = extractReasoningRecap(message);
      if (recapLabel) {
        group.recapLabel = recapLabel;
      }
      return;
    }
    default: {
      const block = createRenderBlock(message);
      if (isCommentaryMessage(message)) {
        group.subtleBlocks.push(block);
      } else {
        group.contentBlocks.push(block);
      }
      group.awaitingThoughtResult = false;
    }
  }
}

function appendAssistantMessage(group: RenderMessageGroup, message: MessageRecord): void {
  const text = message.plainText.trim();
  if (isSummaryMessage(text)) {
    for (const thoughtBlock of splitThoughtBlocks(text)) {
      group.thoughtBlocks.push(createRenderBlock(message, thoughtBlock));
    }
    group.awaitingThoughtResult = true;
    return;
  }

  const block = createRenderBlock(message);
  if (group.awaitingThoughtResult) {
    group.subtleBlocks.push(block);
    group.awaitingThoughtResult = false;
    return;
  }

  group.contentBlocks.push(block);
}

function shouldSkipMessageInRender(message: MessageRecord): boolean {
  if (message.role === "system") {
    return true;
  }

  if (message.role !== "assistant") {
    return false;
  }

  if (message.sourceContentType === "model_editable_context") {
    return true;
  }

  if (message.sourceIsVisuallyHiddenFromConversation) {
    return true;
  }

  const payload = parseJsonObject(message.plainText);
  if (!payload) {
    return false;
  }

  return Array.isArray(payload.queries) || Array.isArray(payload.pointers);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isSummaryMessage(text: string): boolean {
  return /^\s*Summary:/.test(text);
}

function splitThoughtBlocks(text: string): string[] {
  return text
    .split(/\n\s*\n---\n\s*\n|\n---\n/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function createRenderBlock(message: MessageRecord, textOverride?: string): RenderBlock {
  const html = textOverride == null
    ? (message.renderedHtml || plainTextToHtml(message.plainText))
    : plainTextToHtml(textOverride);

  return {
    html,
    ...(textOverride == null && message.copiedMarkdown ? { copiedMarkdown: message.copiedMarkdown } : {}),
  };
}

function createThoughtRenderBlocks(message: MessageRecord): RenderBlock[] {
  const thoughts = isRecord(message.sourceContent) && Array.isArray(message.sourceContent.thoughts)
    ? message.sourceContent.thoughts
    : [];

  if (thoughts.length === 0) {
    return message.plainText.trim().length > 0 ? [createRenderBlock(message)] : [];
  }

  return thoughts.flatMap((thought) => {
    if (!isRecord(thought)) {
      return [];
    }

    const summary = readString(thought.summary);
    const content = readString(thought.content);
    const chunks = Array.isArray(thought.chunks)
      ? thought.chunks.filter((chunk): chunk is string => typeof chunk === "string" && chunk.trim().length > 0)
      : [];
    const body = content ?? (chunks.length > 0 ? chunks.join("\n\n") : "");

    if (!summary && !body) {
      return [];
    }

    const html = [
      summary ? `<h4 class="thought-title">${escapeHtml(summary)}</h4>` : "",
      body ? plainTextToHtml(body) : "",
    ].filter(Boolean).join("\n");

    return [{ html }];
  });
}

function extractReasoningRecap(message: MessageRecord): string | undefined {
  if (isRecord(message.sourceContent)) {
    const content = readString(message.sourceContent.content);
    if (content) {
      return content;
    }
  }

  return readString(message.plainText);
}

function isCommentaryMessage(message: MessageRecord): boolean {
  return message.sourceChannel === "commentary" || message.sourceIsThinkingPreambleMessage === true;
}

function renderRenderableMessage(message: RenderMessageGroup): string {
  const attachmentMarkup = message.attachments.length === 0
    ? ""
    : `
      <section class="message-files">
        <h3>Files</h3>
        <ul class="attachment-list">
          ${message.attachments
            .map((attachment) => `
              <li class="attachment-card">
                <strong>${escapeHtml(attachment.fileName)}</strong><br>
                <span class="meta">${escapeHtml(attachment.status)}</span><br>
                <a href="./files/${encodeURIComponent(path.basename(attachment.localPath))}">Open local copy</a>
              </li>
            `)
            .join("")}
        </ul>
      </section>
    `;

  const subtleMarkup = message.subtleBlocks.length === 0
    ? ""
    : `
      <section class="message-subtle-group">
        ${message.subtleBlocks.map((block) => renderMessageBlock(block, "is-subtle")).join("\n")}
      </section>
    `;

  const thoughtMarkup = message.thoughtBlocks.length === 0
    ? ""
    : `
      <details class="message-thoughts">
        <summary>Reasoning summaries (${message.thoughtBlocks.length})</summary>
        <div class="thought-list">
          ${message.thoughtBlocks.map((block) => renderMessageBlock(block, "thought-block")).join("\n")}
        </div>
      </details>
    `;

  return `
    <li class="message role-${escapeHtml(message.role)}">
      <header>
        <span class="badge">${escapeHtml(message.role)}</span>
        <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;justify-content:flex-end;">
          ${message.recapLabel ? `<span class="message-recap">${escapeHtml(message.recapLabel)}</span>` : ""}
          <span class="meta">${escapeHtml(formatOrdinalRange(message.startOrdinal, message.endOrdinal))}</span>
        </div>
      </header>
      <div class="message-stack">
        ${subtleMarkup}
        ${thoughtMarkup}
        ${message.contentBlocks.map((block) => renderMessageBlock(block)).join("\n")}
        ${attachmentMarkup}
      </div>
    </li>
  `;
}

function renderMessageBlock(block: RenderBlock, extraClass = ""): string {
  const markdownMarkup = block.copiedMarkdown
    ? `
      <details>
        <summary>Copied markdown</summary>
        <pre>${escapeHtml(block.copiedMarkdown)}</pre>
      </details>
    `
    : "";

  const className = ["message-block", extraClass].filter(Boolean).join(" ");
  return `
    <section class="${escapeHtml(className)}">
      <div class="message-body">${block.html}</div>
      ${markdownMarkup}
    </section>
  `;
}

function formatOrdinalRange(startOrdinal: number, endOrdinal: number): string {
  const start = startOrdinal + 1;
  const end = endOrdinal + 1;
  return start === end ? `#${start}` : `#${start}-${end}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function renderChatIndexItem(entry: ChatIndexEntry): string {
  const project = resolveProjectMetadata(entry.url, entry);
  const meta = [
    entry.status,
    entry.messageCount != null ? `${entry.messageCount} messages` : null,
    entry.attachmentCount != null ? `${entry.attachmentCount} files` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const searchText = [
    entry.title,
    entry.status,
    project?.projectName,
    entry.url,
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <li data-chat-item data-chat-search="${escapeHtml(searchText)}">
      <div class="chat-card-top">
        <a class="chat-link" href="./chats/${encodeURIComponent(entry.chatId)}/chat.html">
          <strong>${escapeHtml(entry.title)}</strong>
          <span class="meta">${escapeHtml(meta || entry.url)}</span>
        </a>
        ${project ? `<span class="project-pill">${escapeHtml(project.projectName)}</span>` : ""}
      </div>
    </li>
  `;
}

function buildChatGroups(entries: ChatIndexEntry[]): ChatGroup[] {
  const groups = new Map<string, Required<Pick<ChatGroup, "title" | "projectId" | "projectName">> & {
    entries: ChatIndexEntry[];
  }>();
  const standalone: ChatIndexEntry[] = [];

  for (const entry of entries) {
    const project = resolveProjectMetadata(entry.url, entry);
    if (!project) {
      standalone.push(entry);
      continue;
    }

    const group = groups.get(project.projectId) ?? {
      title: project.projectName,
      projectId: project.projectId,
      projectName: project.projectName,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(project.projectId, group);
  }

  const projectGroups: ChatGroup[] = Array.from(groups.values())
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => left.title.localeCompare(right.title)),
    }))
    .sort((left, right) => left.title.localeCompare(right.title));

  if (standalone.length > 0) {
    projectGroups.push({
      title: "No project",
      entries: [...standalone].sort((left, right) => left.title.localeCompare(right.title)),
    });
  }

  return projectGroups;
}

function minifyShell(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimStart();
}
