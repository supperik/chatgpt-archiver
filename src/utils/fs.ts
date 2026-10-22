import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function readJsonFileIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, value, "utf8");
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const serialized = `${JSON.stringify(value)}\n`;
  await writeFile(filePath, serialized, { encoding: "utf8", flag: "a" });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export function sanitizeFileName(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  const withoutTrailingDots = normalized.replace(/[. ]+$/g, "");
  return withoutTrailingDots || "unnamed";
}

const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_FILE_NAME_LENGTH = 120;

export function toSafeFileName(rawName: string | undefined, mimeType?: string): string {
  const baseName = (rawName ?? "").split(/[/\\]/).pop() ?? "";
  let name = baseName.trim() ? sanitizeFileName(baseName) : `file${extensionFromMime(mimeType)}`;

  if (WINDOWS_RESERVED_STEM.test(name.split(".")[0] ?? "")) {
    name = `_${name}`;
  }

  if (name.length > MAX_FILE_NAME_LENGTH) {
    const ext = path.extname(name);
    name = name.slice(0, MAX_FILE_NAME_LENGTH - ext.length) + ext;
  }
  return name;
}

function extensionFromMime(mimeType: string | undefined): string {
  const subtype = mimeType?.split("/")[1]?.split(/[+;]/)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9]+$/.test(subtype) ? `.${subtype}` : "";
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function uniqueFileName(name: string, taken: Set<string>): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let counter = 2; taken.has(candidate.toLowerCase()); counter += 1) {
    candidate = `${stem} (${counter})${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export async function listSubdirectories(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error != null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
