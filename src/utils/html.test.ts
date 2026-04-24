import test from "node:test";
import assert from "node:assert/strict";
import { plainTextToHtml, sanitizeHtml } from "./html";

test("sanitizeHtml removes scripts and inline handlers", () => {
  const value = sanitizeHtml('<div onclick="alert(1)"><script>alert(1)</script><a href="javascript:foo()">x</a></div>');
  assert.equal(value, '<div><a href="#">x</a></div>');
});

test("plainTextToHtml renders basic markdown blocks", () => {
  const value = plainTextToHtml("# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```");
  assert.match(value, /<h1>Title<\/h1>/);
  assert.match(value, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(value, /<pre><code data-language="ts">const x = 1;<\/code><\/pre>/);
});

test("plainTextToHtml renders inline markdown safely", () => {
  const value = plainTextToHtml("Use **bold**, *italic*, `code`, and [link](https://example.com).");
  assert.match(value, /<strong>bold<\/strong>/);
  assert.match(value, /<em>italic<\/em>/);
  assert.match(value, /<code>code<\/code>/);
  assert.match(value, /<a href="https:\/\/example\.com">link<\/a>/);
});
