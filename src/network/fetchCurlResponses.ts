import path from "node:path";
import { spawn } from "node:child_process";
import type { AppOptions, BrowserFlavor, BrowserSession } from "../contracts";
import { createBrowserSession } from "../browser/session";
import { getProjectNameFromProjectId } from "../discovery/urlPatterns";
import { ensureDir, writeJsonFile } from "../utils/fs";
import { Logger } from "../utils/log";
import {
  CAPTURE_SOURCE_PATHS,
  CHAT_MESSAGES_REQUEST,
  NON_PROJECT_CHATS_REQUEST,
  PROJECT_SIDEBAR_REQUEST,
  REQUIRED_CAPTURE_HEADERS,
} from "./requestBlueprints";
import { importFetchedChats } from "./importChatResponses";

export interface FetchOptions extends AppOptions {
  nonProjectLimit: number;
  projectsLimit: number;
  projectConversationsLimit: number;
  maxSidebarExpansionRounds: number;
  importAfterFetch: boolean;
}

interface CapturedHeaders {
  [key: string]: string;
}

interface ProjectTarget {
  projectId: string;
  projectName: string;
  projectPath: string;
  url: string;
}

interface ChatTarget {
  chatId: string;
  title: string;
  url: string;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  discoveredFrom: string[];
}

interface SidebarParseResult {
  projects: ProjectTarget[];
  chats: ChatTarget[];
  topCursor: string | null;
  projectChatCursorCount: number;
  maxProjectConversationCount: number;
}

class RequestTransportError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: string,
    readonly transport?: "curl" | "browser",
  ) {
    super(message);
  }
}

async function main(): Promise<void> {
  const options = parseFetchArgs(process.argv.slice(2));
  await fetchNetworkArchive(options);
}

export async function fetchNetworkArchive(
  options: FetchOptions,
  logger: Logger = new Logger(),
): Promise<void> {
  const discoveryDir = path.join(options.outDir, "network", "discovery");
  const rawDir = path.join(discoveryDir, "raw");
  const chatsDir = path.join(options.outDir, "network", "chats");
  const targetsFile = path.join(discoveryDir, "chat-targets.json");

  await Promise.all([
    ensureDir(discoveryDir),
    ensureDir(rawDir),
    ensureDir(chatsDir),
  ]);

  const session = await createBrowserSession(options, logger);
  try {
    const capturedHeaders = await captureApiHeaders(session, logger);

    const nonProjectChats = await fetchNonProjectChats(session, capturedHeaders, options, rawDir, logger);
    const sidebarResult = await fetchProjectsAndChats(session, capturedHeaders, options, rawDir, logger);

    const allChats = new Map<string, ChatTarget>();
    for (const chat of nonProjectChats) {
      mergeChatTarget(allChats, chat);
    }
    for (const chat of sidebarResult.chats) {
      mergeChatTarget(allChats, chat);
    }

    const orderedProjects = [...sidebarResult.projects].sort((left, right) => left.projectName.localeCompare(right.projectName));
    const orderedChats = [...allChats.values()].sort((left, right) => left.title.localeCompare(right.title));

    await Promise.all([
      writeJsonFile(path.join(discoveryDir, "projects.json"), orderedProjects),
      writeJsonFile(targetsFile, orderedChats),
    ]);

    logger.info(`Collected ${nonProjectChats.length} non-project chats`);
    logger.info(`Collected ${orderedProjects.length} projects`);
    logger.info(`Collected ${orderedChats.length} total chats`);

    for (const chat of orderedChats) {
      const payload = await fetchChatMessages(session, capturedHeaders, chat);
      await writeJsonFile(path.join(chatsDir, `${chat.chatId}.json`), payload);
      logger.info(`Saved chat payload ${chat.chatId}`);
    }
  } finally {
    await session.close();
  }

  if (options.importAfterFetch) {
    logger.info("Importing fetched chats into the local archive and rendering HTML");
    await importFetchedChats({
      baseUrl: options.baseUrl,
      outDir: options.outDir,
      responsesDir: chatsDir,
      targetsFile,
    });
  }
}

