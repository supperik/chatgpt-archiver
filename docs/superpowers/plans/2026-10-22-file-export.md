# File Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download every file visible in ChatGPT chats during `fetch` and show them next to their messages in the HTML archive.

**Architecture:** One pure extractor (`extractFileRefs`) reads file references out of a chat payload; `fetch` uses it to download files into `<outDir>/network/files/` through an injected transport (metadata via existing `requestJson`, bytes via `curl -o` with session cookies) and records results in `manifest.json`; `import` joins refs with the manifest into `AttachmentRecord`s, copies files into each chat folder, and the renderer shows them.

**Tech Stack:** TypeScript 5 (strict, CommonJS), Node ≥ 22, `node:test`, curl.exe, Playwright (existing session only).

**Spec:** `docs/superpowers/specs/2026-10-22-file-export-design.md`

**Beads epic:** `chatgpt-archiver-13j` (claim a task with `bd update <id> --claim` before starting, `bd close <id>` after its commit)

## Global Constraints

- Branch `feat/file-export`. Commits: conventional `type(scope): subject`, subject and body **in Russian**, no `Co-Authored-By` or any AI attribution.
- TDD: no production code without a failing test first.
- Every new `*.test.ts` file must be appended to the `test` script in `package.json` (it lists `dist/**/*.test.js` files explicitly).
- Run tests: `npm test` (PowerShell: `& 'C:\Program Files\nodejs\npm.cmd' test`). Single file: `npm run build` then `node --test --test-isolation=none dist/<path>.test.js`.
- No new dependencies.
- Never write `download_url`, its query string (`sig=`), cookies or auth headers to logs, manifest, HTML, or error messages.
- Every server-provided string in HTML goes through `escapeHtml`; file hrefs use `./files/${encodeURIComponent(basename)}`.
- HTML copy is English, matching existing UI ("Files", "Open local copy").
- Download is sequential. One file's failure never aborts `fetch`.
- `AttachmentStatus` values are the existing `"downloaded" | "skipped" | "failed" | "missing"`.

## Review Focus

- Session expires mid-run (401/403 on metadata after many chats) → those files `failed`, run finishes, next run retries them. *(Task 4 test `retries failed entries on next call`.)*
- One project file referenced in many chats → downloaded once, `seenIn` lists every chat. *(Task 4 test `downloads a shared key once`.)*
- Manifest says `downloaded` but file was deleted or is truncated → re-downloaded. *(Task 4 test `re-downloads when file missing or size differs`.)*
- Interrupted/forbidden download leaves no file that looks complete. *(Task 4 test `curlDownloadToFile leaves no file on 403`.)*
- Hostile or awkward names: Cyrillic with spaces, sandbox paths, `..`, `CON`, duplicate names in one chat. *(Task 2 and Task 6 tests.)*

---

### Task 1: Code fence language from `content.language` (separate commit) (`chatgpt-archiver-13j.1`)

The uncommitted change in `src/renderer/render.ts` (`buildRenderableText` / `wrapAsPythonCodeFence`) always fences `code` messages as `python`. Fix it in place, then commit **only this** before any other task.

**Files:**
- Modify: `src/renderer/render.ts` (`buildRenderableText`, `wrapAsPythonCodeFence` → rename `wrapAsCodeFence(text: string, language?: string): string`)
- Create: `src/renderer/render.test.ts`
- Modify: `package.json` (add `dist/renderer/render.test.js`)

**Interfaces:**
- Produces (test helper, reused by Task 7), in `src/renderer/render.test.ts`:
  `async function renderChatHtml(artifacts: StoredChatArtifacts): Promise<string>` — creates a temp dir with `fs.mkdtemp(path.join(os.tmpdir(), "archiver-render-"))`, `new ArchiveStorage(dir)`, `ensureBaseStructure()`, `new StaticArchiveRenderer(storage).renderChat(artifacts)`, returns `chats/<chatId>/chat.html` contents. Plus `makeMessage(overrides: Partial<MessageRecord>): MessageRecord` with defaults (`role: "assistant"`, `plainText: ""`, `attachmentRefs: []`, `preferredSource: "network"`, `sourceChannel: null`).

