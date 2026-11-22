import assert from "node:assert/strict";
import { test } from "node:test";

import { updateLine, VERSION_CARD_TEXT } from "@glimstone/core/versionCards";

/** Runs fn as Hermes would, without the Intl constructors it lacks. */
async function withoutIntl<T>(fn: () => T | Promise<T>): Promise<T> {
  const intl = Intl as unknown as Record<string, unknown>;
  const kept = { RelativeTimeFormat: intl.RelativeTimeFormat, Segmenter: intl.Segmenter, ListFormat: intl.ListFormat };
  for (const name of Object.keys(kept)) delete intl[name];
  try {
    return await fn();
  } finally {
    Object.assign(intl, kept);
  }
}

test("a check today reads as up to date with its clock time where Intl.RelativeTimeFormat is missing", async () => {
  const now = new Date(2026, 10, 22, 16, 0);
  const at = new Date(2026, 10, 22, 14, 5);
  const face = await withoutIntl(() => updateLine({ kind: "current", checkedAt: at }, VERSION_CARD_TEXT, now));
  assert.equal(face.line, VERSION_CARD_TEXT.current);
  assert.match(face.note ?? "", /14[:.]05|2:05/);
});

test("the store and the release page need no relative time at all", async () => {
  const store = await withoutIntl(() => updateLine({ kind: "store", store: "Google Play" }, VERSION_CARD_TEXT));
  const direct = await withoutIntl(() => updateLine({ kind: "direct" }, VERSION_CARD_TEXT));
  assert.equal(store.line, VERSION_CARD_TEXT.store("Google Play"));
  assert.equal(direct.line, VERSION_CARD_TEXT.direct);
});

test("the words of both cards load and build without those constructors", async () => {
  const words = await withoutIntl(async () => (await import("@glimstone/core/componentTexts")).componentText("de"));
  assert.equal(words.versionCard.store("F-Droid"), "Updates kommen über F-Droid.");
  assert.equal(words.componentsCard.title, "Komponenten");
});