export function createDefaultFetchOptions(): FetchOptions {
  return {
    command: "fetch",
    baseUrl: "https://chatgpt.com",
    outDir: path.resolve("archive"),
    profileDir: path.resolve(".playwright-profile"),
    remoteDebugProfileDir: path.resolve(".remote-debug-profile"),
    browserFlavor: "auto",
    headless: false,
    manualLogin: false,
    remoteDebuggingPort: 9222,
    nonProjectLimit: 100,
    projectsLimit: 50,
    projectConversationsLimit: 20,
    maxSidebarExpansionRounds: 5,
    importAfterFetch: false,
  };
}

export function parseFetchArgs(argv: string[]): FetchOptions {
  const options = createDefaultFetchOptions();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--base-url":
        options.baseUrl = readValue(argv, ++index, arg);
        break;
      case "--out-dir":
        options.outDir = path.resolve(readValue(argv, ++index, arg));
        break;
      case "--profile-dir":
        options.profileDir = path.resolve(readValue(argv, ++index, arg));
        break;
      case "--remote-debug-profile-dir":
        options.remoteDebugProfileDir = path.resolve(readValue(argv, ++index, arg));
        break;
      case "--browser-channel":
        options.browserChannel = readValue(argv, ++index, arg);
        break;
      case "--browser":
        options.browserFlavor = parseBrowserFlavor(readValue(argv, ++index, arg));
        break;
      case "--browser-executable-path":
        options.browserExecutablePath = path.resolve(readValue(argv, ++index, arg));
        break;
      case "--cdp-url":
        options.cdpUrl = readValue(argv, ++index, arg);
        break;
      case "--remote-debugging-port":
        options.remoteDebuggingPort = Number.parseInt(readValue(argv, ++index, arg), 10);
        break;
      case "--headless":
        options.headless = true;
        break;
      case "--manual-login":
        options.manualLogin = true;
        break;
      case "--non-project-limit":
        options.nonProjectLimit = Number.parseInt(readValue(argv, ++index, arg), 10);
        break;
      case "--projects-limit":
        options.projectsLimit = Number.parseInt(readValue(argv, ++index, arg), 10);
        break;
      case "--project-conversations-limit":
        options.projectConversationsLimit = Number.parseInt(readValue(argv, ++index, arg), 10);
        break;
      case "--max-sidebar-expansion-rounds":
        options.maxSidebarExpansionRounds = Number.parseInt(readValue(argv, ++index, arg), 10);
        break;
      case "--import":
      case "--render":
        options.importAfterFetch = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  assertPositiveInt(options.nonProjectLimit, "--non-project-limit");
  assertPositiveInt(options.projectsLimit, "--projects-limit");
  assertPositiveInt(options.projectConversationsLimit, "--project-conversations-limit");
  assertPositiveInt(options.maxSidebarExpansionRounds, "--max-sidebar-expansion-rounds");
  assertPositiveInt(options.remoteDebuggingPort, "--remote-debugging-port");

  return options;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function assertPositiveInt(value: number, flag: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
}

function parseBrowserFlavor(value: string): BrowserFlavor {
  switch (value) {
    case "auto":
    case "yandex":
    case "chrome":
    case "edge":
      return value;
    default:
      throw new Error(`Unknown browser flavor: ${value}`);
  }
}

async function captureApiHeaders(session: BrowserSession, logger: Logger): Promise<CapturedHeaders> {
  logger.info("Capturing request headers from the authorized ChatGPT session");

  for (const action of [
    async () => {
      const requestPromise = session.page.waitForRequest(matchesHeaderCaptureRequest, { timeout: 15000 });
      await session.page.goto(session.baseUrl, { waitUntil: "domcontentloaded" });
      return requestPromise;
    },
    async () => {
      const requestPromise = session.page.waitForRequest(matchesHeaderCaptureRequest, { timeout: 15000 });
      await session.page.reload({ waitUntil: "domcontentloaded" });
      return requestPromise;
    },
  ]) {
    try {
      const request = await action();
      const headers = await request.allHeaders();
      const cookieHeader = headers.cookie || await buildCookieHeader(session);
      const sanitized = sanitizeCapturedHeaders({
        ...headers,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      });

      const missing = REQUIRED_CAPTURE_HEADERS.filter((name) => !sanitized[name]);
      if (missing.length > 0) {
        throw new Error(`Captured request is missing headers: ${missing.join(", ")}`);
      }

      return sanitized;
    } catch (error) {
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    "Could not capture a suitable ChatGPT API request. Open the ChatGPT home page in the authorized browser and retry.",
  );
}

function matchesHeaderCaptureRequest(request: { method(): string; url(): string }): boolean {
  if (request.method() !== "GET") {
    return false;
  }

  return CAPTURE_SOURCE_PATHS.some((pathPart) => request.url().includes(pathPart));
}

async function buildCookieHeader(session: BrowserSession): Promise<string> {
  const cookies = await session.page.context().cookies(session.baseOrigin);
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function sanitizeCapturedHeaders(headers: CapturedHeaders): CapturedHeaders {
  const next: CapturedHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!value || lowerName.startsWith(":") || [
      "host",
      "content-length",
      "connection",
      "referer",
      "x-openai-target-path",
      "x-openai-target-route",
      "chatgpt-project-id",
    ].includes(lowerName)) {
      continue;
    }
    next[lowerName] = value;
  }
  return next;
}

async function fetchNonProjectChats(
  session: BrowserSession,
  capturedHeaders: CapturedHeaders,
  options: FetchOptions,
  rawDir: string,
  logger: Logger,
): Promise<ChatTarget[]> {
  const allChats: ChatTarget[] = [];
  let offset = 0;
  let pageIndex = 0;

  while (true) {
    const payload = await requestJson(session, capturedHeaders, {
      pathname: NON_PROJECT_CHATS_REQUEST.path,
      targetRoute: NON_PROJECT_CHATS_REQUEST.targetRoute,
      query: NON_PROJECT_CHATS_REQUEST.buildQuery(offset, options.nonProjectLimit),
      referer: `${session.baseUrl}/`,
    }, logger);

    await writeJsonFile(path.join(rawDir, `conversations-page-${pad(pageIndex)}.json`), payload);

    const pageChats = parseNonProjectChats(payload, session.baseUrl);
    allChats.push(...pageChats);
    logger.info(`Non-project page ${pageIndex + 1}: ${pageChats.length} chats`);

    const total = isRecord(payload) && typeof payload.total === "number" ? payload.total : undefined;
    if (pageChats.length === 0 || pageChats.length < options.nonProjectLimit) {
      break;
    }

    offset += pageChats.length;
    pageIndex += 1;

    if (total != null && offset >= total) {
      break;
    }
  }

  return dedupeChats(allChats);
}

async function fetchProjectsAndChats(
  session: BrowserSession,
  capturedHeaders: CapturedHeaders,
  options: FetchOptions,
  rawDir: string,
  logger: Logger,
): Promise<{ projects: ProjectTarget[]; chats: ChatTarget[] }> {
  const projectById = new Map<string, ProjectTarget>();
  const chatById = new Map<string, ChatTarget>();
  let projectLimit = options.projectsLimit;
  let conversationsPerGizmo = options.projectConversationsLimit;
  let previousSnapshot = "";

  for (let round = 0; round < options.maxSidebarExpansionRounds; round += 1) {
    const payload = await requestJson(session, capturedHeaders, {
      pathname: PROJECT_SIDEBAR_REQUEST.path,
      targetRoute: PROJECT_SIDEBAR_REQUEST.targetRoute,
      query: PROJECT_SIDEBAR_REQUEST.buildQuery(projectLimit, conversationsPerGizmo),
      referer: `${session.baseUrl}/`,
    }, logger);

    await writeJsonFile(
      path.join(rawDir, `projects-sidebar-round-${pad(round)}-p${projectLimit}-c${conversationsPerGizmo}.json`),
      payload,
    );

    const parsed = parseSidebarPayload(payload, session.baseUrl);
    for (const project of parsed.projects) {
      projectById.set(project.projectId, project);
    }
    for (const chat of parsed.chats) {
      mergeChatTarget(chatById, chat);
    }

    logger.info(
      `Sidebar round ${round + 1}: ${parsed.projects.length} projects, ${parsed.chats.length} project chats`,
    );

    const needsMoreProjects = Boolean(parsed.topCursor) || parsed.projects.length >= projectLimit;
    const needsMoreChats =
      parsed.projectChatCursorCount > 0 || parsed.maxProjectConversationCount >= conversationsPerGizmo;

    if (!needsMoreProjects && !needsMoreChats) {
      break;
    }

    const nextProjectLimit = needsMoreProjects ? projectLimit * 2 : projectLimit;
    const nextConversationLimit = needsMoreChats
      ? conversationsPerGizmo * 2
      : conversationsPerGizmo;
    const snapshot = `${parsed.projects.length}|${parsed.chats.length}|${parsed.topCursor ?? ""}|${parsed.projectChatCursorCount}|${parsed.maxProjectConversationCount}`;

    if (snapshot === previousSnapshot) {
      logger.warn("Sidebar limits stopped expanding the result set. Using the latest collected project chats.");
      break;
    }

    previousSnapshot = snapshot;
    projectLimit = nextProjectLimit;
    conversationsPerGizmo = nextConversationLimit;
  }

  return {
    projects: [...projectById.values()],
    chats: [...chatById.values()],
  };
}

async function fetchChatMessages(
  session: BrowserSession,
  capturedHeaders: CapturedHeaders,
  chat: ChatTarget,
  logger?: Logger,
): Promise<unknown> {
  return requestJson(session, capturedHeaders, {
    pathname: CHAT_MESSAGES_REQUEST.path(chat.chatId),
    targetRoute: CHAT_MESSAGES_REQUEST.targetRoute,
    referer: chat.url,
    projectId: chat.projectId,
  }, logger);
}

async function requestJson(
  session: BrowserSession,
  capturedHeaders: CapturedHeaders,
  request: {
    pathname: string;
    targetRoute: string;
    referer: string;
    query?: Record<string, string>;
    projectId?: string;
  },
  logger?: Logger,
): Promise<unknown> {
  const url = new URL(request.pathname, session.baseOrigin);
  if (request.query) {
    for (const [key, value] of Object.entries(request.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers = buildRequestHeaders(capturedHeaders, {
    referer: request.referer,
    targetPath: `${url.pathname}${url.search}`,
    targetRoute: request.targetRoute,
    projectId: request.projectId,
  });

  try {
    return await requestJsonWithCurl(url.toString(), headers);
  } catch (error) {
    if (!shouldFallbackToBrowserRequest(error)) {
      throw error;
    }

    logger?.warn(
      `curl request was rejected for ${url.pathname}; retrying inside the authorized browser session`,
    );
    return requestJsonInBrowser(session, url.toString(), headers);
  }
}

function buildRequestHeaders(
  capturedHeaders: CapturedHeaders,
  request: {
    referer: string;
    targetPath: string;
    targetRoute: string;
    projectId?: string;
  },
): CapturedHeaders {
  const headers: CapturedHeaders = {
    ...capturedHeaders,
    referer: request.referer,
    "x-openai-target-path": request.targetPath,
    "x-openai-target-route": request.targetRoute,
  };

  if (request.projectId) {
    headers["chatgpt-project-id"] = request.projectId;
  } else {
    delete headers["chatgpt-project-id"];
  }

  return headers;
}

async function requestJsonWithCurl(url: string, headers: CapturedHeaders): Promise<unknown> {
  const response = await runCurlRequest(url, sanitizeHeadersForCurlRequest(headers));
  return parseJsonResponse(url, response.body, response.statusCode, "curl");
}

async function requestJsonInBrowser(
  session: BrowserSession,
  url: string,
  headers: CapturedHeaders,
): Promise<unknown> {
  const browserHeaders = sanitizeHeadersForBrowserFetch(headers);
  const response = await session.page.evaluate(async (request) => {
    const result = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      credentials: "include",
    });

    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      body: await result.text(),
    };
  }, {
    url,
    headers: browserHeaders,
  });

  if (!response.ok) {
    throw new RequestTransportError(
      `Request failed ${response.status} ${response.statusText} for ${url}\n${response.body.slice(0, 1000)}`,
      response.status,
      response.body,
      "browser",
    );
  }

  return parseJsonResponse(url, response.body, response.status, "browser");
}

async function runCurlRequest(
  url: string,
  headers: CapturedHeaders,
): Promise<{ statusCode: number; body: string }> {
  const statusMarker = "\n__CHATGPT_ARCHIVER_STATUS__:";
  const curlBinary = process.platform === "win32" ? "curl.exe" : "curl";
  const args = [
    "-sS",
    "--compressed",
    "-X",
    "GET",
    url,
    "-w",
    `${statusMarker}%{http_code}`,
  ];

  for (const [name, value] of Object.entries(headers)) {
    if (!value) {
      continue;
    }
    args.push("-H", `${name}: ${value}`);
  }

  const output = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(curlBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });

  const markerIndex = output.stdout.lastIndexOf(statusMarker);
  if (markerIndex === -1) {
    throw new RequestTransportError(
      `curl did not return a status marker for ${url}\n${output.stderr.slice(0, 1000)}`,
      undefined,
      output.stdout,
      "curl",
    );
  }

  const body = output.stdout.slice(0, markerIndex);
  const statusCode = Number.parseInt(output.stdout.slice(markerIndex + statusMarker.length).trim(), 10);
  if (!Number.isInteger(statusCode)) {
    throw new RequestTransportError(
      `curl returned an invalid status code for ${url}`,
      undefined,
      body,
      "curl",
    );
  }

  if (statusCode === 0) {
    throw new RequestTransportError(
      `curl did not receive an HTTP response for ${url}\n${output.stderr.slice(0, 1000)}`,
      0,
      body,
      "curl",
    );
  }

  if (output.exitCode !== 0 && body.length === 0) {
    throw new RequestTransportError(
      `curl exited with code ${output.exitCode ?? "unknown"} for ${url}\n${output.stderr.slice(0, 1000)}`,
      statusCode,
      body,
      "curl",
    );
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new RequestTransportError(
      `Request failed ${statusCode} for ${url}\n${body.slice(0, 1000)}`,
      statusCode,
      body,
      "curl",
    );
  }

  return { statusCode, body };
}

