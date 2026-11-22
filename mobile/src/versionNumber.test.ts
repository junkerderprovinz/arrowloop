import assert from "node:assert/strict";
import { test } from "node:test";

import { NUMBER_BESIDE_NAME } from "./versionNumber.ts";

test("a number beside its name gives way and wraps, as a long unreleased one in German does", () => {
  assert.equal(NUMBER_BESIDE_NAME.flexShrink, 1);
  assert.equal(NUMBER_BESIDE_NAME.textAlign, "right");
});
