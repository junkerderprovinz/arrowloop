import assert from "node:assert/strict";
import { test } from "node:test";
import { entryNote } from "../../web/src/lib/entryLabel.ts";
import { de } from "../../web/src/lib/i18n.data.ts";
import { translator } from "./translate.ts";

const t = translator(de);
const spell = { lang: "de", moment: (iso: string) => iso };

test("a skip that carries its reason's code reads in the app's language", () => {
  const line = {
    Kind: "skip",
    Side: "",
    Note: "held open by another program on the left side, waiting for it to be closed",
    Code: "heldOpen",
    Vars: { side: "left" },
  };
  assert.equal(entryNote(t, line, spell), "wird links von einem anderen Programm offen gehalten, wartet auf das Schließen");
});

test("a file written to while it was copied says how it grew, in the app's language", () => {
  const line = {
    Kind: "skip",
    Side: "",
    Note: "was being written on the left side while it was copied, in 4 runs in a row, leaving it for the next run. While it was read its size changed from 2048 to 4096 bytes.",
    Code: "inFlux",
    Vars: { side: "left", runs: "4", details: "While it was read its size changed from 2048 to 4096 bytes.", sizeFrom: "2048", sizeTo: "4096" },
  };
  assert.equal(
    entryNote(t, line, spell),
    "wurde links beschrieben, während sie kopiert wurde, und das 4 Läufe hintereinander, bleibt für den nächsten Lauf liegen. Beim Lesen änderte sich die Größe von 2.048 auf 4.096 Byte.",
  );
});

test("a skip from an older engine shows the note it was recorded with", () => {
  const line = { Kind: "skip", Side: "", Note: "copy failed, leaving it for the next run: permission denied" };
  assert.equal(entryNote(t, line, spell), "copy failed, leaving it for the next run: permission denied");
});

test("a reason this build has no sentence for shows the engine's own", () => {
  const line = { Kind: "skip", Side: "", Note: "a reason from a newer engine", Code: "somethingNewer", Vars: { side: "left" } };
  assert.equal(entryNote(t, line, spell), "a reason from a newer engine");
});

test("a sentence missing from a table falls back to English", () => {
  assert.equal(translator({})("side.left"), "left");
});
