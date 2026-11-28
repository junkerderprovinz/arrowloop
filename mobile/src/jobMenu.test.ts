import assert from "node:assert/strict";
import { test } from "node:test";
import { jobMenu, type CardEntry, type JobMenuActions } from "./jobMenu.ts";

const t = (key: string) => key;
const none = () => {};
const act: JobMenuActions = {
  open: none,
  edit: none,
  duplicate: none,
  preview: none,
  check: none,
  dupes: none,
  trash: none,
  remove: none,
};
const sides = ["Photos", "NAS"] as const;
const rows = (entries: CardEntry[]) => entries.map((e) => (e === "-" ? "-" : e.label));

test("the job card lists every action in the shared groups", () => {
  assert.deepEqual(rows(jobMenu(t, sides, act, "card")), [
    "action.open",
    "action.edit",
    "edit.duplicate",
    "-",
    "jobs.preview",
    "jobs.check",
    "jobs.dupes",
    "nav.trash · Photos",
    "nav.trash · NAS",
    "-",
    "action.delete",
  ]);
});

test("the job's own screen lists what the card does, but Open and Edit, as it is that screen", () => {
  const card = rows(jobMenu(t, sides, act, "card"));
  const screen = rows(jobMenu(t, sides, act, "screen"));
  assert.deepEqual(
    screen,
    card.filter((row) => row !== "action.open" && row !== "action.edit"),
  );
});

test("a job not saved yet shows every action, each one off", () => {
  const entries = jobMenu(t, sides, null, "screen");
  assert.deepEqual(rows(entries), rows(jobMenu(t, sides, act, "screen")));
  assert.ok(entries.every((e) => e === "-" || e.disabled));
});

test("each trash row opens the trash of its own side", () => {
  const opened: string[] = [];
  const entries = jobMenu(t, sides, { ...act, trash: (side, place) => opened.push(`${side} ${place}`) }, "screen");
  for (const e of entries) if (e !== "-" && e.label.startsWith("nav.trash")) e.onPress();
  assert.deepEqual(opened, ["left Photos", "right NAS"]);
});
