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
  menuRoom,
  menuTop,
  pageRoom,
  sceneBox,
  titleRow,
  pageTop,
  floatingInset,
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

test("a page on a phone keeps the phone's column, spread or not", () => {
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

test("a menu at the end of a phone may reach across to the far gutter", () => {
  assert.equal(menuRoom(411, 85, PAGE_GUTTER), 411 - 85 - PAGE_GUTTER);
});

test("a menu opens under its button when there is room below it", () => {
  assert.equal(menuTop({ y: 200, height: 56 }, 400, 2400, 48), 200 + 56 + 4);
});

test("a menu with no room below opens above its button, clear of the status bar", () => {
  assert.equal(menuTop({ y: 1100, height: 56 }, 1300, 2400, 48), 48 + 8);
  assert.equal(menuTop({ y: 1900, height: 56 }, 600, 2400, 48), 1900 - 600);
});

test("a menu on a tablet may grow past a phone's width", () => {
  assert.ok(menuRoom(1280, 24, PAGE_GUTTER) > 411);
});

test("a phone's pages keep the pager's own size, since the bar below them clears the navigation bar", () => {
  assert.equal(sceneBox(false, 411, 48), undefined);
});

test("a page beside the side bar stops above the system's navigation bar", () => {
  assert.deepEqual(sceneBox(true, 1179, 48), { width: 1179, paddingBottom: 48 });
});

test("a page beside the settings tiles uses the width the tiles leave", () => {
  assert.equal(pageRoom({ wide: true, width: 900, fill: true }, PAGE_GUTTER, false), WIDE_ROOM);
});

test("a phone's pages keep their title row", () => {
  assert.deepEqual(titleRow(false, true, 24), { shown: true, top: 0 });
  assert.deepEqual(titleRow(false, false, 24), { shown: true, top: 0 });
});

test("beside the side bar a tab's first page has no title row, as the web's pages have none", () => {
  assert.equal(titleRow(true, true, 24).shown, false);
});

test("a first page without its title row keeps clear of the status bar", () => {
  assert.equal(titleRow(true, true, 24).top, 24);
});

test("a page opened from a tab keeps its title row and back arrow beside the side bar", () => {
  assert.deepEqual(titleRow(true, false, 24), { shown: true, top: 0 });
});

test("a page under a title row keeps a sliver above its first card", () => {
  assert.equal(pageTop(true), 4);
});

test("a page without a title row keeps the web's gutter above its first card, level with the side bar", () => {
  assert.equal(pageTop(false), GUTTER);
});

test("a floating action on a phone keeps the gutter from the edge and the bar", () => {
  assert.deepEqual(floatingInset({ wide: false, width: 411 }), { end: 16, bottom: 16 });
  assert.deepEqual(floatingInset({ wide: false, width: 800 }), { end: 16, bottom: 16 });
});

test("a floating action beside the side bar stands where the job list's buttons end", () => {
  const frame = { wide: true, width: 1179 };
  assert.deepEqual(floatingInset(frame), { end: pageRoom(frame, PAGE_GUTTER, true), bottom: 16 });
  assert.equal(floatingInset(frame).end, WIDE_ROOM);
});

test("a floating action on a very wide screen keeps to the list's edge", () => {
  const frame = { wide: true, width: 1800 };
  assert.equal(floatingInset(frame).end, (1800 - WIDE_COLUMN) / 2);
});
