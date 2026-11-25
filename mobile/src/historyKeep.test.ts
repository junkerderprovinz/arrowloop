import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSwitch, keepOf, keepSetting } from "./historyKeep.ts";

test("the history shows the stored age in days", () => {
  assert.deepEqual(keepOf("720h"), { days: 30, forever: false });
});

test("the history keeps ninety days where nothing is set, as the engine does", () => {
  assert.deepEqual(keepOf(undefined), { days: 90, forever: false });
  assert.deepEqual(keepOf(""), { days: 90, forever: false });
});

test("zero days keeps every run", () => {
  assert.deepEqual(keepOf("0"), { days: 0, forever: true });
});

test("days are saved as hours, since the engine reads a Go duration", () => {
  assert.equal(keepSetting(14), "336h");
  assert.equal(keepSetting(0), "0");
});

test("Keep forever saves zero, and switching it off brings the days back", () => {
  assert.equal(afterSwitch(true, 14), "0");
  assert.equal(afterSwitch(false, 14), "336h");
});

test("switching Keep forever off without days to go back to keeps ninety", () => {
  assert.equal(afterSwitch(false, null), "2160h");
});
