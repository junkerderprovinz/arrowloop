import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION_CARD_TEXT } from "@glimstone/core/versionCards";
import { versionLine } from "./versionLine.ts";

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

test("the last check reads as a clock time where Intl.RelativeTimeFormat is missing", async () => {
  const at = new Date(2026, 10, 22, 14, 5);
  const face = await withoutIntl(() => versionLine({ kind: "current", checkedAt: at }, VERSION_CARD_TEXT, "de"));
  assert.equal(face.line, VERSION_CARD_TEXT.current);
  assert.equal(face.note, "14:05");
});

test("the store line needs no relative time at all", async () => {
  const face = await withoutIntl(() => versionLine({ kind: "store", store: "Google Play" }, VERSION_CARD_TEXT));
  assert.equal(face.line, VERSION_CARD_TEXT.store("Google Play"));
});

test("the words of both cards load and build without those constructors", async () => {
  const words = await withoutIntl(async () => (await import("@glimstone/core/componentTexts")).componentText("de"));
  assert.equal(words.versionCard.store("F-Droid"), "Updates kommen über F-Droid.");
  assert.equal(words.componentsCard.title, "Komponenten");
});