function parseJsonResponse(
  url: string,
  raw: string,
  statusCode: number,
  transport: "curl" | "browser",
): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RequestTransportError(
      `Request to ${url} via ${transport} returned invalid JSON after status ${statusCode}: ${message}`,
      statusCode,
      raw,
      transport,
    );
  }
}

function sanitizeHeadersForBrowserFetch(headers: CapturedHeaders): CapturedHeaders {
  const next: CapturedHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (
      !value
      || lowerName === "cookie"
      || lowerName === "host"
      || lowerName === "origin"
      || lowerName === "referer"
      || lowerName === "user-agent"
      || lowerName === "accept-encoding"
      || lowerName === "accept-language"
      || lowerName === "content-length"
      || lowerName === "connection"
      || lowerName.startsWith("sec-")
    ) {
      continue;
    }
    next[lowerName] = value;
  }
  return next;
}

function sanitizeHeadersForCurlRequest(headers: CapturedHeaders): CapturedHeaders {
  const next: CapturedHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (
      !value
      || lowerName === "host"
      || lowerName === "content-length"
      || lowerName === "connection"
      || lowerName === "accept-encoding"
      || lowerName.startsWith("sec-")
    ) {
      continue;
    }
    next[lowerName] = value;
  }
  return next;
}

function shouldFallbackToBrowserRequest(error: unknown): boolean {
  return error instanceof RequestTransportError
    && error.transport === "curl"
    && (error.statusCode == null || error.statusCode === 0 || error.statusCode === 401 || error.statusCode === 403);
}

