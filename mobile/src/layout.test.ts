import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLUMN,
  EXPANDED,
  GUTTER,
  MEDIUM,
  PANEL,
  RAIL,
  RAIL_NARROW,
  WIDE_COLUMN,
  WIDE_ROOM,
  pageRoom,
  panelWidth,
  railWidth,
  sceneWidth,
  sideBarShown,
  sideRoom,
  widthClass,
} from "./layout.ts";

const PAGE_GUTTER = 16;

test("a phone keeps its gutter", () => {
  assert.equal(sideRoom(360, PAGE_GUTTER), PAGE_GUTTER);
  assert.equal(sideRoom(411, PAGE_GUTTER), PAGE_GUTTER);
});

test("a screen just wide enough for the column keeps its gutter", () => {
  assert.equal(sideRoom(COLUMN + 2 * PAGE_GUTTER, PAGE_GUTTER), PAGE_GUTTER);
});

test("a tablet held upright centres the column", () => {
  assert.equal(sideRoom(800, PAGE_GUTTER), (800 - COLUMN) / 2);
});

test("a tablet held sideways centres the column", () => {
  const room = sideRoom(1280, PAGE_GUTTER);
  assert.equal(1280 - 2 * room, COLUMN);
});

test("a wider column can be asked for", () => {
  assert.equal(sideRoom(1040, PAGE_GUTTER, Infinity), PAGE_GUTTER);
  assert.equal(sideRoom(1600, PAGE_GUTTER, 1200), 200);
});

test("the width classes break where Material's do", () => {
  assert.equal(widthClass(MEDIUM - 1), "compact");
  assert.equal(widthClass(MEDIUM), "medium");
  assert.equal(widthClass(EXPANDED - 1), "medium");
  assert.equal(widthClass(EXPANDED), "expanded");
  assert.equal(MEDIUM, 600);
  assert.equal(EXPANDED, 840);
});

test("a phone in either orientation keeps the bar along the bottom", () => {
  assert.equal(sideBarShown(360), false);
  assert.equal(sideBarShown(411), false);
  // A large phone on its side is still below the expanded class.
  assert.equal(sideBarShown(780), false);
});

test("a tablet held upright keeps the phone's bar", () => {
  assert.equal(sideBarShown(800), false);
  assert.equal(sideBarShown(600), false);
});

test("an unfolded foldable and half a tablet in split screen keep the phone's bar", () => {
  assert.equal(sideBarShown(673), false);
  assert.equal(sideBarShown(640), false);
});

test("a tablet held sideways gets the side bar", () => {
  assert.equal(sideBarShown(1280), true);
  assert.equal(sideBarShown(960), true);
  assert.equal(sideBarShown(EXPANDED), true);
});

test("the side bar narrows to the web's glyph rail when only glyphs show", () => {
  assert.equal(railWidth("textGlyph"), RAIL);
  assert.equal(railWidth("text"), RAIL);
  assert.equal(railWidth("glyph"), RAIL_NARROW);
  assert.equal(RAIL, 224);
  assert.equal(RAIL_NARROW, 85);
});

test("the pages get what the side bar and its gutter leave of the window", () => {
  assert.equal(sceneWidth(1280, RAIL, 0), 1280 - GUTTER - RAIL);
  assert.equal(sceneWidth(1280, RAIL_NARROW, 0), 1280 - GUTTER - RAIL_NARROW);
});

test("a cutout on the side bar's edge comes off the pages too", () => {
  assert.equal(sceneWidth(1280, RAIL, 32), 1280 - 32 - GUTTER - RAIL);
});

test("a page on a phone keeps the room it always had", () => {
  for (const spread of [false, true]) {
    assert.equal(pageRoom({ wide: false, width: 411 }, PAGE_GUTTER, spread), sideRoom(411, PAGE_GUTTER));
    assert.equal(pageRoom({ wide: false, width: 800 }, PAGE_GUTTER, spread), sideRoom(800, PAGE_GUTTER));
  }
});

test("a list beside the side bar uses the page's width", () => {
  assert.equal(pageRoom({ wide: true, width: 1040 }, PAGE_GUTTER, true), WIDE_ROOM);
});

test("a list on a very wide screen stops growing at the wide column", () => {
  const room = pageRoom({ wide: true, width: 1800 }, PAGE_GUTTER, true);
  assert.equal(1800 - 2 * room, WIDE_COLUMN);
});

test("a form beside the side bar keeps the phone's column", () => {
  const room = pageRoom({ wide: true, width: 1040 }, PAGE_GUTTER, false);
  assert.equal(1040 - 2 * room, COLUMN);
});

test("a sheet beside the side bar is the web's side panel", () => {
  assert.equal(panelWidth(1280), PANEL);
  assert.equal(PANEL, 448);
});

test("a side panel in a narrow window leaves the gutter on both sides", () => {
  assert.equal(panelWidth(400), 400 - 2 * GUTTER);
});
