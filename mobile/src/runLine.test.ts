import assert from "node:assert/strict";
import { test } from "node:test";
import { de, en } from "../../web/src/lib/i18n.data.ts";
import type { Run } from "./api";
import { runFigures } from "./runLine.ts";
import { translator } from "./translate.ts";

const run = (over: Partial<Run>): Run => ({
  ID: 7, Job: "photos", Started: "", Finished: "", Copied: 0, Moved: 0, Trashed: 0, Conflicts: 0,
  DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 0, Err: "", ...over,
});

test("a run's line says what it sent, written the way the reader's language writes numbers", () => {
  const line = runFigures(run({ Copied: 3, Bytes: 2.2 * 1024 ** 3 }), translator(de), "de");
  assert.deepEqual(line, ["kopiert: 3", "übertragen: 2,2 GB"]);
});

test("a run's line reads the same in English", () => {
  const line = runFigures(run({ Copied: 1, Moved: 2, Bytes: 1536 }), translator(en), "en");
  assert.deepEqual(line, ["copied: 1", "moved: 2", "transferred: 1.5 KB"]);
});

test("a run that sent nothing says nothing about bytes", () => {
  assert.deepEqual(runFigures(run({ Trashed: 2, NoTrash: true }), translator(en), "en"), ["deleted: 2"]);
  assert.deepEqual(runFigures(run({ Moved: 1, Bytes: 0 }), translator(en), "en"), ["moved: 1"]);
});

test("a run's line names what it left for later, between what it removed and its conflicts, as the web's columns do", () => {
  const line = runFigures(run({ Copied: 2, Trashed: 1, Skipped: 4, Conflicts: 1 }), translator(en), "en");
  assert.deepEqual(line, ["copied: 2", "trashed: 1", "left for later: 4", "conflicts: 1"]);
});
