import assert from "node:assert/strict";
import { test } from "node:test";

import { filesFit, rowWidth, runsFit } from "./historyColumns.ts";
import { GUTTER, RAIL, RAIL_NARROW, sceneWidth } from "./layout.ts";

const beside = (window: number, rail = RAIL) => ({ wide: true, width: sceneWidth(window, rail, 0) });

test("a row beside the side bar is the page less its side room and the card's padding", () => {
  assert.equal(rowWidth(beside(840)), 840 - GUTTER - RAIL - 2 * 24 - 2 * 16);
});

test("the run list takes its columns beside the side bar from the narrowest tablet up", () => {
  assert.equal(runsFit(beside(840)), true);
  assert.equal(runsFit(beside(1280)), true);
});

test("the file log stacks its rows where its columns would run out of the card", () => {
  assert.equal(filesFit(beside(840)), false);
  assert.equal(filesFit(beside(840, RAIL_NARROW)), false);
  assert.equal(filesFit(beside(960, RAIL_NARROW)), true);
  assert.equal(filesFit(beside(1280)), true);
});

test("a phone keeps the stacked rows", () => {
  assert.equal(runsFit({ wide: false, width: 411 }), false);
  assert.equal(filesFit({ wide: false, width: 800 }), false);
});
