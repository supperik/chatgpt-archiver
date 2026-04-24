import test from "node:test";
import assert from "node:assert/strict";
import {
  getChatIdFromUrl,
  getProjectIdFromUrl,
  getProjectPageIdFromUrl,
  getProjectNameFromProjectId,
  isProjectUrl,
  resolveProjectMetadata,
} from "./urlPatterns";

test("getChatIdFromUrl extracts regular chat ids", () => {
  assert.equal(
    getChatIdFromUrl("https://chatgpt.com/c/689e49e8-bf74-832f-8299-861467cb57c9"),
    "689e49e8-bf74-832f-8299-861467cb57c9",
  );
});

test("getChatIdFromUrl extracts project chat ids", () => {
  assert.equal(
    getChatIdFromUrl("https://chatgpt.com/g/g-p-687da3b762d481919d8eed800a57c604-austerreich/c/689f5298-1fa8-8330-adb4-3c6d909ba95a"),
    "689f5298-1fa8-8330-adb4-3c6d909ba95a",
  );
});

test("project url helpers recognize project pages", () => {
  const url = "https://chatgpt.com/g/g-p-686e89247fe481918a75531351153ea4-memoire-jade/project";
  assert.equal(getProjectIdFromUrl(url), "g-p-686e89247fe481918a75531351153ea4-memoire-jade");
  assert.equal(getProjectPageIdFromUrl(url), "g-p-686e89247fe481918a75531351153ea4-memoire-jade");
  assert.equal(isProjectUrl(url), true);
});

test("getProjectIdFromUrl extracts project ids from project chat urls", () => {
  assert.equal(
    getProjectIdFromUrl(
      "https://chatgpt.com/g/g-p-686e89247fe481918a75531351153ea4-memoire-jade/c/689f5298-1fa8-8330-adb4-3c6d909ba95a",
    ),
    "g-p-686e89247fe481918a75531351153ea4-memoire-jade",
  );
});

test("getProjectNameFromProjectId humanizes the project slug", () => {
  assert.equal(
    getProjectNameFromProjectId("g-p-686e89247fe481918a75531351153ea4-memoire-jade"),
    "memoire jade",
  );
});

test("resolveProjectMetadata prefers an explicit project name", () => {
  assert.deepEqual(
    resolveProjectMetadata(
      "https://chatgpt.com/g/g-p-686e89247fe481918a75531351153ea4-memoire-jade/c/689f5298-1fa8-8330-adb4-3c6d909ba95a",
      {
        projectName: "Memoire Jade",
      },
    ),
    {
      projectId: "g-p-686e89247fe481918a75531351153ea4-memoire-jade",
      projectName: "Memoire Jade",
    },
  );
});
