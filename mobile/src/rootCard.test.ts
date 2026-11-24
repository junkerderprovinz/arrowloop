import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../../web/src/lib/i18n.data.ts";
import { rootActions, rootStatus, shizukuStatus, type RootAnswer, type ShizukuState } from "./rootCard.ts";

const answers: RootAnswer[] = ["granted", "denied", "absent", "unknown"];
const shizukus: ShizukuState[] = ["ready", "denied", "stopped", "missing"];

test("root can be asked for until su grants it", () => {
  for (const rootAnswer of answers) {
    assert.equal(rootActions({ rootAnswer, shizukuState: "ready" }).requestRoot, rootAnswer !== "granted", rootAnswer);
  }
});

test("Shizuku is asked for its permission only while it runs without one", () => {
  for (const shizukuState of shizukus) {
    assert.equal(rootActions({ rootAnswer: "granted", shizukuState }).askShizuku, shizukuState === "denied", shizukuState);
  }
});

test("Shizuku is offered for download only while it is missing", () => {
  for (const shizukuState of shizukus) {
    assert.equal(rootActions({ rootAnswer: "granted", shizukuState }).getShizuku, shizukuState === "missing", shizukuState);
  }
});

test("every state of root and of Shizuku reads differently, in words the app has", () => {
  const roots = answers.map(rootStatus);
  const shizukuWords = shizukus.map(shizukuStatus);
  assert.equal(new Set(roots).size, answers.length);
  assert.equal(new Set(shizukuWords).size, shizukus.length);
  for (const key of [...roots, ...shizukuWords]) assert.ok(key in en, key);
});