function parseNonProjectChats(payload: unknown, baseUrl: string): ChatTarget[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return [];
  }

  return payload.items.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const chatId = readString(item.id);
    if (!chatId) {
      return [];
    }

    return [{
      chatId,
      title: readString(item.title) ?? `Chat ${chatId}`,
      url: `${baseUrl}/c/${chatId}`,
      discoveredFrom: ["non-project-chats"],
    }];
  });
}

function parseSidebarPayload(payload: unknown, baseUrl: string): SidebarParseResult {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return {
      projects: [],
      chats: [],
      topCursor: null,
      projectChatCursorCount: 0,
      maxProjectConversationCount: 0,
    };
  }

  const projects: ProjectTarget[] = [];
  const chats: ChatTarget[] = [];
  let projectChatCursorCount = 0;
  let maxProjectConversationCount = 0;

  for (const item of payload.items) {
    if (!isRecord(item)) {
      continue;
    }

    const project = extractProjectTarget(item, baseUrl);
    if (!project) {
      continue;
    }
    projects.push(project);

    const conversations = isRecord(item.conversations) ? item.conversations : undefined;
    if (readString(conversations?.cursor)) {
      projectChatCursorCount += 1;
    }

    const conversationItems = Array.isArray(conversations?.items) ? conversations.items : [];
    if (conversationItems.length > maxProjectConversationCount) {
      maxProjectConversationCount = conversationItems.length;
    }
    for (const conversation of conversationItems) {
      const chat = extractProjectConversation(conversation, project, baseUrl);
      if (chat) {
        chats.push(chat);
      }
    }
  }

  return {
    projects: dedupeProjects(projects),
    chats: dedupeChats(chats),
    topCursor: readString(payload.cursor) ?? null,
    projectChatCursorCount,
    maxProjectConversationCount,
  };
}

