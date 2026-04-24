import path from "node:path";
import { spawn } from "node:child_process";
import type { AppOptions, BrowserFlavor } from "../contracts";
import { ensureDir, pathExists } from "../utils/fs";
import { Logger } from "../utils/log";

const KNOWN_BROWSER_PATHS: Record<Exclude<BrowserFlavor, "auto">, string[]> = {
  yandex: [
    "C:\\Program Files\\Yandex\\YandexBrowser\\Application\\browser.exe",
    "C:\\Program Files (x86)\\Yandex\\YandexBrowser\\Application\\browser.exe",
  ],
  chrome: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  edge: [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

export async function launchExternalBrowser(options: AppOptions, logger: Logger): Promise<void> {
  const executablePath = await resolveBrowserExecutablePath(options);
  const remoteProfileDir = resolveRemoteDebugProfileDir(options);
  await ensureDir(remoteProfileDir);

  const args = [
    `--remote-debugging-port=${options.remoteDebuggingPort}`,
    `--user-data-dir=${remoteProfileDir}`,
    "--new-window",
    normalizeBaseUrl(options.baseUrl),
  ];

  logger.info(`Launching external browser ${executablePath}`);
  const child = spawn(executablePath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  logger.info(
    `Browser started. CDP endpoint should be available at http://127.0.0.1:${options.remoteDebuggingPort}`,
  );
  logger.info(`Remote debugging profile: ${remoteProfileDir}`);
  logger.warn(
    "If the browser was already running without remote debugging, fully close it first and launch again.",
  );
}

export async function resolveBrowserExecutablePath(options: AppOptions): Promise<string> {
  if (options.browserExecutablePath) {
    if (!(await pathExists(options.browserExecutablePath))) {
      throw new Error(`Browser executable not found: ${options.browserExecutablePath}`);
    }
    return options.browserExecutablePath;
  }

  const flavors = options.browserFlavor === "auto"
    ? (["yandex", "chrome", "edge"] as const)
    : [options.browserFlavor];

  for (const flavor of flavors) {
    for (const candidate of KNOWN_BROWSER_PATHS[flavor]) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  const searched = flavors.flatMap((flavor) => KNOWN_BROWSER_PATHS[flavor]);
  throw new Error(
    `Could not find a browser executable automatically. Searched: ${searched.join(", ")}. Pass --browser-executable-path explicitly.`,
  );
}

function normalizeBaseUrl(value: string): string {
  const withProtocol = value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
  const url = new URL(withProtocol);
  return url.toString().replace(/\/$/, "");
}

function resolveRemoteDebugProfileDir(options: AppOptions): string {
  const suffix = options.browserFlavor === "auto" ? "chromium" : options.browserFlavor;
  return path.join(options.remoteDebugProfileDir, suffix);
}
