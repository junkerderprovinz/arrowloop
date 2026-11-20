import assert from "node:assert/strict";
import { test } from "node:test";
import { TILE_IDS } from "../../web/src/lib/routes.ts";
import { SECTION_TILE, TILE_COLUMN, paneWidth, settingsTiles, shownTile, type SectionId } from "./settingsTiles.ts";
import { WIDE_ROOM } from "./layout.ts";

const ids = (pairable: boolean, vpn = true) => settingsTiles({ pairable, vpn }).map((tile) => tile.id);
const every = { pairable: true, vpn: true };

test("the tiles stand in the web's order, General first and Info last", () => {
  const tiles = ids(true);
  assert.equal(tiles[0], "general");
  assert.equal(tiles[1], "look");
  assert.equal(tiles.at(-1), "info");
  assert.equal(tiles.at(-2), "apps");
  const web = TILE_IDS.filter((id) => (tiles as string[]).includes(id));
  assert.deepEqual(tiles, web);
});

test("the phone offers every web tile it has something for", () => {
  assert.deepEqual(ids(true), ["general", "look", "sync", "targets", "integrations", "pairing", "apps", "info"]);
});

test("an engine without the built-in VPN has no integrations tile", () => {
  assert.ok(!ids(true, false).includes("integrations"));
});

test("an engine that cannot be paired has no pairing tile", () => {
  assert.ok(!ids(false).includes("pairing"));
});

test("the tiles carry the web's words and glyphs", () => {
  const byId = Object.fromEntries(settingsTiles(every).map((tile) => [tile.id, tile]));
  assert.equal(byId.general?.label, "settings.general");
  assert.equal(byId.general?.glyph, "IconTabGeneral");
  assert.equal(byId.look?.label, "settings.look");
  assert.equal(byId.look?.glyph, "IconTabLook");
  assert.equal(byId.apps?.label, "settings.apps");
  assert.equal(byId.apps?.glyph, "IconTabApp");
  assert.equal(byId.info?.label, "settings.info");
  assert.equal(byId.info?.glyph, "IconInfo");
  assert.equal(byId.integrations?.label, "settings.integrations");
  assert.equal(byId.integrations?.glyph, "IconPlug");
});

test("sync, targets and pairing show their own screens beside the tiles", () => {
  const byId = Object.fromEntries(settingsTiles(every).map((tile) => [tile.id, tile.screen]));
  assert.deepEqual(byId, {
    general: undefined,
    look: undefined,
    sync: "Sync",
    targets: "TargetList",
    integrations: undefined,
    pairing: "Pairing",
    apps: undefined,
    info: undefined,
  });
});

test("each card of the phone's settings page lands on the tile the web keeps it on", () => {
  const on = (tile: string) =>
    (Object.keys(SECTION_TILE) as SectionId[]).filter((section) => SECTION_TILE[section] === tile);
  assert.deepEqual(on("general"), ["thisPhone", "engine", "backup", "autoBackup", "danger"]);
  assert.deepEqual(on("look"), ["language", "appearance", "motion"]);
  assert.deepEqual(on("apps"), ["server", "desktop"]);
  assert.deepEqual(on("info"), ["problems", "about"]);
  assert.deepEqual(on("integrations"), ["integrations"]);
});

test("a tile without a screen of its own always has cards to show", () => {
  for (const tile of settingsTiles(every)) {
    if (tile.screen) continue;
    assert.ok(Object.values(SECTION_TILE).includes(tile.id), tile.id);
  }
});

test("the settings open on General", () => {
  assert.equal(shownTile(settingsTiles(every), null), "general");
});

test("a picked tile stays shown", () => {
  assert.equal(shownTile(settingsTiles(every), "apps"), "apps");
});

test("a tile that went away gives way to General", () => {
  assert.equal(shownTile(settingsTiles({ pairable: false, vpn: true }), "pairing"), "general");
});

test("the page beside the tiles gets what the tile column and its gutter leave", () => {
  assert.equal(paneWidth(1040), 1040 - WIDE_ROOM - TILE_COLUMN);
  assert.equal(TILE_COLUMN, 204);
});
