import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AppOptions, BrowserSession } from "../contracts";
import { resolveBrowserExecutablePath } from "./externalBrowser";
import { ensureDir } from "../utils/fs";
import { Logger } from "../utils/log";

export async function createBrowserSession(
  options: AppOptions,
  logger: Logger,
): Promise<BrowserSession> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  if (options.cdpUrl) {
    return createCdpBrowserSession(options, logger, baseUrl);
  }

  await ensureDir(options.profileDir);
  logger.info(`Launching browser context with profile ${options.profileDir}`);

  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: options.headless,
    acceptDownloads: true,
    viewport: {
      width: 1440,
      height: 1024,
    },
  };
  if (options.browserExecutablePath || options.browserFlavor !== "auto") {
    launchOptions.executablePath = await resolveBrowserExecutablePath(options);
  } else if (options.browserChannel) {
    launchOptions.channel = options.browserChannel;
  }

  const context = await chromium.launchPersistentContext(options.profileDir, {
    ...launchOptions,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  await preparePageForArchiving(page, baseUrl, options, logger);
  const userAgent = await page.evaluate(() => navigator.userAgent);

  return {
    baseUrl,
    baseOrigin: new URL(baseUrl).origin,
    page,
    userAgent,
    close: async () => {
      await context.close();
    },
  };
}

async function createCdpBrowserSession(
  options: AppOptions,
  logger: Logger,
  baseUrl: string,
): Promise<BrowserSession> {
  logger.info(`Connecting to existing Chromium over CDP at ${options.cdpUrl}`);
  const browser = await chromium.connectOverCDP(options.cdpUrl!);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => undefined);
    throw new Error(
      "Connected over CDP, but no browser context was exposed. Launch Chrome with remote debugging and keep at least one window open.",
    );
  }

  const page = context.pages()[0] ?? (await context.newPage());
  await preparePageForArchiving(page, baseUrl, options, logger);
  const userAgent = await page.evaluate(() => navigator.userAgent);

  return {
    baseUrl,
    baseOrigin: new URL(baseUrl).origin,
    page,
    userAgent,
    close: async () => {
      await Promise.resolve();
    },
  };
}

async function preparePageForArchiving(
  page: BrowserSession["page"],
  baseUrl: string,
  options: AppOptions,
  logger: Logger,
): Promise<void> {
  await grantPermissions(page, baseUrl);
  await page.bringToFront().catch(() => undefined);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  if (options.manualLogin) {
    logger.warn(
      "Manual login mode enabled. Complete login/CAPTCHA in the opened browser window, then press Enter here.",
    );
    await waitForEnter();
    await page.waitForLoadState("networkidle").catch(() => undefined);
  }

  await ensureAuthorized(page, logger);
}

async function grantPermissions(page: BrowserSession["page"], baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  }).catch(() => undefined);
}

async function ensureAuthorized(page: BrowserSession["page"], logger: Logger): Promise<void> {
  const authState = await readAuthState(page);

  if (authState.looksLikeRobotCheck) {
    throw new Error(
      "ChatGPT opened a robot/CAPTCHA check. Retry with --manual-login, or connect to a normal logged-in Chromium browser via --cdp-url http://127.0.0.1:9222.",
    );
  }

  if (authState.looksLikeAuthPage && !authState.hasChatLinks) {
    throw new Error(
      "ChatGPT session is not authorized in the current browser session. Use --manual-login, or attach to an already logged-in Chromium browser with --cdp-url http://127.0.0.1:9222.",
    );
  }

  logger.info(`Browser preflight succeeded on ${authState.url}`);
}

async function readAuthState(page: BrowserSession["page"]): Promise<{
  url: string;
  hasChatLinks: boolean;
  looksLikeAuthPage: boolean;
  looksLikeRobotCheck: boolean;
}> {
  return page.evaluate(() => {
    const bodyText = document.body.innerText.toLowerCase();
    const locationHref = window.location.href.toLowerCase();
    const authMarkers = [
      "log in",
      "sign up",
      "continue with",
      "password",
      "email address",
    ];
    const robotMarkers = [
      "verify you are human",
      "checking if the site connection is secure",
      "checking your browser before accessing",
      "captcha",
      "are you human",
      "cloudflare",
    ];

    return {
      url: locationHref,
      hasChatLinks: Boolean(document.querySelector("a[href*='/c/']")),
      looksLikeAuthPage:
        locationHref.includes("/auth") ||
        authMarkers.some((marker) => bodyText.includes(marker)),
      looksLikeRobotCheck: robotMarkers.some((marker) => bodyText.includes(marker)),
    };
  });
}

async function waitForEnter(): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    return;
  }

  const rl = createInterface({ input, output });
  try {
    await rl.question("Press Enter after the ChatGPT page is fully opened and authorized. ");
  } finally {
    rl.close();
  }
}

function normalizeBaseUrl(value: string): string {
  const withProtocol = value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
  const url = new URL(withProtocol);
  return url.toString().replace(/\/$/, "");
}