function extractProjectTarget(value: unknown, baseUrl: string): ProjectTarget | null {
  const candidate = findProjectRecord(value);
  if (!candidate) {
    return null;
  }

  const projectId = readString(candidate.id);
  if (!projectId || !projectId.startsWith("g-p-")) {
    return null;
  }

  const projectPath = readString(candidate.short_url) ?? projectId;
  const display = isRecord(candidate.display) ? candidate.display : undefined;
  const projectName = readString(display?.name)
    ?? readString(candidate.name)
    ?? getProjectNameFromProjectId(projectPath)
    ?? projectPath;

  return {
    projectId,
    projectName,
    projectPath,
    url: `${baseUrl}/g/${projectPath}/project`,
  };
}

function findProjectRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const gizmo = isRecord(value.gizmo) ? value.gizmo : undefined;
  const nested = isRecord(gizmo?.gizmo) ? gizmo.gizmo : undefined;

  if (nested && readString(nested.id)?.startsWith("g-p-")) {
    return nested;
  }
  if (gizmo && readString(gizmo.id)?.startsWith("g-p-")) {
    return gizmo;
  }
  if (readString(value.id)?.startsWith("g-p-")) {
    return value;
  }

  return null;
}

function extractProjectConversation(
  value: unknown,
  project: ProjectTarget,
  baseUrl: string,
): ChatTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const chatId = readString(value.id);
  if (!chatId) {
    return null;
  }

  return {
    chatId,
    title: readString(value.title) ?? `Chat ${chatId}`,
    url: `${baseUrl}/g/${project.projectPath}/c/${chatId}`,
    projectId: project.projectId,
    projectName: project.projectName,
    projectPath: project.projectPath,
    discoveredFrom: ["project-sidebar"],
  };
}

function dedupeProjects(projects: ProjectTarget[]): ProjectTarget[] {
  const byId = new Map<string, ProjectTarget>();
  for (const project of projects) {
    byId.set(project.projectId, project);
  }
  return [...byId.values()];
}

function dedupeChats(chats: ChatTarget[]): ChatTarget[] {
  const byId = new Map<string, ChatTarget>();
  for (const chat of chats) {
    mergeChatTarget(byId, chat);
  }
  return [...byId.values()];
}

function mergeChatTarget(targets: Map<string, ChatTarget>, next: ChatTarget): void {
  const current = targets.get(next.chatId);
  if (!current) {
    targets.set(next.chatId, {
      ...next,
      discoveredFrom: [...next.discoveredFrom],
    });
    return;
  }

  current.title = chooseBetterTitle(current.title, next.title);
  current.url = current.url || next.url;
  current.projectId = current.projectId ?? next.projectId;
  current.projectName = current.projectName ?? next.projectName;
  current.projectPath = current.projectPath ?? next.projectPath;
  current.discoveredFrom = Array.from(new Set([...current.discoveredFrom, ...next.discoveredFrom]));
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

function pad(value: number): string {
  return String(value).padStart(3, "0");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
