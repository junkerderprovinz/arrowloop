import assert from "node:assert/strict";
import { test } from "node:test";
import { barFit, jobsBar } from "./jobsBar.ts";

const idle = { ready: 2, running: 0, paused: false, settingsLoaded: true };

test("the bar holds three buttons and no More", () => {
  const bar = jobsBar(idle);
  assert.deepEqual(
    bar.map((b) => b.id),
    ["automatic", "runAll", "add"],
  );
  assert.ok(bar.every((b) => b.label !== "more.title"));
});

test("the job to add is the last button and the only accent", () => {
  const bar = jobsBar(idle);
  assert.equal(bar[2].tone, "accent");
  assert.ok(bar.slice(0, 2).every((b) => b.tone === "neutral"));
});

test("stop all takes the place of run all while a job runs", () => {
  const bar = jobsBar({ ...idle, running: 1 });
  assert.deepEqual(
    bar.map((b) => b.id),
    ["automatic", "stopAll", "add"],
  );
});

test("run all stays in its place but is off when no job is ready", () => {
  const run = jobsBar({ ...idle, ready: 0 })[1];
  assert.equal(run.id, "runAll");
  assert.equal(run.disabled, true);
});

test("automatic runs read as paused or running", () => {
  assert.equal(jobsBar(idle)[0].spoken, "automatic.pause");
  assert.equal(jobsBar({ ...idle, paused: true })[0].spoken, "automatic.resume");
  assert.notEqual(jobsBar({ ...idle, paused: true })[0].glyph, jobsBar(idle)[1].glyph);
});

test("the automatic switch waits for the engine's settings", () => {
  assert.equal(jobsBar({ ...idle, settingsLoaded: false })[0].disabled, true);
});

// A 360 dp phone: 16 dp either side and 8 dp between leaves 104 dp a button.
const narrow = { room: 328, gap: 8, pad: 8, glyph: 16 };

test("short words keep their glyphs on a narrow phone", () => {
  assert.equal(barFit("textGlyph", [56, 50, 28], narrow), "full");
});

test("words that only fit without their glyphs drop the glyphs", () => {
  assert.equal(barFit("textGlyph", [80, 50, 28], narrow), "words");
});

test("a word too long for its share turns the whole row into glyphs", () => {
  assert.equal(barFit("text", [140, 50, 28], narrow), "glyphs");
  assert.equal(barFit("textGlyph", [140, 50, 28], narrow), "glyphs");
});

test("text mode never shows glyphs while the words fit", () => {
  assert.equal(barFit("text", [56, 50, 28], narrow), "words");
});

test("glyph mode shows glyphs whatever the room", () => {
  assert.equal(barFit("glyph", [10, 10, 10], narrow), "glyphs");
  assert.equal(barFit("reactive", [10, 10, 10], narrow), "glyphs");
});

test("an unmeasured row shows glyphs, which always fit", () => {
  assert.equal(barFit("textGlyph", [56, undefined, 28], narrow), "glyphs");
  assert.equal(barFit("textGlyph", [56, 50, 28], { ...narrow, room: 0 }), "glyphs");
});
