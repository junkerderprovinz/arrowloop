import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../../web/src/lib/i18n.data.ts";
import { rootActions, rootStatus, shizukuStatus, switchesHeld, type RootAnswer, type ShizukuState } from "./rootCard.ts";

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

const off = { appDataOn: false, rootTargetOn: false };

test("the whole file system waits for root, and says so", () => {
  for (const rootAnswer of answers) {
    const why = switchesHeld({ ...off, rootAnswer, shizukuState: "ready" }).rootTarget;
    assert.equal(why, rootAnswer === "granted" ? null : "phone.rootTargetNeedsRoot", rootAnswer);
  }
});

test("Android/data waits for root or a ready Shizuku, and says so", () => {
  for (const rootAnswer of answers) {
    for (const shizukuState of shizukus) {
      const why = switchesHeld({ ...off, rootAnswer, shizukuState }).appData;
      const usable = rootAnswer === "granted" || shizukuState === "ready";
      assert.equal(why, usable ? null : "phone.appDataNeedsAccess", `${rootAnswer} ${shizukuState}`);
    }
  }
});

test("a switch that is on can always be switched off", () => {
  const held = switchesHeld({ appDataOn: true, rootTargetOn: true, rootAnswer: "absent", shizukuState: "missing" });
  assert.deepEqual(held, { appData: null, rootTarget: null });
});

test("the reasons are words the app has", () => {
  const held = switchesHeld({ ...off, rootAnswer: "absent", shizukuState: "missing" });
  for (const key of [held.appData, held.rootTarget]) assert.ok(key && key in en, String(key));
});
