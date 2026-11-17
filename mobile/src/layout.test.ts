import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMN, menuRoom, sideRoom } from "./layout.ts";

const GUTTER = 16;

test("a phone keeps its gutter", () => {
  assert.equal(sideRoom(360, GUTTER), GUTTER);
  assert.equal(sideRoom(411, GUTTER), GUTTER);
});

test("a screen just wide enough for the column keeps its gutter", () => {
  assert.equal(sideRoom(COLUMN + 2 * GUTTER, GUTTER), GUTTER);
});

test("a tablet held upright centres the column", () => {
  assert.equal(sideRoom(800, GUTTER), (800 - COLUMN) / 2);
});

test("a tablet held sideways centres the column", () => {
  const room = sideRoom(1280, GUTTER);
  assert.equal(1280 - 2 * room, COLUMN);
});

test("a menu at the end of a phone may reach across to the far gutter", () => {
  assert.equal(menuRoom(411, 85, GUTTER), 411 - 85 - GUTTER);
});

test("a menu on a tablet may grow past a phone's width", () => {
  assert.ok(menuRoom(1280, 24, GUTTER) > 411);
});
