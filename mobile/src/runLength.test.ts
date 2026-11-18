import assert from "node:assert/strict";
import { test } from "node:test";
import { runLength } from "./runLength.ts";

const units: Record<string, string> = {
  "anomaly.unit.seconds": "{count} s",
  "anomaly.unit.minutes": "{count} min",
  "anomaly.unit.hours": "{count} h",
};
const t = (key: string, vars?: Record<string, string | number>) =>
  (units[key] ?? key).replace("{count}", String(vars?.count ?? ""));

test("half a minute does not read as a time of day", () => {
  assert.equal(runLength("2026-11-16T20:27:00Z", "2026-11-16T20:27:31Z", t), "31 s");
});

test("a longer run is counted in minutes", () => {
  assert.equal(runLength("2026-11-16T20:00:00Z", "2026-11-16T20:12:20Z", t), "12 min");
});

test("a run still going has no length yet", () => {
  assert.equal(runLength("2026-11-16T20:00:00Z", undefined, t), null);
});
