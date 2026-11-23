import assert from "node:assert/strict";
import { test } from "node:test";
import { labelledSide, learnTargets } from "../../web/src/lib/targetLabels.ts";

// SideRow, the folder picker's heading and its list of targets show a side
// through labelledSide.
test("a job's side on a renamed target reads as its name and the folder, never the id", () => {
  learnTargets([{ name: "SFTP-Home-Lab", label: "Home Lab - Keller" }]);
  try {
    assert.equal(labelledSide("SFTP-Home-Lab:home/a"), "Home Lab - Keller: home/a");
    assert.equal(labelledSide("/storage/emulated/0/DCIM"), "/storage/emulated/0/DCIM");
  } finally {
    learnTargets([]);
  }
});
