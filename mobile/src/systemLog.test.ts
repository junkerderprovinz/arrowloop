import assert from "node:assert/strict";
import { test } from "node:test";
import { de, en } from "../../web/src/lib/i18n.data.ts";
import type { SystemLine } from "./api";
import { logRows } from "./systemLog.ts";
import { translator } from "./translate.ts";

const line = (over: Partial<SystemLine>): SystemLine => ({
  ID: 1, At: "2027-03-01T12:00:00Z", Source: "rclone", Text: "Failed to copy: disk full", Count: 1, ...over,
});

test("each line names its source in the reader's language and keeps the engine's words", () => {
  const rows = logRows(
    [
      line({ ID: 3, Source: "connection", Text: "nas: no such host" }),
      line({ ID: 2, Source: "integration", Text: "fortress: could not join the fortress" }),
      line({ ID: 1, Source: "rclone" }),
    ],
    translator(de),
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.source, r.text]),
    [
      [3, "Verbindung", "nas: no such host"],
      [2, "Integration", "fortress: could not join the fortress"],
      [1, "rclone", "Failed to copy: disk full"],
    ],
  );
});

test("a line that came several times in a row says how often, and one that came once says nothing", () => {
  const [repeated, once] = logRows([line({ ID: 2, Count: 4 }), line({ ID: 1, Count: 1 })], translator(en));
  assert.equal(repeated?.repeat, "4×");
  assert.equal(once?.repeat, null);
});

test("the time of a line is the last time it came", () => {
  const [row] = logRows([line({ At: "2027-03-01T12:02:00Z", Count: 3 })], translator(en));
  assert.equal(row?.at, "2027-03-01T12:02:00Z");
});
