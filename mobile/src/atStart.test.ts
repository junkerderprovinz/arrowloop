import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneAtStart } from "./atStart.ts";

test("the phone offers to wait or to run a job when it is due", () => {
  assert.deepEqual(phoneAtStart(undefined), ["off", "due"]);
  assert.deepEqual(phoneAtStart("due"), ["off", "due"]);
});

test("a job that runs at every start keeps that choice in sight", () => {
  assert.deepEqual(phoneAtStart(true), ["off", "always", "due"]);
});
