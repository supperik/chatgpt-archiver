import path from "node:path";
import type { AppOptions, BrowserFlavor, CommandName } from "./contracts";
import { launchExternalBrowser } from "./browser/externalBrowser";
import {
  createDefaultFetchOptions,
  fetchNetworkArchive,
  parseFetchArgs,
} from "./network/fetchCurlResponses";
import { importFetchedChats, parseImportArgs } from "./network/importChatResponses";
import { Logger } from "./utils/log";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = parseCommand(argv[0]);
  const rest = command === "help" && argv[0] == null ? [] : argv.slice(command === "help" && argv[0] == null ? 0 : 1);
  const logger = new Logger();

  switch (command) {
    case "help":
      printHelp();
      return;
    case "launch-browser":
      await launchExternalBrowser(parseLaunchBrowserArgs(rest), logger);
      return;
    case "fetch":
      await fetchNetworkArchive(parseFetchArgs(rest), logger);
      return;
    case "run": {
      const options = parseFetchArgs(rest);
      options.command = "run";
      options.importAfterFetch = true;
      await fetchNetworkArchive(options, logger);
      return;
    }
    case "import":
      await importFetchedChats(parseImportArgs(rest));
      return;
  }
}

function parseCommand(value: string | undefined): CommandName {
  switch (value) {
    case undefined:
    case "help":
      return "help";
    case "fetch":
    case "import":
    case "run":
    case "launch-browser":
      return value;
    default:
      throw new Error(`Unknown command: ${value}`);
  }
}

function parseLaunchBrowserArgs(argv: string[]): AppOptions {
  const defaults = createDefaultFetchOptions();
  const options: AppOptions = {
    command: "launch-browser",
    baseUrl: defaults.baseUrl,
    outDir: defaults.outDir,
    profileDir: defaults.profileDir,
    remoteDebugProfileDir: defaults.remoteDebugProfileDir,
    browserFlavor: defaults.browserFlavor,
    remoteDebuggingPort: defaults.remoteDebuggingPort,
    headless: defaults.headless,
    manualLogin: defaults.manualLogin,
  };

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
      case "--browser":
        options.browserFlavor = parseBrowserFlavor(readValue(argv, ++index, arg));
        break;
      case "--browser-channel":
        options.browserChannel = readValue(argv, ++index, arg);
        break;
      case "--browser-executable-path":
        options.browserExecutablePath = path.resolve(readValue(argv, ++index, arg));
        break;
      case "--remote-debugging-port":
        options.remoteDebuggingPort = Number.parseInt(readValue(argv, ++index, arg), 10);
        break;
      case "--cdp-url":
        options.cdpUrl = readValue(argv, ++index, arg);
        break;
      case "--headless":
        options.headless = true;
        break;
      case "--manual-login":
        options.manualLogin = true;
        break;
      default:
        throw new Error(`Unknown argument for launch-browser: ${arg}`);
    }
  }

  if (!Number.isInteger(options.remoteDebuggingPort) || options.remoteDebuggingPort <= 0) {
    throw new Error("--remote-debugging-port must be a positive integer");
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

function printHelp(): void {
  console.log(`
chatgpt-archiver

Usage:
  chatgpt-archiver <command> [options]

Commands:
  fetch          Capture auth headers from an authorized ChatGPT browser and download chat JSON
  import         Build the local archive and HTML from previously fetched chat JSON
  run            Fetch chat JSON and immediately import/render the archive
  launch-browser Launch a Chromium-based browser with remote debugging enabled
  help           Show this help

Shared browser options:
  --base-url <url>            Base ChatGPT URL (default: https://chatgpt.com)
  --out-dir <path>            Archive output directory (default: ./archive)
  --profile-dir <path>        Persistent Playwright profile directory
  --remote-debug-profile-dir <path>
                              Profile dir for launch-browser CDP sessions
  --browser <name>            Browser to auto-detect: auto, yandex, chrome, edge
  --browser-channel <name>    Optional browser channel, for example chrome
  --browser-executable-path <path>
                              Explicit Chromium-based browser executable path
  --cdp-url <url>             Connect to an already running Chromium over CDP
  --remote-debugging-port <n> Remote debugging port (default: 9222)
  --headless                  Run browser in headless mode
  --manual-login              Wait for manual login/CAPTCHA before continuing

Fetch options:
  --non-project-limit <n>         Page size for regular chats (default: 100)
  --projects-limit <n>            Initial project page size (default: 50)
  --project-conversations-limit <n>
                                  Initial per-project chats page size (default: 20)
  --max-sidebar-expansion-rounds <n>
                                  Max rounds of project sidebar expansion (default: 5)
  --import                        After fetch, immediately import and render HTML

Import options:
  --responses-dir <path>      Directory with raw chat JSON (default: ./archive/network/chats)
  --targets-file <path>       Chat target index JSON (default: ./archive/network/discovery/chat-targets.json)
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
