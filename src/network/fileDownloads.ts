import { spawn } from "node:child_process";
import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { FileManifest, FileManifestEntry, FileRef, LogSink } from "../contracts";
import { ensureDir, pathExists, readJsonFileIfExists, toSafeFileName, writeJsonFile } from "../utils/fs";
import { sha256Hex, shortHash } from "../utils/hash";

export interface FileTransport {
  requestMetadata(ref: FileRef): Promise<unknown>;
  downloadToFile(url: string, destPath: string): Promise<{ statusCode: number; contentType?: string }>;
}

export interface FileDownloadSummary {
  downloaded: number;
  cached: number;
  failed: number;
  missing: number;
  skipped: number;
}

export function keyDir(key: string): string {
  return key.startsWith("sandbox:") ? `sandbox-${shortHash(key)}` : key;
}

function manifestPath(filesRoot: string): string {
  return path.join(filesRoot, "manifest.json");
}

export async function readFileManifest(filesRoot: string): Promise<FileManifest> {
  return (await readJsonFileIfExists<FileManifest>(manifestPath(filesRoot))) ?? {};
}

export async function writeFileManifest(filesRoot: string, manifest: FileManifest): Promise<void> {
  await writeJsonFile(manifestPath(filesRoot), manifest);
}

export async function needsDownload(entry: FileManifestEntry | undefined, filesRoot: string): Promise<boolean> {
  if (!entry || entry.status !== "downloaded" || !entry.localPath) {
    return true;
  }
  const absPath = path.join(filesRoot, ...entry.localPath.split("/"));
  if (!(await pathExists(absPath))) {
    return true;
  }
  return entry.sizeBytes !== undefined && entry.sizeBytes !== (await stat(absPath)).size;
}

export async function downloadFilesForChat(
  refs: FileRef[],
  manifest: FileManifest,
  filesRoot: string,
  transport: FileTransport,
  logger: LogSink,
  options: { skip: boolean },
): Promise<FileDownloadSummary> {
  const summary: FileDownloadSummary = { downloaded: 0, cached: 0, failed: 0, missing: 0, skipped: 0 };
  const firstRefByKey = new Map<string, FileRef>();
  const created = new Set<string>();

  for (const ref of refs) {
    if (!manifest[ref.key]) {
      manifest[ref.key] = {
        key: ref.key,
        kind: ref.kind,
        fileName: toSafeFileName(ref.fileName, ref.mimeType),
        mimeType: ref.mimeType,
        status: "skipped",
        seenIn: [],
      };
      created.add(ref.key);
    }
    const entry = manifest[ref.key]!;
    if (!entry.seenIn.some((seen) => seen.chatId === ref.chatId && seen.messageId === ref.messageId)) {
      entry.seenIn.push({ chatId: ref.chatId, messageId: ref.messageId });
    }
    if (!firstRefByKey.has(ref.key)) {
      firstRefByKey.set(ref.key, ref);
    }
  }

  for (const [key, ref] of firstRefByKey) {
    const entry = manifest[key]!;

    if (options.skip) {
      if (created.has(key)) {
        summary.skipped += 1;
      } else {
        summary.cached += 1;
      }
    } else if (!(await needsDownload(entry, filesRoot))) {
      summary.cached += 1;
    } else {
      const outcome = await downloadOne(ref, entry, filesRoot, transport);
      summary[outcome] += 1;
    }

    const suffix = entry.httpStatus !== undefined && entry.status !== "downloaded" ? ` (${entry.httpStatus})` : "";
    logger.info(`File ${key.startsWith("sandbox:") ? keyDir(key) : key} ${entry.fileName}: ${entry.status}${suffix}`);
  }

  return summary;
}

async function downloadOne(
  ref: FileRef,
  entry: FileManifestEntry,
  filesRoot: string,
  transport: FileTransport,
): Promise<"downloaded" | "failed" | "missing"> {
  delete entry.error;
  delete entry.httpStatus;

  let metadata: unknown;
  try {
    metadata = await transport.requestMetadata(ref);
  } catch (error) {
    return recordError(entry, error);
  }

  const json = isRecord(metadata) ? metadata : {};
  if (json.status !== "success" || typeof json.download_url !== "string") {
    entry.status = "missing";
    return "missing";
  }

  const fileName = toSafeFileName(
    asString(json.file_name) ?? ref.fileName,
    asString(json.mime_type) ?? ref.mimeType,
  );
  const localPath = `${keyDir(ref.key)}/${fileName}`;
  const absPath = path.join(filesRoot, keyDir(ref.key), fileName);
  entry.fileName = fileName;
  entry.mimeType = asString(json.mime_type) ?? ref.mimeType;

  let statusCode: number;
  try {
    ({ statusCode } = await transport.downloadToFile(json.download_url, absPath));
  } catch (error) {
    return recordError(entry, error);
  }

  if (statusCode >= 200 && statusCode < 300) {
    entry.status = "downloaded";
    entry.localPath = localPath;
    entry.sha256 = sha256Hex(await readFile(absPath));
    entry.sizeBytes = (await stat(absPath)).size;
    entry.downloadedAt = new Date().toISOString();
    return "downloaded";
  }

  entry.httpStatus = statusCode;
  entry.status = statusCode === 404 ? "missing" : "failed";
  return entry.status;
}

function recordError(entry: FileManifestEntry, error: unknown): "failed" | "missing" {
  const statusCode = isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined;
  if (statusCode === 404) {
    entry.status = "missing";
    entry.httpStatus = 404;
    return "missing";
  }
  entry.status = "failed";
  if (statusCode !== undefined) {
    entry.httpStatus = statusCode;
  }
  entry.error = scrubUrls(error instanceof Error ? error.message : String(error)).slice(0, 200);
  return "failed";
}

function scrubUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, "<url>");
}

export async function curlDownloadToFile(
  url: string,
  headers: Record<string, string>,
  destPath: string,
): Promise<{ statusCode: number; contentType?: string }> {
  const partPath = `${destPath}.part`;
  await ensureDir(path.dirname(destPath));

  const args = ["-sS", "-o", partPath, "-w", "%{http_code} %{content_type}"];
  for (const [name, value] of Object.entries(headers)) {
    args.push("-H", `${name}: ${value}`);
  }
  args.push(url);

  const curlBinary = process.platform === "win32" ? "curl.exe" : "curl";
  const output = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(curlBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("error", (error) => reject(new Error(scrubUrls(error.message))));
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  }).catch(async (error) => {
    await rm(partPath, { force: true });
    throw error;
  });

  const [codeText = "", ...typeParts] = output.stdout.trim().split(" ");
  const statusCode = Number.parseInt(codeText, 10);
  if (output.exitCode !== 0 || !Number.isInteger(statusCode) || statusCode === 0) {
    await rm(partPath, { force: true });
    throw new Error(scrubUrls(`curl exited with code ${output.exitCode ?? "unknown"}: ${output.stderr.slice(0, 300)}`));
  }

  if (statusCode < 200 || statusCode >= 300) {
    await rm(partPath, { force: true });
  } else {
    await rename(partPath, destPath);
  }

  const contentType = typeParts.join(" ").trim();
  return { statusCode, ...(contentType ? { contentType } : {}) };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
