import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { FileManifest, FileRef, LogSink } from "../contracts";
import { sha256Hex } from "../utils/hash";
import {
  curlDownloadToFile,
  downloadFilesForChat,
  keyDir,
  type FileTransport,
} from "./fileDownloads";

function makeLogger(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  const push = (message: string): void => {
    lines.push(message);
  };
  return { lines, info: push, warn: push, error: push };
}

function makeRef(overrides: Partial<FileRef> = {}): FileRef {
  return { key: "file_1", kind: "attachment", chatId: "c1", messageId: "m1", role: "user", ...overrides };
}

function makeTransport(body = "abc", calls: string[] = []): FileTransport {
  return {
    async requestMetadata() {
      return {
        status: "success",
        download_url: "https://files.example/x?sig=abc",
        file_name: "a.pdf",
        mime_type: "application/pdf",
        file_size_bytes: body.length,
      };
    },
    async downloadToFile(url, destPath) {
      calls.push(url);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, body);
      return { statusCode: 200 };
    },
  };
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "archiver-files-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const OPTIONS = { skip: false };

test("downloads an attachment and records it", async () => {
  await withTempDir(async (root) => {
    const manifest: FileManifest = {};
    const logger = makeLogger();
    const summary = await downloadFilesForChat([makeRef()], manifest, root, makeTransport(), logger, OPTIONS);

    assert.equal(summary.downloaded, 1);
    const entry = manifest.file_1!;
    assert.equal(entry.status, "downloaded");
    assert.equal(entry.localPath, "file_1/a.pdf");
    assert.equal(entry.sizeBytes, 3);
    assert.equal(entry.sha256, sha256Hex("abc"));
    assert.equal(await fs.readFile(path.join(root, "file_1", "a.pdf"), "utf8"), "abc");
    assert.deepEqual(logger.lines, ["File file_1 a.pdf: downloaded"]);
    assert.ok(logger.lines.every((line) => !line.includes("sig=") && !line.includes("https://")));
  });
});

test("downloads a shared key once", async () => {
  await withTempDir(async (root) => {
    const manifest: FileManifest = {};
    const calls: string[] = [];
    const transport = makeTransport("abc", calls);
    await downloadFilesForChat([makeRef({ chatId: "c1" })], manifest, root, transport, makeLogger(), OPTIONS);
    const summary = await downloadFilesForChat(
      [makeRef({ chatId: "c2", messageId: "m2" })], manifest, root, transport, makeLogger(), OPTIONS,
    );

    assert.equal(calls.length, 1);
    assert.equal(summary.cached, 1);
    assert.deepEqual(manifest.file_1!.seenIn, [
      { chatId: "c1", messageId: "m1" },
      { chatId: "c2", messageId: "m2" },
    ]);
  });
});

test("re-downloads when file missing or size differs", async () => {
  await withTempDir(async (root) => {
    const manifest: FileManifest = {};
    const calls: string[] = [];
    const transport = makeTransport("abc", calls);
    await downloadFilesForChat([makeRef()], manifest, root, transport, makeLogger(), OPTIONS);

    await fs.rm(path.join(root, "file_1", "a.pdf"));
    await downloadFilesForChat([makeRef()], manifest, root, transport, makeLogger(), OPTIONS);
    assert.equal(calls.length, 2);

    await fs.writeFile(path.join(root, "file_1", "a.pdf"), "ab");
    await downloadFilesForChat([makeRef()], manifest, root, transport, makeLogger(), OPTIONS);
    assert.equal(calls.length, 3);
    assert.equal(await fs.readFile(path.join(root, "file_1", "a.pdf"), "utf8"), "abc");
  });
});

