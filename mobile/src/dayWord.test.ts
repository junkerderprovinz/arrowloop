import assert from "node:assert/strict";
import { test } from "node:test";
import { dayWord } from "./dayWord.ts";

const now = new Date(2027, 2, 10, 9, 30);

test("a moment earlier today or just after midnight is today", () => {
  assert.equal(dayWord(new Date(2027, 2, 10, 0, 1), now), "today");
});

test("a moment late last night is yesterday, however few hours ago", () => {
  assert.equal(dayWord(new Date(2027, 2, 9, 23, 50), now), "yesterday");
});

test("a moment within the week names its weekday", () => {
  assert.equal(dayWord(new Date(2027, 2, 8, 12, 0), now), "weekday");
  assert.equal(dayWord(new Date(2027, 2, 4, 12, 0), now), "weekday");
});

test("a moment a week back or more is written as its date", () => {
  assert.equal(dayWord(new Date(2027, 2, 3, 12, 0), now), "date");
});