- [ ] **Step 1: Write failing tests** in `render.test.ts`:
  - `code message uses content.language for the fence`: message `{ sourceContentType: "code", plainText: '{"q":"x"}', sourceContent: { language: "json" } }` → HTML matches `/data-language="json"/` and does not match `/data-language="python"/`.
  - `code message with unknown language gets a plain fence`: `sourceContent: { language: "unknown" }`, `plainText: "print(1)"` → HTML matches `/<pre><code/` and does not match `/data-language=/`.
- [ ] **Step 2:** Run, expect FAIL (python fence is emitted).
- [ ] **Step 3:** `buildRenderableText` reads `message.sourceContent?.language`; a non-empty string other than `"unknown"` becomes the fence language, otherwise the fence has no language. Already-fenced text stays unchanged (existing behaviour).
- [ ] **Step 4:** Run `npm test`, expect PASS.
- [ ] **Step 5: Commit** `src/renderer/render.ts src/renderer/render.test.ts package.json`:
  `fix(renderer): брать язык блока кода из content.language`

---

### Task 2: Safe file names and byte formatting (`chatgpt-archiver-13j.2`)

**Files:**
- Modify: `src/utils/fs.ts`, `src/utils/fs.test.ts`

**Interfaces:**
- Produces: `toSafeFileName(rawName: string | undefined, mimeType?: string): string`
- Produces: `formatBytes(sizeBytes: number): string`
- Produces: `uniqueFileName(name: string, taken: Set<string>): string` — returns `name` or `"<stem> (2)<ext>"`, `"(3)"`… and adds the result to `taken` (case-insensitive comparison, Windows).