test("maps 404 to missing and other errors to failed", async () => {
  await withTempDir(async (root) => {
    const notFound: FileTransport = {
      async requestMetadata() {
        throw Object.assign(new Error("nope"), { statusCode: 404 });
      },
      async downloadToFile() {
        throw new Error("unreachable");
      },
    };
    const manifest: FileManifest = {};
    const first = await downloadFilesForChat([makeRef()], manifest, root, notFound, makeLogger(), OPTIONS);
    assert.equal(first.missing, 1);
    assert.equal(manifest.file_1!.status, "missing");

    const unauthorized: FileTransport = {
      ...notFound,
      async requestMetadata() {
        throw Object.assign(new Error("Request failed 401 for https://chatgpt.com/x?sig=abc"), { statusCode: 401 });
      },
    };
    const logger = makeLogger();
    const second = await downloadFilesForChat([makeRef()], manifest, root, unauthorized, logger, OPTIONS);
    assert.equal(second.failed, 1);
    const entry = manifest.file_1!;
    assert.equal(entry.status, "failed");
    assert.equal(entry.httpStatus, 401);
    assert.ok(!entry.error!.includes("sig="));
    assert.ok(!entry.error!.includes("https://"));
    assert.ok(logger.lines.every((line) => !line.includes("sig=") && !line.includes("https://")));
  });
});

test("retries failed entries on next call", async () => {
  await withTempDir(async (root) => {
    const manifest: FileManifest = {};
    const broken: FileTransport = {
      async requestMetadata() {
        throw new Error("boom");
      },
      async downloadToFile() {
        throw new Error("unreachable");
      },
    };
    await downloadFilesForChat([makeRef()], manifest, root, broken, makeLogger(), OPTIONS);
    assert.equal(manifest.file_1!.status, "failed");

    const summary = await downloadFilesForChat([makeRef()], manifest, root, makeTransport(), makeLogger(), OPTIONS);
    assert.equal(summary.downloaded, 1);
    assert.equal(manifest.file_1!.status, "downloaded");
  });
});

test("skip marks only absent entries", async () => {
  await withTempDir(async (root) => {
    const calls: string[] = [];
    const transport = makeTransport("abc", calls);
    const manifest: FileManifest = {};
    await downloadFilesForChat([makeRef()], manifest, root, transport, makeLogger(), OPTIONS);
    calls.length = 0;

    const summary = await downloadFilesForChat(
      [makeRef(), makeRef({ key: "file_2" })], manifest, root, transport, makeLogger(), { skip: true },
    );

    assert.equal(calls.length, 0);
    assert.equal(manifest.file_1!.status, "downloaded");
    assert.equal(manifest.file_2!.status, "skipped");
    assert.equal(summary.skipped, 1);
    assert.equal(summary.cached, 1);
  });
});

test("sandbox refs use a hashed directory", () => {
  assert.match(keyDir("sandbox:c:m:/mnt/data/x.zip"), /^sandbox-[0-9a-f]{16}$/);
  assert.equal(keyDir("file_1"), "file_1");
});

async function withServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/f`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("curlDownloadToFile writes the body and sends headers", async () => {
  await withTempDir(async (root) => {
    await withServer((req, res) => {
      if (req.headers.cookie === "a=1") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("payload");
      } else {
        res.writeHead(401);
        res.end();
      }
    }, async (url) => {
      const dest = path.join(root, "nested", "out.txt");
      const result = await curlDownloadToFile(url, { cookie: "a=1" }, dest);
      assert.equal(result.statusCode, 200);
      assert.equal(result.contentType, "text/plain");
      assert.equal(await fs.readFile(dest, "utf8"), "payload");
    });
  });
});

test("curlDownloadToFile leaves no file on 403", async () => {
  await withTempDir(async (root) => {
    await withServer((_req, res) => {
      res.writeHead(403);
      res.end("denied");
    }, async (url) => {
      const dest = path.join(root, "out.txt");
      const result = await curlDownloadToFile(url, {}, dest);
      assert.equal(result.statusCode, 403);
      assert.deepEqual(await fs.readdir(root), []);
    });
  });
});
