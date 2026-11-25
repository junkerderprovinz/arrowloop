import assert from "node:assert/strict";
import { test } from "node:test";
import { revealScroll } from "./reveal.ts";

// The add row of the shared lists on a 1080x2400 phone at 420 dpi: the name
// field ends 6 points above the keyboard and its button sits under it.
const field = { top: 1500, height: 48 };
const scrolled = 1000;
const visible = 554;
const button = 48 + 8;

test("a focused field near the keyboard scrolls far enough to show the button under it", () => {
  const to = revealScroll(field.top, field.height, scrolled, visible, button);
  assert.ok(to !== null);
  assert.ok(field.top + field.height + button <= to + visible, "the button stays behind the keyboard");
});

test("a field with room under it is left where it is", () => {
  assert.equal(revealScroll(1100, 48, 1000, 554, button), null);
});

test("a field the keyboard covers is brought up with its button", () => {
  const to = revealScroll(1700, 48, 1000, 554, button);
  assert.equal(to, 1700 + 48 + button - 554);
});