- [ ] **Step 1: Write failing tests:**
  - `toSafeFileName("user-F5…__72cb/a24e/mnt/data/QA_contact.png")` → `"QA_contact.png"` (basename on `/` and `\`).
  - `toSafeFileName("Элегантная вывеска юридического офиса.png")` → unchanged.
  - `toSafeFileName("../../etc/passwd")` → `"passwd"`.
  - `toSafeFileName("CON.txt")` → `"_CON.txt"`; `toSafeFileName("nul")` → `"_nul"`.
  - `toSafeFileName(undefined, "image/png")` → `"file.png"`; `toSafeFileName("", "application/pdf")` → `"file.pdf"`; `toSafeFileName(undefined, undefined)` → `"file"`.
  - `toSafeFileName("a".repeat(300) + ".docx").length` ≤ 120 and ends with `".docx"`.
  - `formatBytes(512)` → `"512 B"`, `formatBytes(2048)` → `"2.0 KB"`, `formatBytes(4201864)` → `"4.0 MB"` (base 1024, one decimal for KB/MB).
  - `uniqueFileName("a.png", taken)` twice → `"a.png"`, then `"a (2).png"`; `"A.PNG"` after those → `"A (3).PNG"`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement in `fs.ts`, reusing `sanitizeFileName`. Reserved stems: `CON PRN AUX NUL COM1–COM9 LPT1–LPT9` (case-insensitive, compared on stem before first dot). Extension-from-mime: last segment of subtype, stripped of `+…`/`;…` (`image/png` → `png`; unknown/missing → no extension). Max length 120 including extension.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit:** `feat(utils): безопасные имена файлов и форматирование размера`

---

### Task 3: `extractFileRefs` — file references from a chat payload (`chatgpt-archiver-13j.3`)

**Files:**
- Modify: `src/contracts.ts` (add types below)
- Create: `src/network/fileRefs.ts`, `src/network/fileRefs.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces in `contracts.ts`:
  ```ts
  export type FileRefKind = "attachment" | "image" | "sandbox";
  export interface FileRef {
    key: string;            // "file_…" / "file-…" id, or `sandbox:${chatId}:${messageId}:${sandboxPath}`
    kind: FileRefKind;
    chatId: string;
    messageId: string;      // message.id of the mapping node
    role: ChatRole;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
    sandboxPath?: string;   // kind "sandbox" only, decoded, starts with "/mnt/data/"
    generated?: boolean;    // kind "image" with metadata.generation or metadata.dalle non-null
  }
  ```
- Produces: `extractFileRefs(payload: unknown, chatId: string): FileRef[]` — order: mapping iteration order, then within a message: attachments, image parts, sandbox links. Duplicates are **kept** (same key in several messages); dedupe is the caller's job.

- [ ] **Step 1: Write failing tests** with small inline payloads `{ mapping: { n1: { id: "m1", message: { id: "m1", author: { role }, content, metadata } } } }`:
  - user `metadata.attachments: [{ id: "file_00a", name: "20261021_145816.jpg", mime_type: "image/jpeg", size: 1025181 }]` → one ref `{ key: "file_00a", kind: "attachment", role: "user", fileName: "20261021_145816.jpg", mimeType: "image/jpeg", sizeBytes: 1025181 }`. Also accept `mimeType` (camelCase) as seen in project files.
  - user `multimodal_text` part `{ content_type: "image_asset_pointer", asset_pointer: "sediment://file_00b", size_bytes: 2009383 }` → `{ key: "file_00b", kind: "image", sizeBytes: 2009383 }`, `generated` falsy.
  - tool part with `metadata.generation: { gen_id: "g" }` → `generated: true`, `role: "tool"`.
  - composite `"sediment://4cd614053a4baf0#file_000000002eec#p_0.91d6fec838.jpg"` → `key: "file_000000002eec"`.
  - legacy `"file-service://file-AbC123xyz"` → `key: "file-AbC123xyz"`.
  - assistant text part containing `[zip](sandbox:/mnt/data/%D0%9F%D0%BE%D0%BF%D0%BE%D0%B2.zip)` → `{ kind: "sandbox", sandboxPath: "/mnt/data/Попов.zip", fileName: "Попов.zip", key: "sandbox:c1:m1:/mnt/data/Попов.zip" }`.
  - assistant `content_type: "code"` text containing `path='/mnt/data/x.csv'` → no refs.
  - system message attachments → refs with `role: "system"`.
  - node without `message` and payload without `mapping` → `[]`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement. File id regex: `/file[-_][A-Za-z0-9]+/` applied to `asset_pointer`. Sandbox regex over string parts of assistant messages whose `content_type` is `text` or `multimodal_text`: `/sandbox:(\/mnt\/data\/[^)\s"]+)/g`, `decodeURIComponent` with fallback to raw on error.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit:** `feat(network): извлечение ссылок на файлы из JSON чата`

---

### Task 4: File downloader, manifest and curl binary transport (`chatgpt-archiver-13j.4`)

**Files:**
- Modify: `src/contracts.ts`
- Create: `src/network/fileDownloads.ts`, `src/network/fileDownloads.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `FileRef` (Task 3), `toSafeFileName` (Task 2), `shortHash`, `sha256Hex` (`src/utils/hash.ts`), `LogSink`.
- Produces in `contracts.ts`:
  ```ts
  export interface FileManifestEntry {
    key: string;
    kind: FileRefKind;
    fileName: string;          // safe name
    localPath?: string;        // posix, relative to filesRoot: "<keyDir>/<fileName>"
    mimeType?: string;
    sizeBytes?: number;
    sha256?: string;
    status: AttachmentStatus;
    error?: string;            // short, no URLs
    httpStatus?: number;
    downloadedAt?: string;
    seenIn: Array<{ chatId: string; messageId: string }>;
  }
  export type FileManifest = Record<string, FileManifestEntry>;
  ```
- Produces in `fileDownloads.ts`:
  ```ts
  export interface FileTransport {
    requestMetadata(ref: FileRef): Promise<unknown>;            // throws errors that may carry `statusCode: number`
    downloadToFile(url: string, destPath: string): Promise<{ statusCode: number; contentType?: string }>;
  }
  export interface FileDownloadSummary { downloaded: number; cached: number; failed: number; missing: number; skipped: number }
  export function keyDir(key: string): string;                 // key itself for file ids, `sandbox-${shortHash(key)}` for sandbox
  export async function readFileManifest(filesRoot: string): Promise<FileManifest>;   // {} if absent
  export async function writeFileManifest(filesRoot: string, manifest: FileManifest): Promise<void>;
  export async function needsDownload(entry: FileManifestEntry | undefined, filesRoot: string): Promise<boolean>;
  export async function downloadFilesForChat(
    refs: FileRef[], manifest: FileManifest, filesRoot: string,
    transport: FileTransport, logger: LogSink, options: { skip: boolean },
  ): Promise<FileDownloadSummary>;                              // mutates manifest; caller writes it
  export async function curlDownloadToFile(
    url: string, headers: Record<string, string>, destPath: string,
  ): Promise<{ statusCode: number; contentType?: string }>;
  ```

Behaviour of `downloadFilesForChat` (per unique key in `refs`):
1. Merge `{ chatId, messageId }` of every ref into `entry.seenIn` (no duplicates).
2. `skip: true` → absent entry gets `status: "skipped"`; existing entries untouched; count `skipped`.
3. `!needsDownload(entry)` → count `cached`.
4. Metadata: `transport.requestMetadata(ref)`. Thrown error with `statusCode === 404` → `missing`; other thrown error → `failed` (`httpStatus` from error if present, `error` = first 200 chars of message with any `https?://\S+` replaced by `<url>`). JSON without `status === "success"` or without string `download_url` → `missing`.
5. Name: `toSafeFileName(json.file_name ?? ref.fileName, json.mime_type ?? ref.mimeType)`; `localPath = keyDir(key) + "/" + name`.
6. `transport.downloadToFile(download_url, abs path)`; 2xx → `downloaded`, `sha256` from file on disk, `sizeBytes` = `json.file_size_bytes` or stat size, `downloadedAt`; 404 → `missing`; else `failed` with `httpStatus`.
7. Log one line per key: `File <key or keyDir> <name>: <status>[ (<httpStatus>)]` — nothing else.

`needsDownload` → `false` only if `status === "downloaded"`, `localPath` exists under `filesRoot`, and (`sizeBytes` undefined or equals file size).

`curlDownloadToFile`: `curl.exe` (`curl` off Windows) `-sS -o <dest>.part -w "%{http_code} %{content_type}"` plus `-H "name: value"` per header; 2xx → rename `.part` → `dest` (create parent dir first); otherwise delete `.part`. Thrown errors must not include the URL.

- [ ] **Step 1: Write failing tests** (fake transport that records calls; temp `filesRoot` via `mkdtemp`):
  - `downloads an attachment and records it`: metadata `{ status: "success", download_url: "u", file_name: "a.pdf", mime_type: "application/pdf", file_size_bytes: 3 }`, fake writes `"abc"` → entry `{ status: "downloaded", localPath: "file_1/a.pdf", sizeBytes: 3, sha256: sha256Hex("abc") }`, summary `downloaded: 1`.
  - `downloads a shared key once`: refs with same key from chats `c1`, `c2` across two calls → one `downloadToFile` call, `seenIn` has both.
  - `re-downloads when file missing or size differs`: entry `downloaded` but file deleted → downloads again; file of 2 bytes with `sizeBytes: 3` → downloads again.
  - `maps 404 to missing and other errors to failed`: metadata throws `{ statusCode: 404 }` → `missing`; throws `Object.assign(new Error("Request failed 401 for https://chatgpt.com/x?sig=abc"), { statusCode: 401 })` → `failed`, `httpStatus: 401`, `error` does not contain `sig=` or `https://`.
  - `retries failed entries on next call`: after a `failed` call, second call with working transport → `downloaded`.
  - `skip marks only absent entries`: `skip: true` → new key `skipped`, existing `downloaded` untouched, no transport calls.
  - `sandbox refs use a hashed directory`: `keyDir("sandbox:c:m:/mnt/data/x.zip")` matches `/^sandbox-[0-9a-f]{16}$/`.
  - `curlDownloadToFile writes the body and sends headers`: local `http.createServer` on `127.0.0.1:0` returns 200 bytes only if `cookie` header equals `"a=1"` → file content matches, `statusCode: 200`.
  - `curlDownloadToFile leaves no file on 403`: server returns 403 → `statusCode: 403`, neither `dest` nor `dest.part` exists.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement per the behaviour above.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit:** `feat(network): скачивание файлов чатов с манифестом`

---

### Task 5: Wire file downloads into `fetch` (`chatgpt-archiver-13j.5`)

**Files:**
- Modify: `src/network/requestBlueprints.ts`, `src/network/fetchCurlResponses.ts`, `src/cli.ts` (help text), `README.md`, `.gitignore`
- Test: `src/network/fileDownloads.test.ts` (one more test)

**Interfaces:**
- Consumes: `extractFileRefs` (Task 3); `downloadFilesForChat`, `readFileManifest`, `writeFileManifest`, `curlDownloadToFile`, `FileTransport` (Task 4).
- Produces: `FetchOptions.skipFiles: boolean` (default `false`, flag `--skip-files`); in `fileDownloads.ts` `export function resolveDownloadUrl(downloadUrl: string, baseOrigin: string): string`.
- Produces in `requestBlueprints.ts`:
  - `FILE_DOWNLOAD_REQUEST = { path(fileId) => "/backend-api/files/download/${fileId}", targetRoute: "/backend-api/files/download/{file_id}", buildQuery(chatId) => ({ conversation_id: chatId, inline: "false" }) }`
  - `INTERPRETER_DOWNLOAD_REQUEST = { path(chatId) => "/backend-api/conversation/${chatId}/interpreter/download", targetRoute: "/backend-api/conversation/{conversation_id}/interpreter/download", buildQuery(messageId, sandboxPath) => ({ message_id: messageId, sandbox_path: sandboxPath }) }`

- [ ] **Step 1: Write failing test** `resolveDownloadUrl`: `("/backend-api/estuary/content?id=1", "https://chatgpt.com")` → `"https://chatgpt.com/backend-api/estuary/content?id=1"`; absolute URL returned unchanged.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** In `fetchNetworkArchive`: `filesRoot = path.join(options.outDir, "network", "files")`; read manifest once before the chat loop; after each `writeJsonFile(...chatsDir...)` call `downloadFilesForChat(extractFileRefs(payload, chat.chatId), manifest, filesRoot, transport, logger, { skip: options.skipFiles })`, accumulate the summary, and `writeFileManifest` after each chat (so an interrupted run keeps progress). Transport closure: `requestMetadata` → existing `requestJson` with the blueprint above (`referer: chat.url`, `projectId: chat.projectId`); `downloadToFile` → `curlDownloadToFile(resolveDownloadUrl(url, session.baseOrigin), { cookie, "user-agent" } from capturedHeaders, dest)`. After the loop log `Files: N downloaded, M cached, K failed, L missing, S skipped`.
- [ ] **Step 6:** `parseFetchArgs` handles `--skip-files`; `printHelp` fetch options list `--skip-files  Do not download chat files`; README "Fetch options" gets the flag and "What it stores" gets `files: archive/network/files/<file-id>/<name>` and `manifest: archive/network/files/manifest.json`; `.gitignore` adds `archive-*/`.
- [ ] **Step 7:** `npm run check` and `npm test` PASS.
- [ ] **Step 8: Commit:** `feat(fetch): скачивать файлы чатов во время fetch`

---

### Task 6: Import — keep file-bearing messages, build attachments, copy files (`chatgpt-archiver-13j.6`)

**Files:**
- Create: `src/network/importChatFiles.ts`, `src/network/importChatFiles.test.ts`
- Modify: `src/network/importChatResponses.ts`, `package.json`

**Interfaces:**
- Consumes: `FileRef`, `FileManifest` (Tasks 3–4), `extractFileRefs`, `readFileManifest`, `uniqueFileName`.
- Produces in `importChatFiles.ts`:
  ```ts
  export interface ChatFileLinks {
    attachments: AttachmentRecord[];                          // one per unique key in this chat
    refsByMessageId: Map<string, MessageAttachmentRef[]>;
    copies: Array<{ from: string; to: string }>;              // from: relative to filesRoot; to: relative to chat dir
  }
  export function buildChatFileLinks(chatId: string, refs: FileRef[], manifest: FileManifest): ChatFileLinks;
  export async function copyChatFiles(copies: ChatFileLinks["copies"], filesRoot: string, chatDir: string): Promise<string[]>; // returns `to` paths whose source was missing
  ```
- Produces: `ImportOptions.filesDir` (default `path.join(outDir, "network", "files")`, reset with `--out-dir` like `responsesDir`); exported `convertResponseToArtifacts(payload, fileChatId, targets, baseUrl, manifest: FileManifest): StoredChatArtifacts & { copies: ChatFileLinks["copies"] }`.

`buildChatFileLinks` rules:
- `AttachmentRecord`: `attachmentId = key`, `chatId`, `fileName` = manifest `fileName` or `toSafeFileName(ref.fileName, ref.mimeType)`, `mimeType`, `sizeBytes`, `sha256`, `status` from manifest (no entry → `"missing"`, `error: "not in manifest"`), `localPath = "files/" + uniqueFileName(fileName, takenInThisChat)`, `sourceUrl = "sandbox:" + sandboxPath` for sandbox refs.
- `messageId`: first ref's `messageId`, except `role === "system"` → `undefined` (project file, chat-level).
- `copies` only for `status === "downloaded"`: `{ from: entry.localPath, to: record.localPath }`.
- `refsByMessageId`: per message, `{ attachmentId: key, relation: kind, ordinal }` in ref order, one per key per message.

`importChatResponses.ts` changes:
- Compute `refs = extractFileRefs(payload, chatId)` first; a normalized node is kept if it was kept before **or** (`role !== "system"` and some ref has `messageId === node.id`).
- `messages[].attachmentRefs = refsByMessageId.get(messageId) ?? []`, `artifacts.attachments = links.attachments`, index `attachmentCount = attachments.length`.
- `importFetchedChats` reads the manifest once; per chat it runs `copyChatFiles(copies, filesDir, storage.getChatDir(chatId))` first, sets records whose `localPath` came back as missing to `status: "missing"`, `error: "local file missing"`, then `writeChatArtifacts` and `renderChat`.
- Attachment size in `metadata.attachments[]`: use `size` when it is a number (field name not confirmed live; absent is fine).

- [ ] **Step 1: Write failing tests** for `buildChatFileLinks`:
  - user image ref + manifest `downloaded` → record `{ status: "downloaded", messageId: "m1", localPath: "files/20261021_145816.jpg" }`, one copy `{ from: "file_1/20261021_145816.jpg", to: "files/20261021_145816.jpg" }`.
  - same key in `m1` (attachment) and `m1` (image part) and `m3` → one record (`messageId: "m1"`), `refsByMessageId` has `m1` once and `m3` once.
  - system ref → `messageId` undefined.
  - two keys both named `scan.png` → `files/scan.png` and `files/scan (2).png`.
  - key absent from manifest → `status: "missing"`, no copy.
  - sandbox ref → `sourceUrl: "sandbox:/mnt/data/Попов.zip"`.
- [ ] **Step 2: Write failing test** for `convertResponseToArtifacts`: payload with a user message whose only part is an image pointer (no text) and a tool message with a generated image → both messages present in `messages` (roles `user`, `tool`) with non-empty `attachmentRefs`; a tool message without refs is still dropped.
- [ ] **Step 3: Write failing tests** for `copyChatFiles`: copies `from` (under `filesRoot`) to `to` (under `chatDir`), creating `files/`; a copy whose source is absent does not throw, creates nothing, and its `to` is returned in the result array.
- [ ] **Step 4:** Run, expect FAIL. **Step 5:** implement. **Step 6:** `npm test` PASS.
- [ ] **Step 7: Commit:** `feat(import): привязывать скачанные файлы к сообщениям`

---

### Task 7: Render files in the chat HTML (`chatgpt-archiver-13j.7`)

**Files:**
- Modify: `src/renderer/render.ts`, `src/utils/html.ts`, `src/utils/html.test.ts`, `src/renderer/render.test.ts`

**Interfaces:**
- Consumes: `AttachmentRecord` from Task 6 (`messageId` undefined = project file, `sourceUrl` `sandbox:` for sandbox files), `formatBytes` (Task 2), `renderChatHtml`/`makeMessage` test helpers (Task 1).
- Produces in `render.ts`: `export function rewriteSandboxLinks(text: string, links: Map<string, string>): string` — replaces `sandbox:<path>` (raw or percent-encoded form) with the mapped href.

Markup (classes are new; add CSS for `.attachment-image img { max-width: 100%; max-height: 24rem; display: block; }` and `.chat-files`):
- Downloaded image (`mimeType` starts with `image/`): `<li class="attachment-card attachment-image"><a href="./files/X"><img src="./files/X" alt="<name>" loading="lazy"></a><span class="meta"><name> · <size></span></li>`.
- Downloaded other: existing card plus `<span class="meta"><size> · <mimeType></span>` and the existing "Open local copy" link.
- Not downloaded: card with name and no link; label `missing` → `Unavailable on server`, `failed` → `Download failed`, `skipped` → `Not downloaded (--skip-files)`.
- Attachments with `messageId` undefined: `<section class="chat-files"><h2>Project files</h2><ul class="attachment-list">…</ul></section>` inside the chat `<header>` after the URL line.
- `tool` messages (metadata-aware path only): never render their text; push their attachments into the current assistant group when its `sourceTurnExchangeId` equals the tool message's turn id (or the tool message has none and a current assistant group exists); otherwise start a new assistant group with that turn id. A user message still resets the current assistant group.
- Sandbox links: map `sourceUrl → "./files/" + encodeURIComponent(basename(localPath))` for downloaded sandbox records; apply `rewriteSandboxLinks` to text before `plainTextToHtml`. `sanitizeUrl` in `html.ts` additionally allows hrefs starting with `./files/`.

- [ ] **Step 1: Write failing tests:**
  - `html.test.ts`: `plainTextToHtml("[a](./files/x.zip)")` matches `/href="\.\/files\/x\.zip"/`; `[a](sandbox:/mnt/data/x)` still becomes `href="#"`.
  - `rewriteSandboxLinks("[z](sandbox:/mnt/data/%D0%9F.zip)", new Map([["sandbox:/mnt/data/П.zip", "./files/%D0%9F.zip"]]))` → `"[z](./files/%D0%9F.zip)"`; unmapped link unchanged.
  - `renders a downloaded image inline`: user message with attachment `{ mimeType: "image/png", status: "downloaded", localPath: "files/a b.png" }` → HTML matches `/<img src="\.\/files\/a%20b\.png"/`.
  - `renders a pdf card with size and type`: `sizeBytes: 4201864` → matches `/4\.0 MB · application\/pdf/` and `/Open local copy/`.
  - `renders a placeholder for missing files`: `status: "missing"` → matches `/Unavailable on server/`, no `href="./files/`.
  - `renders project files in the header`: attachment without `messageId` → `<h2>Project files</h2>` appears before `class="message-list"`.
  - `attaches generated images to the assistant turn`: messages `user`, `assistant` (turn `t1`, text "Here"), `tool` (turn `t1`, text `{"json":1}`, attachment) → exactly one assistant `<li` containing both "Here" and the `<img`, and HTML does not contain `{"json":1}`.
  - `rewrites downloaded sandbox links`: assistant text `[zip](sandbox:/mnt/data/x.zip)` + downloaded record `{ sourceUrl: "sandbox:/mnt/data/x.zip", localPath: "files/x.zip" }` → matches `/href="\.\/files\/x\.zip"/`.
  - escaping: `fileName: "<b>x</b>.png"` → HTML contains `&lt;b&gt;` and no `<b>x</b>`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** implement. **Step 4:** `npm test` PASS.
- [ ] **Step 5: Commit:** `feat(renderer): показывать файлы чатов в HTML-архиве`

---

### Task 8: Live verification (controller, no code) (`chatgpt-archiver-13j.8`)

- [ ] **Step 1:** Browser running with `--remote-debugging-port=9222` on `.remote-debug-profile/yandex`, logged into the target workspace.
- [ ] **Step 2:** `npx tsx src/cli.ts run --cdp-url http://127.0.0.1:9222 --out-dir archive-team` → exit 0, summary line `Files: …` with `failed` 0 or each failure explained.
- [ ] **Step 3:** Run it again → summary shows `0 downloaded`, all `cached`.
- [ ] **Step 4:** `grep -rl "sig=" archive-team` → no output; `git status --short` shows nothing under `archive-team/`.
- [ ] **Step 5:** Open `archive-team/index.html` and chats containing: a user photo, a generated image, the PDF, the `.docx` (composite pointer), a sandbox `.zip` link, a project chat with project files → each shows correctly and local links open.
- [ ] **Step 6:** `npx tsx src/cli.ts fetch --cdp-url http://127.0.0.1:9222 --out-dir archive-team-skip --skip-files --import` → files `skipped`, placeholders rendered.
