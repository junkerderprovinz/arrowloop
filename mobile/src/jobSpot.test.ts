import assert from "node:assert/strict";
import { test } from "node:test";
import { durationWritten, spotOf } from "./jobSpot.ts";

test("a refused timestamp tolerance is said at its own field", () => {
  assert.equal(spotOf('job "Photos": modWindow "two": time: invalid duration "two"'), "modWindow");
});

test("a refused quiet period is still said at the quiet period", () => {
  assert.equal(spotOf('job "Photos": quietPeriod "x": time: invalid duration "x"'), "quiet");
});

test("an emptied tolerance is written as an exact comparison rather than the global value", () => {
  assert.equal(durationWritten(""), "0s");
  assert.equal(durationWritten("  "), "0s");
});

test("a typed tolerance is written as the engine spells it", () => {
  assert.equal(durationWritten(" 2s "), "2s");
});
