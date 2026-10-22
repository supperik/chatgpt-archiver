import assert from "node:assert/strict";
import test from "node:test";
import { findMissingCaptureHeaders } from "./fetchCurlResponses";

test("findMissingCaptureHeaders accepts the headers ChatGPT sends today", () => {
  assert.deepEqual(
    findMissingCaptureHeaders({
      authorization: "Bearer x",
      "chatgpt-account-id": "a",
      "oai-did": "d",
      "oai-language": "en-US",
    }),
    [],
  );
});

test("findMissingCaptureHeaders reports a missing authorization", () => {
  assert.deepEqual(findMissingCaptureHeaders({ "chatgpt-account-id": "a" }), ["authorization"]);
  assert.deepEqual(findMissingCaptureHeaders({ authorization: "" }), ["authorization"]);
});
