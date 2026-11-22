import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BAR, MORE, railCurrent, railPlaces } from "./nav.ts";

const ALL = { overview: true, anomalies: true, instances: true };

const keys = (shown: Parameters<typeof railPlaces>[0]) => railPlaces(shown).map((p) => p.key);

test("the side bar lists the places in the web rail's order, Settings at its foot", () => {
  assert.deepEqual(keys(ALL), [
    "OverviewTab",
    "JobsTab",
    "ConflictsTab",
    "Anomalies",
    "TrashAll",
    "HistoryTab",
    "TargetList",
    "Instances",
    "SettingsHome",
  ]);
  const foot = railPlaces(ALL).filter((p) => p.footer).map((p) => p.key);
  assert.deepEqual(foot, ["SettingsHome"]);
});

test("the side bar leaves out the overview, the findings and the instances while they are switched off", () => {
  assert.deepEqual(keys({ overview: false, anomalies: false, instances: false }), [
    "JobsTab",
    "ConflictsTab",
    "TrashAll",
    "HistoryTab",
    "TargetList",
    "SettingsHome",
  ]);
});

test("the side bar holds every place the bar and the More sheet hold", () => {
  const rail = new Set(keys(ALL));
  for (const place of BAR) assert.ok(rail.has(place.tab), place.tab);
  for (const place of MORE) assert.ok(rail.has(place.screen), place.screen);
});

test("the side bar draws each place with the glyph and the words the phone uses", () => {
  const rail = railPlaces(ALL);
  for (const place of [...BAR.map((b) => ({ key: b.tab, ...b })), ...MORE.map((m) => ({ key: m.screen, ...m }))]) {
    const same = rail.find((r) => r.key === place.key);
    assert.equal(same?.glyph, place.glyph);
    assert.equal(same?.label, place.label);
  }
});

test("a screen behind More carries the name its menu entry gives it", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  for (const place of MORE) {
    const title = new RegExp(`name="${place.screen}"[^>]*title: t\\("([^"]+)"\\)`).exec(app)?.[1];
    assert.equal(title, place.label, place.screen);
  }
});

test("the side bar counts what the web rail counts", () => {
  const counted = Object.fromEntries(railPlaces(ALL).map((p) => [p.key, p.count ?? null]));
  assert.deepEqual(counted, {
    OverviewTab: null,
    JobsTab: "running",
    ConflictsTab: "conflicts",
    Anomalies: "findings",
    TrashAll: "trash",
    HistoryTab: null,
    TargetList: null,
    Instances: null,
    SettingsHome: null,
  });
});

test("a tab on the bar is lit on the side bar", () => {
  const rail = railPlaces(ALL);
  assert.equal(railCurrent(rail, "JobsTab", undefined), "JobsTab");
  assert.equal(railCurrent(rail, "HistoryTab", undefined), "HistoryTab");
});

test("a place behind More is lit by the screen More opened", () => {
  const rail = railPlaces(ALL);
  assert.equal(railCurrent(rail, "MoreTab", "TrashAll"), "TrashAll");
  assert.equal(railCurrent(rail, "MoreTab", "SettingsHome"), "SettingsHome");
  assert.equal(railCurrent(rail, "MoreTab", "TargetList"), "TargetList");
});

test("wherever the phone was, the side bar lights a place after the tablet turns", () => {
  const rail = railPlaces(ALL);
  for (const place of BAR) assert.notEqual(railCurrent(rail, place.tab, undefined), null);
  for (const place of MORE) assert.notEqual(railCurrent(rail, "MoreTab", place.screen), null);
});

test("each place says where it leads, a tab or a screen behind More", () => {
  const rail = railPlaces(ALL);
  assert.deepEqual(rail.find((p) => p.key === "JobsTab")?.go, { tab: "JobsTab" });
  assert.deepEqual(rail.find((p) => p.key === "TrashAll")?.go, { more: "TrashAll" });
});
